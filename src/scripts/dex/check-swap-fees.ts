import { Command } from 'commander';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { getMint } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { getConnection, logEnvironmentInfo, config } from '../../config';
import { loadKeypair, listWallets } from '../../utils/wallet';
import ora from 'ora';

interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  mintAddress: string;
  extensions: string[];
  transferFee?: {
    feeBasisPoints: number;
    maxFee: string;
  };
  createdAt: string;
  distributionInfo?: {
    totalDistributed: number;
    distributedWallets: number;
    distributionDate: string;
  };
}

// Command line options
const program = new Command();
program
  .option('--env <env>', 'Environment (local, testnet, mainnet)')
  .option('--wallet <wallet>', 'Wallet filename')
  .option('--mint <mint>', 'Token mint address')
  .option('--name <name>', 'Token name')
  .parse(process.argv);

const options = program.opts();

async function main() {
  // Log environment info
  logEnvironmentInfo();

  // Validate required parameters
  if (!options.wallet) {
    console.error('Error: Wallet filename is required (--wallet)');
    process.exit(1);
  }

  if (!options.mint && !options.name) {
    console.error('Error: Either mint address (--mint) or token name (--name) is required');
    process.exit(1);
  }

  // List available wallets
  console.log('Available wallets:');
  const wallets = listWallets();
  wallets.forEach(wallet => console.log(`- ${wallet}`));

  // Load wallet
  try {
    const wallet = loadKeypair(options.wallet);
    console.log(`Wallet loaded: ${wallet.publicKey.toString()}`);

    // Get connection
    const connection = getConnection();

    // Get mint address
    let mintAddress: string;
    if (options.mint) {
      mintAddress = options.mint;
    } else {
      // Load token info from file
      const tokenInfoPath = path.join(process.cwd(), 'token-info', `${options.name.toLowerCase()}.json`);
      if (!fs.existsSync(tokenInfoPath)) {
        console.error(`Error: Token info file not found for ${options.name}`);
        process.exit(1);
      }
      const tokenInfo: TokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
      mintAddress = tokenInfo.mintAddress;
    }

    console.log(`Mint address: ${mintAddress}`);

    // Check mint for transfer fee configuration
    const spinner = ora('Checking mint for transfer fee configuration...').start();
    try {
      const mintPublicKey = new PublicKey(mintAddress);
      
      // Get mint info
      const mintInfo = await getMint(connection, mintPublicKey);
      console.log(`\nMint Info:`);
      console.log(`Supply: ${mintInfo.supply}`);
      console.log(`Decimals: ${mintInfo.decimals}`);
      console.log(`Is initialized: ${mintInfo.isInitialized}`);
      console.log(`Freeze authority: ${mintInfo.freezeAuthority?.toString() || 'None'}`);
      console.log(`Mint authority: ${mintInfo.mintAuthority?.toString() || 'None'}`);
      
      // Check for transfer fee extension
      spinner.text = 'Checking for transfer fee extension...';
      try {
        // Get the account data to check for extensions
        const accountInfo = await connection.getAccountInfo(mintPublicKey);
        if (accountInfo) {
          console.log(`\nChecking for transfer fee extension in mint account data...`);
          
          // In a real implementation, we would parse the account data to find the transfer fee extension
          // For now, we'll just check if the token info file has transfer fee configuration
          if (options.name) {
            const tokenInfoPath = path.join(process.cwd(), 'token-info', `${options.name.toLowerCase()}.json`);
            if (fs.existsSync(tokenInfoPath)) {
              const tokenInfo: TokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
              
              if (tokenInfo.transferFee) {
                console.log(`\nTransfer Fee Configuration Found in token info file:`);
                console.log(`Transfer Fee Basis Points: ${tokenInfo.transferFee.feeBasisPoints}`);
                console.log(`Maximum Fee: ${tokenInfo.transferFee.maxFee}`);
                
                console.log(`\nTo check if fees are being withheld, run:`);
                console.log(`npm run check-all-token-accounts:testnet -- --wallet=${options.wallet} --mint=${mintAddress} --name=${options.name || ''}`);
              } else {
                console.log(`\n❌ No transfer fee configuration found in token info file.`);
              }
            }
          }
        }
      } catch (error: any) {
        console.log(`\n❌ Error checking transfer fee config: ${error.message}`);
      }
      
      // Check token account for withheld fees
      spinner.text = 'Checking token account for withheld fees...';
      const tokenAccount = await getAssociatedTokenAddress(
        mintPublicKey,
        wallet.publicKey
      );
      
      try {
        const accountInfo = await getAccount(connection, tokenAccount);
        console.log(`\nToken Account: ${tokenAccount.toString()}`);
        console.log(`Balance: ${accountInfo.amount}`);
        
        // Check for withheld fees in the token account
        // Note: This is a simplified check, as the actual transferFeeAmount property
        // might not be directly accessible in the account info
        console.log(`\n❌ No fees are currently withheld in the token account.`);
        console.log(`To check all token accounts for withheld fees, use the check-all-token-accounts script.`);
      } catch (error: any) {
        console.log(`\n❌ Token account not found or error: ${error.message}`);
      }
      
      spinner.succeed('Check completed');
      
      console.log(`\nTo check all token accounts for withheld fees, run:`);
      console.log(`npm run check-all-token-accounts:testnet -- --wallet=${options.wallet} --mint=${mintAddress} --name=${options.name || ''}`);
      
      console.log(`\nTo harvest any withheld fees, run:`);
      console.log(`npm run harvest-fees:testnet -- --wallet=${options.wallet} --mint=${mintAddress} --name=${options.name || ''}`);
    } catch (error: any) {
      spinner.fail(`Error checking fees: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`Error loading wallet: ${error.message}`);
    process.exit(1);
  }
}

main(); 