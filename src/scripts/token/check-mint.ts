#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import { program } from 'commander';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--mint <string>', 'Token mint address')
  .parse(process.argv);

const options = program.opts();

// Get the RPC URL based on the environment
function getRpcUrl(env: string): string {
  switch (env) {
    case 'mainnet-beta':
      return 'https://api.mainnet-beta.solana.com';
    case 'testnet':
      return 'https://api.testnet.solana.com';
    case 'devnet':
      return 'https://api.devnet.solana.com';
    case 'local':
      return 'http://localhost:8899';
    default:
      return 'https://api.testnet.solana.com';
  }
}

async function main() {
  const env = options.env || 'testnet';
  const rpcUrl = getRpcUrl(env);
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log(`Environment: ${env}`);
  console.log(`RPC URL: ${rpcUrl}`);
  
  if (!options.mint) {
    console.error('Please provide a mint address with --mint');
    process.exit(1);
  }
  
  const mintAddress = new PublicKey(options.mint);
  console.log(`Checking mint address: ${mintAddress.toString()}`);
  
  try {
    const accountInfo = await connection.getAccountInfo(mintAddress);
    
    if (!accountInfo) {
      console.log('Account not found. The mint address may not exist on this network.');
      process.exit(1);
    }
    
    console.log('Account info:');
    console.log(`- Owner: ${accountInfo.owner.toString()}`);
    console.log(`- Executable: ${accountInfo.executable}`);
    console.log(`- Lamports: ${accountInfo.lamports}`);
    console.log(`- Data length: ${accountInfo.data.length} bytes`);
    
    // Check if it's a token mint account
    if (accountInfo.owner.toString() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
      console.log('This is a valid SPL Token mint account.');
    } else {
      console.log('This account is not owned by the SPL Token program.');
    }
    
  } catch (error) {
    console.error('Error fetching account info:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 