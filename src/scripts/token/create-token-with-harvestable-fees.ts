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
import { loadWallet, loadWalletFromPrivateKey } from '../../utils/wallet';

program
  .option('--env <string>', 'Solana cluster environment', 'testnet')
  .option('--wallet <string>', 'Wallet name')
  .option('--private-key <string>', 'Private key as a JSON array of numbers')
  .option('--wallet-path <string>', 'Custom path to wallet file')
  .option('--name <string>', 'Token name', 'Harvestable Fee Token')
  .option('--symbol <string>', 'Token symbol', 'HARVEST')
  .option('--decimals <number>', 'Token decimals', '9')
  .option('--initial-supply <number>', 'Initial token supply', '1000000')
  .option('--fee-basis-points <number>', 'Transfer fee in basis points (1 basis point = 0.01%)', '1000')
  .option('--max-fee <number>', 'Maximum fee per transfer (0 for unlimited)', '0')
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

async function main() {
  console.log(chalk.green('Creating token with harvestable fees...'));
  
  // Check required parameters
  let wallet: Keypair;
  
  if (!options.wallet && !options.privateKey) {
    console.error(chalk.red('Either wallet name (--wallet) or private key (--private-key) is required'));
    process.exit(1);
  }
  
  // Get the RPC URL
  const rpcUrl = getRpcUrl(options.env);
  console.log(chalk.blue(`RPC URL: ${rpcUrl}`));
  
  // Create a connection to the cluster
  const connection = new Connection(rpcUrl, 'confirmed');
  
  // Load the wallet
  try {
    if (options.privateKey) {
      // Load from provided private key
      console.log(chalk.blue(`Loading wallet from provided private key`));
      wallet = loadWalletFromPrivateKey(options.privateKey);
      console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toString()}`));
    } else {
      // Load from wallet file
      console.log(chalk.blue(`Loading wallet: ${options.wallet}`));
      wallet = loadWallet(options.wallet);
      console.log(chalk.blue(`Wallet Public Key: ${wallet.publicKey.toString()}`));
    }
  } catch (error) {
    console.error(chalk.red(`Error loading wallet: ${error}`));
    process.exit(1);
  }
  
  // Check the wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(chalk.blue(`Wallet balance: ${balance / 10**9} SOL`));
  
  // Check if balance is sufficient for mainnet deployment
  if (options.env === 'mainnet-beta' && balance < 10000000) { // 0.01 SOL
    console.warn(chalk.yellow(`Warning: Your wallet balance may be too low for mainnet deployment. Consider adding more SOL.`));
  }
  
  // Get token parameters
  const tokenName = options.name;
  const tokenSymbol = options.symbol;
  const tokenDecimals = parseInt(options.decimals);
  const initialSupply = parseInt(options.initialSupply);
  const feeBasisPoints = parseInt(options.feeBasisPoints);
  const maxFee = BigInt(parseInt(options.maxFee) * 10**tokenDecimals);
  
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
  const tokenInfo = {
    name: tokenName,
    symbol: tokenSymbol,
    decimals: tokenDecimals,
    mintAddress: mintKeypair.publicKey.toBase58(),
    initialSupply: initialSupply,
    transferFeePercent: `${feeBasisPoints / 100}%`,
    maxFee: maxFee > BigInt(0) ? Number(maxFee) / 10**tokenDecimals : 'None (unlimited)',
    tokenAccount: tokenAccount.toBase58(),
    createdAt: new Date().toISOString(),
    environment: options.env,
    extensions: ['TransferFeeConfig'],
    transferFee: {
      feeBasisPoints: feeBasisPoints,
      maxFee: maxFee.toString()
    },
    authorities: {
      mintAuthority: wallet.publicKey.toBase58(),
      freezeAuthority: wallet.publicKey.toBase58(),
      transferFeeConfigAuthority: transferFeeConfigAuthority.toBase58(),
      withdrawWithheldAuthority: withdrawWithheldAuthority.toBase58()
    },
    harvestable: true
  };
  
  saveTokenInfo(tokenName, tokenInfo);
  
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
  
  console.log(chalk.yellow('\nIMPORTANT: For proper fee harvesting, use the transfer-checked script:'));
  console.log(chalk.blue(`npm run transfer-checked:${options.env} -- --wallet=${options.wallet} --mint=${mintKeypair.publicKey.toBase58()} --amount=100 --recipient=<RECIPIENT_ADDRESS>`));
  
  console.log(chalk.blue('\nTo distribute this token, run:'));
  console.log(chalk.blue(`npm run distribute-token:${options.env} -- --wallet=${options.wallet} --mint=${mintKeypair.publicKey.toBase58()} --amount=10 --wallets=10`));
  
  console.log(chalk.blue('\nTo check token extensions, run:'));
  console.log(chalk.blue(`npm run check-token-extensions:${options.env} -- --wallet=${options.wallet} --mint=${mintKeypair.publicKey.toBase58()}`));
  
  console.log(chalk.blue('\nTo check for withheld fees, run:'));
  console.log(chalk.blue(`npm run check-withheld-fees:${options.env} -- --wallet=${options.wallet} --mint=${mintKeypair.publicKey.toBase58()}`));
  
  console.log(chalk.blue('\nTo harvest fees, run:'));
  console.log(chalk.blue(`npm run harvest-fees:${options.env} -- --wallet=${options.wallet} --mint=${mintKeypair.publicKey.toBase58()}`));
}

main().catch(err => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             