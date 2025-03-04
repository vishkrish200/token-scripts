import * as fs from 'fs';
import * as path from 'path';

/**
 * Token configuration interface
 */
export interface TokenConfig {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: number;
  feeBasisPoints: number;
  maxFee: number;
  metadata?: {
    description: string;
    image?: string;
    external_url?: string;
    attributes?: { trait_type: string; value: string }[];
    properties?: Record<string, any>;
  };
}

/**
 * Load token configuration from a JSON file
 * @param filePath Path to the token configuration JSON file
 * @returns Token configuration object
 */
export function loadTokenConfig(filePath: string): TokenConfig {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Token configuration file not found at ${filePath}`);
    }
    
    // Read and parse the JSON file
    const configJson = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(configJson) as TokenConfig;
    
    // Validate required fields
    if (!config.name) throw new Error('Token name is required');
    if (!config.symbol) throw new Error('Token symbol is required');
    if (config.decimals === undefined) throw new Error('Token decimals is required');
    if (config.initialSupply === undefined) throw new Error('Initial supply is required');
    
    // Set default values for optional fields
    config.feeBasisPoints = config.feeBasisPoints || 0;
    config.maxFee = config.maxFee || 0;
    
    return config;
  } catch (error: any) {
    throw new Error(`Failed to load token configuration: ${error.message}`);
  }
}

/**
 * Save token configuration to a JSON file
 * @param config Token configuration object
 * @param filePath Path to save the token configuration JSON file
 * @returns Path to the saved configuration file
 */
export function saveTokenConfig(config: TokenConfig, filePath: string): string {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write the configuration to a file
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
    
    return filePath;
  } catch (error: any) {
    throw new Error(`Failed to save token configuration: ${error.message}`);
  }
} 