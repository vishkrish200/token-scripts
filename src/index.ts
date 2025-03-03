import { logEnvironmentInfo, getEnvironment } from './config';

/**
 * Main entry point for the token-scripts package
 * Displays information about available scripts and how to use them
 */
function main() {
  // Log environment information
  const env = getEnvironment();
  logEnvironmentInfo();
  
  console.log('\n=== Solana Token 2022 Scripts ===');
  console.log('\nAvailable Scripts:');
  
  console.log('\n1. Wallet Management:');
  console.log(`   - Create Single Wallet: npm run create-wallet:${env}`);
  console.log(`   - Create Multiple Wallets (100): npm run create-multiple-wallets:${env} -- --count=100`);
  console.log(`   - Request Airdrop: npm run airdrop:${env} -- --wallet=<wallet-filename>`);
  console.log(`   - Fund Multiple Wallets: npm run fund-wallets:${env} -- --source=<wallet-filename> --amount=0.1 --airdrops=3`);
  
  console.log('\n2. Token Management:');
  console.log(`   - Create Token: npm run create-token:${env} -- --wallet=<wallet-filename> --name=<token-name>`);
  console.log(`   - Create & Distribute Token: npm run create-distribute-token:${env} -- --wallet=<wallet-filename> --name=<token-name> --tokenAmount=1000`);
  
  console.log('\n3. Complete Token Launch Workflow:');
  console.log(`   1. Create a source wallet: npm run create-wallet:${env}`);
  console.log(`   2. Request an airdrop: npm run airdrop:${env} -- --wallet=<source-wallet-filename>`);
  console.log(`   3. Create multiple wallets: npm run create-multiple-wallets:${env} -- --count=100`);
  console.log(`   4. Fund the wallets: npm run fund-wallets:${env} -- --source=<source-wallet-filename> --amount=0.1`);
  console.log(`   5. Create and distribute token: npm run create-distribute-token:${env} -- --wallet=<source-wallet-filename> --name=<token-name>`);
  
  console.log('\nEnvironment Configuration:');
  console.log('   - Create a .env file based on .env.example');
  console.log('   - Set your Helius API keys and other configuration options');
  
  console.log('\nData Storage:');
  console.log('   - Wallets are stored in the wallets/ directory');
  console.log('   - Wallet index is stored in wallet-index/ directory');
  console.log('   - Token information is stored in token-info/ directory');
  
  console.log('\nFor more information, see the README.md file.');
}

// Run the main function
main(); 