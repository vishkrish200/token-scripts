import { loadKeypair, getBalance } from '../../utils/wallet';
import { createTokenMint, getRequiredExtensions, saveTokenInfo, createTokenAccount, mintTokens } from '../../utils/token';
import { logEnvironmentInfo, getEnvironment, tokenConfig, config } from '../../config';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as readline from 'readline';

/**
 * Main function to create a token
 */
async function main() {
  try {
    // Get environment and configuration
    const env = getEnvironment();
    logEnvironmentInfo();
    
    // Load wallet
    const walletArg = process.argv.find(arg => arg.startsWith('--wallet='))?.split('=')[1];
    if (!walletArg) {
      console.error('Please provide a wallet with --wallet=<wallet-name>');
      process.exit(1);
    }
    
    // Load keypair
    const keypair = loadKeypair(walletArg);
    const publicKey = keypair.publicKey;
    
    // Get wallet balance
    const balance = await getBalance(publicKey);
    console.log(`\nWallet: ${publicKey.toBase58()}`);
    console.log(`Balance: ${balance} SOL`);
    
    // Check if balance is sufficient
    if (balance < 0.05) {
      console.warn('\nWarning: Low balance. You may need more SOL for creating a token and distributing it.');
      const proceed = await promptUser('Do you want to proceed? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        console.log('Operation cancelled.');
        process.exit(0);
      }
    }
    
    // Get token name from command line or use default
    const tokenNameArg = process.argv.find(arg => arg.startsWith('--name='))?.split('=')[1];
    const tokenName = tokenNameArg || tokenConfig.name;
    
    // Get required extensions
    const extensions = getRequiredExtensions();
    console.log('\nToken Extensions:');
    if (extensions.length === 0) {
      console.log('- None (Standard SPL Token)');
    } else {
      extensions.forEach(ext => console.log(`- ${ext}`));
    }
    
    // Create token mint
    console.log('\nCreating token mint...');
    const { mintKeypair, signature } = await createTokenMint(
      keypair,
      publicKey,
      publicKey // Same as mint authority for simplicity
    );
    
    // Save token information
    saveTokenInfo(tokenName, mintKeypair.publicKey, extensions);
    
    // Create a token account for the creator
    console.log('\nCreating token account for creator...');
    const { tokenAccount } = await createTokenAccount(
      keypair,
      publicKey,
      mintKeypair.publicKey
    );
    
    // Mint initial supply to the creator's account
    console.log('\nMinting initial supply...');
    await mintTokens(
      keypair,
      mintKeypair.publicKey,
      tokenAccount,
      keypair,
      tokenConfig.initialSupply
    );
    
    console.log('\nToken creation completed successfully!');
    console.log(`Token Name: ${tokenName}`);
    console.log(`Token Symbol: ${tokenConfig.symbol}`);
    console.log(`Decimals: ${tokenConfig.decimals}`);
    console.log(`Mint Address: ${mintKeypair.publicKey.toBase58()}`);
    console.log(`Initial Supply: ${tokenConfig.initialSupply}`);
    console.log(`Token Account: ${tokenAccount.toBase58()}`);
    
    // Provide instructions for distribution
    console.log('\nTo distribute this token, run:');
    console.log(`npm run distribute-token:${env} -- --wallet=${walletArg} --mint=${mintKeypair.publicKey.toBase58()} --name=${tokenName}`);
    
  } catch (error) {
    console.error('Error creating token:', error);
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