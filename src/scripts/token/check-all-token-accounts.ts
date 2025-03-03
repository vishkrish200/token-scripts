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
} from '@solana/spl-token';
import { loadKeypair, loadAllWallets } from '../../utils/wallet';
import { getEnvironment, logEnvironmentInfo, config } from '../../config';
import * as fs from 'fs';
import * as path from 'path';

// Define the program
const program = new Command();

// Configure the program
program
  .name('check-all-token-accounts')
  .description('Check all token accounts for a specific mint to find any withheld fees')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-n, --name <name>', 'Token name')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Main function to check all token accounts
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
    
    // Load token info if available
    let transferFeeBasisPoints = 0;
    let maxFee = BigInt(0);
    
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
          transferFeeBasisPoints = tokenInfo.transferFee.feeBasisPoints;
          maxFee = BigInt(tokenInfo.transferFee.maxFee);
          console.log(`- Transfer Fee: ${transferFeeBasisPoints / 100}%`);
          console.log(`- Max Fee: ${maxFee === BigInt(0) ? 'Unlimited' : maxFee.toString()}`);
        }
      }
    }
    
    // Load all wallets
    console.log('\nLoading all wallets...');
    const wallets = loadAllWallets();
    console.log(`Loaded ${wallets.length} wallets.`);
    
    // Check each wallet for token accounts
    console.log('\nChecking token accounts for all wallets...');
    
    let totalWithheldFees = BigInt(0);
    let accountsWithFees = 0;
    
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      
      try {
        // Get the associated token account for the wallet
        const tokenAccount = getAssociatedTokenAddressSync(
          mintAddress,
          wallet.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        
        try {
          // Get the token account info
          const tokenAccountInfo = await getAccount(
            connection,
            tokenAccount,
            'confirmed',
            TOKEN_2022_PROGRAM_ID
          );
          
          // @ts-ignore - Access the transferFeeAmount property
          if (tokenAccountInfo.transferFeeAmount && tokenAccountInfo.transferFeeAmount > BigInt(0)) {
            accountsWithFees++;
            // @ts-ignore - Access the transferFeeAmount property
            totalWithheldFees += tokenAccountInfo.transferFeeAmount;
            
            console.log(`\nWallet ${i + 1}: ${wallet.publicKey.toBase58()}`);
            console.log(`- Token Account: ${tokenAccount.toBase58()}`);
            console.log(`- Balance: ${Number(tokenAccountInfo.amount) / (10 ** mintInfo.decimals)}`);
            // @ts-ignore - Access the transferFeeAmount property
            console.log(`- Withheld Fees: ${Number(tokenAccountInfo.transferFeeAmount) / (10 ** mintInfo.decimals)}`);
          }
        } catch (error) {
          // Token account might not exist, skip
        }
      } catch (error) {
        console.error(`Error checking wallet ${i + 1}:`, error);
      }
    }
    
    console.log('\nSummary:');
    console.log(`- Total accounts with withheld fees: ${accountsWithFees}`);
    console.log(`- Total withheld fees: ${Number(totalWithheldFees) / (10 ** mintInfo.decimals)}`);
    
    if (accountsWithFees > 0) {
      console.log(`\nTo harvest these fees, run:`);
      console.log(`npm run harvest-fees:${env} -- --wallet=${walletArg} --mint=${mintAddressArg}${tokenNameArg ? ` --name=${tokenNameArg}` : ''}`);
    } else {
      console.log(`\nNo fees withheld in any token accounts.`);
      console.log(`\nTo generate fees, you need to make transfers between accounts.`);
      console.log(`Try running the transfer-between-wallets script to generate some fees.`);
    }
    
  } catch (error) {
    console.error('Error checking token accounts:', error);
    process.exit(1);
  }
}

// Run the script
main(); 