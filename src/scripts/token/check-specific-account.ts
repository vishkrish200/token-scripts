import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAccount, getTransferFeeAmount } from '@solana/spl-token';
import chalk from 'chalk';

async function main() {
  try {
    // The specific token account to check
    const tokenAccountAddress = new PublicKey('Cf14WD7W1TGDe9fzZkmbGsaz3FizWGHrTr3Etf8gRWBm');
    
    // Connect to the Solana network
    const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=86a32350-bb87-48e2-b992-782f09d318ed', 'confirmed');
    
    console.log(chalk.blue(`Checking token account: ${tokenAccountAddress.toString()}`));
    
    // Get the token account data
    const tokenAccount = await getAccount(connection, tokenAccountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
    
    console.log(chalk.blue(`Token account owner: ${tokenAccount.owner.toString()}`));
    console.log(chalk.blue(`Token mint: ${tokenAccount.mint.toString()}`));
    console.log(chalk.blue(`Token amount: ${tokenAccount.amount.toString()}`));
    
    // Check if the account has withheld fees
    const withheldAmount = getTransferFeeAmount(tokenAccount);
    
    if (withheldAmount && withheldAmount.withheldAmount > BigInt(0)) {
      console.log(chalk.green(`✓ Token account has ${withheldAmount.withheldAmount.toString()} withheld tokens`));
    } else {
      console.log(chalk.yellow('✗ Token account has no withheld tokens'));
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

main(); 