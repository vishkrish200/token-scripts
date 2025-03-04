#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  createTransferCheckedWithFeeInstruction, 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction, 
  getMint, 
  getAccount,
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
  Mint,
  Account,
  getTransferFeeConfig
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

// Define the Token Extensions program ID
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Main wallet name', 'wallet-1741011852572')
  .option('--mint <string>', 'Token mint address')
  .option('--transfers <number>', 'Number of transfers to make', '5')
  .option('--amount <number>', 'Amount to transfer per transaction', '1000')
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

// Get or create an associated token account
async function getOrCreateAssociatedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<{ address: PublicKey, exists: boolean }> {
  const associatedTokenAddress = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  
  try {
    // Check if the account exists
    await getAccount(connection, associatedTokenAddress, undefined, TOKEN_2022_PROGRAM_ID);
    return { address: associatedTokenAddress, exists: true };
  } catch (error) {
    // If account doesn't exist, create it
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        associatedTokenAddress,
        owner,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    await sendAndConfirmTransaction(connection, transaction, [payer]);
    return { address: associatedTokenAddress, exists: false };
  }
}

// Define interfaces for the extension types
interface MintWithTransferFee extends Mint {
  transferFeeConfig?: {
    transferFeeBasisPoints: number;
    maximumFee: bigint;
    withheldAmount: bigint;
  };
}

interface AccountWithTransferFee extends Account {
  transferFeeAmount?: bigint;
}

async function main() {
  const env = options.env || 'testnet';
  const rpcUrl = getRpcUrl(env);
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log(chalk.blue(`Environment: ${env}`));
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  if (!options.mint) {
    console.error(chalk.red('Please provide a mint address with --mint'));
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  const numTransfers = parseInt(options.transfers);
  const amountPerTransfer = parseInt(options.amount);
  
  // Get mint info to determine decimals and fee configuration
  const mintInfo = await getMint(
    connection, 
    mintAddress, 
    undefined, 
    TOKEN_2022_PROGRAM_ID
  ) as MintWithTransferFee;
  
  // Debug: Print the mint info
  console.log('Mint info:', JSON.stringify(mintInfo, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value, 2));
  
  const decimals = mintInfo.decimals;
  
  // Get transfer fee config using the helper function
  const transferFeeConfig = getTransferFeeConfig(mintInfo);
  
  // Check if the mint has transfer fee extension
  if (!transferFeeConfig) {
    console.error(chalk.red('This mint does not have a transfer fee extension'));
    process.exit(1);
  }
  
  const feeBasisPoints = transferFeeConfig.newerTransferFee.transferFeeBasisPoints;
  const maxFee = transferFeeConfig.newerTransferFee.maximumFee;
  
  console.log(chalk.blue(`Mint has transfer fee: ${feeBasisPoints / 100}% (${feeBasisPoints} basis points)`));
  if (maxFee > BigInt(0)) {
    console.log(chalk.blue(`Maximum fee: ${maxFee} (${Number(maxFee) / 10**decimals} tokens)`));
  } else {
    console.log(chalk.blue(`Maximum fee: None (unlimited)`));
  }
  
  // Load the main wallet
  const walletsDir = path.join(process.cwd(), 'wallets', env);
  const mainWalletFile = path.join(walletsDir, `${options.wallet}.json`);
  const mainKeypair = loadKeypair(mainWalletFile);
  console.log(chalk.blue(`Main wallet: ${mainKeypair.publicKey.toString()}`));
  
  // Load destination wallets (all other wallets in the directory)
  const walletFiles = fs.readdirSync(walletsDir)
    .filter(file => file.endsWith('.json') && file !== `${options.wallet}.json`);
  
  if (walletFiles.length === 0) {
    console.error(chalk.red('No destination wallets found'));
    process.exit(1);
  }
  
  console.log(chalk.blue(`Found ${walletFiles.length} destination wallet files.`));
  console.log(chalk.blue(`Mint address: ${mintAddress.toString()}`));
  console.log(chalk.blue(`Decimals: ${decimals}`));
  console.log(chalk.blue(`Number of transfers: ${numTransfers}`));
  console.log(chalk.blue(`Amount per transfer: ${amountPerTransfer} tokens (${amountPerTransfer * 10**decimals} raw)`));
  console.log();
  
  // Get the main wallet's token account
  const mainTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mainKeypair,
    mintAddress,
    mainKeypair.publicKey
  );
  
  console.log(chalk.blue(`Main token account: ${mainTokenAccount.address.toString()}`));
  
  try {
    const mainAccountInfo = await getAccount(
      connection, 
      mainTokenAccount.address, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    );
    console.log(chalk.blue(`Initial balance: ${parseInt(mainAccountInfo.amount.toString()) / 10**decimals} tokens`));
  } catch (error) {
    console.log(chalk.red('Could not get main account balance:'), error);
  }
  
  console.log();
  
  // Array to store all destination token accounts for harvesting later
  const destinationTokenAccounts: PublicKey[] = [];
  
  // Perform transfers to each wallet
  for (let i = 0; i < Math.min(numTransfers, walletFiles.length); i++) {
    const destWalletFile = path.join(walletsDir, walletFiles[i]);
    const destKeypair = loadKeypair(destWalletFile);
    
    console.log(chalk.green(`Transfer ${i + 1}/${Math.min(numTransfers, walletFiles.length)}: ${mainKeypair.publicKey.toString()} -> ${destKeypair.publicKey.toString()}`));
    
    try {
      // Get or create the destination token account
      const destTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        mainKeypair,
        mintAddress,
        destKeypair.publicKey
      );
      
      console.log(chalk.blue(`Destination token account: ${destTokenAccount.address.toString()}`));
      destinationTokenAccounts.push(destTokenAccount.address);
      
      // Transfer from main to destination
      console.log(chalk.blue(`Transferring ${amountPerTransfer} tokens from main to destination...`));
      
      // Calculate the transfer amount
      const transferAmount = BigInt(amountPerTransfer * 10**decimals);
      
      // Calculate the expected fee
      const expectedFee = (transferAmount * BigInt(feeBasisPoints)) / BigInt(10000);
      const actualFee = expectedFee > maxFee && maxFee > BigInt(0) ? maxFee : expectedFee;
      
      console.log(chalk.blue(`Expected fee: ${Number(actualFee) / 10**decimals} tokens (${actualFee} raw)`));
      
      const spinner = ora('Processing transfer...').start();
      
      const transferInstruction = createTransferCheckedWithFeeInstruction(
        mainTokenAccount.address,
        mintAddress,
        destTokenAccount.address,
        mainKeypair.publicKey,
        transferAmount,
        decimals,
        actualFee, // Pass the calculated fee
        [],
        TOKEN_2022_PROGRAM_ID
      );
      
      const transaction = new Transaction().add(transferInstruction);
      
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [mainKeypair]
      );
      
      spinner.succeed(`Transaction successful: ${signature}`);
      
      // Check destination account balance and withheld amount
      try {
        const destAccountInfo = await getAccount(
          connection, 
          destTokenAccount.address, 
          undefined, 
          TOKEN_2022_PROGRAM_ID
        ) as AccountWithTransferFee;
        
        console.log(chalk.blue(`Destination balance: ${parseInt(destAccountInfo.amount.toString()) / 10**decimals} tokens`));
        
        if (destAccountInfo.transferFeeAmount) {
          console.log(chalk.green(`Withheld fees: ${parseInt(destAccountInfo.transferFeeAmount.toString()) / 10**decimals} tokens`));
        } else {
          console.log(chalk.yellow('No withheld fees found in destination account'));
        }
      } catch (error) {
        console.log(chalk.red('Could not get destination account info:'), error);
      }
      
      console.log();
      
      // Add a small delay between transfers
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(chalk.red(`Error in transfer ${i + 1}:`), error);
      console.log();
    }
  }
  
  // Check final balance of main wallet
  try {
    const updatedMainAccountInfo = await getAccount(
      connection, 
      mainTokenAccount.address, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    );
    console.log(chalk.green(`Final main wallet balance: ${parseInt(updatedMainAccountInfo.amount.toString()) / 10**decimals} tokens`));
  } catch (error) {
    console.log(chalk.red('Could not get final main account balance:'), error);
  }
  
  console.log(chalk.green('All transfers completed.'));
  
  // Step 2: Harvest withheld fees from token accounts to the mint
  console.log(chalk.blue('\nHarvesting withheld fees from token accounts to the mint...'));
  
  try {
    const harvestSpinner = ora('Harvesting fees...').start();
    
    const harvestSignature = await harvestWithheldTokensToMint(
      connection,
      mainKeypair,
      mintAddress,
      destinationTokenAccounts,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    
    harvestSpinner.succeed(`Harvesting successful: ${harvestSignature}`);
    
    // Check if the mint has withheld fees now
    const updatedMintInfo = await getMint(
      connection, 
      mintAddress, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    ) as MintWithTransferFee;
    
    const updatedTransferFeeConfig = getTransferFeeConfig(updatedMintInfo);
    
    if (updatedTransferFeeConfig) {
      console.log(chalk.green(`Withheld fees in mint: ${Number(updatedTransferFeeConfig.withheldAmount) / 10**decimals} tokens`));
    } else {
      console.log(chalk.yellow('No withheld fees found in mint'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error harvesting fees:'), error);
  }
  
  // Step 3: Withdraw withheld fees from the mint to the main wallet
  console.log(chalk.blue('\nWithdrawing withheld fees from the mint to the main wallet...'));
  
  try {
    const withdrawSpinner = ora('Withdrawing fees...').start();
    
    const withdrawSignature = await withdrawWithheldTokensFromMint(
      connection,
      mainKeypair,
      mintAddress,
      mainTokenAccount.address,
      mainKeypair,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    
    withdrawSpinner.succeed(`Withdrawal successful: ${withdrawSignature}`);
    
    // Check final balance of main wallet after withdrawal
    const finalMainAccountInfo = await getAccount(
      connection, 
      mainTokenAccount.address, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(chalk.green(`Final main wallet balance after fee withdrawal: ${parseInt(finalMainAccountInfo.amount.toString()) / 10**decimals} tokens`));
    
    // Check if the mint has any remaining withheld fees
    const finalMintInfo = await getMint(
      connection, 
      mintAddress, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    ) as MintWithTransferFee;
    
    const finalTransferFeeConfig = getTransferFeeConfig(finalMintInfo);
    
    if (finalTransferFeeConfig) {
      console.log(chalk.blue(`Remaining withheld fees in mint: ${Number(finalTransferFeeConfig.withheldAmount) / 10**decimals} tokens`));
    }
    
  } catch (error) {
    console.error(chalk.red('Error withdrawing fees:'), error);
  }
  
  console.log(chalk.green('\nFee harvesting workflow completed.'));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 