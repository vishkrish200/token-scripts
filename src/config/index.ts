import * as dotenv from 'dotenv';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Environment types
export type Environment = 'local' | 'testnet' | 'mainnet';

// Get current environment from command line args or default to local
export const getEnvironment = (): Environment => {
  const envArg = process.argv.find(arg => arg.startsWith('--env='));
  if (envArg) {
    const env = envArg.split('=')[1] as Environment;
    if (['local', 'testnet', 'mainnet'].includes(env)) {
      return env;
    }
  }
  return 'local';
};

const currentEnv = getEnvironment();

// Configuration for different environments
interface EnvironmentConfig {
  rpcUrl: string;
  walletPath: string;
  heliusApiKey?: string;
  isDevnet: boolean;
}

const environmentConfigs: Record<Environment, EnvironmentConfig> = {
  local: {
    rpcUrl: process.env.LOCAL_RPC_URL || 'http://localhost:8899',
    walletPath: process.env.WALLET_PATH_LOCAL || './wallets/local',
    isDevnet: true,
  },
  testnet: {
    rpcUrl: process.env.TESTNET_RPC_URL || clusterApiUrl('testnet'),
    walletPath: process.env.WALLET_PATH_TESTNET || './wallets/testnet',
    heliusApiKey: process.env.HELIUS_API_KEY_TESTNET,
    isDevnet: true,
  },
  mainnet: {
    rpcUrl: process.env.MAINNET_RPC_URL || clusterApiUrl('mainnet-beta'),
    walletPath: process.env.WALLET_PATH_MAINNET || './wallets/mainnet',
    heliusApiKey: process.env.HELIUS_API_KEY_MAINNET,
    isDevnet: false,
  },
};

// Get the configuration for the current environment
export const config = environmentConfigs[currentEnv];

// Create a Solana connection for the current environment
export const getConnection = (): Connection => {
  let endpoint = config.rpcUrl;
  
  // Add Helius API key if available
  if (config.heliusApiKey && !endpoint.includes('localhost')) {
    if (endpoint.includes('?')) {
      endpoint += `&api-key=${config.heliusApiKey}`;
    } else {
      endpoint += `?api-key=${config.heliusApiKey}`;
    }
  }
  
  return new Connection(endpoint, 'confirmed');
};

// Token configuration
export const tokenConfig = {
  name: process.env.TOKEN_NAME || 'MyToken',
  symbol: process.env.TOKEN_SYMBOL || 'MTK',
  decimals: parseInt(process.env.TOKEN_DECIMALS || '9', 10),
  initialSupply: BigInt(process.env.TOKEN_INITIAL_SUPPLY || '1000000000'),
};

// Test amounts
export const testAmounts = {
  airdropAmount: parseFloat(process.env.TEST_AIRDROP_AMOUNT || '1'),
  transferAmount: parseFloat(process.env.TEST_TRANSFER_AMOUNT || '0.1'),
};

// Feature flags for Token 2022 extensions
export const featureFlags = {
  enableTransferFee: process.env.ENABLE_TRANSFER_FEE === 'true',
  enableInterestBearing: process.env.ENABLE_INTEREST_BEARING === 'true',
  enableNonTransferable: process.env.ENABLE_NON_TRANSFERABLE === 'true',
  enablePermanentDelegate: process.env.ENABLE_PERMANENT_DELEGATE === 'true',
};

// Ensure wallet directories exist
export const ensureWalletDirectoryExists = (): void => {
  const walletDir = path.resolve(process.cwd(), config.walletPath);
  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }
};

// Log current environment configuration
export const logEnvironmentInfo = (): void => {
  console.log(`Environment: ${currentEnv}`);
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`Wallet Path: ${config.walletPath}`);
  console.log(`Using Helius API: ${!!config.heliusApiKey}`);
}; 