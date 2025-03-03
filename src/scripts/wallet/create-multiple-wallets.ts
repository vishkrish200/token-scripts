import { generateKeypair, saveKeypair } from '../../utils/wallet';
import { logEnvironmentInfo, getEnvironment, ensureWalletDirectoryExists } from '../../config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Script to create multiple wallets
 * This script generates a specified number of wallets and saves them to files
 */
async function main() {
  try {
    // Log environment information
    const env = getEnvironment();
    logEnvironmentInfo();
    
    // Get number of wallets to create from command line args or default to 100
    const numWalletsArg = process.argv.find(arg => arg.startsWith('--count='))?.split('=')[1];
    const numWallets = numWalletsArg ? parseInt(numWalletsArg, 10) : 100;
    
    if (isNaN(numWallets) || numWallets <= 0) {
      console.error('Invalid number of wallets. Please provide a positive number.');
      process.exit(1);
    }
    
    console.log(`\nCreating ${numWallets} wallets in ${env} environment...`);
    
    // Ensure wallet directory exists
    ensureWalletDirectoryExists();
    
    // Create a directory to store the wallet index
    const walletIndexDir = path.resolve(process.cwd(), 'wallet-index');
    if (!fs.existsSync(walletIndexDir)) {
      fs.mkdirSync(walletIndexDir, { recursive: true });
    }
    
    // Create an array to store wallet information
    const walletIndex: Array<{ 
      filename: string; 
      publicKey: string; 
      path: string;
      funded: boolean;
    }> = [];
    
    // Generate wallets
    for (let i = 0; i < numWallets; i++) {
      // Generate a new keypair
      const keypair = generateKeypair();
      
      // Create a filename with index for better organization
      const filename = `wallet-${i + 1}-${Date.now()}`;
      
      // Save the keypair to a file
      const filePath = saveKeypair(keypair, filename);
      
      // Add wallet info to the index
      walletIndex.push({
        filename,
        publicKey: keypair.publicKey.toBase58(),
        path: filePath,
        funded: false
      });
      
      // Log progress every 10 wallets
      if ((i + 1) % 10 === 0 || i === numWallets - 1) {
        console.log(`Created ${i + 1}/${numWallets} wallets`);
      }
    }
    
    // Save the wallet index to a JSON file
    const indexFilePath = path.join(walletIndexDir, `${env}-wallets-index.json`);
    fs.writeFileSync(indexFilePath, JSON.stringify(walletIndex, null, 2));
    
    console.log('\nWallet creation completed successfully!');
    console.log(`Created ${numWallets} wallets`);
    console.log(`Wallet index saved to: ${indexFilePath}`);
    console.log('\nIMPORTANT: Keep your wallet files secure and backed up!');
  } catch (error) {
    console.error('Error creating wallets:', error);
    process.exit(1);
  }
}

// Run the script
main(); 