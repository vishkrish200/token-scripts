import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  CreateMetadataAccountV3InstructionAccounts,
  CreateMetadataAccountV3InstructionArgs,
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as METADATA_PROGRAM_ID,
  DataV2,
  Creator,
  Collection,
  Uses
} from '@metaplex-foundation/mpl-token-metadata';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Create metadata for a token
 * @param connection Solana connection
 * @param payer Keypair of the payer
 * @param mint Mint address of the token
 * @param name Token name
 * @param symbol Token symbol
 * @param uri URI to the token metadata (JSON file)
 * @param creators Optional array of creators
 * @returns Transaction signature
 */
export async function createTokenMetadata(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  name: string,
  symbol: string,
  uri: string,
  creators?: { address: PublicKey; share: number; verified: boolean }[]
): Promise<string> {
  // Derive the metadata account address
  const [metadataAccount] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );

  // Convert creators to the required format
  const metadataCreators = creators ? 
    creators.map(c => new Creator({
      address: c.address.toString(),
      share: c.share,
      verified: c.verified
    })) : 
    null;

  // Create the metadata
  const data: DataV2 = {
    name,
    symbol,
    uri,
    sellerFeeBasisPoints: 0,
    creators: metadataCreators,
    collection: null,
    uses: null,
  };

  // Create the instruction
  const accounts: CreateMetadataAccountV3InstructionAccounts = {
    metadata: metadataAccount,
    mint,
    mintAuthority: payer.publicKey,
    payer: payer.publicKey,
    updateAuthority: payer.publicKey,
  };

  const args: CreateMetadataAccountV3InstructionArgs = {
    createMetadataAccountArgsV3: {
      data,
      isMutable: true,
      collectionDetails: null,
    }
  };

  const instruction = createCreateMetadataAccountV3Instruction(
    accounts,
    args
  );

  // Create and send the transaction
  const transaction = new Transaction().add(instruction);
  
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer],
    { commitment: 'confirmed' }
  );

  return signature;
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