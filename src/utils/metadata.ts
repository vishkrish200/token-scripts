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
  createGenericFile,
} from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { fromWeb3JsKeypair, fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Upload metadata to Arweave via Irys
 * @param connection Solana connection
 * @param payer Keypair of the payer
 * @param metadata Metadata object
 * @returns URI of the uploaded metadata
 */
export async function uploadMetadata(
  connection: Connection,
  payer: Keypair,
  metadata: {
    name: string;
    symbol: string;
    description: string;
    image?: string;
    external_url?: string;
    attributes?: { trait_type: string; value: string }[];
    properties?: Record<string, any>;
  }
): Promise<string> {
  try {
    // Create Umi instance with RPC endpoint and Irys uploader
    const umi = createUmi(connection.rpcEndpoint)
      .use(irysUploader());
    
    // Create signer from keypair
    const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer));
    
    // Set payer as identity
    umi.use(signerIdentity(payerSigner));
    
    console.log('Uploading metadata to Arweave via Irys...');
    
    // Upload metadata JSON
    const metadataUri = await umi.uploader.uploadJson(metadata);
    console.log(`Metadata uploaded to: ${metadataUri}`);
    
    return metadataUri;
  } catch (error) {
    console.error('Error uploading metadata:', error);
    throw error;
  }
}

/**
 * Upload an image to Arweave via Irys
 * @param connection Solana connection
 * @param payer Keypair of the payer
 * @param imagePath Path to the image file
 * @returns URI of the uploaded image
 */
export async function uploadImage(
  connection: Connection,
  payer: Keypair,
  imagePath: string
): Promise<string> {
  try {
    // Create Umi instance with RPC endpoint and Irys uploader
    const umi = createUmi(connection.rpcEndpoint)
      .use(irysUploader());
    
    // Create signer from keypair
    const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer));
    
    // Set payer as identity
    umi.use(signerIdentity(payerSigner));
    
    // Read image file
    const imageFile = fs.readFileSync(imagePath);
    const fileExtension = path.extname(imagePath).substring(1); // Remove the dot
    
    // Determine content type based on file extension
    let contentType = 'image/png'; // Default
    if (fileExtension === 'jpg' || fileExtension === 'jpeg') {
      contentType = 'image/jpeg';
    } else if (fileExtension === 'gif') {
      contentType = 'image/gif';
    } else if (fileExtension === 'svg') {
      contentType = 'image/svg+xml';
    }
    
    // Create generic file
    const umiImageFile = createGenericFile(
      imageFile, 
      path.basename(imagePath), 
      { tags: [{ name: 'Content-Type', value: contentType }] }
    );
    
    console.log('Uploading image to Arweave via Irys...');
    
    // Upload image
    const imageUriArray = await umi.uploader.upload([umiImageFile]);
    const imageUri = imageUriArray[0];
    console.log(`Image uploaded to: ${imageUri}`);
    
    return imageUri;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
}

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
    // Create Umi instance with RPC endpoint
    const umi = createUmi(connection.rpcEndpoint);
    
    // Create signers from keypairs
    const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer));
    const mintSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(mintKeypair));
    
    // Set both payer and mint as signers
    umi.use(signerIdentity(payerSigner));
    
    // Create metadata with explicit mint authority
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
      updateAuthority: fromWeb3JsPublicKey(payer.publicKey),
    });

    // Send and confirm transaction with both signers
    const result = await builder.sendAndConfirm(umi, {
      send: {
        skipPreflight: true,
      },
      confirm: {
        commitment: 'confirmed',
      }
    });
    
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