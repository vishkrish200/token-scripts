import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';

// Define the program
const program = new Command();

// Configure the program
program
  .name('test-connection')
  .description('Test connection to Solana testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file', 'wallet-1741011852572')
  .parse(process.argv);

// Get the options
const options = program.opts();

async function main() {
  try {
    console.log('Testing connection to Solana testnet...');
    
    // Create connection
    const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
    console.log(`RPC URL: ${connection.rpcEndpoint}`);
    
    // Test connection
    const version = await connection.getVersion();
    console.log(`Solana version: ${JSON.stringify(version)}`);
    
    // Load wallet
    const walletDir = path.resolve(process.cwd(), 'wallets', 'testnet');
    const walletPath = path.join(walletDir, `${options.wallet}.json`);
    console.log(`Wallet Path: ${walletPath}`);
    
    if (!fs.existsSync(walletPath)) {
      throw new Error(`Keypair file not found at ${walletPath}`);
    }
    
    const keypairData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    console.log(`Wallet Public Key: ${keypairData.publicKey}`);
    
    // Get balance
    const publicKey = new PublicKey(keypairData.publicKey);
    const balance = await connection.getBalance(publicKey);
    console.log(`Wallet Balance: ${balance / 1000000000} SOL`);
    
    console.log('Connection test successful!');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

main(); 