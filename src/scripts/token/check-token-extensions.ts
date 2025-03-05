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
    const mintInfo = await getMint(connection, mintPubkey, undefined, TOKEN_2022_PROGRAM_ID);
    
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
        console.log('\nToken Account Information:');
        console.log('------------------------');
        
        // Use getTokenAccountsByOwner which is more reliable than getAssociatedTokenAddress
        const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { mint: mintPubkey });
        
        if (tokenAccounts.value.length > 0) {
          for (const { pubkey, account } of tokenAccounts.value) {
            try {
              const accountInfo = await getAccount(connection, pubkey, undefined, TOKEN_2022_PROGRAM_ID);
              console.log(`\nAccount Address: ${pubkey.toBase58()}`);
              console.log(`Balance: ${Number(accountInfo.amount) / 10**mintInfo.decimals} tokens`);
              console.log(`Delegate: ${accountInfo.delegate?.toBase58() || 'None'}`);
              console.log(`Close Authority: ${accountInfo.closeAuthority?.toBase58() || 'None'}`);
              
              // Check for withheld fees if this is a token 2022 account
              try {
                // @ts-ignore - extensions property exists on Token2022 accounts
                const withheldAmount = accountInfo.extensions?.transferFeeAmount?.withheldAmount;
                if (withheldAmount) {
                  console.log(`Withheld Fees: ${Number(withheldAmount) / 10**mintInfo.decimals} tokens`);
                }
              } catch (error: any) {
                // No withheld fees extension
              }
            } catch (error: any) {
              console.log(`\nCould not parse token account ${pubkey.toBase58()}: ${error.message}`);
            }
          }
        } else {
          // Try to get the associated token account directly
          try {
            const associatedTokenAccount = getAssociatedTokenAddressSync(
              mintPubkey,
              wallet.publicKey,
              false,
              TOKEN_2022_PROGRAM_ID
            );
            
            console.log(`\nChecking associated token account: ${associatedTokenAccount.toBase58()}`);
            
            try {
              const accountInfo = await getAccount(connection, associatedTokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
              console.log(`Balance: ${Number(accountInfo.amount) / 10**mintInfo.decimals} tokens`);
            } catch (error: any) {
              console.log(`Associated token account not found or not initialized: ${error.message}`);
              console.log(`You may need to create this account first by sending tokens to this address.`);
            }
          } catch (error: any) {
            console.log(`Error getting associated token account: ${error.message}`);
          }
          
          console.log('\nNo token accounts found for this wallet and mint.');
        }
      } catch (error) {
        console.error('Error fetching token accounts:', error);
        
        // Try to get the associated token account as a fallback
        try {
          const associatedTokenAccount = getAssociatedTokenAddressSync(
            mintPubkey,
            wallet.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID
          );
          
          console.log(`\nTrying associated token account: ${associatedTokenAccount.toBase58()}`);
          
          try {
            const accountInfo = await getAccount(connection, associatedTokenAccount, undefined, TOKEN_2022_PROGRAM_ID);
            console.log(`Balance: ${Number(accountInfo.amount) / 10**mintInfo.decimals} tokens`);
          } catch (error: any) {
            console.log(`Associated token account not found or not initialized: ${error.message}`);
            console.log(`You may need to create this account first by sending tokens to this address.`);
          }
        } catch (error: any) {
          console.log(`Error getting associated token account: ${error.message}`);
        }
      }
    } else {
      console.log('\nNo wallet provided. Skipping token account check.');
    }
  } catch (error) {
    console.error('Error checking token extensions:', error);
    process.exit(1);
  }
}

// Run the script
main(); 