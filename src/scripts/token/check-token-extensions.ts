import { Command } from 'commander';
import {
  Connection,
  PublicKey,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAccount,
  getAssociatedTokenAddressSync,
  ExtensionType,
  getExtensionData,
  getTransferFeeConfig,
} from '@solana/spl-token';
import { loadWallet, loadWalletFromEnv } from '../../utils/wallet';
import { getEnvironment, logEnvironmentInfo, config, getConnection } from '../../config';
import * as fs from 'fs';
import * as path from 'path';

// Define the program
const program = new Command();

// Configure the program
program
  .name('check-token-extensions')
  .description('Check token account extension data')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-n, --name <name>', 'Token name')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Main function to check token extensions
 */
async function main() {
  try {
    // Log environment information
    logEnvironmentInfo();
    
    // Get mint address from command line args
    const mintArg = process.argv.find(arg => arg.startsWith('--mint='))?.split('=')[1];
    const privateKeyEnv = process.argv.find(arg => arg.startsWith('--private-key-env='))?.split('=')[1];
    const walletFile = process.argv.find(arg => arg.startsWith('--wallet='))?.split('=')[1];
    
    if (!mintArg) {
      console.error('Usage: npm run check-token-extensions -- --mint=<mint_address> [--private-key-env=<env_var> | --wallet=<wallet_file>]');
      process.exit(1);
    }
    
    // Load the wallet if provided
    const wallet = privateKeyEnv 
      ? loadWalletFromEnv(privateKeyEnv)
      : walletFile 
        ? loadWallet(walletFile)
        : null;
    
    const connection = getConnection();
    const mintPubkey = new PublicKey(mintArg);
    
    // Get mint info
    console.log('\nFetching mint information...');
    const mintInfo = await getMint(connection, mintPubkey);
    
    console.log('\nMint Information:');
    console.log('----------------');
    console.log(`Address: ${mintPubkey.toBase58()}`);
    console.log(`Decimals: ${mintInfo.decimals}`);
    console.log(`Supply: ${mintInfo.supply}`);
    console.log(`Mint Authority: ${mintInfo.mintAuthority?.toBase58() || 'None'}`);
    console.log(`Freeze Authority: ${mintInfo.freezeAuthority?.toBase58() || 'None'}`);
    
    // Check transfer fee config
    try {
      console.log('\nChecking transfer fee configuration...');
      const feeConfig = await getTransferFeeConfig(mintInfo);
      
      if (feeConfig) {
        console.log('\nTransfer Fee Configuration:');
        console.log('-------------------------');
        console.log(`Transfer Fee: ${feeConfig.newerTransferFee.transferFeeBasisPoints / 100}%`);
        console.log(`Maximum Fee: ${feeConfig.newerTransferFee.maximumFee}`);
        console.log(`Fee Authority: ${feeConfig.withdrawWithheldAuthority?.toBase58() || 'None'}`);
      }
    } catch (error) {
      console.log('No transfer fee configuration found.');
    }
    
    // If wallet is provided, check its token account
    if (wallet) {
      try {
        const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: mintPubkey });
        
        if (tokenAccounts.value.length > 0) {
          console.log('\nToken Account Information:');
          console.log('------------------------');
          
          for (const { pubkey, account } of tokenAccounts.value) {
            const accountInfo = await getAccount(connection, pubkey);
            console.log(`\nAccount Address: ${pubkey.toBase58()}`);
            console.log(`Balance: ${accountInfo.amount} tokens`);
            console.log(`Delegate: ${accountInfo.delegate?.toBase58() || 'None'}`);
            console.log(`Close Authority: ${accountInfo.closeAuthority?.toBase58() || 'None'}`);
          }
        } else {
          console.log('\nNo token accounts found for this wallet.');
        }
      } catch (error) {
        console.error('Error fetching token accounts:', error);
      }
    }
  } catch (error) {
    console.error('Error checking token extensions:', error);
    process.exit(1);
  }
}

// Run the script
main(); 