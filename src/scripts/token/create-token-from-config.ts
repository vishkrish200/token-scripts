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
  createAssociatedTokenAccountInstruction,
  createSetAuthorityInstruction,
  AuthorityType
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
  
  // Add the transfer fee config authority
  const transferFeeConfigAuthority = wallet.publicKey;
  const withdrawWithheldAuthority = wallet.publicKey;
  
  // Get the associated token account address
  const tokenAccount = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  // Create a transaction to create the mint account and initialize it
  const transaction = new Transaction().add(
    // Create the mint account
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    
    // Initialize transfer fee config
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      transferFeeConfigAuthority,
      withdrawWithheldAuthority,
      feeBasisPoints,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    ),
    
    // Initialize mint with wallet as temporary authority
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      tokenDecimals,
      wallet.publicKey, // temporary mint authority for initial supply
      null, // no freeze authority
      TOKEN_2022_PROGRAM_ID
    ),

    // Create token account
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAccount,
      wallet.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    ),

    // Mint the entire supply
    createMintToInstruction(
      mintKeypair.publicKey,
      tokenAccount,
      wallet.publicKey,
      BigInt(initialSupply * 10**tokenDecimals),
      [],
      TOKEN_2022_PROGRAM_ID
    ),

    // Remove mint authority to fix supply
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      wallet.publicKey,
      AuthorityType.MintTokens,
      null,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  // Send the transaction to create and initialize everything
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet, mintKeypair],
    { commitment: 'confirmed' }
  );

  spinner.succeed(`Token created with fixed supply: ${mintKeypair.publicKey.toBase58()}`);
  console.log(chalk.green(`Transaction signature: ${signature}`));
  console.log(chalk.blue(`Mint Authority: None (fixed supply)`));
  console.log(chalk.blue(`Freeze Authority: None`));
  console.log(chalk.blue(`Initial Supply: ${initialSupply} tokens`));
  console.log(chalk.blue(`Token Account: ${tokenAccount.toBase58()}`));

  // Create metadata if specified
  let metadataAddress: string | undefined;
  if (metadata) {
    spinner.text = 'Creating token metadata...';
    spinner.start();

    try {
      // Convert creator addresses from strings to PublicKey objects
      const creators = metadata.creators?.map(creator => ({
        ...creator,
        address: new PublicKey(creator.address)
      }));

      const metadataSignature = await createTokenMetadata(
        connection,
        wallet,
        mintKeypair.publicKey,
        metadata.name,
        metadata.symbol,
        metadata.uri,
        creators
      );

      spinner.succeed('Token metadata created');
      console.log(chalk.green(`Metadata transaction signature: ${metadataSignature}`));
      metadataAddress = metadataSignature;
    } catch (error) {
      spinner.fail('Failed to create token metadata');
      console.error(chalk.red(`Error creating metadata: ${error}`));
    }
  }

  // Save token information
  const tokenInfo: TokenInfo = {
    name: tokenName,
    symbol: tokenSymbol,
    decimals: tokenDecimals,
    mintAddress: mintKeypair.publicKey.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
    initialSupply,
    feeBasisPoints,
    maxFee: Number(maxFee),
    createdAt: new Date().toISOString(),
    environment: options.env,
    metadata: metadata,
    metadataAddress
  };

  saveTokenInfo(tokenName, tokenInfo);
  spinner.succeed('Token creation completed successfully!');
  
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
  console.log(chalk.blue(`Mint Authority: None (fixed supply)`));
  
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

main().catch((error) => {
  console.error(chalk.red('Error:', error));
  process.exit(1);
});