import { loadKeypair, getBalance } from '../../utils/wallet';
import { logEnvironmentInfo, getEnvironment, tokenConfig, config, featureFlags } from '../../config';
import { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedWithFeeInstruction,
  createTransferCheckedInstruction,
  getMint,
  ExtensionType,
  getTransferFeeConfig
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

/**
 * Main function to distribute tokens to multiple wallets
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
      console.warn('\nWarning: Low balance. You may need more SOL for distributing tokens.');
      const proceed = await promptUser('Do you want to proceed? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        console.log('Operation cancelled.');
        process.exit(0);
      }
    }
    
    // Get token mint address
    const mintAddressArg = process.argv.find(arg => arg.startsWith('--mint='))?.split('=')[1];
    if (!mintAddressArg) {
      console.error('Please provide a token mint address with --mint=<address>');
      process.exit(1);
    }
    
    // Get token name
    const tokenNameArg = process.argv.find(arg => arg.startsWith('--name='))?.split('=')[1];
    if (!tokenNameArg) {
      console.error('Please provide a token name with --name=<n>');
      process.exit(1);
    }
    
    const mintAddress = new PublicKey(mintAddressArg);
    const tokenName = tokenNameArg;
    
    // Create connection
    const connection = new Connection(config.rpcUrl, 'confirmed');
    
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
      : 1;
    
    // Load token info to get fee configuration
    const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
    const tokenInfoPath = path.join(tokenInfoDir, `${tokenName.toLowerCase()}.json`);
    let tokenInfo: TokenInfo | null = null;
    
    if (fs.existsSync(tokenInfoPath)) {
      tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
    }
    
    // Get mint info to use for transfer_checked instructions
    const mintInfo = await getMint(
      connection,
      mintAddress,
      'confirmed',
      TOKEN_2022_PROGRAM_ID
    );
    
    // Adjust for decimals
    const adjustedAmount = BigInt(amountPerWallet) * BigInt(10 ** mintInfo.decimals);
    
    console.log(`\nDistribution Strategy:`);
    console.log(`- Amount per wallet: ${amountPerWallet} tokens`);
    console.log(`- Number of wallets: ${walletIndex.length}`);
    
    // Find the token account for the source wallet
    const sourceTokenAccounts = await connection.getTokenAccountsByOwner(
      publicKey,
      { mint: mintAddress }
    );
    
    if (sourceTokenAccounts.value.length === 0) {
      console.error('No token account found for the source wallet');
      process.exit(1);
    }
    
    const sourceTokenAccount = sourceTokenAccounts.value[0].pubkey;
    const accountInfo = await connection.getTokenAccountBalance(sourceTokenAccount);
    console.log(`\nSource wallet token balance: ${accountInfo.value.uiAmount} ${tokenInfo?.symbol || 'TST'}`);
    
    // Check if we have enough tokens to distribute
    const totalNeeded = adjustedAmount * BigInt(walletIndex.length);
    const availableAmount = BigInt(accountInfo.value.amount);
    
    if (availableAmount < totalNeeded) {
      console.warn(`\nWarning: Not enough tokens to distribute to all wallets.`);
      console.warn(`Available: ${accountInfo.value.uiAmount} ${tokenInfo?.symbol || 'TST'}`);
      console.warn(`Required: ${Number(totalNeeded) / (10 ** mintInfo.decimals)} ${tokenInfo?.symbol || 'TST'}`);
      
      const proceed = await promptUser('Do you want to proceed with partial distribution? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        console.log('Token distribution cancelled.');
        process.exit(0);
      }
    }
    
    // Get transfer fee configuration if available
    let transferFeeBasisPoints = 0;
    if (tokenInfo?.transferFee) {
      transferFeeBasisPoints = tokenInfo.transferFee.feeBasisPoints;
      console.log(`\nTransfer Fee Configuration:`);
      console.log(`- Transfer Fee Basis Points: ${transferFeeBasisPoints} (${transferFeeBasisPoints / 100}%)`);
    }
    
    // Distribute tokens to each wallet
    console.log(`\nDistributing tokens to ${walletIndex.length} wallets...`);
    
    let successCount = 0;
    let failCount = 0;
    let totalDistributed = 0;
    
    for (let i = 0; i < walletIndex.length; i++) {
      const wallet = walletIndex[i];
      const destinationPublicKey = new PublicKey(wallet.publicKey);
      
      console.log(`\nDistributing to wallet ${i + 1}/${walletIndex.length}: ${wallet.publicKey}`);
      
      try {
        // Get or create the associated token account for the destination
        const destinationTokenAccount = getAssociatedTokenAddressSync(
          mintAddress,
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
            mintAddress,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          
          transaction.add(createAccountTx);
        }
        
        // Add the appropriate transfer instruction based on token extensions
        if (transferFeeBasisPoints > 0) {
          // Calculate the expected fee
          const transferAmount = adjustedAmount;
          const feeBasisPoints = BigInt(transferFeeBasisPoints);
          const expectedFee = (transferAmount * feeBasisPoints) / BigInt(10000);
          
          console.log(`Using transfer_checked_with_fee instruction...`);
          console.log(`- Transfer Amount: ${Number(transferAmount) / (10 ** mintInfo.decimals)}`);
          console.log(`- Expected Fee: ${Number(expectedFee) / (10 ** mintInfo.decimals)}`);
          
          // Use regular transfer instruction for high fee tokens
          const transferTx = createTransferCheckedInstruction(
            sourceTokenAccount,
            mintAddress,
            destinationTokenAccount,
            publicKey,
            transferAmount,
            mintInfo.decimals,
            [],
            TOKEN_2022_PROGRAM_ID
          );
          transaction.add(transferTx);
        } else {
          // Use transfer_checked for other token-2022 tokens
          console.log(`Using transfer_checked instruction...`);
          const transferTx = createTransferCheckedInstruction(
            sourceTokenAccount,
            mintAddress,
            destinationTokenAccount,
            publicKey,
            adjustedAmount,
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
        walletIndex[i].tokenBalance = amountPerWallet;
        successCount++;
        totalDistributed += amountPerWallet;
        
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
    if (tokenInfo) {
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
    console.error('Error distributing token:', error);
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