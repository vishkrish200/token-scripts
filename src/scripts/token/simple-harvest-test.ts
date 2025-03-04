#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
  getMint, 
  getAccount,
  getTransferFeeConfig,
  harvestWithheldTokensToMint,
  withdrawWithheldTokensFromMint,
  getAssociatedTokenAddressSync
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
  
  console.log(chalk.blue(`Environment: ${env}`));
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  if (!options.mint) {
    console.error(chalk.red('Please provide a mint address with --mint'));
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  
  // Load the main wallet
  const walletsDir = path.join(process.cwd(), 'wallets', env);
  const mainWalletFile = path.join(walletsDir, `${options.wallet}.json`);
  const mainKeypair = loadKeypair(mainWalletFile);
  console.log(chalk.blue(`Main wallet: ${mainKeypair.publicKey.toString()}`));
  
  // Get mint info
  const mintInfo = await getMint(
    connection, 
    mintAddress, 
    undefined, 
    TOKEN_2022_PROGRAM_ID
  );
  
  const decimals = mintInfo.decimals;
  
  // Get transfer fee config
  const transferFeeConfig = getTransferFeeConfig(mintInfo);
  
  if (!transferFeeConfig) {
    console.error(chalk.red('This mint does not have a transfer fee extension'));
    process.exit(1);
  }
  
  console.log(chalk.blue(`Mint has transfer fee: ${transferFeeConfig.newerTransferFee.transferFeeBasisPoints / 100}% (${transferFeeConfig.newerTransferFee.transferFeeBasisPoints} basis points)`));
  console.log(chalk.blue(`Withheld amount in mint: ${Number(transferFeeConfig.withheldAmount) / 10**decimals} tokens`));
  
  // Get the main wallet's token account
  const mainTokenAccount = getAssociatedTokenAddressSync(
    mintAddress,
    mainKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log(chalk.blue(`Main token account: ${mainTokenAccount.toString()}`));
  
  try {
    const mainAccountInfo = await getAccount(
      connection, 
      mainTokenAccount, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    );
    console.log(chalk.blue(`Initial balance: ${parseInt(mainAccountInfo.amount.toString()) / 10**decimals} tokens`));
  } catch (error) {
    console.log(chalk.red('Could not get main account balance:'), error);
  }
  
  // Load all token accounts for this mint
  console.log(chalk.blue('\nFinding all token accounts for this mint...'));
  
  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: mintAddress.toBase58(),
        },
      },
    ],
  });
  
  console.log(chalk.blue(`Found ${accounts.length} token accounts for this mint.`));
  
  const tokenAccounts = accounts.map(account => account.pubkey);
  
  // Harvest withheld fees from token accounts to the mint
  if (tokenAccounts.length > 0) {
    console.log(chalk.blue('\nHarvesting withheld fees from token accounts to the mint...'));
    
    try {
      const harvestSpinner = ora('Harvesting fees...').start();
      
      const harvestSignature = await harvestWithheldTokensToMint(
        connection,
        mainKeypair,
        mintAddress,
        tokenAccounts,
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
      );
      
      const updatedTransferFeeConfig = getTransferFeeConfig(updatedMintInfo);
      
      if (updatedTransferFeeConfig) {
        console.log(chalk.green(`Withheld fees in mint after harvesting: ${Number(updatedTransferFeeConfig.withheldAmount) / 10**decimals} tokens`));
      } else {
        console.log(chalk.yellow('No withheld fees found in mint after harvesting'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error harvesting fees:'), error);
    }
    
    // Withdraw withheld fees from the mint to the main wallet
    console.log(chalk.blue('\nWithdrawing withheld fees from the mint to the main wallet...'));
    
    try {
      const withdrawSpinner = ora('Withdrawing fees...').start();
      
      const withdrawSignature = await withdrawWithheldTokensFromMint(
        connection,
        mainKeypair,
        mintAddress,
        mainTokenAccount,
        mainKeypair,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      
      withdrawSpinner.succeed(`Withdrawal successful: ${withdrawSignature}`);
      
      // Check final balance of main wallet after withdrawal
      const finalMainAccountInfo = await getAccount(
        connection, 
        mainTokenAccount, 
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
      );
      
      const finalTransferFeeConfig = getTransferFeeConfig(finalMintInfo);
      
      if (finalTransferFeeConfig) {
        console.log(chalk.blue(`Remaining withheld fees in mint: ${Number(finalTransferFeeConfig.withheldAmount) / 10**decimals} tokens`));
      }
      
    } catch (error) {
      console.error(chalk.red('Error withdrawing fees:'), error);
    }
  } else {
    console.log(chalk.yellow('No token accounts found for this mint.'));
  }
  
  console.log(chalk.green('\nFee harvesting test completed.'));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 