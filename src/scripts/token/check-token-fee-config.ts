import { Command } from 'commander';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getMint, getTransferFeeConfig } from '@solana/spl-token';
import chalk from 'chalk';

// Define the program
const program = new Command();

// Configure the program
program
  .name('check-token-fee-config')
  .description('Check if a token has the transfer fee extension enabled')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'mainnet-beta')
  .option('-m, --mint <address>', 'Token mint address')
  .option('--rpc <url>', 'Custom RPC URL to use')
  .parse(process.argv);

// Get the options
const options = program.opts();

async function main() {
  try {
    // Validate required options
    if (!options.mint) {
      console.error(chalk.red('Error: Mint address is required'));
      process.exit(1);
    }

    // Set up connection with custom RPC if provided
    const rpcUrl = options.rpc || 
      (options.env === 'mainnet-beta' || options.env === 'mainnet')
        ? 'https://mainnet.helius-rpc.com/?api-key=86a32350-bb87-48e2-b992-782f09d318ed'
        : options.env === 'testnet'
          ? 'https://api.testnet.solana.com'
          : 'http://localhost:8899';
    
    const connection = new Connection(rpcUrl, 'confirmed');
    
    console.log(chalk.blue(`Environment: ${options.env}`));
    console.log(chalk.blue(`RPC URL: ${connection.rpcEndpoint}`));
    
    // Parse mint address
    const mint = new PublicKey(options.mint);
    console.log(chalk.blue(`Mint address: ${mint.toBase58()}`));
    
    // Get the mint account
    console.log(chalk.blue('Fetching mint account...'));
    const mintAccount = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    
    // Check if the mint has the transfer fee extension
    const transferFeeConfig = getTransferFeeConfig(mintAccount);
    
    if (transferFeeConfig) {
      console.log(chalk.green('✓ Token has transfer fee extension enabled'));
      console.log(chalk.blue(`Transfer fee: ${transferFeeConfig.newerTransferFee.transferFeeBasisPoints / 100}%`));
      console.log(chalk.blue(`Maximum fee: ${transferFeeConfig.newerTransferFee.maximumFee.toString()}`));
      console.log(chalk.blue(`Withheld amount: ${transferFeeConfig.withheldAmount.toString()}`));
      
      // Check if there are any withheld fees
      if (transferFeeConfig.withheldAmount > BigInt(0)) {
        console.log(chalk.green(`There are ${transferFeeConfig.withheldAmount.toString()} withheld tokens in the mint that can be withdrawn`));
      } else {
        console.log(chalk.yellow('There are no withheld tokens in the mint to withdraw'));
      }
    } else {
      console.log(chalk.red('✗ Token does not have transfer fee extension enabled'));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

// Run the main function
main(); 