#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  getTransferFeeConfig,
  createTransferCheckedWithFeeInstruction
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadWallet, loadWalletFromPrivateKey, loadWalletFromEnv } from '../../utils/wallet';

program
  .name('transfer-checked')
  .description('Transfer tokens with checked instruction')
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name')
  .option('--private-key <string>', 'Private key as a JSON array of numbers')
  .option('--private-key-env <string>', 'Environment variable containing the private key')
  .option('--mint <string>', 'Token mint address')
  .option('--recipient <string>', 'Recipient wallet address')
  .option('--amount <number>', 'Amount of tokens to transfer')
  .parse(process.argv);

const options = program.opts();

// Get RPC URL based on environment
function getRpcUrl(env: string): string {
  switch (env) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    case 'testnet':
      return 'https://api.testnet.solana.com';
    case 'devnet':
      return 'https://api.devnet.solana.com';
    case 'local':
      return 'http://localhost:8899';
    default:
      return 'https://api.testnet.solana.com';
  }
}

async function main() {
  console.log(chalk.green('Transferring tokens with fee...'));
  
  // Check required parameters
  if (!options.wallet && !options.privateKey && !options.privateKeyEnv) {
    console.error(chalk.red('Either wallet name (--wallet), private key (--private-key), or private key environment variable (--private-key-env) is required'));
    process.exit(1);
  }
  
  if (!options.mint) {
    console.error(chalk.red('Mint address (--mint) is required'));
    process.exit(1);
  }
  
  if (!options.recipient) {
    console.error(chalk.red('Recipient address (--recipient) is required'));
    process.exit(1);
  }
  
  if (!options.amount) {
    console.error(chalk.red('Amount (--amount) is required'));
    process.exit(1);
  }
  
  // Get the RPC URL
  const rpcUrl = getRpcUrl(options.env);
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  // Create a connection to the cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load the wallet
  let wallet: Keypair;
  try {
    if (options.privateKeyEnv) {
      // Load from environment variable
      console.log(chalk.blue(`Loading wallet from environment variable: ${options.privateKeyEnv}`));
      wallet = loadWalletFromEnv(options.privateKeyEnv);
    } else if (options.privateKey) {
      // Load from provided private key
      console.log(chalk.blue(`Loading wallet from provided private key`));
      wallet = loadWalletFromPrivateKey(options.privateKey);
    } else {
      // Load from wallet file
      console.log(chalk.blue(`Loading wallet: ${options.wallet}`));
      wallet = loadWallet(options.wallet);
    }
    console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toString()}`));
    
    // Get wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(chalk.blue(`Wallet balance: ${balance / 10**9} SOL`));
  } catch (error) {
    console.error(chalk.red(`Error loading wallet: ${error}`));
    process.exit(1);
  }
  
  // Parse mint address
  const mint = new PublicKey(options.mint);
  
  // Parse recipient address
  const recipient = new PublicKey(options.recipient);
  
  // Get the mint info
  const mintInfo = await getMint(connection, mint, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(chalk.blue(`Token decimals: ${mintInfo.decimals}`));
  
  // Calculate the amount in base units
  const amount = BigInt(options.amount * 10**mintInfo.decimals);
  
  // Get the source token account
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Check if the source token account exists
  try {
    const sourceAccount = await getAccount(connection, sourceTokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    console.log(chalk.blue(`Source token account: ${sourceAccount.address.toString()}`));
    console.log(chalk.blue(`Source token balance: ${Number(sourceAccount.amount) / 10**mintInfo.decimals}`));
    
    if (sourceAccount.amount < amount) {
      console.error(chalk.red(`Insufficient token balance. You have ${Number(sourceAccount.amount) / 10**mintInfo.decimals} tokens, but tried to transfer ${options.amount} tokens.`));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red(`Source token account not found: ${error}`));
    process.exit(1);
  }
  
  // Get the destination token account
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Create a transaction
  const transaction = new Transaction();
  
  // Get a recent blockhash with a longer validity window and log the details
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('processed');
  const currentBlockHeight = await connection.getBlockHeight('processed');
  console.log(chalk.blue(`Current block height: ${currentBlockHeight}`));
  console.log(chalk.blue(`Last valid block height: ${lastValidBlockHeight}`));
  console.log(chalk.blue(`Validity window: ${lastValidBlockHeight - currentBlockHeight} blocks`));
  
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = wallet.publicKey;
  
  // Check if the destination token account exists
  try {
    await getAccount(connection, destinationTokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
    console.log(chalk.blue(`Destination token account exists: ${destinationTokenAccount.toString()}`));
  } catch (error) {
    // If the account doesn't exist, create it
    console.log(chalk.blue(`Creating destination token account: ${destinationTokenAccount.toString()}`));
    transaction.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        destinationTokenAccount,
        recipient,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Get transfer fee config if available
  let fee = BigInt(0);
  try {
    const transferFeeConfig = getTransferFeeConfig(mintInfo);
    if (transferFeeConfig) {
      console.log(chalk.blue(`Transfer fee: ${transferFeeConfig.newerTransferFee.transferFeeBasisPoints / 100}%`));
      console.log(chalk.blue(`Maximum fee: ${Number(transferFeeConfig.newerTransferFee.maximumFee) / 10**mintInfo.decimals} tokens`));
      
      // Calculate the fee
      const feeBasisPoints = transferFeeConfig.newerTransferFee.transferFeeBasisPoints;
      const maxFee = transferFeeConfig.newerTransferFee.maximumFee;
      
      // Calculate fee: amount * feeBasisPoints / 10000
      // Note: We need to calculate this exactly as the program does
      const numerator = amount * BigInt(feeBasisPoints);
      const denominator = BigInt(10000);
      fee = numerator / denominator;
      
      // Cap at maximum fee if set
      if (maxFee > BigInt(0) && fee > maxFee) {
        fee = maxFee;
      }
      
      console.log(chalk.blue(`Calculated fee: ${fee} (${Number(fee) / 10**mintInfo.decimals} tokens)`));
    }
  } catch (error) {
    console.log(chalk.yellow(`No transfer fee config found: ${error}`));
  }
  
  // Add the transfer instruction with fee
  transaction.add(
    createTransferCheckedWithFeeInstruction(
      sourceTokenAccount,
      mint,
      destinationTokenAccount,
      wallet.publicKey,
      amount,
      mintInfo.decimals,
      BigInt(0), // Let the program calculate the fee
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Send the transaction with increased priority
  const spinnerTransaction = ora('Sending transaction...').start();
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      {
        commitment: 'confirmed',
        maxRetries: 5,
        skipPreflight: true,
        preflightCommitment: 'processed'
      }
    );
    
    spinnerTransaction.succeed(`Transaction sent: ${signature}`);
    
    // Display transfer details
    console.log(chalk.green('\nTransfer Summary:'));
    console.log(chalk.blue(`From: ${wallet.publicKey.toString()}`));
    console.log(chalk.blue(`To: ${recipient.toString()}`));
    console.log(chalk.blue(`Amount: ${options.amount} tokens`));
    console.log(chalk.blue(`Fee: ${Number(fee) / 10**mintInfo.decimals} tokens`));
    console.log(chalk.blue(`Recipient receives: ${(options.amount - Number(fee) / 10**mintInfo.decimals).toFixed(mintInfo.decimals)} tokens`));
    
    console.log(chalk.yellow('\nTo check for withheld fees, run:'));
    console.log(chalk.blue(`npm run check-withheld-fees:${options.env} -- --wallet=${options.wallet} --mint=${options.mint}`));
    
    console.log(chalk.yellow('\nTo harvest fees, run:'));
    console.log(chalk.blue(`npm run harvest-fees:${options.env} -- --wallet=${options.wallet} --mint=${options.mint}`));
  } catch (error) {
    spinnerTransaction.fail(`Transaction failed: ${error}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});