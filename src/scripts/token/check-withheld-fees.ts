#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
  TOKEN_2022_PROGRAM_ID, 
  getAccount,
  getMint,
  harvestWithheldTokensToMint,
  createHarvestWithheldTokensToMintInstruction
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name', 'wallet-1741011852572')
  .option('--mint <string>', 'Token mint address')
  .option('--verbose', 'Show detailed output')
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
  console.log(chalk.green('Checking token accounts for withheld fees...'));
  
  // Get the RPC URL
  const rpcUrl = getRpcUrl(options.env);
  console.log(chalk.blue(`Environment: ${options.env}`));
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  // Create a connection to the cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load the wallet
  const walletsDir = path.join(process.cwd(), 'wallets', options.env);
  const walletFile = path.join(walletsDir, `${options.wallet}.json`);
  const wallet = loadKeypair(walletFile);
  console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toString()}`));
  
  // Get mint address
  if (!options.mint) {
    console.error(chalk.red('Mint address is required. Use --mint=<address>'));
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  console.log(chalk.blue(`Mint address: ${mintAddress.toString()}`));
  
  // Get the mint info
  const mintInfo = await getMint(connection, mintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log(chalk.blue(`Token decimals: ${mintInfo.decimals}`));
  
  // Get all token accounts for the mint
  console.log(chalk.green(`\nFetching all token accounts for mint...`));
  
  const tokenAccounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [
      {
        dataSize: 165, // Minimum size for a token account with extensions
      },
      {
        memcmp: {
          offset: 0,
          bytes: mintAddress.toBase58(),
        },
      },
    ],
  });
  
  console.log(chalk.blue(`Found ${tokenAccounts.length} token accounts for the mint.`));
  
  // Process each token account
  let totalAccounts = 0;
  
  for (let i = 0; i < tokenAccounts.length; i++) {
    const tokenAccount = tokenAccounts[i];
    const accountAddress = tokenAccount.pubkey;
    
    try {
      // Get the account
      const account = await getAccount(connection, accountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
      
      // Get the owner
      const owner = account.owner;
      
      // Get the balance
      const balance = account.amount;
      
      console.log(chalk.blue(`\nToken Account #${i+1}:`));
      console.log(chalk.blue(`Address: ${accountAddress.toBase58()}`));
      console.log(chalk.blue(`Owner: ${owner.toBase58()}`));
      console.log(chalk.blue(`Balance: ${Number(balance) / 10**mintInfo.decimals} tokens`));
      
      totalAccounts++;
    } catch (error) {
      if (options.verbose) {
        console.error(chalk.red(`Error getting account ${accountAddress.toBase58()}:`), error);
      }
    }
  }
  
  console.log(chalk.green(`\nSummary:`));
  console.log(chalk.blue(`Total token accounts: ${totalAccounts}`));
  console.log(chalk.yellow(`\nNote: To check if fees are being withheld properly, you can run the harvest script and see if any fees are collected`));
  
  console.log(chalk.green(`\nTo harvest potential withheld fees, run:`));
  console.log(chalk.blue(`npm run harvest-fees:${options.env} -- --wallet=${options.wallet} --mint=${mintAddress.toString()}`));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 