import { Command } from 'commander';
import { PublicKey, Connection, clusterApiUrl, Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

// Define the program
const program = new Command();

// Configure the program
program
  .name('check-balances')
  .description('Check SOL balances of all wallets')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Get the balance of a wallet
 * @param publicKey The public key of the wallet
 * @param connection The Solana connection
 * @returns The balance in SOL
 */
async function getBalance(publicKey: PublicKey, connection: Connection): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / 1000000000; // Convert lamports to SOL
}

/**
 * Load a keypair from a file
 * @param filePath The path to the keypair file
 * @returns The loaded keypair
 */
function loadKeypair(filePath: string): Keypair {
  try {
    const keypairData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const secretKey = Buffer.from(keypairData.secretKey, 'base64');
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    console.error(`Error loading keypair from ${filePath}: ${error}`);
    throw error;
  }
}

/**
 * Main function to check balances
 */
async function main() {
  try {
    // Set up connection directly to testnet
    const connection = new Connection(clusterApiUrl('testnet'), 'confirmed');
    console.log(chalk.blue(`Environment: ${options.env}`));
    console.log(chalk.blue(`RPC URL: ${connection.rpcEndpoint}`));
    
    // Load wallets from the testnet directory
    const walletDir = path.resolve(process.cwd(), 'wallets/testnet');
    console.log(chalk.blue(`Loading wallets from ${walletDir}...`));
    
    if (!fs.existsSync(walletDir)) {
      console.error(chalk.red(`Wallet directory not found: ${walletDir}`));
      process.exit(1);
    }
    
    const walletFiles = fs.readdirSync(walletDir)
      .filter(file => file.endsWith('.json'));
    
    console.log(chalk.green(`Found ${walletFiles.length} wallet files.`));
    
    // Check balances
    console.log(chalk.blue('\nChecking SOL balances for all wallets...'));
    
    for (let i = 0; i < walletFiles.length; i++) {
      const walletFile = walletFiles[i];
      const walletPath = path.join(walletDir, walletFile);
      
      try {
        const wallet = loadKeypair(walletPath);
        const balance = await getBalance(wallet.publicKey, connection);
        
        console.log(chalk.yellow(`Wallet ${i + 1} (${walletFile}): ${wallet.publicKey.toBase58()}`));
        console.log(chalk.green(`- SOL Balance: ${balance}`));
      } catch (error) {
        console.error(chalk.red(`Error processing wallet ${walletFile}: ${error}`));
      }
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

// Run the main function
main(); 