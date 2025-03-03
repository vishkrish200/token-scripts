import {
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferFeeConfigInstruction,
  createInitializeInterestBearingMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createInitializePermanentDelegateInstruction,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getConnection, tokenConfig, featureFlags } from '../config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Calculate the required extensions for the token based on feature flags
 * @returns Array of extension types
 */
export const getRequiredExtensions = (): ExtensionType[] => {
  const extensions: ExtensionType[] = [];
  
  if (featureFlags.enableTransferFee) {
    extensions.push(ExtensionType.TransferFeeConfig);
  }
  
  if (featureFlags.enableInterestBearing) {
    extensions.push(ExtensionType.InterestBearingConfig);
  }
  
  if (featureFlags.enableNonTransferable) {
    extensions.push(ExtensionType.NonTransferable);
  }
  
  if (featureFlags.enablePermanentDelegate) {
    extensions.push(ExtensionType.PermanentDelegate);
  }
  
  return extensions;
};

/**
 * Create a new token mint
 * @param payer The keypair that will pay for the transaction
 * @param mintAuthority The public key that will have authority to mint tokens
 * @param freezeAuthority The public key that will have authority to freeze accounts (optional)
 * @returns The mint keypair and transaction signature
 */
export const createTokenMint = async (
  payer: Keypair,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null = null
): Promise<{ mintKeypair: Keypair; signature: string }> => {
  const connection = getConnection();
  const mintKeypair = Keypair.generate();
  
  // Get required extensions
  const extensions = getRequiredExtensions();
  
  // Calculate space required for the mint
  const mintLen = getMintLen(extensions);
  
  // Calculate rent required
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  
  // Create a transaction to create the mint account
  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );
  
  // Add extension-specific instructions BEFORE initializing the mint
  if (featureFlags.enableTransferFee) {
    // Example transfer fee config (1% fee)
    const transferFeeConfigAuthority = payer.publicKey;
    const withdrawWithheldAuthority = payer.publicKey;
    const feeRateBasisPoints = 100; // 1%
    const maxFee = BigInt(1000000000); // 1 token with 9 decimals
    
    transaction.add(
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        transferFeeConfigAuthority,
        withdrawWithheldAuthority,
        feeRateBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  
  if (featureFlags.enableInterestBearing) {
    // Example interest rate (1% APR)
    const rateAuthority = payer.publicKey;
    const rate = 1; // 1% APR
    
    transaction.add(
      createInitializeInterestBearingMintInstruction(
        mintKeypair.publicKey,
        rateAuthority,
        rate,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  
  if (featureFlags.enableNonTransferable) {
    transaction.add(
      createInitializeNonTransferableMintInstruction(
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  
  if (featureFlags.enablePermanentDelegate) {
    const permanentDelegate = payer.publicKey;
    
    transaction.add(
      createInitializePermanentDelegateInstruction(
        mintKeypair.publicKey,
        permanentDelegate,
        TOKEN_2022_PROGRAM_ID
      )
    );
  }
  
  // Add the initialize mint instruction AFTER all extensions
  transaction.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      tokenConfig.decimals,
      mintAuthority,
      freezeAuthority,
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Send the transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, mintKeypair],
    { commitment: 'confirmed' }
  );
  
  console.log(`Token mint created: ${mintKeypair.publicKey.toBase58()}`);
  console.log(`Transaction signature: ${signature}`);
  
  return { mintKeypair, signature };
};

/**
 * Create a token account for a wallet
 * @param payer The keypair that will pay for the transaction
 * @param owner The public key of the account owner
 * @param mint The public key of the token mint
 * @returns The token account address and transaction signature
 */
export const createTokenAccount = async (
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey
): Promise<{ tokenAccount: PublicKey; signature: string }> => {
  const connection = getConnection();
  
  // Get the associated token account address
  const tokenAccount = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  // Check if the account already exists
  const accountInfo = await connection.getAccountInfo(tokenAccount);
  if (accountInfo !== null) {
    console.log(`Token account already exists: ${tokenAccount.toBase58()}`);
    return { tokenAccount, signature: '' };
  }
  
  // Create a transaction to create the token account
  const transaction = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      tokenAccount,
      owner,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  
  // Send the transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer],
    { commitment: 'confirmed' }
  );
  
  console.log(`Token account created: ${tokenAccount.toBase58()}`);
  console.log(`Transaction signature: ${signature}`);
  
  return { tokenAccount, signature };
};

/**
 * Mint tokens to an account
 * @param payer The keypair that will pay for the transaction
 * @param mint The public key of the token mint
 * @param destination The public key of the destination token account
 * @param authority The keypair with authority to mint tokens
 * @param amount The amount of tokens to mint
 * @returns The transaction signature
 */
export const mintTokens = async (
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  authority: Keypair,
  amount: bigint
): Promise<string> => {
  const connection = getConnection();
  
  // Create a transaction to mint tokens
  const transaction = new Transaction().add(
    createMintToInstruction(
      mint,
      destination,
      authority.publicKey,
      amount,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  
  // Send the transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, authority],
    { commitment: 'confirmed' }
  );
  
  console.log(`Minted ${amount} tokens to ${destination.toBase58()}`);
  console.log(`Transaction signature: ${signature}`);
  
  return signature;
};

/**
 * Save token information to a file
 * @param tokenName The name of the token
 * @param mintAddress The public key of the token mint
 * @param extensions The extensions used by the token
 */
export const saveTokenInfo = (
  tokenName: string,
  mintAddress: PublicKey,
  extensions: ExtensionType[]
): void => {
  const tokenInfo = {
    name: tokenName,
    symbol: tokenConfig.symbol,
    decimals: tokenConfig.decimals,
    mintAddress: mintAddress.toBase58(),
    extensions: extensions.map(ext => ExtensionType[ext]),
    createdAt: new Date().toISOString(),
  };
  
  const tokenInfoDir = path.resolve(process.cwd(), 'token-info');
  if (!fs.existsSync(tokenInfoDir)) {
    fs.mkdirSync(tokenInfoDir, { recursive: true });
  }
  
  const filePath = path.join(tokenInfoDir, `${tokenName.toLowerCase()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(tokenInfo, null, 2));
  
  console.log(`Token information saved to ${filePath}`);
}; 