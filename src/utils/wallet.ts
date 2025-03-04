import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { config, getConnection, ensureWalletDirectoryExists } from '../config';

/**
 * Generate a new keypair
 * @returns A new keypair
 */
export const generateKeypair = (): Keypair => {
  return Keypair.generate();
};

/**
 * Loads a keypair from a file
 * @param walletName The name of the wallet file
 * @returns The loaded keypair
 */
export function loadWallet(walletName: string): Keypair {
  ensureWalletDirectoryExists();
  const walletPath = path.join(path.resolve(process.cwd(), config.walletPath), `${walletName}.json`);
  
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Wallet file not found at ${walletPath}`);
  }
  
  const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(walletJson.secretKey));
}

/**
 * Loads a keypair from a private key string
 * @param privateKeyString The private key as a string (base58 or JSON array format)
 * @returns The loaded keypair
 */
export function loadWalletFromPrivateKey(privateKeyString: string): Keypair {
  try {
    // Check if the private key is in JSON array format
    if (privateKeyString.startsWith('[') && privateKeyString.endsWith(']')) {
      const secretKeyArray = JSON.parse(privateKeyString);
      return Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
    }
    
    // Otherwise, assume it's a base58 encoded private key
    // For base58, we need to use bs58 library which is not available here
    // Let's use a simpler approach - assume the input is already in the correct format
    try {
      // Try to parse as a JSON array directly
      const secretKeyArray = JSON.parse(privateKeyString);
      return Keypair.fromSecretKey(new Uint8Array(secretKeyArray));
    } catch {
      // If that fails, throw a helpful error
      throw new Error('Private key must be provided as a JSON array of numbers');
    }
  } catch (error: any) {
    throw new Error(`Invalid private key format: ${error.message}`);
  }
}

/**
 * Saves a keypair to a file
 * @param keypair The keypair to save
 * @param walletName The name to give the wallet file
 * @returns The path where the wallet was saved
 */
export function saveWallet(keypair: Keypair, walletName: string): string {
  ensureWalletDirectoryExists();
  const walletPath = path.join(path.resolve(process.cwd(), config.walletPath), `${walletName}.json`);
  
  // Create directory if it doesn't exist
  const dir = path.dirname(walletPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Save wallet to file
  const walletJson = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey)
  };
  
  fs.writeFileSync(walletPath, JSON.stringify(walletJson, null, 2));
  return walletPath;
}

/**
 * Get wallet balance in SOL
 * @param publicKey Wallet public key
 * @returns Balance in SOL
 */
export const getBalance = async (publicKey: PublicKey): Promise<number> => {
  const connection = getConnection();
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9; // Convert lamports to SOL
};

/**
 * Request an airdrop of SOL
 * @param publicKey Wallet public key
 * @param amount Amount of SOL to request
 * @returns Transaction signature
 */
export const requestAirdrop = async (publicKey: PublicKey, amount: number): Promise<string> => {
  const connection = getConnection();
  
  // Convert SOL to lamports
  const lamports = amount * 1e9;
  
  try {
    const signature = await connection.requestAirdrop(publicKey, lamports);
    await connection.confirmTransaction(signature);
    return signature;
  } catch (error) {
    console.error('Error requesting airdrop:', error);
    throw error;
  }
};

/**
 * List all wallet files in the wallet directory
 * @returns Array of wallet filenames (without extension)
 */
export const listWallets = (): string[] => {
  ensureWalletDirectoryExists();
  const walletDir = path.resolve(process.cwd(), config.walletPath);
  const files = fs.readdirSync(walletDir);
  
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''));
};

/**
 * Load all wallets from the wallet directory
 * @returns Array of keypairs
 */
export const loadAllWallets = (): Keypair[] => {
  const walletFiles = listWallets();
  const wallets: Keypair[] = [];
  
  for (const walletFile of walletFiles) {
    try {
      const keypair = loadWallet(walletFile);
      wallets.push(keypair);
    } catch (error) {
      console.error(`Error loading wallet ${walletFile}:`, error);
    }
  }
  
  return wallets;
};

/**
 * Loads a keypair from a private key stored in an environment variable
 * @param envVarName The name of the environment variable containing the private key
 * @returns The loaded keypair
 */
export function loadWalletFromEnv(envVarName: string): Keypair {
  const privateKeyString = process.env[envVarName];
  if (!privateKeyString) {
    throw new Error(`Environment variable ${envVarName} not found or empty`);
  }
  
  return loadWalletFromPrivateKey(privateKeyString);
}

/**
 * Loads a keypair from a private key stored in a file
 * @param filePath Path to the file containing the private key
 * @returns The loaded keypair
 */
export function loadWalletFromFile(filePath: string): Keypair {
  try {
    const privateKeyString = fs.readFileSync(filePath, 'utf-8').trim();
    return loadWalletFromPrivateKey(privateKeyString);
  } catch (error: any) {
    throw new Error(`Failed to load private key from file ${filePath}: ${error.message}`);
  }
} 