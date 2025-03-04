import { generateKeypair, saveWallet } from '../../utils/wallet';
import { logEnvironmentInfo, getEnvironment } from '../../config';

/**
 * Script to create a new wallet
 * This is a one-time script to generate a new wallet keypair and save it to a file
 */
async function main() {
  try {
    // Log environment information
    logEnvironmentInfo();
    
    // Generate a new keypair
    const keypair = generateKeypair();
    
    // Save the keypair to a file
    const env = getEnvironment();
    const filename = `wallet-${Date.now()}`;
    const filePath = saveWallet(keypair, filename);
    
    console.log('\nWallet created successfully!');
    console.log(`Public Key: ${keypair.publicKey.toBase58()}`);
    console.log(`Environment: ${env}`);
    console.log(`Saved to: ${filePath}`);
    console.log('\nIMPORTANT: Keep your wallet file secure and backed up!');
  } catch (error) {
    console.error('Error creating wallet:', error);
    process.exit(1);
  }
}

// Run the script
main(); 