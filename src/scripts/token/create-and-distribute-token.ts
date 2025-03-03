import { loadKeypair, getBalance } from '../../utils/wallet';
import { 
  createTokenMint, 
  getRequiredExtensions, 
  saveTokenInfo, 
  createTokenAccount, 
  mintTokens 
} from '../../utils/token';
import { logEnvironmentInfo, getEnvironment, tokenConfig, config, featureFlags } from '../../config';
import { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithFeeInstruction,
  createTransferCheckedInstruction,
  getMint
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Interface for wallet index entries
interface WalletIndexEntry {
  filename: string;
  publicKey: string;
  path: string;
  funded: boolean;
  tokenAccount?: string;
  tokenBalance?: number;
}

// Interface for token info
interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  mintAddress: string;
  extensions: string[];
  createdAt: string;
  distributionInfo?: {
    totalDistributed: number;
    distributedWallets: number;
    distributionDate: string;
  };
}

/**
 * Script to create a token and distribute it to multiple wallets
 * This script creates a token using the Token 2022 program and distributes it to wallets
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
    const publicKey = keypair.publicKey;
    
    // Get wallet balance
    const balance = await getBalance(publicKey);
    console.log(`\nWallet: ${publicKey.toBase58()}`);
    console.log(`Balance: ${balance} SOL`);
    
    if (balance < 1) {
      console.warn('\nWarning: Low balance. You may need more SOL for creating a token and distributing it.');
      const proceed = await promptUser('Do you want to proceed? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        console.log('Token creation cancelled.');
        process.exit(0);
      }
    }
    
    // Get token name or use default
    let tokenName = process.argv.find(arg => arg.startsWith('--name='))?.split('=')[1];
    
    if (!tokenName) {
      tokenName = await promptUser(`Enter token name (default: ${tokenConfig.name}): `);
      if (!tokenName) {
        tokenName = tokenConfig.name;
      }
    }
    
    // Get required extensions based on feature flags
    const extensions = getRequiredExtensions();
    console.log('\nToken Extensions:');
    if (extensions.length === 0) {
      console.log('- None (Standard SPL Token)');
    } else {
      extensions.forEach(ext => console.log(`- ${ext}`));
    }
    
    // Create the token mint
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
    const { tokenAccount: creatorTokenAccount } = await createTokenAccount(
      keypair,
      publicKey,
      mintKeypair.publicKey
    );
    
    // Mint initial supply to the creator's account
    console.log('\nMinting initial supply...');
    await mintTokens(
      keypair,
      mintKeypair.publicKey,
      creatorTokenAccount,
      keypair,
      tokenConfig.initialSupply
    );
    
    console.log('\nToken creation completed successfully!');
    console.log(`Token Name: ${tokenName}`);
    console.log(`Token Symbol: ${tokenConfig.symbol}`);
    console.log(`Decimals: ${tokenConfig.decimals}`);
    console.log(`Mint Address: ${mintKeypair.publicKey.toBase58()}`);
    console.log(`Initial Supply: ${tokenConfig.initialSupply}`);
    
    // Ask if user wants to distribute tokens
    const distribute = await promptUser('\nDo you want to distribute tokens to wallets? (y/n): ');
    if (distribute.toLowerCase() !== 'y') {
      console.log('Token distribution skipped.');
      process.exit(0);
    }
    
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
    
    // Get distribution parameters
    const amountPerWalletArg = process.argv.find(arg => arg.startsWith('--tokenAmount='))?.split('=')[1];
    let amountPerWallet = amountPerWalletArg 
      ? parseInt(amountPerWalletArg, 10) 
      : 1000;
    
    // Adjust for decimals - make sure this is a much smaller amount
    // We're using a smaller amount to ensure we have enough tokens to distribute
    amountPerWallet = amountPerWallet * (10 ** (tokenConfig.decimals - 3)); // Reduce by 1000x
    
    console.log(`\nDistribution Strategy:`);
    console.log(`- Amount per wallet: ${amountPerWallet / (10 ** tokenConfig.decimals)} tokens`);
    console.log(`- Number of wallets: ${walletIndex.length}`);
    
    // Create a connection
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
    // Initialize source token account variable
    let sourceTokenAccount = creatorTokenAccount;
    
    // Check token balance before distribution
    try {
      // Find the token account for the source wallet
      const sourceTokenAccounts = await connection.getTokenAccountsByOwner(
        publicKey,
        { mint: mintKeypair.publicKey }
      );
      
      if (sourceTokenAccounts.value.length === 0) {
        console.error('No token account found for the source wallet');
        process.exit(1);
      }
      
      sourceTokenAccount = sourceTokenAccounts.value[0].pubkey;
      const accountInfo = await connection.getTokenAccountBalance(sourceTokenAccount);
      console.log(`\nSource wallet token balance: ${accountInfo.value.uiAmount} ${tokenConfig.symbol}`);
      
      // Check if we have enough tokens to distribute
      const totalNeeded = BigInt(amountPerWallet) * BigInt(walletIndex.length);
      const availableAmount = BigInt(accountInfo.value.amount);
      
      if (availableAmount < totalNeeded) {
        console.warn(`\nWarning: Not enough tokens to distribute to all wallets.`);
        console.warn(`Available: ${accountInfo.value.uiAmount} ${tokenConfig.symbol}`);
        console.warn(`Required: ${Number(totalNeeded) / (10 ** tokenConfig.decimals)} ${tokenConfig.symbol}`);
        
        const proceed = await promptUser('Do you want to proceed with partial distribution? (y/n): ');
        if (proceed.toLowerCase() !== 'y') {
          console.log('Token distribution cancelled.');
          process.exit(0);
        }
      }
    } catch (error) {
      console.error('Error checking token balance:', error);
      process.exit(1);
    }
    
    // Distribute tokens to each wallet
    console.log(`\nDistributing tokens to ${walletIndex.length} wallets...`);
    
    let successCount = 0;
    let failCount = 0;
    let totalDistributed = 0;
    
    // Get mint info to use for transfer_checked instructions
    const mintInfo = await getMint(
      connection,
      mintKeypair.publicKey,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    for (let i = 0; i < walletIndex.length; i++) {
      const wallet = walletIndex[i];
      const destinationPublicKey = new PublicKey(wallet.publicKey);
      
      console.log(`\nDistributing to wallet ${i + 1}/${walletIndex.length}: ${wallet.publicKey}`);
      
      try {
        // Get or create the associated token account for the destination
        const destinationTokenAccount = getAssociatedTokenAddressSync(
          mintKeypair.publicKey,
          destinationPublicKey,
          false,
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        
        // Check if the token account exists
        const accountInfo = await connection.getAccountInfo(destinationTokenAccount);
        
        // Create transaction
        const transaction = new Transaction();
        
        // If the account doesn't exist, create it
        if (accountInfo === null) {
          console.log(`Creating token account for wallet ${wallet.publicKey}...`);
          
          const createAccountTx = createAssociatedTokenAccountInstruction(
            publicKey,
            destinationTokenAccount,
            destinationPublicKey,
            mintKeypair.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          
          transaction.add(createAccountTx);
        }
        
        // Add the appropriate transfer instruction based on token extensions
        if (featureFlags.enableTransferFee) {
          // Use transfer_checked_with_fee for tokens with transfer fee
          console.log(`Using transfer_checked_with_fee instruction...`);
          const transferTx = createTransferCheckedWithFeeInstruction(
            sourceTokenAccount,
            mintKeypair.publicKey,
            destinationTokenAccount,
            publicKey,
            BigInt(amountPerWallet),
            mintInfo.decimals,
            BigInt(0), // Expected fee (we'll let the program calculate it)
            [],
            TOKEN_2022_PROGRAM_ID
          );
          transaction.add(transferTx);
        } else {
          // Use transfer_checked for other token-2022 tokens
          console.log(`Using transfer_checked instruction...`);
          const transferTx = createTransferCheckedInstruction(
            sourceTokenAccount,
            mintKeypair.publicKey,
            destinationTokenAccount,
            publicKey,
            BigInt(amountPerWallet),
            mintInfo.decimals,
            [],
            TOKEN_2022_PROGRAM_ID
          );
          transaction.add(transferTx);
        }
        
        // Send the transaction
        const signature = await sendAndConfirmTransaction(
          connection,
          transaction,
          [keypair]
        );
        
        console.log(`Tokens transferred: ${signature}`);
        
        // Update wallet status in the index
        walletIndex[i].tokenAccount = destinationTokenAccount.toBase58();
        walletIndex[i].tokenBalance = amountPerWallet / (10 ** tokenConfig.decimals);
        successCount++;
        totalDistributed += amountPerWallet / (10 ** tokenConfig.decimals);
        
        // Save the updated index every 10 wallets
        if ((i + 1) % 10 === 0 || i === walletIndex.length - 1) {
          fs.writeFileSync(indexFilePath, JSON.stringify(walletIndex, null, 2));
          console.log(`Saved updated wallet index (${successCount} distributed, ${failCount} failed)`);
        }
        
        // Wait a bit between transfers to avoid rate limiting
        if (i < walletIndex.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error distributing to wallet ${wallet.publicKey}:`, error);
        failCount++;
      }
    }
    
    // Update token info with distribution details
    const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
    const tokenInfoPath = path.join(tokenInfoDir, `${tokenName.toLowerCase()}.json`);
    
    if (fs.existsSync(tokenInfoPath)) {
      const tokenInfo: TokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
      
      tokenInfo.distributionInfo = {
        totalDistributed,
        distributedWallets: successCount,
        distributionDate: new Date().toISOString()
      };
      
      fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));
    }
    
    console.log('\nToken distribution completed!');
    console.log(`Successfully distributed to: ${successCount}/${walletIndex.length} wallets`);
    console.log(`Failed: ${failCount}/${walletIndex.length} wallets`);
    console.log(`Total tokens distributed: ${totalDistributed}`);
    console.log(`Wallet index saved to: ${indexFilePath}`);
    console.log(`Token info saved to: ${tokenInfoPath}`);
  } catch (error) {
    console.error('Error creating or distributing token:', error);
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