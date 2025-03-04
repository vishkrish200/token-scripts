#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import { program } from 'commander';

// Define the Token Extensions program ID
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

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
    // Get mint info
    const mintInfo = await getMint(
      connection, 
      mintAddress, 
      undefined, 
      TOKEN_2022_PROGRAM_ID
    );
    
    console.log('Mint info:');
    console.log(`- Supply: ${mintInfo.supply}`);
    console.log(`- Decimals: ${mintInfo.decimals}`);
    console.log(`- Is initialized: ${mintInfo.isInitialized}`);
    console.log(`- Freeze authority: ${mintInfo.freezeAuthority?.toString() || 'None'}`);
    console.log(`- Mint authority: ${mintInfo.mintAuthority?.toString() || 'None'}`);
    
    // Get the account data directly
    const accountInfo = await connection.getAccountInfo(mintAddress);
    if (!accountInfo) {
      console.log('Account not found');
      return;
    }
    
    console.log('\nAccount data length:', accountInfo.data.length);
    
    // For Token-2022 with transfer fee, we can try to extract the fee information
    // This is a simplified approach and may not work for all tokens
    console.log('\nTrying to extract transfer fee information...');
    
    // The transfer fee is typically stored in the account data
    // Let's print some of the account data to see if we can identify patterns
    console.log('Account data (hex):');
    console.log(Buffer.from(accountInfo.data).toString('hex').substring(0, 100) + '...');
    
    // Let's try to find the fee basis points (assuming it's a 2-byte value)
    // This is just a guess based on common token structures
    // The actual location may vary depending on the token implementation
    if (accountInfo.data.length >= 100) {
      // Try to extract fee basis points from different positions
      // These positions are guesses and may not be correct for all tokens
      const possiblePositions = [82, 84, 86, 88, 90];
      
      console.log('\nPossible fee basis points values:');
      for (const pos of possiblePositions) {
        if (pos + 2 <= accountInfo.data.length) {
          const value = accountInfo.data[pos] | (accountInfo.data[pos + 1] << 8);
          console.log(`- At position ${pos}: ${value} (${value / 100}%)`);
        }
      }
    }
    
    console.log('\nNote: This is a simplified approach to extract fee information.');
    console.log('For accurate fee information, you should use the specific methods provided by the token program.');
    
  } catch (error) {
    console.error('Error fetching mint info:', error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
}); 