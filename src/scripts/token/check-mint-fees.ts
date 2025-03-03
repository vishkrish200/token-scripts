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
import { loadKeypair } from '../../utils/wallet';
import { getEnvironment, logEnvironmentInfo, config } from '../../config';
import * as fs from 'fs';
import * as path from 'path';

// Define the program
const program = new Command();

// Configure the program
program
  .name('check-mint-fees')
  .description('Check if there are any fees withheld at the mint level')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-n, --name <name>', 'Token name')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Main function to check mint fees
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
    
    // Check for withheld fees in the token account
    try {
      // Get the associated token account for the wallet
      const tokenAccount = getAssociatedTokenAddressSync(
        mintAddress,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      // Get the token account info
      const tokenAccountInfo = await getAccount(
        connection,
        tokenAccount,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
      
      console.log(`\nToken Account Info:`);
      console.log(`- Address: ${tokenAccount.toBase58()}`);
      console.log(`- Balance: ${Number(tokenAccountInfo.amount) / (10 ** mintInfo.decimals)}`);
      
      // @ts-ignore - Access the transferFeeAmount property
      if (tokenAccountInfo.transferFeeAmount) {
        // @ts-ignore - Access the transferFeeAmount property
        console.log(`- Withheld Fees: ${Number(tokenAccountInfo.transferFeeAmount) / (10 ** mintInfo.decimals)}`);
        
        // @ts-ignore - Access the transferFeeAmount property
        if (tokenAccountInfo.transferFeeAmount > 0) {
          console.log(`\nThere are fees withheld in this token account.`);
          console.log(`To harvest these fees, run:`);
          console.log(`npm run harvest-fees:${env} -- --wallet=${walletArg} --mint=${mintAddressArg}${tokenNameArg ? ` --name=${tokenNameArg}` : ''}`);
        } else {
          console.log(`\nNo fees withheld in this token account.`);
        }
      } else {
        console.log(`\nThis token account does not have withheld fees.`);
      }
    } catch (error) {
      console.error(`Error checking token account:`, error);
    }
    
  } catch (error) {
    console.error('Error checking mint fees:', error);
    process.exit(1);
  }
}

// Run the script
main(); 