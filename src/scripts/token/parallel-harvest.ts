import { Command } from 'commander';
import {
  Connection,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import { loadKeypair, getBalance } from '../../utils/wallet';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { chunk } from 'lodash';

// Define the program
const program = new Command();

// Configure the program
program
  .name('parallel-harvest')
  .description('Run multiple token operations in parallel, including harvesting fees from multiple tokens')
  .option('-e, --env <environment>', 'Environment to use (local, testnet, mainnet)', 'testnet')
  .option('-w, --wallets <paths...>', 'Paths to wallet keypair files', ['wallet.json'])
  .option('-m, --mints <addresses...>', 'Token mint addresses')
  .option('-r, --rpcs <urls...>', 'Custom RPC URLs to use')
  .option('-c, --concurrency <number>', 'Number of operations to run concurrently', '3')
  .option('-b, --batch-size <size>', 'Number of accounts to process in a batch for harvesting', '10')
  .option('--harvest-concurrency <number>', 'Number of batches to process concurrently for harvesting', '3')
  .option('--dry-run', 'Simulate operations without executing transactions')
  .parse(process.argv);

// Get the options
const options = program.opts();

/**
 * Run a command in a child process
 * @param command The command to run
 * @param args The arguments to pass to the command
 * @returns A promise that resolves when the command completes
 */
function runCommand(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: true });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });
    
    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

/**
 * Harvest fees for a token using a specific wallet and RPC
 * @param mint The token mint address
 * @param wallet The wallet to use
 * @param rpc The RPC URL to use
 * @param batchSize The number of accounts to process in a batch
 * @param harvestConcurrency The number of batches to process concurrently
 * @param dryRun Whether to simulate the harvest without executing transactions
 * @returns A promise that resolves when the harvest completes
 */
async function harvestFees(
  mint: string,
  wallet: string,
  rpc: string,
  batchSize: number,
  harvestConcurrency: number,
  dryRun: boolean
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  console.log(chalk.blue(`Harvesting fees for mint ${mint} using wallet ${wallet} and RPC ${rpc}`));
  
  // Get token name from token info file if available
  let tokenName = 'unknown-token';
  const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
  const tokenInfoFiles = fs.readdirSync(tokenInfoDir);
  
  for (const file of tokenInfoFiles) {
    if (file.endsWith('.json')) {
      const filePath = path.join(tokenInfoDir, file);
      const tokenInfo = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      
      if (tokenInfo.mintAddress === mint) {
        tokenName = tokenInfo.name;
        break;
      }
    }
  }
  
  // Build the command to run the harvest-fees script
  const args = [
    'ts-node',
    'src/scripts/token/harvest-fees.ts',
    `--env=${options.env}`,
    `--wallet=${wallet}`,
    `--mint=${mint}`,
    `--name=${tokenName}`,
    `--batch-size=${batchSize}`,
    `--concurrency=${harvestConcurrency}`,
    `--rpc=${rpc}`,
  ];
  
  if (dryRun) {
    args.push('--dry-run');
  }
  
  // Run the command
  return runCommand(args[0], args.slice(1));
}

/**
 * Main function to run multiple operations in parallel
 */
async function main() {
  try {
    // Validate required options
    if (!options.mints || options.mints.length === 0) {
      console.error(chalk.red('Error: At least one mint address is required'));
      process.exit(1);
    }
    
    if (!options.wallets || options.wallets.length === 0) {
      console.error(chalk.red('Error: At least one wallet is required'));
      process.exit(1);
    }
    
    if (!options.rpcs || options.rpcs.length === 0) {
      console.error(chalk.red('Error: At least one RPC URL is required'));
      process.exit(1);
    }
    
    // Get concurrency
    const concurrency = parseInt(options.concurrency, 10);
    const batchSize = parseInt(options.batchSize, 10);
    const harvestConcurrency = parseInt(options.harvestConcurrency, 10);
    
    // Create a list of operations to run
    const operations: Array<{
      type: 'harvest';
      mint: string;
      wallet: string;
      rpc: string;
    }> = [];
    
    // Add harvest operations for each mint
    for (let i = 0; i < options.mints.length; i++) {
      const mint = options.mints[i];
      const wallet = options.wallets[i % options.wallets.length];
      const rpc = options.rpcs[i % options.rpcs.length];
      
      operations.push({
        type: 'harvest',
        mint,
        wallet,
        rpc,
      });
    }
    
    console.log(chalk.blue(`Running ${operations.length} operations with concurrency ${concurrency}`));
    
    // Split operations into batches
    const batches = chunk(operations, concurrency);
    
    // Process batches sequentially
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(chalk.blue(`Processing batch ${i + 1}/${batches.length} (${batch.length} operations)`));
      
      // Run operations in parallel
      const promises = batch.map(async (operation) => {
        if (operation.type === 'harvest') {
          return harvestFees(
            operation.mint,
            operation.wallet,
            operation.rpc,
            batchSize,
            harvestConcurrency,
            options.dryRun || false
          );
        }
      });
      
      // Wait for all operations in the batch to complete
      await Promise.all(promises);
      
      // Add a small delay between batches
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(chalk.green('All operations completed successfully.'));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

// Run the main function
main(); 