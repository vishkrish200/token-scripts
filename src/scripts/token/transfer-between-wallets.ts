#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  ExtensionType,
  getTransferFeeConfig,
  createTransferCheckedInstruction,
  unpackAccount
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name', 'wallet-1741011852572')
  .option('--mint <string>', 'Token mint address')
  .option('--amount <number>', 'Amount to transfer', '100')
  .option('--count <number>', 'Number of wallets to transfer to', '3')
  .parse(process.argv);

const options = program.opts();

// Get the RPC URL based on the environment
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

// Load a keypair from a file
function loadKeypair(filePath: string): Keypair {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const keypairData = JSON.parse(fileContent);
  
  if (Array.isArray(keypairData)) {
    // Handle array format
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  } else if (keypairData.secretKey) {
    // Handle object format with base64 encoded secretKey
    const secretKeyString = keypairData.secretKey;
    const secretKey = Buffer.from(secretKeyString, 'base64');
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  } else {
    throw new Error(`Invalid keypair format in file: ${filePath}`);
  }
}

// Function to get all wallet keypairs in a directory
function getAllWallets(walletDir: string): Keypair[] {
  if (!fs.existsSync(walletDir)) {
    throw new Error(`Wallet directory not found: ${walletDir}`);
  }
  
  // Get all files in the directory
  const files = fs.readdirSync(walletDir);
  
  // Filter for JSON files
  const jsonFiles = files.filter(file => file.endsWith('.json'));
  
  // Load each keypair
  return jsonFiles.map(file => loadKeypair(path.join(walletDir, file)));
}

async function main() {
  console.log(chalk.green('Transferring tokens between wallets...'));
  
  // Get the RPC URL
  const rpcUrl = getRpcUrl(options.env);
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  // Create a connection to the cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load the wallet
  const walletsDir = path.join(process.cwd(), 'wallets', options.env);
  const walletFile = path.join(walletsDir, `${options.wallet}.json`);
  const wallet = loadKeypair(walletFile);
  console.log(chalk.blue(`Main Wallet: ${wallet.publicKey.toString()}`));
  
  // Check the wallet balance
  const walletBalance = await connection.getBalance(wallet.publicKey);
  console.log(chalk.blue(`Wallet balance: ${walletBalance / 10**9} SOL`));
  
  // Get mint address
  if (!options.mint) {
    console.error(chalk.red('Mint address is required. Use --mint=<address>'));
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  console.log(chalk.blue(`Mint address: ${mintAddress.toString()}`));
  
  // Get all wallets
  const allWallets = getAllWallets(walletsDir);
  console.log(chalk.blue(`Found ${allWallets.length} wallets`));
  
  // Get the mint info
  const mint = await getMint(connection, mintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const decimals = mint.decimals;
  console.log(chalk.blue(`Token decimals: ${decimals}`));
  
  // Calculate the amount in raw units
  const amount = BigInt(parseInt(options.amount) * 10**decimals);
  console.log(chalk.blue(`Transfer amount: ${options.amount} tokens (${amount} raw)`));
  
  // Check if the mint has the transfer fee extension
  let transferFeeConfig;
  let feeBasisPoints = 1000; // Default to 10%
  let maxFee = BigInt(0);
  
  try {
    // Try to get the transfer fee config directly from the mint info
    transferFeeConfig = getTransferFeeConfig(mint);
    
    if (transferFeeConfig) {
      feeBasisPoints = transferFeeConfig.newerTransferFee.transferFeeBasisPoints;
      maxFee = transferFeeConfig.newerTransferFee.maximumFee;
      console.log(chalk.blue(`Transfer fee: ${feeBasisPoints / 100}%`));
      if (maxFee > BigInt(0)) {
        console.log(chalk.blue(`Maximum fee: ${maxFee}`));
      } else {
        console.log(chalk.blue(`Maximum fee: None (unlimited)`));
      }
    } else {
      console.log(chalk.yellow('Token does not have the transfer fee extension'));
    }
  } catch (error) {
    console.error(chalk.red('Error getting transfer fee config:'), error);
  }
  
  // Calculate the fee
  const calculatedFee = (amount * BigInt(feeBasisPoints)) / BigInt(10000);
  const fee = maxFee > BigInt(0) && calculatedFee > maxFee ? maxFee : calculatedFee;
  console.log(chalk.blue(`Calculated fee per transfer: ${fee} (${Number(fee) / 10**decimals} tokens)`));
  
  // Get source token account
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Get the token account info
  try {
    const tokenAccountInfo = await getAccount(
      connection,
      sourceTokenAccount,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(chalk.blue(`Token account balance: ${tokenAccountInfo.amount} (${Number(tokenAccountInfo.amount) / 10**decimals} tokens)`));
    
    // Check if balance is enough for transfers
    const totalAmount = amount * BigInt(parseInt(options.count));
    if (tokenAccountInfo.amount < totalAmount) {
      console.error(chalk.red(`Insufficient balance. Required: ${totalAmount} (${Number(totalAmount) / 10**decimals} tokens), Available: ${tokenAccountInfo.amount} (${Number(tokenAccountInfo.amount) / 10**decimals} tokens)`));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('Error getting token account:'), error);
    process.exit(1);
  }
  
  // Get wallets to transfer to
  const transferCount = parseInt(options.count);
  const walletIndex = allWallets.findIndex(w => w.publicKey.toString() === wallet.publicKey.toString());
  if (walletIndex === -1) {
    console.error(chalk.red('Main wallet not found in wallet directory'));
    process.exit(1);
  }
  
  const wallets = allWallets.filter((_, index) => index !== walletIndex).slice(0, transferCount);
  
  if (wallets.length === 0) {
    console.error(chalk.red('No wallets found to transfer to'));
    process.exit(1);
  }
  
  if (wallets.length < transferCount) {
    console.warn(chalk.yellow(`Warning: Only ${wallets.length} wallets available, but ${transferCount} requested`));
  }
  
  console.log(chalk.blue(`Transferring tokens to ${wallets.length} wallets`));
  
  // Create a spinner
  const spinner = ora('Setting up transfers...').start();
  
  // Transfer to each wallet
  let successCount = 0;
  let failureCount = 0;
  
  for (const targetWallet of wallets) {
    try {
      spinner.text = `Transferring to wallet ${targetWallet.publicKey.toString()}...`;
      
      // Get the associated token account for the target wallet
      const targetTokenAccount = getAssociatedTokenAddressSync(
        mintAddress,
        targetWallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Check if the token account exists
      let targetAccountExists = false;
      try {
        await getAccount(connection, targetTokenAccount, 'confirmed', TOKEN_2022_PROGRAM_ID);
        targetAccountExists = true;
      } catch (error) {
        // Account doesn't exist, need to create it
      }
      
      // Create a new transaction
      const instructions = [];
      
      // Create token account if it doesn't exist
      if (!targetAccountExists) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            targetTokenAccount,
            targetWallet.publicKey,
            mintAddress,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
      
      // Add transfer instruction - use regular transferChecked instead of transferCheckedWithFee
      instructions.push(
        createTransferCheckedInstruction(
          sourceTokenAccount,
          mintAddress,
          targetTokenAccount,
          wallet.publicKey,
          amount,
          decimals,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      
      // Create a versioned transaction
      const latestBlockhash = await connection.getLatestBlockhash();
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      
      // Sign the transaction
      transaction.sign([wallet]);
      
      // Send the transaction
      const signature = await connection.sendTransaction(transaction);
      
      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash,
      });
      
      console.log(chalk.green(`\nTransfer successful to ${targetWallet.publicKey.toString()}`));
      console.log(chalk.blue(`Transaction signature: ${signature}`));
      
      successCount++;
    } catch (error) {
      console.error(chalk.red(`\nError transferring to ${targetWallet.publicKey.toString()}:`), error);
      failureCount++;
    }
  }
  
  spinner.succeed('Transfers completed');
  
  console.log(chalk.green(`\nTransfer Summary:`));
  console.log(chalk.blue(`Successful transfers: ${successCount}`));
  if (failureCount > 0) {
    console.log(chalk.red(`Failed transfers: ${failureCount}`));
  }
  
  // Check source account balance after transfers
  try {
    const tokenAccountInfo = await getAccount(
      connection,
      sourceTokenAccount,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(chalk.blue(`\nRemaining token balance: ${tokenAccountInfo.amount} (${Number(tokenAccountInfo.amount) / 10**decimals} tokens)`));
  } catch (error) {
    console.error(chalk.red('Error getting final token account balance:'), error);
  }
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 