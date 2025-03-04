#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  ExtensionType, 
  TOKEN_2022_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction, 
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import dotenv from 'dotenv';
import { 
  loadWallet, 
  loadWalletFromPrivateKey, 
  loadWalletFromEnv, 
  loadWalletFromFile 
} from '../../utils/wallet';
import { loadTokenConfig, TokenConfig } from '../../utils/token-config';
import { createTokenMetadata, generateMetadataJson } from '../../utils/metadata';

// Load environment variables
dotenv.config();

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name')
  .option('--private-key <string>', 'Private key as a JSON array of numbers')
  .option('--private-key-file <string>', 'Path to a file containing the private key')
  .option('--private-key-env <string>', 'Name of environment variable containing the private key')
  .option('--config <string>', 'Path to token configuration JSON file')
  .parse(process.argv);

const options = program.opts();

// Get the RPC URL based on the environment
function getRpcUrl(env: string): string {
  switch (env) {
    case 'mainnet-beta':
      return process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
    case 'testnet':
      return process.env.TESTNET_RPC_URL || 'https://api.testnet.solana.com';
    case 'devnet':
      return process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
    case 'local':
      return process.env.LOCAL_RPC_URL || 'http://localhost:8899';
    default:
      return 'https://api.testnet.solana.com';
  }
}

// Save token information to a file
function saveTokenInfo(tokenName: string, tokenInfo: any) {
  // Create the token-info directory if it doesn't exist
  const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
  if (!fs.existsSync(tokenInfoDir)) {
    fs.mkdirSync(tokenInfoDir, { recursive: true });
  }
  
  // Save the token info to a file
  const fileName = `${tokenName.toLowerCase().replace(/\s+/g, '-')}-${options.env}.json`;
  const filePath = path.join(tokenInfoDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(tokenInfo, null, 2));
  console.log(chalk.blue(`Token information saved to ${filePath}`));
}

// Interface for token info
interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  mintAddress: string;
  tokenAccount: string;
  initialSupply: number;
  feeBasisPoints: number;
  maxFee: number;
  createdAt: string;
  environment: string;
  metadata?: TokenConfig['metadata'];
  metadataAddress?: string;
}

async function main() {
  console.log(chalk.green('Creating token with configuration...'));
  
  // Check required parameters
  if (!options.config) {
    console.error(chalk.red('Token configuration file (--config) is required'));
    process.exit(1);
  }
  
  // Load token configuration
  let tokenConfig: TokenConfig;
  try {
    tokenConfig = loadTokenConfig(options.config);
    console.log(chalk.blue(`Loaded token configuration from ${options.config}`));
  } catch (error) {
    console.error(chalk.red(`Error loading token configuration: ${error}`));
    process.exit(1);
  }
  
  // Load wallet
  let wallet: Keypair;
  try {
    if (options.privateKeyEnv) {
      // Load from environment variable
      wallet = loadWalletFromEnv(options.privateKeyEnv);
      console.log(chalk.blue(`Loaded wallet from environment variable ${options.privateKeyEnv}`));
    } else if (options.privateKeyFile) {
      // Load from private key file
      wallet = loadWalletFromFile(options.privateKeyFile);
      console.log(chalk.blue(`Loaded wallet from file ${options.privateKeyFile}`));
    } else if (options.privateKey) {
      // Load from provided private key
      wallet = loadWalletFromPrivateKey(options.privateKey);
      console.log(chalk.blue(`Loaded wallet from provided private key`));
    } else if (options.wallet) {
      // Load from wallet file
      wallet = loadWallet(options.wallet);
      console.log(chalk.blue(`Loaded wallet: ${options.wallet}`));
    } else {
      console.error(chalk.red('No wallet specified. Use --wallet, --private-key, --private-key-file, or --private-key-env'));
      process.exit(1);
    }
    console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toString()}`));
  } catch (error) {
    console.error(chalk.red(`Error loading wallet: ${error}`));
    process.exit(1);
  }
  
  // Get the RPC URL
  const rpcUrl = getRpcUrl(options.env);
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  // Create a connection to the cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Check the wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(chalk.blue(`Wallet balance: ${balance / 10**9} SOL`));
  
  // Check if balance is sufficient for mainnet deployment
  if (options.env === 'mainnet-beta' && balance < 10000000) { // 0.01 SOL
    console.warn(chalk.yellow(`Warning: Your wallet balance may be too low for mainnet deployment. Consider adding more SOL.`));
  }
  
  // Extract token parameters from config
  const tokenName = tokenConfig.name;
  const tokenSymbol = tokenConfig.symbol;
  const tokenDecimals = tokenConfig.decimals;
  const initialSupply = tokenConfig.initialSupply;
  const feeBasisPoints = tokenConfig.feeBasisPoints;
  const maxFee = BigInt(tokenConfig.maxFee * 10**tokenDecimals);
  const metadata = tokenConfig.metadata;
  
  console.log(chalk.blue(`Creating token: ${tokenName} (${tokenSymbol})`));
  console.log(chalk.blue(`Decimals: ${tokenDecimals}`));
  console.log(chalk.blue(`Initial supply: ${initialSupply} tokens`));
  console.log(chalk.blue(`Transfer fee: ${feeBasisPoints / 100}%`));
  if (maxFee > BigInt(0)) {
    console.log(chalk.blue(`Maximum fee: ${Number(maxFee) / 10**tokenDecimals} tokens`));
  } else {
    console.log(chalk.blue(`Maximum fee: None (unlimited)`));
  }
  
  // Create a spinner for the token creation process
  const spinner = ora('Creating token mint...').start();
  
  // Generate a new keypair for the mint
  const mintKeypair = Keypair.generate();
  
  // Define the extensions to use
  const extensions = [ExtensionType.TransferFeeConfig];
  
  // Calculate space required for the mint
  const mintLen = getMintLen(extensions);
  
  // Calculate rent required
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  
  // Create a transaction to create the mint account
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );
  
  // Add transfer fee config instruction with harvestable fees
  const transferFeeConfigAuthority = wallet.publicKey;
  const withdrawWithheldAuthority = wallet.publicKey;
  
  // IMPORTANT: This configuration sets up harvestable fees
  // The fees will be withheld in the recipient token account and can be harvested
  // using the harvestWithheldTokensToMint instruction
  transaction.add(
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      transferFeeConfigAuthority,
      withdrawWithheldAuthority,
      feeBasisPoints,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Add the initialize mint instruction
  transaction.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      tokenDecimals,
      wallet.publicKey,
      wallet.publicKey,
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Send the transaction to create the mint
  const mintSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet, mintKeypair],
    { commitment: 'confirmed' }
  );
  
  spinner.succeed(`Token mint created: ${mintKeypair.publicKey.toBase58()}`);
  console.log(chalk.green(`Transaction signature: ${mintSignature}`));
  
  // Create a token account for the creator
  spinner.text = 'Creating token account...';
  spinner.start();
  
  // Get the associated token account address
  const tokenAccount = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Create a transaction to create the token account
  const createAccountTransaction = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAccount,
      wallet.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  
  // Send the transaction to create the token account
  const createAccountSignature = await sendAndConfirmTransaction(
    connection,
    createAccountTransaction,
    [wallet],
    { commitment: 'confirmed' }
  );
  
  spinner.succeed(`Token account created: ${tokenAccount.toBase58()}`);
  
  // Mint the initial supply to the creator's token account
  spinner.text = `Minting ${initialSupply} tokens...`;
  spinner.start();
  
  // Create a transaction to mint tokens
  const mintTransaction = new Transaction().add(
    createMintToInstruction(
      mintKeypair.publicKey,
      tokenAccount,
      wallet.publicKey,
      BigInt(initialSupply * 10**tokenDecimals),
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Send the transaction to mint tokens
  const mintToSignature = await sendAndConfirmTransaction(
    connection,
    mintTransaction,
    [wallet],
    { commitment: 'confirmed' }
  );
  
  spinner.succeed(`Minted ${initialSupply} tokens to ${tokenAccount.toBase58()}`);
  console.log(chalk.green(`Transaction signature: ${mintToSignature}`));
  
  // Save token information
  const tokenInfo: TokenInfo = {
    name: tokenName,
    symbol: tokenSymbol,
    decimals: tokenDecimals,
    mintAddress: mintKeypair.publicKey.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    initialSupply,
    feeBasisPoints,
    maxFee: Number(maxFee) / 10**tokenDecimals,
    createdAt: new Date().toISOString(),
    environment: options.env,
    metadata: tokenConfig.metadata
  };
  
  saveTokenInfo(tokenName, tokenInfo);
  
  // Create and upload metadata if provided
  if (metadata) {
    spinner.text = 'Creating token metadata...';
    spinner.start();
    
    try {
      // Generate metadata JSON file
      const metadataDir = path.resolve(process.cwd(), 'metadata');
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      
      const metadataFilePath = path.join(
        metadataDir, 
        `${tokenName.toLowerCase().replace(/\s+/g, '-')}-${options.env}.json`
      );
      
      // Create metadata JSON with all available fields
      const metadataJson = generateMetadataJson({
        name: tokenName,
        symbol: tokenSymbol,
        description: metadata.description || `${tokenName} token`,
        image: metadata.image || '',
        external_url: metadata.external_url || '',
        attributes: metadata.attributes || [],
        properties: metadata.properties || {}
      }, metadataFilePath);
      
      console.log(chalk.blue(`Metadata JSON saved to: ${metadataFilePath}`));
      
      // If URI is provided in metadata, use it, otherwise we can't create on-chain metadata
      if (metadata.uri) {
        // Create on-chain metadata
        const metadataSignature = await createTokenMetadata(
          connection,
          wallet,
          mintKeypair.publicKey,
          tokenName,
          tokenSymbol,
          metadata.uri
        );
        
        spinner.succeed(`Token metadata created on-chain`);
        console.log(chalk.green(`Metadata transaction signature: ${metadataSignature}`));
        
        // Update token info with metadata
        tokenInfo.metadataAddress = PublicKey.findProgramAddressSync(
          [
            Buffer.from('metadata'),
            new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
            mintKeypair.publicKey.toBuffer(),
          ],
          new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
        )[0].toBase58();
        
        // Save updated token info
        saveTokenInfo(tokenName, tokenInfo);
      } else {
        spinner.warn(`No metadata URI provided. On-chain metadata not created.`);
        console.log(chalk.yellow(`To create on-chain metadata, add a 'uri' field to your metadata configuration.`));
        console.log(chalk.yellow(`The URI should point to a hosted JSON file with your token metadata.`));
      }
    } catch (error) {
      spinner.fail(`Failed to create token metadata`);
      console.error(chalk.red(`Error creating metadata: ${error}`));
    }
  } else {
    console.log(chalk.yellow('No metadata configuration provided.'));
    console.log(chalk.yellow('To add metadata, include a "metadata" object in your token configuration.'));
  }
  
  console.log(chalk.green(`\nToken created successfully!`));
  console.log(chalk.blue(`Mint Address: ${mintKeypair.publicKey.toBase58()}`));
  console.log(chalk.blue(`Token Account: ${tokenAccount.toBase58()}`));
  console.log(chalk.blue(`Initial Supply: ${initialSupply} tokens`));
  
  console.log(chalk.green('\nToken Creation Summary:'));
  console.log(chalk.blue(`Token Name: ${tokenName}`));
  console.log(chalk.blue(`Token Symbol: ${tokenSymbol}`));
  console.log(chalk.blue(`Decimals: ${tokenDecimals}`));
  console.log(chalk.blue(`Mint Address: ${mintKeypair.publicKey.toBase58()}`));
  console.log(chalk.blue(`Initial Supply: ${initialSupply}`));
  console.log(chalk.blue(`Transfer Fee: ${feeBasisPoints / 100}%`));
  console.log(chalk.blue(`Max Fee: ${maxFee > BigInt(0) ? Number(maxFee) / 10**tokenDecimals : 'None (unlimited)'}`));
  console.log(chalk.blue(`Token Account: ${tokenAccount.toBase58()}`));
  console.log(chalk.blue(`Harvestable Fees: Enabled`));
  
  if (tokenConfig.metadata) {
    console.log(chalk.blue(`Metadata: ${tokenConfig.metadata.description}`));
    console.log(chalk.yellow('Note: On-chain metadata creation is not supported in this version.'));
    console.log(chalk.yellow('You can add metadata manually using the Metaplex CLI or other tools.'));
  }
  
  console.log(chalk.yellow('\nIMPORTANT: For proper fee harvesting, use the transfer-checked script:'));
  console.log(chalk.blue(`npm run transfer-checked:${options.env} -- --wallet=${options.wallet || ''} --mint=${mintKeypair.publicKey.toBase58()} --amount=100 --recipient=<RECIPIENT_ADDRESS>`));
  
  console.log(chalk.blue('\nTo distribute this token, run:'));
  console.log(chalk.blue(`npm run distribute-token:${options.env} -- --wallet=${options.wallet || ''} --mint=${mintKeypair.publicKey.toBase58()} --amount=10 --wallets=10`));
  
  console.log(chalk.blue('\nTo check token extensions, run:'));
  console.log(chalk.blue(`npm run check-token-extensions:${options.env} -- --wallet=${options.wallet || ''} --mint=${mintKeypair.publicKey.toBase58()}`));
  
  console.log(chalk.blue('\nTo check for withheld fees, run:'));
  console.log(chalk.blue(`npm run check-withheld-fees:${options.env} -- --wallet=${options.wallet || ''} --mint=${mintKeypair.publicKey.toBase58()}`));
  
  console.log(chalk.blue('\nTo harvest fees, run:'));
  console.log(chalk.blue(`npm run harvest-fees:${options.env} -- --wallet=${options.wallet || ''} --mint=${mintKeypair.publicKey.toBase58()}`));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 