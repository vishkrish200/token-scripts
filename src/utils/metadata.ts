import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { 
  createV1,
  TokenStandard,
  findMetadataPda,
} from '@metaplex-foundation/mpl-token-metadata';
import { 
  signerIdentity, 
  createSignerFromKeypair,
  percentAmount,
} from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair, fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Create metadata for a token
 * @param connection Solana connection
 * @param payer Keypair of the payer
 * @param mintKeypair Keypair of the mint
 * @param name Token name
 * @param symbol Token symbol
 * @param uri URI to the token metadata (JSON file)
 * @param creators Optional array of creators
 * @returns Transaction signature
 */
export async function createTokenMetadata(
  connection: Connection,
  payer: Keypair,
  mintKeypair: Keypair,
  name: string,
  symbol: string,
  uri: string,
  creators?: { address: PublicKey; share: number; verified: boolean }[]
): Promise<string> {
  try {
    // Create Umi instance
    const umi = createUmi(connection.rpcEndpoint);
    
    // Create signers
    const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer));
    const mintSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(mintKeypair));
    
    // Set the payer as the primary signer
    umi.use(signerIdentity(payerSigner));
    
    // Create metadata
    const builder = createV1(umi, {
      mint: fromWeb3JsPublicKey(mintKeypair.publicKey),
      authority: payerSigner,
      name,
      symbol,
      uri,
      sellerFeeBasisPoints: percentAmount(0),
      creators: creators ? creators.map(c => ({
        address: fromWeb3JsPublicKey(c.address),
        verified: c.verified,
        share: c.share,
      })) : null,
      tokenStandard: TokenStandard.Fungible,
      collection: null,
      uses: null,
      isMutable: true,
    });

    // Send and confirm transaction
    const result = await builder.sendAndConfirm(umi);
    
    return result.signature.toString();
  } catch (error) {
    console.error('Error creating metadata:', error);
    throw error;
  }
}

/**
 * Generate a metadata JSON file for a token
 * @param tokenDetails Token details
 * @param outputPath Path to save the metadata JSON file
 * @returns Path to the saved metadata file
 */
export function generateMetadataJson(
  tokenDetails: {
    name: string;
    symbol: string;
    description: string;
    image?: string;
    external_url?: string;
    attributes?: { trait_type: string; value: string }[];
    properties?: Record<string, any>;
  },
  outputPath: string
): string {
  // Create the metadata directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Create the metadata JSON
  const metadata = {
    name: tokenDetails.name,
    symbol: tokenDetails.symbol,
    description: tokenDetails.description,
    image: tokenDetails.image || '',
    external_url: tokenDetails.external_url || '',
    attributes: tokenDetails.attributes || [],
    properties: tokenDetails.properties || {},
  };

  // Write the metadata to a file
  fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2));
  
  return outputPath;
} 