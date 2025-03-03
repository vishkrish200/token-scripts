import { Command } from 'commander';
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAccount,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { loadKeypair, loadAllWallets } from '../../utils/wallet';
import { getEnvironment, logEnvironmentInfo, config } from '../../config';
import * as fs from 'fs';
import * as path from 'path';

// Define the program
const program = new Command();

// Configure the program
program
  .name('transfer-between-wallets')
  .description('Transfer tokens between wallets to generate fees')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-n, --name <name>', 'Token name')
  .option('-a, --amount <amount>', 'Amount of tokens to transfer', '1')
  .option('-c, --count <count>', 'Number of transfers to make', '5')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Main function to transfer tokens between wallets
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
    
    // Get amount
    const amountArg = options.amount || process.argv.find(arg => arg.startsWith('--amount='))?.split('=')[1] || '1';
    const amount = parseFloat(amountArg);
    
    // Get count
    const countArg = options.count || process.argv.find(arg => arg.startsWith('--count='))?.split('=')[1] || '5';
    const count = parseInt(countArg);
    
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
    
    // Filter out wallets that have tokens
    console.log('\nChecking wallets for tokens...');
    const walletsWithTokens = [];
    
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
          
          if (tokenAccountInfo.amount > BigInt(0)) {
            walletsWithTokens.push({
              wallet,
              tokenAccount,
              balance: tokenAccountInfo.amount,
            });
            
            console.log(`Wallet ${i + 1}: ${wallet.publicKey.toBase58()}`);
            console.log(`- Token Account: ${tokenAccount.toBase58()}`);
            console.log(`- Balance: ${Number(tokenAccountInfo.amount) / (10 ** mintInfo.decimals)}`);
          }
        } catch (error) {
          // Token account might not exist, skip
        }
      } catch (error) {
        console.error(`Error checking wallet ${i + 1}:`, error);
      }
    }
    
    console.log(`\nFound ${walletsWithTokens.length} wallets with tokens.`);
    
    if (walletsWithTokens.length < 2) {
      console.error('Need at least 2 wallets with tokens to transfer between them.');
      process.exit(1);
    }
    
    // Calculate the amount in lamports
    const amountLamports = BigInt(Math.floor(amount * (10 ** mintInfo.decimals)));
    
    console.log(`\nTransferring ${amount} tokens ${count} times between wallets...`);
    
    // Make transfers
    for (let i = 0; i < count; i++) {
      // Select random source and destination wallets
      const sourceIndex = Math.floor(Math.random() * walletsWithTokens.length);
      let destIndex = Math.floor(Math.random() * walletsWithTokens.length);
      
      // Make sure source and destination are different
      while (destIndex === sourceIndex) {
        destIndex = Math.floor(Math.random() * walletsWithTokens.length);
      }
      
      const source = walletsWithTokens[sourceIndex];
      const destination = walletsWithTokens[destIndex];
      
      // Check if source has enough balance
      if (source.balance < amountLamports) {
        console.log(`Skipping transfer ${i + 1}: Source wallet doesn't have enough balance.`);
        continue;
      }
      
      console.log(`\nTransfer ${i + 1}:`);
      console.log(`- From: ${source.wallet.publicKey.toBase58()}`);
      console.log(`- To: ${destination.wallet.publicKey.toBase58()}`);
      console.log(`- Amount: ${amount} tokens`);
      
      try {
        // Create transfer instruction
        const transferInstruction = createTransferCheckedInstruction(
          source.tokenAccount,
          mintAddress,
          destination.tokenAccount,
          source.wallet.publicKey,
          amountLamports,
          mintInfo.decimals,
          [],
          TOKEN_2022_PROGRAM_ID
        );
        
        // Create and sign transaction
        const transaction = new Transaction().add(transferInstruction);
        
        // Send and confirm transaction
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [source.wallet],
          { commitment: 'confirmed' }
        );
        
        console.log(`- Transaction: ${signature}`);
        console.log(`- Status: Success`);
        
        // Update balances
        source.balance -= amountLamports;
        destination.balance += amountLamports;
        
        // Calculate fee
        if (transferFeeBasisPoints > 0) {
          const fee = (amountLamports * BigInt(transferFeeBasisPoints)) / BigInt(10000);
          console.log(`- Fee: ${Number(fee) / (10 ** mintInfo.decimals)} tokens`);
        }
      } catch (error: any) {
        console.error(`- Error: ${error.message}`);
      }
    }
    
    console.log('\nTransfers completed.');
    console.log(`\nTo check for withheld fees, run:`);
    console.log(`npm run check-all-token-accounts:${env} -- --wallet=${walletArg} --mint=${mintAddressArg}${tokenNameArg ? ` --name=${tokenNameArg}` : ''}`);
    
  } catch (error) {
    console.error('Error transferring tokens:', error);
    process.exit(1);
  }
}

// Run the script
main(); 