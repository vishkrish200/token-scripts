import { Command } from 'commander';
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getTransferFeeConfig,
  createHarvestWithheldTokensToMintInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  unpackAccount,
  ExtensionType,
  getTransferFeeAmount,
  AccountState,
  Account,
} from '@solana/spl-token';
import { loadWallet, loadWalletFromPrivateKey, getBalance } from '../../utils/wallet';
import { getConnection } from '../../config';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { chunk } from 'lodash';

// Define the program
const program = new Command();

// Configure the program
program
  .name('harvest-fees')
  .description('Harvest and withdraw fees from token accounts')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallet <path>', 'Path to wallet keypair file', 'wallet.json')
  .option('-p, --private-key <string>', 'Private key as a JSON array of numbers')
  .option('-m, --mint <address>', 'Token mint address')
  .option('-n, --name <n>', 'Token name (used for saving info)')
  .option('-b, --batch-size <size>', 'Number of accounts to process in a batch', '10')
  .option('-c, --concurrency <number>', 'Number of batches to process concurrently', '3')
  .option('--rpc <url>', 'Custom RPC URL to use')
  .option('--dry-run', 'Simulate the harvest without executing transactions')
  .option('--list-only', 'Only list accounts with withheld fees without harvesting')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Find all token accounts for a specific mint
 * @param connection Solana connection
 * @param mint The mint address
 * @returns Array of token accounts
 */
async function findAllTokenAccounts(connection: Connection, mint: PublicKey): Promise<PublicKey[]> {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Get all token accounts for the mint
      const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          {
            dataSize: 165, // Size of token account data
          },
          {
            memcmp: {
              offset: 0, // Mint address is at offset 0 in a token account
              bytes: mint.toBase58(),
            },
          },
        ],
      });
      
      console.log(`Found ${accounts.length} total token accounts for this mint`);
      
      // Filter for valid token accounts with withheld fees
      const tokenAccounts: PublicKey[] = [];
      
      for (const { pubkey, account } of accounts) {
        try {
          // Try to unpack the account to verify it's a token account
          const tokenAccount = unpackAccount(pubkey, account);
          
          // Check if the account has withheld fees
          const withheldAmount = getTransferFeeAmount(tokenAccount);
          
          if (withheldAmount && withheldAmount.withheldAmount > BigInt(0)) {
            console.log(`Account ${pubkey.toString()} has ${withheldAmount.withheldAmount.toString()} withheld tokens`);
            tokenAccounts.push(pubkey);
          }
        } catch (error) {
          // Skip accounts that can't be unpacked
          continue;
        }
      }
      
      // Explicitly check the account you mentioned
      const specificAccounts = [
        'Cf14WD7W1TGDe9fzZkmbGsaz3FizWGHrTr3Etf8gRWBm'
      ];
      
      for (const accountStr of specificAccounts) {
        try {
          const specificAccount = new PublicKey(accountStr);
          const accountInfo = await connection.getAccountInfo(specificAccount);
          
          if (accountInfo) {
            try {
              const tokenAccount = unpackAccount(specificAccount, accountInfo);
              
              // Check if the account has withheld fees
              const withheldAmount = getTransferFeeAmount(tokenAccount);
              
              if (withheldAmount && withheldAmount.withheldAmount > BigInt(0)) {
                console.log(`Specific account ${specificAccount.toString()} has ${withheldAmount.withheldAmount.toString()} withheld tokens`);
                
                // Only add if not already in the list
                if (!tokenAccounts.some(account => account.equals(specificAccount))) {
                  tokenAccounts.push(specificAccount);
                }
              }
            } catch (error) {
              console.log(`Error processing specific account: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          console.log(`Error fetching specific account: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      return tokenAccounts;
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.pow(2, retryCount) * 500;
      console.log(`Server responded with an error. Retrying after ${delay}ms delay...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return [];
}

/**
 * Harvest withheld fees from token accounts to the mint
 * @param connection Solana connection
 * @param payer Payer keypair
 * @param mint Mint address
 * @param tokenAccounts Array of token accounts to harvest from
 * @param batchSize Number of accounts to process in a batch
 * @param concurrency Number of batches to process concurrently
 * @param dryRun Whether to simulate the harvest without executing transactions
 * @returns Object containing success and failure counts
 */
async function harvestFeesToMint(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  tokenAccounts: PublicKey[],
  batchSize: number,
  concurrency: number,
  dryRun: boolean
): Promise<{ successful: number; failed: number }> {
  const spinner = ora('Harvesting fees to mint...').start();
  
  // Split token accounts into batches
  const batches = chunk(tokenAccounts, batchSize);
  
  let successful = 0;
  let failed = 0;
  
  // Process batches with limited concurrency
  for (let i = 0; i < batches.length; i += concurrency) {
    const currentBatches = batches.slice(i, i + concurrency);
    
    const batchPromises = currentBatches.map(async (batch: PublicKey[], batchIndex: number) => {
      try {
        // Create a transaction for this batch
        const transaction = new Transaction();
        
        // Add compute budget instruction to increase compute limit
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: 1000000,
          })
        );
        
        // Add harvest instructions for each account in the batch
        for (const tokenAccount of batch) {
          transaction.add(
            createHarvestWithheldTokensToMintInstruction(
              mint,
              [tokenAccount],
              TOKEN_2022_PROGRAM_ID
            )
          );
        }
        
        if (dryRun) {
          // Simulate the transaction
          const { value } = await connection.simulateTransaction(transaction, [payer]);
          if (value.err) {
            throw new Error(`Simulation error: ${JSON.stringify(value.err)}`);
          }
          successful += batch.length;
        } else {
          // Send the transaction
          const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { commitment: 'confirmed', maxRetries: 3 }
          );
          
          console.log(`Batch ${i + batchIndex + 1}/${batches.length} harvested: ${signature}`);
          successful += batch.length;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error processing batch ${i + batchIndex + 1}/${batches.length}:`, errorMessage);
        failed += batch.length;
      }
      
      spinner.text = `Harvested fees from ${successful} accounts (${failed} failed)...`;
    });
    
    // Wait for the current set of batches to complete
    await Promise.all(batchPromises);
    
    // Add a small delay between batch sets to avoid rate limiting
    if (i + concurrency < batches.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (successful > 0) {
    spinner.succeed(`Successfully harvested fees from ${successful} accounts (${failed} failed)`);
  } else {
    spinner.fail(`Failed to harvest fees from any accounts`);
  }
  
  return { successful, failed };
}

/**
 * Withdraw withheld fees from the mint to a destination account
 * @param connection Solana connection
 * @param payer Payer keypair
 * @param mint Mint address
 * @param destination Destination token account
 * @param dryRun Whether to simulate the withdrawal without executing the transaction
 * @returns Transaction signature or simulation result
 */
async function withdrawFeesFromMint(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  dryRun: boolean
): Promise<string> {
  const spinner = ora('Withdrawing fees from mint...').start();
  
  try {
    // Get the mint account to check withheld fees
    const mintAccount = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    
    // Get the transfer fee config
    const transferFeeConfig = getTransferFeeConfig(mintAccount);
    if (!transferFeeConfig) {
      spinner.fail('Mint does not have transfer fee extension');
      throw new Error('Mint does not have transfer fee extension');
    }
    
    // Check if there are withheld fees to withdraw
    if (transferFeeConfig.withheldAmount === BigInt(0)) {
      spinner.info('No withheld fees to withdraw from mint');
      return 'No withheld fees to withdraw';
    }
    
    // Create a transaction to withdraw fees
    const transaction = new Transaction();
    
    // Add compute budget instruction to increase compute limit
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 400000,
      })
    );
    
    // Add withdraw instruction
    transaction.add(
      createWithdrawWithheldTokensFromMintInstruction(
        mint,
        destination,
        payer.publicKey,
        [], // Empty signers array
        TOKEN_2022_PROGRAM_ID
      )
    );
    
    if (dryRun) {
      // Simulate the transaction
      const { value } = await connection.simulateTransaction(transaction, [payer]);
      if (value.err) {
        throw new Error(`Simulation error: ${JSON.stringify(value.err)}`);
      }
      spinner.succeed(`Simulation successful: would withdraw ${transferFeeConfig.withheldAmount} tokens`);
      return `Simulation successful: would withdraw ${transferFeeConfig.withheldAmount} tokens`;
    } else {
      // Send the transaction
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [payer],
        { commitment: 'confirmed', maxRetries: 3 }
      );
      
      spinner.succeed(`Successfully withdrew ${transferFeeConfig.withheldAmount} tokens from mint`);
      console.log(`Transaction signature: ${signature}`);
      return signature;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(`Error withdrawing fees: ${errorMessage}`);
    throw error;
  }
}

/**
 * Save harvest results to a file
 * @param tokenName Token name
 * @param mintAddress Mint address
 * @param results Harvest results
 */
function saveHarvestResults(
  tokenName: string,
  mintAddress: string,
  results: {
    date: string;
    accountsProcessed: number;
    successful: number;
    failed: number;
    withdrawnAmount?: bigint;
    withdrawSignature?: string;
  }
): void {
  const harvestDir = path.resolve(process.cwd(), 'harvest-results');
  if (!fs.existsSync(harvestDir)) {
    fs.mkdirSync(harvestDir, { recursive: true });
  }
  
  const fileName = `${tokenName.toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`;
  const filePath = path.join(harvestDir, fileName);
  
  // Check if file exists to append or create new
  let harvestHistory = [];
  if (fs.existsSync(filePath)) {
    harvestHistory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  
  // Add new results
  harvestHistory.push({
    ...results,
    mintAddress,
  });
  
  // Save to file
  fs.writeFileSync(filePath, JSON.stringify(harvestHistory, null, 2));
  console.log(`Harvest results saved to ${filePath}`);
}

// Set the environment based on command line options
function setEnvironment() {
  // Get environment from options
  const env = options.env || 'testnet';
  
  // Set environment variable for the config module
  process.env.SOLANA_NETWORK = env;
  
  // If mainnet-beta, set the RPC URL to the Helius RPC URL
  if (env === 'mainnet-beta' || env === 'mainnet') {
    process.env.MAINNET_RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=86a32350-bb87-48e2-b992-782f09d318ed';
  }
  
  return env;
}

/**
 * Main function to run the harvest and withdrawal process
 */
async function main() {
  try {
    // Set the environment first
    const env = setEnvironment();
    
    // Validate required options
    if (!options.mint) {
      console.error(chalk.red('Error: Mint address is required'));
      process.exit(1);
    }
    
    if (!options.wallet && !options.privateKey) {
      console.error(chalk.red('Error: Either wallet path (--wallet) or private key (--private-key) is required'));
      process.exit(1);
    }
    
    // Set up connection with custom RPC if provided
    const connection = options.rpc
      ? new Connection(options.rpc, 'confirmed')
      : env === 'mainnet-beta' || env === 'mainnet'
        ? new Connection(process.env.MAINNET_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=86a32350-bb87-48e2-b992-782f09d318ed', 'confirmed')
        : getConnection();
    
    console.log(chalk.blue(`Environment: ${env}`));
    console.log(chalk.blue(`RPC URL: ${connection.rpcEndpoint}`));
    
    // Load wallet
    let wallet: Keypair;
    try {
      if (options.privateKey) {
        // Load from provided private key
        console.log(chalk.blue(`Loading wallet from provided private key`));
        wallet = loadWalletFromPrivateKey(options.privateKey);
      } else {
        // Load from wallet file
        console.log(chalk.blue(`Loading wallet: ${options.wallet}`));
        
        // Directly construct the wallet path based on the environment
        const walletDir = env === 'mainnet-beta' || env === 'mainnet' 
          ? './wallets/mainnet' 
          : env === 'testnet' 
            ? './wallets/testnet' 
            : './wallets/local';
        
        const walletPath = path.join(path.resolve(process.cwd(), walletDir), `${options.wallet}.json`);
        console.log(chalk.blue(`Looking for wallet at: ${walletPath}`));
        
        if (!fs.existsSync(walletPath)) {
          throw new Error(`Wallet file not found at ${walletPath}`);
        }
        
        try {
          // Read the wallet file
          const walletData = fs.readFileSync(walletPath, 'utf-8');
          const walletJson = JSON.parse(walletData);
          
          // Handle different wallet file formats
          if (Array.isArray(walletJson)) {
            // Array format (direct secret key)
            wallet = Keypair.fromSecretKey(new Uint8Array(walletJson));
          } else if (walletJson.secretKey) {
            // Object with secretKey property
            if (Array.isArray(walletJson.secretKey)) {
              wallet = Keypair.fromSecretKey(new Uint8Array(walletJson.secretKey));
            } else if (typeof walletJson.secretKey === 'string') {
              // Handle base58 encoded secret key
              const secretKeyArray = Buffer.from(walletJson.secretKey, 'base64');
              wallet = Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
            } else {
              throw new Error('Unrecognized secretKey format in wallet file');
            }
          } else {
            // Try to find any property that might be the secret key
            const possibleKeys = ['privateKey', 'private_key', 'secret', 'key'];
            let found = false;
            let tempWallet: Keypair | null = null;
            
            for (const key of possibleKeys) {
              if (walletJson[key] && (Array.isArray(walletJson[key]) || typeof walletJson[key] === 'string')) {
                const secretKey = Array.isArray(walletJson[key]) 
                  ? new Uint8Array(walletJson[key])
                  : Buffer.from(walletJson[key], 'base64');
                
                try {
                  tempWallet = Keypair.fromSecretKey(secretKey);
                  found = true;
                  break;
                } catch (e) {
                  // Continue trying other keys
                }
              }
            }
            
            if (!found || !tempWallet) {
              throw new Error('Could not find a valid secret key in the wallet file');
            }
            
            wallet = tempWallet;
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`Error parsing wallet file: ${errorMessage}`));
          console.log(chalk.yellow('Wallet file content structure:'));
          try {
            const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
            console.log(chalk.yellow(JSON.stringify(Object.keys(walletData))));
          } catch (e) {
            console.log(chalk.yellow('Could not parse wallet file as JSON'));
          }
          throw new Error('Failed to load wallet');
        }
      }
      console.log(chalk.blue(`Wallet public key: ${wallet.publicKey.toString()}`));
    } catch (error) {
      console.error(chalk.red(`Error loading wallet: ${error}`));
      process.exit(1);
    }
    
    // Check wallet balance
    try {
      const balance = await getBalance(wallet.publicKey);
      console.log(chalk.blue(`Wallet balance: ${balance} SOL`));
      
      if (balance < 0.05) {
        console.warn(chalk.yellow('Warning: Low wallet balance. Transactions may fail.'));
      }
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Could not fetch wallet balance: ${error instanceof Error ? error.message : String(error)}`));
      console.warn(chalk.yellow('Continuing with harvesting process...'));
    }
    
    // Parse mint address
    const mint = new PublicKey(options.mint);
    console.log(chalk.blue(`Mint address: ${mint.toBase58()}`));
    
    // Get token name
    const tokenName = options.name || 'unknown-token';
    
    // Get batch size and concurrency
    const batchSize = parseInt(options.batchSize, 10);
    const concurrency = parseInt(options.concurrency, 10);
    
    // Find all token accounts for the mint
    let tokenAccounts: PublicKey[] = [];
    try {
      const spinner = ora('Finding all token accounts...').start();
      tokenAccounts = await findAllTokenAccounts(connection, mint);
      spinner.succeed(`Found ${tokenAccounts.length} token accounts with withheld fees`);
    } catch (error) {
      console.error(chalk.red(`Error finding token accounts: ${error instanceof Error ? error.message : String(error)}`));
      console.warn(chalk.yellow('Attempting to continue with harvesting process...'));
    }
    
    if (tokenAccounts.length === 0) {
      console.log(chalk.yellow('No token accounts with withheld fees found.'));
      
      // Even if no token accounts have fees, check if the mint itself has withheld fees
      try {
        // Get the mint account to check withheld fees
        const mintAccount = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
        const transferFeeConfig = getTransferFeeConfig(mintAccount);
        
        if (transferFeeConfig && transferFeeConfig.withheldAmount > BigInt(0)) {
          console.log(chalk.green(`Found ${transferFeeConfig.withheldAmount} withheld tokens in the mint that can be withdrawn`));
          
          // Get the destination account for withdrawing fees
          const destination = getAssociatedTokenAddressSync(
            mint,
            wallet.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID
          );
          
          // Withdraw fees from mint to destination
          let withdrawResult = '';
          let withdrawnAmount: bigint | undefined;
          
          try {
            withdrawnAmount = transferFeeConfig.withheldAmount;
            withdrawResult = await withdrawFeesFromMint(
              connection,
              wallet,
              mint,
              destination,
              options.dryRun || false
            );
            
            // Save results
            saveHarvestResults(
              options.name || 'unknown-token',
              mint.toBase58(),
              {
                date: new Date().toISOString(),
                accountsProcessed: 0,
                successful: 0,
                failed: 0,
                withdrawnAmount,
                withdrawSignature: withdrawResult,
              }
            );
            
            console.log(chalk.green('Withdrawal process completed.'));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(chalk.red(`Error withdrawing fees: ${errorMessage}`));
          }
        } else {
          console.log(chalk.yellow('No withheld fees found in the mint.'));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error checking mint for withheld fees: ${errorMessage}`));
      }
      
      process.exit(0);
    }
    
    // If list-only option is set, just list the accounts and exit
    if (options.listOnly) {
      console.log(chalk.green(`Found ${tokenAccounts.length} accounts with withheld fees:`));
      for (const account of tokenAccounts) {
        // Get the token account data
        const tokenAccount = await getAccount(connection, account, 'confirmed', TOKEN_2022_PROGRAM_ID);
        const withheldAmount = getTransferFeeAmount(tokenAccount);
        if (withheldAmount) {
          console.log(`${account.toBase58()}: ${withheldAmount.withheldAmount} tokens withheld`);
        }
      }
      process.exit(0);
    }
    
    // Harvest fees from token accounts to mint
    const harvestResults = await harvestFeesToMint(
      connection,
      wallet,
      mint,
      tokenAccounts,
      batchSize,
      concurrency,
      options.dryRun || false
    );
    
    // Get the destination account for withdrawing fees
    const destination = getAssociatedTokenAddressSync(
      mint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    
    // Withdraw fees from mint to destination
    let withdrawResult = '';
    let withdrawnAmount: bigint | undefined;
    
    try {
      // Get the mint account to check withheld fees
      const mintAccount = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const transferFeeConfig = getTransferFeeConfig(mintAccount);
      
      if (transferFeeConfig) {
        withdrawnAmount = transferFeeConfig.withheldAmount;
        withdrawResult = await withdrawFeesFromMint(
          connection,
          wallet,
          mint,
          destination,
          options.dryRun || false
        );
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error withdrawing fees: ${errorMessage}`));
    }
    
    // Save results
    saveHarvestResults(
      tokenName,
      mint.toBase58(),
      {
        date: new Date().toISOString(),
        accountsProcessed: tokenAccounts.length,
        successful: harvestResults.successful,
        failed: harvestResults.failed,
        withdrawnAmount,
        withdrawSignature: withdrawResult,
      }
    );
    
    console.log(chalk.green('Harvest and withdrawal process completed.'));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

// Run the main function
main(); 