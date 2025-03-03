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
import { loadKeypair } from '../../utils/wallet';
import { getEnvironment, logEnvironmentInfo, config } from '../../config';
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
    // Get environment and configuration
    const env = getEnvironment();
    logEnvironmentInfo();
    
    // Get wallet
    const walletArg = options.wallet || process.argv.find(arg => arg.startsWith('--wallet='))?.split('=')[1];
    if (!walletArg) {
      console.error('Please provide a wallet with --wallet=<wallet-name>');
      process.exit(1);
    }
    
    // Get mint address
    const mintAddressArg = options.mint || process.argv.find(arg => arg.startsWith('--mint='))?.split('=')[1];
    if (!mintAddressArg) {
      console.error('Please provide a token mint address with --mint=<address>');
      process.exit(1);
    }
    
    // Get token name
    const tokenNameArg = options.name || process.argv.find(arg => arg.startsWith('--name='))?.split('=')[1];
    
    // Load keypair
    const keypair = loadKeypair(walletArg);
    const publicKey = keypair.publicKey;
    
    console.log(`Wallet: ${publicKey.toBase58()}`);
    
    // Create connection
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
    // Get mint address
    const mintAddress = new PublicKey(mintAddressArg);
    console.log(`Mint address: ${mintAddress.toBase58()}`);
    
    // Get mint info
    const mintInfo = await getMint(
      connection,
      mintAddress,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(`\nMint Info:`);
    console.log(`- Supply: ${Number(mintInfo.supply) / (10 ** mintInfo.decimals)}`);
    console.log(`- Decimals: ${mintInfo.decimals}`);
    console.log(`- Is initialized: ${mintInfo.isInitialized}`);
    console.log(`- Freeze authority: ${mintInfo.freezeAuthority?.toBase58() || 'None'}`);
    console.log(`- Mint authority: ${mintInfo.mintAuthority?.toBase58() || 'None'}`);
    
    // Check for extensions in the mint
    console.log(`\nChecking mint extensions...`);
    
    // Get the raw account data
    const mintAccountInfo = await connection.getAccountInfo(mintAddress);
    if (!mintAccountInfo) {
      console.error('Mint account not found');
      process.exit(1);
    }
    
    // Check for transfer fee extension
    try {
      const transferFeeConfig = getTransferFeeConfig(mintInfo);
      if (transferFeeConfig) {
        console.log(`\nTransfer Fee Extension found:`);
        console.log(`- Transfer Fee Basis Points: ${transferFeeConfig.newerTransferFee.transferFeeBasisPoints} (${transferFeeConfig.newerTransferFee.transferFeeBasisPoints / 100}%)`);
        console.log(`- Maximum Fee: ${transferFeeConfig.newerTransferFee.maximumFee}`);
        console.log(`- Withheld Amount: ${transferFeeConfig.withheldAmount}`);
      } else {
        console.log(`\nNo Transfer Fee Extension found in mint.`);
      }
    } catch (error) {
      console.error(`Error checking transfer fee extension:`, error);
    }
    
    // Get the associated token account for the wallet
    const tokenAccount = getAssociatedTokenAddressSync(
      mintAddress,
      publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log(`\nToken Account: ${tokenAccount.toBase58()}`);
    
    try {
      // Get the token account info
      const tokenAccountInfo = await getAccount(
        connection,
        tokenAccount,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
      
      console.log(`- Balance: ${Number(tokenAccountInfo.amount) / (10 ** mintInfo.decimals)}`);
      
      // Check for extensions in the token account
      console.log(`\nChecking token account extensions...`);
      
      // Get the raw account data
      const accountInfo = await connection.getAccountInfo(tokenAccount);
      if (!accountInfo) {
        console.error('Token account not found');
        process.exit(1);
      }
      
      // Check for transfer fee extension
      try {
        // @ts-ignore - Access the transferFeeAmount property
        if (tokenAccountInfo.transferFeeAmount !== undefined) {
          console.log(`\nTransfer Fee Extension found in token account:`);
          // @ts-ignore - Access the transferFeeAmount property
          console.log(`- Withheld Amount: ${tokenAccountInfo.transferFeeAmount}`);
        } else {
          console.log(`\nNo Transfer Fee Extension found in token account.`);
        }
      } catch (error) {
        console.error(`Error checking token account transfer fee extension:`, error);
      }
      
    } catch (error) {
      console.error(`Error getting token account:`, error);
    }
    
    // Load token info if available
    if (tokenNameArg) {
      const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
      const tokenInfoPath = path.join(tokenInfoDir, `${tokenNameArg.toLowerCase()}.json`);
      
      if (fs.existsSync(tokenInfoPath)) {
        const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
        
        console.log(`\nToken Info from file:`);
        console.log(`- Name: ${tokenInfo.name}`);
        console.log(`- Symbol: ${tokenInfo.symbol}`);
        console.log(`- Decimals: ${tokenInfo.decimals}`);
        console.log(`- Extensions: ${tokenInfo.extensions.join(', ')}`);
        
        if (tokenInfo.transferFee) {
          console.log(`- Transfer Fee: ${tokenInfo.transferFee.feeBasisPoints / 100}%`);
          console.log(`- Max Fee: ${tokenInfo.transferFee.maxFee}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error checking token extensions:', error);
    process.exit(1);
  }
}

// Run the script
main(); 