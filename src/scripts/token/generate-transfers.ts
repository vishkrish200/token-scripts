#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--mint <string>', 'Token mint address')
  .option('--transfers <number>', 'Number of transfers to make', '20')
  .option('--amount <number>', 'Amount to transfer per transaction', '10')
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

async function main() {
  const env = options.env || 'testnet';
  const rpcUrl = getRpcUrl(env);
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log(`Environment: ${env}`);
  console.log(`RPC URL: ${rpcUrl}`);
  
  if (!options.mint) {
    console.error('Please provide a mint address with --mint');
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  const numTransfers = parseInt(options.transfers);
  const amountPerTransfer = parseInt(options.amount);
  
  // Load all wallet files from the wallets directory
  const walletsDir = path.join(process.cwd(), 'wallets', env);
  console.log(`Loading wallets from ${walletsDir}...`);
  
  // Filter wallet files to only include those with tokens
  const walletFiles = fs.readdirSync(walletsDir)
    .filter(file => file.endsWith('.json') && file !== 'wallet-1741011852572.json');
  
  if (walletFiles.length < 2) {
    console.error('Need at least 2 wallets to perform transfers');
    process.exit(1);
  }
  
  // Load the main wallet that was used to distribute tokens
  const mainWalletPath = path.join(walletsDir, 'wallet-1741011852572.json');
  const mainKeypair = loadKeypair(mainWalletPath);
  console.log(`Main wallet: ${mainKeypair.publicKey.toString()}`);
  
  console.log(`Found ${walletFiles.length} wallet files.`);
  console.log(`Mint address: ${mintAddress.toString()}`);
  console.log(`Number of transfers: ${numTransfers}`);
  console.log(`Amount per transfer: ${amountPerTransfer} tokens`);
  console.log();
  
  // Perform random transfers
  for (let i = 0; i < numTransfers; i++) {
    // Select random source and destination wallets
    const sourceIndex = Math.floor(Math.random() * walletFiles.length);
    let destIndex = Math.floor(Math.random() * walletFiles.length);
    
    // Make sure source and destination are different
    while (destIndex === sourceIndex) {
      destIndex = Math.floor(Math.random() * walletFiles.length);
    }
    
    const sourceWalletFile = path.join(walletsDir, walletFiles[sourceIndex]);
    const destWalletFile = path.join(walletsDir, walletFiles[destIndex]);
    
    const sourceKeypair = loadKeypair(sourceWalletFile);
    const destKeypair = loadKeypair(destWalletFile);
    
    console.log(`Transfer ${i + 1}/${numTransfers}: ${sourceKeypair.publicKey.toString()} -> ${destKeypair.publicKey.toString()}`);
    
    try {
      // Get or create the token accounts using the main wallet for paying fees
      const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        mainKeypair,
        mintAddress,
        sourceKeypair.publicKey
      );
      
      const destTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        mainKeypair,
        mintAddress,
        destKeypair.publicKey
      );
      
      // Perform the transfer
      const signature = await transfer(
        connection,
        sourceKeypair,
        sourceTokenAccount.address,
        destTokenAccount.address,
        sourceKeypair,
        amountPerTransfer * 10**9 // Convert to raw amount with 9 decimals
      );
      
      console.log(`Transaction successful: ${signature}`);
      console.log(`Transferred ${amountPerTransfer} tokens from ${sourceKeypair.publicKey.toString()} to ${destKeypair.publicKey.toString()}`);
      console.log();
      
      // Add a small delay between transfers
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`Error in transfer ${i + 1}:`, error);
      console.log();
    }
  }
  
  console.log('All transfers completed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 