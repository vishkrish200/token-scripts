import { PublicKey } from '@solana/web3.js';
import { loadKeypair, requestAirdrop, getBalance } from '../../utils/wallet';
import { logEnvironmentInfo, testAmounts, config } from '../../config';
import * as readline from 'readline';

/**
 * Script to request an airdrop of SOL to a wallet
 * This is a one-time script to request an airdrop of SOL to a wallet for testing
 */
async function main() {
  try {
    // Log environment information
    logEnvironmentInfo();
    
    if (!config.isDevnet) {
      console.error('Airdrops are only available on devnet or local networks');
      process.exit(1);
    }
    
    // Get wallet filename from command line args or prompt user
    let walletFilename = process.argv.find(arg => arg.startsWith('--wallet='))?.split('=')[1];
    
    if (!walletFilename) {
      walletFilename = await promptUser('Enter wallet filename (without extension): ');
    }
    
    // Load the keypair
    const keypair = loadKeypair(walletFilename);
    const publicKey = keypair.publicKey;
    
    // Get initial balance
    const initialBalance = await getBalance(publicKey);
    console.log(`\nWallet: ${publicKey.toBase58()}`);
    console.log(`Initial balance: ${initialBalance} SOL`);
    
    // Request airdrop
    const amount = testAmounts.airdropAmount;
    console.log(`\nRequesting airdrop of ${amount} SOL...`);
    
    const signature = await requestAirdrop(publicKey, amount);
    
    // Get new balance
    const newBalance = await getBalance(publicKey);
    
    console.log('\nAirdrop successful!');
    console.log(`New balance: ${newBalance} SOL`);
    console.log(`Transaction signature: ${signature}`);
  } catch (error) {
    console.error('Error requesting airdrop:', error);
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