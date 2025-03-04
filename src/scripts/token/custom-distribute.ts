import { Command } from 'commander';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  getMint,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

// Define the program
const program = new Command();

// Configure the program
program
  .name('custom-distribute')
  .description('Distribute tokens to multiple wallets')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file', 'wallet-1741011852572')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-a, --amount <amount>', 'Amount of tokens to distribute to each wallet', '100')
  .parse(process.argv);

// Get the options
const options = program.opts();

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
 * Main function to distribute tokens
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
      .filter(file => file.endsWith('.json'))
      .filter(file => file !== `${options.wallet}.json`); // Exclude source wallet
    
    console.log(chalk.green(`Found ${walletFiles.length} destination wallet files.`));
    
    // Load source wallet
    const sourceWalletPath = path.join(walletDir, `${options.wallet}.json`);
    const sourceWallet = loadKeypair(sourceWalletPath);
    console.log(chalk.blue(`Source wallet: ${sourceWallet.publicKey.toBase58()}`));
    
    // Parse mint address
    const mint = new PublicKey(options.mint);
    console.log(chalk.blue(`Mint address: ${mint.toBase58()}`));
    
    // Get mint info
    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log(chalk.blue(`Decimals: ${mintInfo.decimals}`));
    
    // Calculate token amount with decimals
    const amount = BigInt(parseFloat(options.amount) * Math.pow(10, mintInfo.decimals));
    console.log(chalk.blue(`Amount per wallet: ${options.amount} tokens (${amount} raw)`));
    
    // Get source token account
    const sourceTokenAccount = getAssociatedTokenAddressSync(
      mint,
      sourceWallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Distribute tokens to each wallet
    for (let i = 0; i < walletFiles.length; i++) {
      const walletFile = walletFiles[i];
      const walletPath = path.join(walletDir, walletFile);
      
      try {
        const wallet = loadKeypair(walletPath);
        console.log(chalk.yellow(`\nDistributing to wallet ${i + 1}/${walletFiles.length}: ${wallet.publicKey.toBase58()}`));
        
        // Get or create destination token account
        const destinationTokenAccount = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        
        // Create a transaction
        const transaction = new Transaction();
        
        // Check if destination token account exists, if not create it
        try {
          await connection.getTokenAccountBalance(destinationTokenAccount);
          console.log(chalk.green(`Token account exists: ${destinationTokenAccount.toBase58()}`));
        } catch (error) {
          console.log(chalk.yellow(`Creating token account: ${destinationTokenAccount.toBase58()}`));
          transaction.add(
            createAssociatedTokenAccountInstruction(
              sourceWallet.publicKey,
              destinationTokenAccount,
              wallet.publicKey,
              mint,
              TOKEN_2022_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID
            )
          );
        }
        
        // Add transfer instruction
        transaction.add(
          createTransferCheckedInstruction(
            sourceTokenAccount,
            mint,
            destinationTokenAccount,
            sourceWallet.publicKey,
            amount,
            mintInfo.decimals,
            [],
            TOKEN_2022_PROGRAM_ID
          )
        );
        
        // Send the transaction
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sourceWallet],
          { commitment: 'confirmed' }
        );
        
        console.log(chalk.green(`Transaction successful: ${signature}`));
        console.log(chalk.green(`Transferred ${options.amount} tokens to ${wallet.publicKey.toBase58()}`));
      } catch (error) {
        console.error(chalk.red(`Error distributing to wallet ${walletFile}: ${error}`));
      }
    }
    
    console.log(chalk.green('\nDistribution completed.'));
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

// Run the main function
main(); 