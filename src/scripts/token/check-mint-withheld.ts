import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAccount, getTransferFeeAmount, getMint, getTransferFeeConfig } from '@solana/spl-token';
import chalk from 'chalk';

async function main() {
  try {
    // The mint address to check
    const mintAddress = new PublicKey('DH5Jx44EGKY9eBmX35CJBg8wJ4qnGeQiG2me62eaZ8rZ');
    
    // Connect to the Solana network
    const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=86a32350-bb87-48e2-b992-782f09d318ed', 'confirmed');
    
    console.log(chalk.blue(`Checking mint: ${mintAddress.toString()}`));
    
    // First, check if the mint has the transfer fee extension
    try {
      const mintAccount = await getMint(connection, mintAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const transferFeeConfig = getTransferFeeConfig(mintAccount);
      
      if (transferFeeConfig) {
        console.log(chalk.green('✓ Token has transfer fee extension enabled'));
        console.log(chalk.blue(`Transfer fee: ${transferFeeConfig.newerTransferFee.transferFeeBasisPoints / 100}%`));
        console.log(chalk.blue(`Maximum fee: ${transferFeeConfig.newerTransferFee.maximumFee.toString()}`));
        console.log(chalk.blue(`Withheld amount in mint: ${transferFeeConfig.withheldAmount.toString()}`));
      } else {
        console.log(chalk.red('✗ Token does not have transfer fee extension enabled'));
        return;
      }
    } catch (error) {
      console.error(chalk.red(`Error checking mint: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    
    // Get all token accounts for the mint
    console.log(chalk.blue('Fetching all token accounts for this mint...'));
    
    try {
      // Use different approaches to find token accounts
      
      // Approach 1: Using getProgramAccounts with dataSize filter
      console.log(chalk.blue('Approach 1: Using getProgramAccounts with dataSize filter'));
      const accounts1 = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          {
            dataSize: 165, // Size of token account data
          },
          {
            memcmp: {
              offset: 0, // Mint address is at offset 0 in a token account
              bytes: mintAddress.toBase58(),
            },
          },
        ],
      });
      
      console.log(chalk.blue(`Found ${accounts1.length} token accounts using approach 1`));
      
      // Approach 2: Using getProgramAccounts without dataSize filter
      console.log(chalk.blue('Approach 2: Using getProgramAccounts without dataSize filter'));
      const accounts2 = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          {
            memcmp: {
              offset: 0, // Mint address is at offset 0 in a token account
              bytes: mintAddress.toBase58(),
            },
          },
        ],
      });
      
      console.log(chalk.blue(`Found ${accounts2.length} token accounts using approach 2`));
      
      // Approach 3: Using getTokenLargestAccounts
      console.log(chalk.blue('Approach 3: Using getTokenLargestAccounts'));
      const largestAccounts = await connection.getTokenLargestAccounts(mintAddress, 'confirmed');
      
      console.log(chalk.blue(`Found ${largestAccounts.value.length} largest token accounts using approach 3`));
      
      // Combine all accounts from different approaches
      const allAccountKeys = new Set<string>();
      
      // Add accounts from approach 1
      for (const { pubkey } of accounts1) {
        allAccountKeys.add(pubkey.toString());
      }
      
      // Add accounts from approach 2
      for (const { pubkey } of accounts2) {
        allAccountKeys.add(pubkey.toString());
      }
      
      // Add accounts from approach 3
      for (const { address } of largestAccounts.value) {
        allAccountKeys.add(address.toString());
      }
      
      console.log(chalk.blue(`Total unique token accounts found: ${allAccountKeys.size}`));
      
      // Check each account for withheld fees
      let accountsWithFees = 0;
      let totalWithheldAmount = BigInt(0);
      
      for (const accountKey of allAccountKeys) {
        try {
          const accountPubkey = new PublicKey(accountKey);
          const tokenAccount = await getAccount(connection, accountPubkey, 'confirmed', TOKEN_2022_PROGRAM_ID);
          
          // Check if the account has withheld fees
          const withheldAmount = getTransferFeeAmount(tokenAccount);
          
          if (withheldAmount && withheldAmount.withheldAmount > BigInt(0)) {
            accountsWithFees++;
            totalWithheldAmount += withheldAmount.withheldAmount;
            console.log(chalk.green(`✓ Account ${accountKey} has ${withheldAmount.withheldAmount.toString()} withheld tokens`));
          }
        } catch (error) {
          // Skip accounts that can't be processed
          console.log(chalk.yellow(`Could not process account ${accountKey}: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
      
      if (accountsWithFees > 0) {
        console.log(chalk.green(`Found ${accountsWithFees} accounts with a total of ${totalWithheldAmount.toString()} withheld tokens`));
      } else {
        console.log(chalk.yellow('No accounts with withheld fees found'));
      }
      
    } catch (error) {
      console.error(chalk.red(`Error fetching token accounts: ${error instanceof Error ? error.message : String(error)}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

main(); 