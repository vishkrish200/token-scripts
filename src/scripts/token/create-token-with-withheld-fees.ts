#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import { 
  TOKEN_2022_PROGRAM_ID, 
  createInitializeMintInstruction, 
  getMintLen, 
  ExtensionType, 
  createInitializeTransferFeeConfigInstruction,
  TransferFee
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { program } from 'commander';
import chalk from 'chalk';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name', 'wallet-1741011852572')
  .option('--fee-basis-points <number>', 'Transfer fee basis points (100 = 1%)', '1000')
  .option('--max-fee <number>', 'Maximum fee (in tokens)', '0')
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

// Load a keypair from a file
function loadKeypair(filePath: string): Keypair {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const keypairData = JSON.parse(fileContent);
  
  if (Array.isArray(keypairData)) {
    // Handle array format
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  } else if (keypairData.secretKey) {
    // Handle object format with base64 encoded secretKey
    const secretKeyString = keypairData.secretKey;
    const secretKey = Buffer.from(secretKeyString, 'base64');
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  } else {
    throw new Error(`Invalid keypair format in file: ${filePath}`);
  }
}

async function main() {
  console.log(chalk.green('Creating a new token with withheld transfer fees...'));
  
  // Get the RPC URL
  const rpcUrl = getRpcUrl(options.env);
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  // Create a connection to the cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load the wallet
  const walletsDir = path.join(process.cwd(), 'wallets', options.env);
  const walletFile = path.join(walletsDir, `${options.wallet}.json`);
  const wallet = loadKeypair(walletFile);
  console.log(chalk.blue(`Wallet: ${wallet.publicKey.toString()}`));
  
  // Get wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(chalk.blue(`Wallet balance: ${balance / 1e9} SOL`));
  
  // Create a new mint account
  const mint = Keypair.generate();
  console.log(chalk.blue(`Mint address: ${mint.publicKey.toString()}`));
  
  // Configure token properties
  const decimals = 9;
  const tokenName = "Withheld Fee Token";
  const tokenSymbol = "WITHHOLD";
  
  console.log(chalk.blue(`Token name: ${tokenName}`));
  console.log(chalk.blue(`Token symbol: ${tokenSymbol}`));
  console.log(chalk.blue(`Decimals: ${decimals}`));
  
  // Configure transfer fee
  const feeBasisPoints = parseInt(options.feeBasisPoints);
  const maxFee = options.maxFee === '0' ? 
    BigInt(0) : 
    BigInt(parseFloat(options.maxFee) * 10**decimals);
  
  console.log(chalk.blue(`Transfer fee: ${feeBasisPoints / 100}%`));
  
  if (maxFee > BigInt(0)) {
    console.log(chalk.blue(`Maximum fee: ${maxFee} (${Number(maxFee) / 10**decimals} tokens)`));
  } else {
    console.log(chalk.blue(`Maximum fee: None (unlimited)`));
  }
  
  // Calculate space and rent
  const extensionTypes = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensionTypes);
  
  // TransferFee configuration
  const transferFee: TransferFee = {
    epoch: BigInt(0), // Current epoch
    maximumFee: maxFee, // Maximum fee amount in base units
    transferFeeBasisPoints: feeBasisPoints, // Fee percentage in basis points (100 = 1%)
  };
  
  // Calculate the minimum lamports required for rent exemption
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);
  console.log(chalk.blue(`Mint account rent: ${mintRent / 1e9} SOL`));
  
  // Create a transaction to create the mint account with the transfer fee extension
  const transaction = new Transaction();
  
  console.log(chalk.blue(`Transfer fee configuration length: ${mintLen - getMintLen([])}`));
  
  // Add instructions to create the mint account with the transfer fee extension
  transaction.add(
    // Create the mint account with space for the transfer fee extension
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    
    // Initialize the transfer fee configuration
    createInitializeTransferFeeConfigInstruction(
      mint.publicKey,
      wallet.publicKey, // Fee authority
      wallet.publicKey, // Withdraw authority (important for fee collection)
      transferFee.transferFeeBasisPoints,
      transferFee.maximumFee,
      TOKEN_2022_PROGRAM_ID
    ),
    
    // Initialize the mint account
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      wallet.publicKey, // Mint authority
      wallet.publicKey, // Freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  console.log(chalk.blue(`Sending transaction...`));
  
  // Sign and send the transaction
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet, mint],
      { commitment: 'confirmed' }
    );
    
    console.log(chalk.green(`\nToken created successfully!`));
    console.log(chalk.blue(`Transaction signature: ${signature}`));
    
    // Save token info to a file
    const tokenInfo = {
      tokenName,
      tokenSymbol,
      mint: mint.publicKey.toString(),
      mintAuthority: wallet.publicKey.toString(),
      freezeAuthority: wallet.publicKey.toString(),
      feeAuthority: wallet.publicKey.toString(),
      withdrawAuthority: wallet.publicKey.toString(),
      feeBasisPoints,
      maxFee: maxFee.toString(),
      decimals,
      environment: options.env,
      createdAt: new Date().toISOString(),
    };
    
    const outputDir = path.join(process.cwd(), 'tokens');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, `${tokenSymbol.toLowerCase()}-${mint.publicKey.toString().slice(0, 8)}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(tokenInfo, null, 2));
    
    console.log(chalk.green(`\nToken information saved to ${outputFile}`));
    
    // Print next steps
    console.log(chalk.green(`\nNext steps:`));
    console.log(chalk.blue(`1. Distribute your token:`));
    console.log(`   npm run distribute-token:${options.env} -- --wallet=${options.wallet} --mint=${mint.publicKey.toString()} --name="${tokenName}" --amount=1000000 --wallets=10`);
    
    console.log(chalk.blue(`\n2. Check if your token has the transfer fee extension:`));
    console.log(`   npm run check-token-extensions:${options.env} -- --mint=${mint.publicKey.toString()}`);
    
    console.log(chalk.blue(`\n3. Transfer tokens between wallets to generate fees:`));
    console.log(`   npm run transfer-checked:${options.env} -- --wallet=${options.wallet} --mint=${mint.publicKey.toString()} --amount=1000 --recipient=<recipient-address>`);
    
    console.log(chalk.blue(`\n4. Check withheld fees:`));
    console.log(`   npm run check-withheld-fees:${options.env} -- --wallet=${options.wallet} --mint=${mint.publicKey.toString()}`);
    
    console.log(chalk.blue(`\n5. Harvest fees:`));
    console.log(`   npm run harvest-fees:${options.env} -- --wallet=${options.wallet} --mint=${mint.publicKey.toString()}`);
    
  } catch (error) {
    console.error(chalk.red('Error creating token:'), error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
}); 