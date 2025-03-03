import { Command } from 'commander';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferFeeConfigInstruction,
} from '@solana/spl-token';
import { loadKeypair, getBalance } from '../../utils/wallet';
import { getConnection, tokenConfig, config } from '../../config';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { saveTokenInfo } from '../../utils/token';

// Define the program
const program = new Command();

// Configure the program
program
  .name('create-token-with-high-fees')
  .description('Create a new token with high transfer fees (4%) and no upper limit')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file', 'wallet.json')
  .option('-n, --name <n>', 'Token name', 'HighFeeToken')
  .option('-s, --symbol <symbol>', 'Token symbol', 'HFT')
  .option('-d, --decimals <decimals>', 'Token decimals', '9')
  .option('-i, --initial-supply <supply>', 'Initial token supply', '10000000')
  .option('--rpc <url>', 'Custom RPC URL to use')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Main function to create a token with high fees
 */
async function main() {
  try {
    console.log(chalk.blue(`Creating token with high fees (4%)...`));
    
    // Create connection directly to testnet
    const connection = options.rpc
      ? new Connection(options.rpc, 'confirmed')
      : new Connection('https://api.testnet.solana.com', 'confirmed');
    
    console.log(chalk.blue(`RPC URL: ${connection.rpcEndpoint}`));
    
    // Load wallet directly
    const walletDir = path.resolve(process.cwd(), 'wallets', 'testnet');
    const walletPath = path.join(walletDir, `${options.wallet}.json`);
    console.log(chalk.blue(`Wallet Path: ${walletPath}`));
    
    if (!fs.existsSync(walletPath)) {
      throw new Error(`Keypair file not found at ${walletPath}`);
    }
    
    const keypairData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    const secretKey = Buffer.from(keypairData.secretKey, 'base64');
    const wallet = Keypair.fromSecretKey(secretKey);
    
    console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toBase58()}`));
    
    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
    console.log(chalk.blue(`Wallet balance: ${balance} SOL`));
    
    if (balance < 0.1) {
      console.warn(chalk.yellow('Warning: Low wallet balance. This operation requires at least 0.1 SOL.'));
      const proceed = await new Promise(resolve => {
        process.stdout.write('Do you want to continue? (y/n): ');
        process.stdin.once('data', data => {
          resolve(data.toString().trim().toLowerCase() === 'y');
        });
      });
      
      if (!proceed) {
        console.log(chalk.red('Operation cancelled.'));
        process.exit(0);
      }
    }
    
    // Get token details from options
    const tokenName = options.name;
    const tokenSymbol = options.symbol;
    const tokenDecimals = parseInt(options.decimals, 10);
    const initialSupply = BigInt(parseFloat(options.initialSupply) * Math.pow(10, tokenDecimals));
    
    console.log(chalk.blue(`Creating token: ${tokenName} (${tokenSymbol})`));
    console.log(chalk.blue(`Decimals: ${tokenDecimals}`));
    console.log(chalk.blue(`Initial supply: ${options.initialSupply} tokens`));
    
    // Create a spinner for the token creation process
    const spinner = ora('Creating token mint...').start();
    
    // Generate a new keypair for the mint
    const mintKeypair = Keypair.generate();
    
    // Define the extensions to use
    const extensions = [ExtensionType.TransferFeeConfig];
    
    // Calculate space required for the mint
    const mintLen = getMintLen(extensions);
    
    // Calculate rent required
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
    
    // Create a transaction to create the mint account
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      })
    );
    
    // Add transfer fee config instruction
    // 4% fee with no maximum limit
    const transferFeeConfigAuthority = wallet.publicKey;
    const withdrawWithheldAuthority = wallet.publicKey;
    const feeRateBasisPoints = 400; // 4%
    const maxFee = BigInt(0); // No maximum fee limit
    
    transaction.add(
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        transferFeeConfigAuthority,
        withdrawWithheldAuthority,
        feeRateBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    // Add the initialize mint instruction
    transaction.add(
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        tokenDecimals,
        wallet.publicKey,
        wallet.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    // Send the transaction to create the mint
    const mintSignature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet, mintKeypair],
      { commitment: 'confirmed' }
    );
    
    spinner.succeed(`Token mint created: ${mintKeypair.publicKey.toBase58()}`);
    console.log(chalk.green(`Transaction signature: ${mintSignature}`));
    
    // Create a token account for the creator
    spinner.text = 'Creating token account...';
    spinner.start();
    
    // Get the associated token account address
    const tokenAccount = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Create a transaction to create the token account
    const createAccountTransaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAccount,
        wallet.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    
    // Send the transaction to create the token account
    const createAccountSignature = await sendAndConfirmTransaction(
      connection,
      createAccountTransaction,
      [wallet],
      { commitment: 'confirmed' }
    );
    
    spinner.succeed(`Token account created: ${tokenAccount.toBase58()}`);
    console.log(chalk.green(`Transaction signature: ${createAccountSignature}`));
    
    // Mint initial supply to the creator's token account
    spinner.text = 'Minting initial supply...';
    spinner.start();
    
    // Create a transaction to mint tokens
    const mintTransaction = new Transaction().add(
      createMintToInstruction(
        mintKeypair.publicKey,
        tokenAccount,
        wallet.publicKey,
        initialSupply,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    // Send the transaction to mint tokens
    const mintToSignature = await sendAndConfirmTransaction(
      connection,
      mintTransaction,
      [wallet],
      { commitment: 'confirmed' }
    );
    
    spinner.succeed(`Minted ${options.initialSupply} tokens to ${tokenAccount.toBase58()}`);
    console.log(chalk.green(`Transaction signature: ${mintToSignature}`));
    
    // Save token information
    const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
    if (!fs.existsSync(tokenInfoDir)) {
      fs.mkdirSync(tokenInfoDir, { recursive: true });
    }
    
    const tokenInfo = {
      name: tokenName,
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      mintAddress: mintKeypair.publicKey.toBase58(),
      extensions: ['TransferFeeConfig'],
      transferFee: {
        feeBasisPoints: feeRateBasisPoints,
        maxFee: maxFee.toString(),
      },
      createdAt: new Date().toISOString(),
    };
    
    const filePath = path.join(tokenInfoDir, `${tokenName.toLowerCase()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(tokenInfo, null, 2));
    
    console.log(chalk.green(`Token information saved to ${filePath}`));
    
    // Print summary
    console.log('\n' + chalk.bold('Token Creation Summary:'));
    console.log(chalk.bold('Token Name:') + ' ' + tokenName);
    console.log(chalk.bold('Token Symbol:') + ' ' + tokenSymbol);
    console.log(chalk.bold('Decimals:') + ' ' + tokenDecimals);
    console.log(chalk.bold('Mint Address:') + ' ' + mintKeypair.publicKey.toBase58());
    console.log(chalk.bold('Initial Supply:') + ' ' + options.initialSupply);
    console.log(chalk.bold('Transfer Fee:') + ' ' + (feeRateBasisPoints / 100) + '%');
    console.log(chalk.bold('Max Fee:') + ' None (unlimited)');
    console.log(chalk.bold('Token Account:') + ' ' + tokenAccount.toBase58());
    
    // Provide instructions for distributing the token
    console.log('\n' + chalk.bold('To distribute this token, run:'));
    console.log(chalk.cyan(`npm run distribute-token:${process.env.SOLANA_NETWORK || 'testnet'} -- --wallet=${options.wallet} --mint=${mintKeypair.publicKey.toBase58()} --name=${tokenName}`));
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

// Run the main function
main(); 