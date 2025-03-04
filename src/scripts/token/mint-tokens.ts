#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getMint
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';
import { loadWallet, loadWalletFromPrivateKey } from '../../utils/wallet';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name')
  .option('--private-key <string>', 'Private key as a JSON array of numbers')
  .option('--mint <string>', 'Token mint address')
  .option('--amount <number>', 'Amount to mint', '1000000')
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

async function main() {
  console.log(chalk.green('Minting tokens to wallet...'));
  
  // Check required parameters
  if (!options.wallet && !options.privateKey) {
    console.error(chalk.red('Either wallet name (--wallet) or private key (--private-key) is required'));
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
    if (options.privateKey) {
      // Load from provided private key
      console.log(chalk.blue(`Loading wallet from provided private key`));
      wallet = loadWalletFromPrivateKey(options.privateKey);
    } else {
      // Load from wallet file
      console.log(chalk.blue(`Loading wallet: ${options.wallet}`));
      wallet = loadWallet(options.wallet);
    }
    console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toString()}`));
  } catch (error) {
    console.error(chalk.red(`Error loading wallet: ${error}`));
    process.exit(1);
  }
  
  // Get wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(chalk.blue(`Wallet balance: ${balance / 1e9} SOL`));
  
  // Get mint address
  if (!options.mint) {
    console.error(chalk.red('Mint address is required. Use --mint=<address>'));
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  console.log(chalk.blue(`Mint address: ${mintAddress.toString()}`));
  
  // Get the mint info
  const mint = await getMint(connection, mintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const decimals = mint.decimals;
  console.log(chalk.blue(`Token decimals: ${decimals}`));
  
  // Calculate the amount in raw units
  const amount = BigInt(parseInt(options.amount) * 10**decimals);
  console.log(chalk.blue(`Mint amount: ${options.amount} tokens (${amount} raw)`));
  
  // Get or create the associated token account
  const tokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  console.log(chalk.blue(`Token account: ${tokenAccount.toString()}`));
  
  // Check if the token account exists
  let tokenAccountExists = false;
  try {
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    tokenAccountExists = accountInfo !== null;
    console.log(chalk.blue(tokenAccountExists ? 'Token account exists.' : 'Token account does not exist. Creating...'));
  } catch (error) {
    console.log(chalk.blue('Token account does not exist. Creating...'));
  }
  
  // Create a transaction
  const transaction = new Transaction();
  
  // Add instruction to create token account if it doesn't exist
  if (!tokenAccountExists) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAccount,
        wallet.publicKey,
        mintAddress,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Add mint-to instruction
  transaction.add(
    createMintToInstruction(
      mintAddress,
      tokenAccount,
      wallet.publicKey,
      amount,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  console.log(chalk.blue(`Sending transaction...`));
  
  // Send and confirm transaction
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      { commitment: 'confirmed' }
    );
    
    console.log(chalk.green(`\nTokens minted successfully!`));
    console.log(chalk.blue(`Transaction signature: ${signature}`));
    
    console.log(chalk.green(`\nNext steps:`));
    console.log(chalk.blue(`1. Check your token balance:`));
    console.log(`   npm run check-token-extensions:${options.env} -- --wallet=${options.wallet} --mint=${mintAddress.toString()}`);
    
    console.log(chalk.blue(`\n2. Transfer tokens to generate fees:`));
    console.log(`   npm run transfer-checked:${options.env} -- --wallet=${options.wallet} --mint=${mintAddress.toString()} --amount=1000 --recipient=<recipient-address>`);
    
  } catch (error) {
    console.error(chalk.red('Error minting tokens:'), error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 