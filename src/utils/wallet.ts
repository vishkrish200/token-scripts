import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as bs58 from 'bs58';
import { config, getConnection, ensureWalletDirectoryExists } from '../config';

/**
 * Generate a new wallet keypair
 * @returns The generated keypair
 */
export const generateKeypair = (): Keypair => {
  return Keypair.generate();
};

/**
 * Save a keypair to a file
 * @param keypair The keypair to save
 * @param filename The filename to save the keypair to
 * @returns The path to the saved keypair file
 */
export const saveKeypair = (keypair: Keypair, filename: string): string => {
  ensureWalletDirectoryExists();
  
  const walletDir = path.resolve(process.cwd(), config.walletPath);
  const filePath = path.join(walletDir, `${filename}.json`);
  
  // Convert the keypair to a saveable format
  const keypairData = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Buffer.from(keypair.secretKey).toString('base64'),
  };
  
  fs.writeFileSync(filePath, JSON.stringify(keypairData, null, 2));
  console.log(`Keypair saved to ${filePath}`);
  
  return filePath;
};

/**
 * Load a keypair from a file
 * @param filename The filename to load the keypair from
 * @returns The loaded keypair
 */
export const loadKeypair = (filename: string): Keypair => {
  const walletDir = path.resolve(process.cwd(), config.walletPath);
  const filePath = path.join(walletDir, `${filename}.json`);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keypair file not found at ${filePath}`);
  }
  
  const keypairData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const secretKey = Buffer.from(keypairData.secretKey, 'base64');
  
  return Keypair.fromSecretKey(secretKey);
};

/**
 * Get the balance of a wallet
 * @param publicKey The public key of the wallet
 * @returns The balance in SOL
 */
export const getBalance = async (publicKey: PublicKey): Promise<number> => {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
};

/**
 * Request an airdrop of SOL to a wallet
 * @param publicKey The public key of the wallet to airdrop to
 * @param amount The amount of SOL to airdrop
 * @returns The transaction signature
 */
export const requestAirdrop = async (publicKey: PublicKey, amount: number): Promise<string> => {
  const connection = getConnection();
  
  if (!config.isDevnet) {
    throw new Error('Airdrops are only available on devnet or local networks');
  }
  
  const lamports = amount * LAMPORTS_PER_SOL;
  const signature = await connection.requestAirdrop(publicKey, lamports);
  
  // Wait for confirmation
  await connection.confirmTransaction(signature);
  console.log(`Airdropped ${amount} SOL to ${publicKey.toBase58()}`);
  
  return signature;
};

/**
 * List all saved wallets
 * @returns An array of wallet filenames (without extension)
 */
export const listWallets = (): string[] => {
  ensureWalletDirectoryExists();
  
  const walletDir = path.resolve(process.cwd(), config.walletPath);
  
  if (!fs.existsSync(walletDir)) {
    return [];
  }
  
  return fs.readdirSync(walletDir)
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''));
}; 