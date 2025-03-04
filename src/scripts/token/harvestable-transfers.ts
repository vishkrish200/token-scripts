#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createTransferCheckedWithFeeInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, getMint, getAccount } from '@solana/spl-token';
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
  .option('--transfers <number>', 'Number of transfers to make', '10')
  .option('--amount <number>', 'Amount to transfer per transaction', '50')
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
  
  // Get mint info to determine decimals
  const mintInfo = await getMint(
    connection, 
    mintAddress, 
    undefined, 
    TOKEN_2022_PROGRAM_ID
  );
  const decimals = mintInfo.decimals;
  
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
  
  // Perform transfers to each wallet and back
  for (let i = 0; i < Math.min(numTransfers, walletFiles.length); i++) {
    const destWalletFile = path.join(walletsDir, walletFiles[i]);
    const destKeypair = loadKeypair(destWalletFile);
    
    console.log(chalk.green(`Transfer pair ${i + 1}/${Math.min(numTransfers, walletFiles.length)}: ${mainKeypair.publicKey.toString()} <-> ${destKeypair.publicKey.toString()}`));
    
    try {
      // Get or create the destination token account
      const destTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        mainKeypair,
        mintAddress,
        destKeypair.publicKey
      );
      
      console.log(chalk.blue(`Destination token account: ${destTokenAccount.address.toString()}`));
      
      // Transfer from main to destination
      console.log(chalk.blue(`Transferring ${amountPerTransfer} tokens from main to destination...`));
      
      // Calculate the transfer amount
      const transferAmount = BigInt(amountPerTransfer * 10**decimals);
      
      const spinner = ora('Processing transfer...').start();
      
      const transferInstruction = createTransferCheckedWithFeeInstruction(
        mainTokenAccount.address,
        mintAddress,
        destTokenAccount.address,
        mainKeypair.publicKey,
        transferAmount,
        decimals,
        BigInt(0), // Use 0 to let the program calculate the fee
        [],
        TOKEN_2022_PROGRAM_ID
      );
      
      const transaction = new Transaction().add(transferInstruction);
      
      const signature1 = await sendAndConfirmTransaction(
        connection,
        transaction,
        [mainKeypair]
      );
      
      spinner.succeed(`Transaction successful: ${signature1}`);
      
      // Add a small delay between transfers
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Transfer back from destination to main
      console.log(chalk.blue(`Transferring ${amountPerTransfer / 2} tokens from destination to main...`));
      
      // Calculate the transfer amount for the return transfer
      const returnAmount = BigInt(Math.floor((amountPerTransfer / 2) * 10**decimals));
      
      const spinner2 = ora('Processing return transfer...').start();
      
      const transferBackInstruction = createTransferCheckedWithFeeInstruction(
        destTokenAccount.address,
        mintAddress,
        mainTokenAccount.address,
        destKeypair.publicKey,
        returnAmount,
        decimals,
        BigInt(0), // Use 0 to let the program calculate the fee
        [],
        TOKEN_2022_PROGRAM_ID
      );
      
      const transaction2 = new Transaction().add(transferBackInstruction);
      
      const signature2 = await sendAndConfirmTransaction(
        connection,
        transaction2,
        [destKeypair]
      );
      
      spinner2.succeed(`Transaction successful: ${signature2}`);
      console.log();
      
      // Add a small delay between wallet pairs
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(chalk.red(`Error in transfer pair ${i + 1}:`), error);
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
  console.log(chalk.blue('\nTo harvest fees, run:'));
  console.log(chalk.blue(`npm run harvest-fees:${env} -- --wallet=${options.wallet} --mint=${mintAddress.toString()} --name="Harvestable Token"`));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 