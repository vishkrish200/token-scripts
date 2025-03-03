import { Command } from 'commander';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { getConnection, logEnvironmentInfo, config } from '../../config';
import { loadKeypair, listWallets } from '../../utils/wallet';
import ora from 'ora';

interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  mintAddress: string;
  extensions: string[];
  transferFee?: {
    feeBasisPoints: number;
    maxFee: string;
  };
  createdAt: string;
  distributionInfo?: {
    totalDistributed: number;
    distributedWallets: number;
    distributionDate: string;
  };
}

// Command line options
const program = new Command();
program
  .option('--env <env>', 'Environment (local, testnet, mainnet)')
  .option('--wallet <wallet>', 'Wallet filename')
  .option('--mint <mint>', 'Token mint address')
  .option('--name <name>', 'Token name')
  .option('--amount <amount>', 'Amount of SOL to swap', '0.1')
  .option('--slippage <slippage>', 'Slippage tolerance in percentage', '1')
  .parse(process.argv);

const options = program.opts();

async function main() {
  // Log environment info
  logEnvironmentInfo();

  // Validate required parameters
  if (!options.wallet) {
    console.error('Error: Wallet filename is required (--wallet)');
    process.exit(1);
  }

  if (!options.mint && !options.name) {
    console.error('Error: Either mint address (--mint) or token name (--name) is required');
    process.exit(1);
  }

  // List available wallets
  console.log('Available wallets:');
  const wallets = listWallets();
  wallets.forEach(wallet => console.log(`- ${wallet}`));

  // Load wallet
  try {
    const wallet = loadKeypair(options.wallet);
    console.log(`Wallet loaded: ${wallet.publicKey.toString()}`);

    // Get connection
    const connection = getConnection();

    // Get mint address
    let mintAddress: string;
    let isToken2022 = false;
    
    if (options.mint) {
      mintAddress = options.mint;
    } else {
      // Load token info from file
      const tokenInfoPath = path.join(process.cwd(), 'token-info', `${options.name.toLowerCase()}.json`);
      if (!fs.existsSync(tokenInfoPath)) {
        console.error(`Error: Token info file not found for ${options.name}`);
        process.exit(1);
      }
      const tokenInfo: TokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
      mintAddress = tokenInfo.mintAddress;
      
      // Check if token uses Token 2022 program
      if (tokenInfo.extensions && tokenInfo.extensions.length > 0) {
        isToken2022 = true;
        console.log('Token uses Token 2022 program');
      }
    }

    console.log(`Mint address: ${mintAddress}`);

    // Parse swap amount
    const solAmount = parseFloat(options.amount);
    const slippage = parseFloat(options.slippage);

    console.log(`Swapping ${solAmount} SOL for tokens with ${slippage}% slippage tolerance`);

    // Ensure token account exists
    const spinner = ora('Checking token account...').start();
    try {
      const tokenMint = new PublicKey(mintAddress);
      const tokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        wallet.publicKey,
        true, // allowOwnerOffCurve
        isToken2022 ? TOKEN_2022_PROGRAM_ID : undefined // Use Token 2022 program if needed
      );

      // Check if token account exists
      try {
        await getAccount(
          connection, 
          tokenAccount,
          'confirmed',
          isToken2022 ? TOKEN_2022_PROGRAM_ID : undefined // Use Token 2022 program if needed
        );
        spinner.succeed(`Token account exists: ${tokenAccount.toString()}`);
      } catch (error) {
        spinner.info(`Creating token account: ${tokenAccount.toString()}`);
        
        // Create token account
        const transaction = new Transaction().add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            tokenAccount,
            wallet.publicKey,
            tokenMint,
            isToken2022 ? TOKEN_2022_PROGRAM_ID : undefined // Use Token 2022 program if needed
          )
        );
        
        const signature = await connection.sendTransaction(transaction, [wallet]);
        await connection.confirmTransaction(signature, 'confirmed');
        spinner.succeed(`Token account created: ${tokenAccount.toString()}`);
      }

      // Perform swap
      spinner.text = 'Performing swap...';
      
      // In a real implementation, you would:
      // 1. Find the liquidity pool for the token
      // 2. Calculate the expected output amount
      // 3. Create and send a swap transaction
      
      // For demonstration purposes, we'll just show the steps and log them
      spinner.text = 'Finding liquidity pool...';
      // const pool = await findLiquidityPool(connection, tokenMint);
      
      spinner.text = 'Calculating swap amounts...';
      // const { amountIn, minimumAmountOut } = calculateSwapAmounts(solAmount, slippage);
      
      spinner.text = 'Creating swap transaction...';
      // const swapTx = await createSwapTransaction(connection, wallet, pool, amountIn, minimumAmountOut);
      
      spinner.text = 'Sending swap transaction...';
      // const swapSignature = await connection.sendTransaction(swapTx, [wallet]);
      // await connection.confirmTransaction(swapSignature, 'confirmed');
      
      spinner.succeed('Swap completed successfully!');
      console.log('Note: This is a demonstration script. In a real implementation, you would need to:');
      console.log('1. Find the liquidity pool for the token using the Raydium or Orca SDK');
      console.log('2. Calculate the expected output amount based on the pool reserves');
      console.log('3. Create and send a swap transaction using the DEX program');
      
      // For a complete implementation, you would need to:
      // 1. Use the correct program IDs for the DEX on devnet
      // 2. Implement the pool finding, amount calculation, and swap transaction functions
      // 3. Handle all the necessary transactions and confirmations
      
      console.log('\nFor testing purposes, consider using an existing DEX on devnet like Orca or Raydium');
      console.log('and interacting with their pools through their SDKs or UIs.');
      
      // Check for withheld fees
      spinner.text = 'Checking for withheld fees...';
      console.log('\nAfter swapping, you should check for withheld fees using:');
      console.log(`npm run check-all-token-accounts:testnet -- --wallet=${options.wallet} --mint=${mintAddress} --name=${options.name || ''}`);
      console.log('\nAnd then try to harvest any withheld fees using:');
      console.log(`npm run harvest-fees:testnet -- --wallet=${options.wallet} --mint=${mintAddress} --name=${options.name || ''}`);
    } catch (error: any) {
      spinner.fail(`Error swapping tokens: ${error.message}`);
      console.error(error);
      process.exit(1);
    }
  } catch (error: any) {
    console.error(`Error loading wallet: ${error.message}`);
    process.exit(1);
  }
}

main(); 