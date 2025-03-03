import { 
  loadKeypair, 
  requestAirdrop, 
  getBalance 
} from '../../utils/wallet';
import { 
  logEnvironmentInfo, 
  getEnvironment, 
  config, 
  testAmounts 
} from '../../config';
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Interface for wallet index entries
interface WalletIndexEntry {
  filename: string;
  publicKey: string;
  path: string;
  funded: boolean;
}

/**
 * Script to fund multiple wallets efficiently
 * This script requests airdrops for a few wallets and then transfers SOL to the rest
 */
async function main() {
  try {
    // Log environment information
    const env = getEnvironment();
    logEnvironmentInfo();
    
    if (!config.isDevnet) {
      console.error('Funding multiple wallets is only available on devnet or local networks');
      process.exit(1);
    }
    
    // Get source wallet filename from command line args or prompt user
    let sourceWalletFilename = process.argv.find(arg => arg.startsWith('--source='))?.split('=')[1];
    
    if (!sourceWalletFilename) {
      sourceWalletFilename = await promptUser('Enter source wallet filename (without extension): ');
    }
    
    // Load the source keypair
    const sourceKeypair = loadKeypair(sourceWalletFilename);
    const sourcePublicKey = sourceKeypair.publicKey;
    
    // Get initial balance
    const initialBalance = await getBalance(sourcePublicKey);
    console.log(`\nSource Wallet: ${sourcePublicKey.toBase58()}`);
    console.log(`Initial balance: ${initialBalance} SOL`);
    
    // Load wallet index
    const walletIndexDir = path.resolve(process.cwd(), 'wallet-index');
    const indexFilePath = path.join(walletIndexDir, `${env}-wallets-index.json`);
    
    if (!fs.existsSync(indexFilePath)) {
      console.error(`Wallet index file not found at ${indexFilePath}`);
      console.error('Please run create-multiple-wallets.ts first');
      process.exit(1);
    }
    
    const walletIndex: WalletIndexEntry[] = JSON.parse(fs.readFileSync(indexFilePath, 'utf-8'));
    
    console.log(`\nLoaded ${walletIndex.length} wallets from index`);
    
    // Get funding parameters
    const amountPerWalletArg = process.argv.find(arg => arg.startsWith('--amount='))?.split('=')[1];
    const amountPerWallet = amountPerWalletArg 
      ? parseFloat(amountPerWalletArg) 
      : testAmounts.transferAmount;
    
    const airdropCountArg = process.argv.find(arg => arg.startsWith('--airdrops='))?.split('=')[1];
    const airdropCount = airdropCountArg ? parseInt(airdropCountArg, 10) : 3;
    
    console.log(`\nFunding Strategy:`);
    console.log(`- Amount per wallet: ${amountPerWallet} SOL`);
    console.log(`- Number of airdrops: ${airdropCount}`);
    console.log(`- Remaining wallets will be funded via transfers`);
    
    // Create a connection
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
    // Request airdrops for the source wallet
    console.log(`\nRequesting airdrops for source wallet...`);
    
    for (let i = 0; i < airdropCount; i++) {
      const airdropAmount = testAmounts.airdropAmount;
      console.log(`Airdrop ${i + 1}/${airdropCount}: Requesting ${airdropAmount} SOL...`);
      
      try {
        await requestAirdrop(sourcePublicKey, airdropAmount);
        // Wait a bit between airdrops to avoid rate limiting
        if (i < airdropCount - 1) {
          console.log('Waiting 2 seconds before next airdrop...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`Error requesting airdrop ${i + 1}:`, error);
        // Continue with the next airdrop
      }
    }
    
    // Get updated balance
    const updatedBalance = await getBalance(sourcePublicKey);
    console.log(`\nSource wallet balance after airdrops: ${updatedBalance} SOL`);
    
    // Calculate if we have enough SOL to fund all wallets
    const totalNeeded = walletIndex.length * amountPerWallet;
    
    if (updatedBalance < totalNeeded) {
      console.warn(`\nWARNING: Source wallet balance (${updatedBalance} SOL) is less than needed (${totalNeeded} SOL)`);
      console.warn(`Some wallets may not be fully funded`);
      
      const proceed = await promptUser('Do you want to proceed with partial funding? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        console.log('Funding cancelled.');
        process.exit(0);
      }
    }
    
    // Fund each wallet
    console.log(`\nFunding ${walletIndex.length} wallets...`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < walletIndex.length; i++) {
      const wallet = walletIndex[i];
      const destinationPublicKey = new PublicKey(wallet.publicKey);
      
      console.log(`\nFunding wallet ${i + 1}/${walletIndex.length}: ${wallet.publicKey}`);
      
      try {
        // Create and send a transfer transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: sourcePublicKey,
            toPubkey: destinationPublicKey,
            lamports: amountPerWallet * LAMPORTS_PER_SOL
          })
        );
        
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [sourceKeypair]
        );
        
        console.log(`Transfer successful: ${signature}`);
        
        // Update wallet status in the index
        walletIndex[i].funded = true;
        successCount++;
        
        // Save the updated index every 10 wallets
        if ((i + 1) % 10 === 0 || i === walletIndex.length - 1) {
          fs.writeFileSync(indexFilePath, JSON.stringify(walletIndex, null, 2));
          console.log(`Saved updated wallet index (${successCount} funded, ${failCount} failed)`);
        }
        
        // Wait a bit between transfers to avoid rate limiting
        if (i < walletIndex.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error funding wallet ${wallet.publicKey}:`, error);
        failCount++;
      }
    }
    
    // Get final balance
    const finalBalance = await getBalance(sourcePublicKey);
    
    console.log('\nFunding completed!');
    console.log(`Successfully funded: ${successCount}/${walletIndex.length} wallets`);
    console.log(`Failed: ${failCount}/${walletIndex.length} wallets`);
    console.log(`Source wallet final balance: ${finalBalance} SOL`);
    console.log(`Wallet index saved to: ${indexFilePath}`);
  } catch (error) {
    console.error('Error funding wallets:', error);
    process.exit(1);
  }
}

/**
 * Prompt the user for input
 * @param question The question to ask
 * @returns The user's response
 */
function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Run the script
main(); 