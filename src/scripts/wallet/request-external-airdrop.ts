import { loadKeypair } from '../../utils/wallet';
import { logEnvironmentInfo, getEnvironment } from '../../config';
import * as readline from 'readline';

/**
 * Script to provide instructions for requesting an airdrop from external faucets
 * This script displays the wallet address and provides links to external faucets
 */
async function main() {
  try {
    // Log environment information
    const env = getEnvironment();
    logEnvironmentInfo();
    
    // Get wallet filename from command line args or prompt user
    let walletFilename = process.argv.find(arg => arg.startsWith('--wallet='))?.split('=')[1];
    
    if (!walletFilename) {
      walletFilename = await promptUser('Enter wallet filename (without extension): ');
    }
    
    // Load the keypair
    const keypair = loadKeypair(walletFilename);
    const publicKey = keypair.publicKey.toBase58();
    
    console.log(`\nWallet Address: ${publicKey}`);
    console.log('\nTo get more SOL for this wallet, visit one of these faucets:');
    console.log('1. QuickNode Solana Faucet: https://faucet.quicknode.com/solana/testnet');
    console.log('2. Stakely Faucet: https://stakely.io/en/faucet/solana-sol');
    console.log('3. Solfaucet: https://solfaucet.com/');
    
    console.log('\nInstructions:');
    console.log('1. Copy your wallet address shown above');
    console.log('2. Visit one of the faucet websites');
    console.log('3. Paste your wallet address and request SOL');
    console.log('4. Wait for the transaction to complete');
    
    console.log('\nAfter receiving SOL, you can continue with token creation.');
  } catch (error) {
    console.error('Error:', error);
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