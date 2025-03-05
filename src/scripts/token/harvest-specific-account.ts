import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAccount,
  getTransferFeeAmount,
  createHarvestWithheldTokensToMintInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getTransferFeeConfig
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

async function main() {
  try {
    // The specific token account to harvest fees from
    const tokenAccountAddress = new PublicKey('Cf14WD7W1TGDe9fzZkmbGsaz3FizWGHrTr3Etf8gRWBm');
    
    // Load wallet
    const walletPath = path.join(path.resolve(process.cwd(), './wallets/mainnet'), 'secret-key.json');
    console.log(chalk.blue(`Looking for wallet at: ${walletPath}`));
    
    if (!fs.existsSync(walletPath)) {
      throw new Error(`Wallet file not found at ${walletPath}`);
    }
    
    let wallet: Keypair;
    try {
      // Read the wallet file
      const walletData = fs.readFileSync(walletPath, 'utf-8');
      const walletJson = JSON.parse(walletData);
      
      // Handle different wallet file formats
      if (Array.isArray(walletJson)) {
        // Array format (direct secret key)
        wallet = Keypair.fromSecretKey(new Uint8Array(walletJson));
      } else if (walletJson.secretKey) {
        // Object with secretKey property
        if (Array.isArray(walletJson.secretKey)) {
          wallet = Keypair.fromSecretKey(new Uint8Array(walletJson.secretKey));
        } else {
          throw new Error('Unrecognized secretKey format in wallet file');
        }
      } else {
        throw new Error('Could not find a valid secret key in the wallet file');
      }
    } catch (error) {
      console.error(chalk.red(`Error parsing wallet file: ${error instanceof Error ? error.message : String(error)}`));
      throw new Error('Failed to load wallet');
    }
    
    console.log(chalk.blue(`Wallet public key: ${wallet.publicKey.toString()}`));
    
    // Connect to the Solana network
    const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=86a32350-bb87-48e2-b992-782f09d318ed', 'confirmed');
    
    console.log(chalk.blue(`Checking token account: ${tokenAccountAddress.toString()}`));
    
    // Get the token account data
    const tokenAccount = await getAccount(connection, tokenAccountAddress, 'confirmed', TOKEN_2022_PROGRAM_ID);
    
    console.log(chalk.blue(`Token account owner: ${tokenAccount.owner.toString()}`));
    console.log(chalk.blue(`Token mint: ${tokenAccount.mint.toString()}`));
    console.log(chalk.blue(`Token amount: ${tokenAccount.amount.toString()}`));
    
    // Check if the account has withheld fees
    const withheldAmount = getTransferFeeAmount(tokenAccount);
    
    if (withheldAmount && withheldAmount.withheldAmount > BigInt(0)) {
      console.log(chalk.green(`✓ Token account has ${withheldAmount.withheldAmount.toString()} withheld tokens`));
      
      // Get the mint
      const mint = tokenAccount.mint;
      
      // Step 1: Harvest fees from token account to mint
      console.log(chalk.blue('Harvesting fees from token account to mint...'));
      
      const harvestInstruction = createHarvestWithheldTokensToMintInstruction(
        mint,
        [tokenAccountAddress],
        TOKEN_2022_PROGRAM_ID
      );
      
      const harvestTransaction = new Transaction().add(harvestInstruction);
      
      try {
        const harvestSignature = await sendAndConfirmTransaction(
          connection,
          harvestTransaction,
          [wallet],
          { commitment: 'confirmed' }
        );
        
        console.log(chalk.green(`Harvest successful! Transaction signature: ${harvestSignature}`));
        
        // Step 2: Withdraw fees from mint to destination
        console.log(chalk.blue('Withdrawing fees from mint to destination...'));
        
        // Get the destination account
        const destination = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID
        );
        
        // Get the mint account to check withheld fees
        const mintAccount = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
        const transferFeeConfig = getTransferFeeConfig(mintAccount);
        
        if (transferFeeConfig && transferFeeConfig.withheldAmount > BigInt(0)) {
          console.log(chalk.green(`Mint has ${transferFeeConfig.withheldAmount.toString()} withheld tokens to withdraw`));
          
          const withdrawInstruction = createWithdrawWithheldTokensFromMintInstruction(
            mint,
            destination,
            wallet.publicKey,
            [], // Empty signers array
            TOKEN_2022_PROGRAM_ID
          );
          
          const withdrawTransaction = new Transaction().add(withdrawInstruction);
          
          try {
            const withdrawSignature = await sendAndConfirmTransaction(
              connection,
              withdrawTransaction,
              [wallet],
              { commitment: 'confirmed' }
            );
            
            console.log(chalk.green(`Withdrawal successful! Transaction signature: ${withdrawSignature}`));
            console.log(chalk.green(`Harvested and withdrawn ${transferFeeConfig.withheldAmount.toString()} tokens`));
          } catch (error) {
            console.error(chalk.red(`Error withdrawing fees: ${error instanceof Error ? error.message : String(error)}`));
          }
        } else {
          console.log(chalk.yellow('No withheld tokens in the mint to withdraw'));
        }
      } catch (error) {
        console.error(chalk.red(`Error harvesting fees: ${error instanceof Error ? error.message : String(error)}`));
      }
    } else {
      console.log(chalk.yellow('✗ Token account has no withheld tokens'));
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

main(); 