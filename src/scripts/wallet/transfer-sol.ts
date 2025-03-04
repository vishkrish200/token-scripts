import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { loadWallet, loadWalletFromEnv, getBalance } from '../../utils/wallet';
import { logEnvironmentInfo, getConnection, getEnvironment } from '../../config';

/**
 * Script to transfer SOL between wallets
 */
async function main() {
  try {
    // Log environment information
    const env = getEnvironment();
    logEnvironmentInfo();
    
    // Get parameters from command line
    const privateKeyEnv = process.argv.find(arg => arg.startsWith('--private-key-env='))?.split('=')[1];
    const amount = process.argv.find(arg => arg.startsWith('--amount='))?.split('=')[1];
    const recipient = process.argv.find(arg => arg.startsWith('--recipient='))?.split('=')[1];
    const walletFile = process.argv.find(arg => arg.startsWith('--wallet='))?.split('=')[1];
    
    if (!amount || !recipient) {
      console.error('Usage: npm run transfer-sol -- --amount=<amount> --recipient=<recipient> [--private-key-env=<env_var> | --wallet=<wallet_file>]');
      process.exit(1);
    }
    
    // Load the source wallet
    const sourceKeypair = privateKeyEnv 
      ? loadWalletFromEnv(privateKeyEnv)
      : loadWallet(walletFile!);
    
    const sourcePublicKey = sourceKeypair.publicKey;
    const destinationPublicKey = new PublicKey(recipient);
    const amountToSend = parseFloat(amount);
    
    // Create a connection
    const connection = getConnection();
    
    // Get initial balance
    const initialBalance = await getBalance(sourcePublicKey);
    console.log(`\nSource Wallet: ${sourcePublicKey.toBase58()}`);
    console.log(`Initial balance: ${initialBalance} SOL`);
    console.log(`Recipient: ${destinationPublicKey.toBase58()}`);
    console.log(`Amount to send: ${amountToSend} SOL`);
    
    // Create and send transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sourcePublicKey,
        toPubkey: destinationPublicKey,
        lamports: amountToSend * LAMPORTS_PER_SOL
      })
    );
    
    console.log('\nSending transaction...');
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sourceKeypair]
    );
    
    console.log(`\nTransfer successful!`);
    console.log(`Transaction signature: ${signature}`);
    
    // Get final balances
    const finalSourceBalance = await getBalance(sourcePublicKey);
    const finalDestBalance = await getBalance(destinationPublicKey);
    
    console.log(`\nSource wallet final balance: ${finalSourceBalance} SOL`);
    console.log(`Recipient wallet final balance: ${finalDestBalance} SOL`);
  } catch (error) {
    console.error('Error transferring SOL:', error);
    process.exit(1);
  }
}

// Run the script
main(); 