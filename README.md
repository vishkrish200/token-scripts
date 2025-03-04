# Solana Token Scripts

A collection of utility scripts for creating and managing Solana tokens with harvestable fees using the Token-2022 program.

## Features

- Create tokens with transfer fee extensions (configurable fee percentage)
- Mint tokens to wallets
- Transfer tokens between wallets with proper fee withholding
- Check token balances and extensions
- Harvest withheld fees
- Support for local validator, testnet, and mainnet deployments
- Token metadata support
- Configuration-based token creation

## Prerequisites

- Node.js (v16+)
- Solana CLI tools
- TypeScript

## Installation

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

## Environment Setup

The scripts support three environments:

- `local`: For testing with a local Solana validator
- `testnet`: For deploying to Solana testnet
- `mainnet-beta`: For deploying to Solana mainnet

### Setting up Local Environment

Start a local Solana validator:

```bash
npm run start-validator
```

Keep this running in a separate terminal window.

## Creating Wallets

Create a new wallet for development or deployment:

```bash
# Local environment
npm run create-wallet:local -- --output=my-wallet

# Testnet
npm run create-wallet:testnet -- --output=my-testnet-wallet

# Mainnet
npm run create-wallet:mainnet -- --output=my-mainnet-wallet
```

### Funding Local Wallets

For local development, you can airdrop SOL to your wallet:

```bash
npm run fund-wallet:local -- --wallet=my-wallet --amount=10
```

## Token Creation

### Using Command Line Arguments

Create a token with harvestable fees:

```bash
# Local environment
npm run create-token:local -- --wallet=my-wallet --name="My Token" --symbol=MTK --fee-basis-points=1000

# Testnet
npm run create-token:testnet -- --wallet=my-testnet-wallet --name="My Token" --symbol=MTK --fee-basis-points=1000

# Mainnet
npm run create-token:mainnet -- --wallet=my-mainnet-wallet --name="My Token" --symbol=MTK --fee-basis-points=1000
```

### Using Configuration Files

You can also create tokens using a JSON configuration file:

1. Create a token configuration file (see `token-configs/sample-token.json` for an example):

```json
{
  "name": "Sample Token",
  "symbol": "SMPL",
  "decimals": 9,
  "initialSupply": 1000000,
  "feeBasisPoints": 100,
  "maxFee": 10,
  "metadata": {
    "description": "This is a sample token with harvestable fees",
    "image": "https://example.com/token-image.png",
    "external_url": "https://example.com/token",
    "attributes": [
      {
        "trait_type": "Type",
        "value": "Utility"
      },
      {
        "trait_type": "Transfer Fee",
        "value": "1%"
      }
    ],
    "properties": {
      "category": "utility",
      "creators": [
        {
          "address": "YOUR_WALLET_ADDRESS",
          "share": 100
        }
      ]
    }
  }
}
```

2. Run the token creation script with the configuration file:

```bash
# Using a wallet file
npm run create-token-from-config:local -- --wallet=my-wallet --config=token-configs/sample-token.json

# Using a private key file
npm run create-token-from-config:local -- --private-key-file=private-keys/my-key.json --config=token-configs/sample-token.json

# Using an environment variable for the private key
# First set the environment variable:
# export MY_TOKEN_KEY="[123,456,...]"
npm run create-token-from-config:local -- --private-key-env=MY_TOKEN_KEY --config=token-configs/sample-token.json
```

### Private Key Options

You have several options for providing your private key:

1. **Wallet file**: Use `--wallet=my-wallet` to load a wallet from the wallets directory
2. **Private key string**: Use `--private-key="[123,456,...]"` to provide the private key directly
3. **Private key file**: Use `--private-key-file=path/to/key.json` to load the private key from a file
4. **Environment variable**: Use `--private-key-env=ENV_VAR_NAME` to load the private key from an environment variable

### Token Metadata

The token configuration file supports metadata information:

```json
"metadata": {
  "description": "This is a sample token with harvestable fees",
  "image": "https://example.com/token-image.png",
  "external_url": "https://example.com/token"
}
```

This metadata is stored in the token information file but is not currently added on-chain. You can use the Metaplex CLI or other tools to add on-chain metadata manually.

### Using Environment Variables

You can also create tokens using environment variables:

1. Copy the `.env.example` file to `.env` and update the values:

```bash
cp .env.example .env
# Edit the .env file with your values
```

2. Run the provided shell script:

```bash
./create-token-from-env.sh
```

This script will:
1. Load environment variables from the `.env` file
2. Create a token configuration file based on those variables
3. Create the token using the private key from the `TOKEN_CREATOR_PRIVATE_KEY` environment variable

## Token Management

### Minting Tokens

Mint additional tokens to your wallet:

```bash
# Using wallet file
npm run mint-tokens:local -- --wallet=my-wallet --mint=<MINT_ADDRESS> --amount=1000

# Using private key
npm run mint-tokens:local -- --private-key="[123,456,...]" --mint=<MINT_ADDRESS> --amount=1000
```

### Checking Balance

Check your token balance:

```bash
npm run check-balance:local -- --wallet=my-wallet --mint=<MINT_ADDRESS>
```

### Transferring Tokens

Transfer tokens with proper fee withholding:

```bash
npm run transfer-checked:local -- --wallet=my-wallet --mint=<MINT_ADDRESS> --recipient=<RECIPIENT_ADDRESS> --amount=100
```

### Checking Token Extensions

Verify the token's extensions and configuration:

```bash
npm run check-token-extensions:local -- --wallet=my-wallet --mint=<MINT_ADDRESS>
```

### Checking for Withheld Fees

Check token accounts for withheld fees:

```bash
npm run check-withheld-fees:local -- --wallet=my-wallet --mint=<MINT_ADDRESS>
```

### Harvesting Fees

Harvest and withdraw withheld fees:

```bash
# Using wallet file
npm run harvest-fees:local -- --wallet=my-wallet --mint=<MINT_ADDRESS>

# Using private key
npm run harvest-fees:local -- --private-key="[123,456,...]" --mint=<MINT_ADDRESS>
```

## For Mainnet Deployment

When deploying to mainnet, follow these best practices:

1. Create a dedicated wallet for your token and fund it with at least 1 SOL
2. Create your token with proper parameters (symbol, name, decimals, supply)
3. Verify the token extensions and transfer fee configuration
4. Use the `transfer-checked` script for all transfers to ensure fees are properly withheld
5. Regularly harvest fees using the `harvest-fees` script

## Security Notes

- **IMPORTANT**: Never commit your wallet files or private key files to version control
- Add `wallets/` and `private-keys/` to your `.gitignore` file
- For production deployments, consider using a hardware wallet to sign transactions
- Always verify transaction details before signing
- Keep your wallet files secure
- Use dedicated wallets for different tokens or purposes
- When using environment variables for private keys, be careful with your shell history

## Using Private Keys

In addition to loading wallets from files, all scripts now support providing a private key directly via the `--private-key` option. This is useful for integrating with other systems or when you want to use a wallet without saving it to disk.

### Private Key Format

The private key must be provided as a JSON array of numbers representing the secret key bytes:

```bash
--private-key="[123,45,67,89,...]"
```

### Security Considerations

When using the `--private-key` option:

1. Be careful with command history - your private key will be stored in your shell history
2. Consider using environment variables or a secure method to pass the private key
3. For production use, prefer hardware wallets or more secure key management solutions

### Example Usage

Create a token with a provided private key:

```bash
npm run create-token:testnet -- --private-key="[123,45,67,...]" --name="My Token" --symbol=MTK
```

Transfer tokens using a provided private key:

```bash
npm run transfer-checked:testnet -- --private-key="[123,45,67,...]" --mint=<MINT_ADDRESS> --recipient=<RECIPIENT_ADDRESS> --amount=100
```

## License

ISC 