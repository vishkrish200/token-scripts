# Solana Token Scripts

A collection of scripts for launching and managing a token on the Solana blockchain using the Token 2022 program.

## Features

- Environment-specific configuration (local, testnet, mainnet)
- Wallet management (creation, balance checking, airdrops)
- Token creation with Token 2022 program
- Support for Token 2022 extensions:
  - Transfer Fee
  - Interest Bearing
  - Non-Transferable
  - Permanent Delegate
- Bulk operations:
  - Create multiple wallets (up to 100+)
  - Fund multiple wallets efficiently
  - Distribute tokens to multiple wallets

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Solana CLI (optional, for local validator)

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd token-scripts
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file with your configuration:
   - Set your Helius API keys
   - Configure token parameters
   - Enable/disable Token 2022 extensions

## Usage

### Environment Selection

All scripts can be run in different environments:

- `local`: Local Solana validator
- `testnet`: Solana testnet
- `mainnet`: Solana mainnet

### Available Scripts

#### Wallet Management

1. Create a single wallet:
   ```
   npm run create-wallet:local
   ```

2. Create multiple wallets (default: 100):
   ```
   npm run create-multiple-wallets:local -- --count=100
   ```

3. Request an airdrop (local/testnet only):
   ```
   npm run airdrop:local -- --wallet=wallet-filename
   ```

4. Fund multiple wallets efficiently:
   ```
   npm run fund-wallets:local -- --source=wallet-filename --amount=0.1 --airdrops=3
   ```

#### Token Management

1. Create a new token:
   ```
   npm run create-token:local -- --wallet=wallet-filename --name=MyToken
   ```

2. Create and distribute a token to multiple wallets:
   ```
   npm run create-distribute-token:local -- --wallet=wallet-filename --name=MyToken --tokenAmount=1000
   ```

### Complete Token Launch Workflow

1. Create a source wallet:
   ```
   npm run create-wallet:local
   ```

2. Request an airdrop to the source wallet:
   ```
   npm run airdrop:local -- --wallet=wallet-filename
   ```

3. Create multiple wallets:
   ```
   npm run create-multiple-wallets:local -- --count=100
   ```

4. Fund the wallets:
   ```
   npm run fund-wallets:local -- --source=wallet-filename --amount=0.1
   ```

5. Create and distribute a token:
   ```
   npm run create-distribute-token:local -- --wallet=wallet-filename --name=MyToken
   ```

### Running a Local Validator

For local development and testing, you can run a local Solana validator:

```
solana-test-validator
```

## Project Structure

```
token-scripts/
├── src/
│   ├── config/           # Configuration files
│   ├── scripts/          # Executable scripts
│   │   ├── token/        # Token-related scripts
│   │   └── wallet/       # Wallet-related scripts
│   └── utils/            # Utility functions
├── wallets/              # Generated wallet files (gitignored)
│   ├── local/            # Local environment wallets
│   ├── testnet/          # Testnet environment wallets
│   └── mainnet/          # Mainnet environment wallets
├── wallet-index/         # Wallet index files
├── token-info/           # Token information files
├── .env                  # Environment variables (gitignored)
├── .env.example          # Example environment variables
└── package.json          # Project dependencies
```

## Data Storage

- **Wallets**: Individual wallet keypairs are stored in the `wallets/` directory, organized by environment.
- **Wallet Index**: Information about multiple wallets is stored in the `wallet-index/` directory.
- **Token Information**: Details about created tokens are stored in the `token-info/` directory.

## Token 2022 Extensions

The Token 2022 program offers several extensions that can be enabled in the `.env` file:

- **Transfer Fee**: Enables a fee on token transfers
- **Interest Bearing**: Tokens accrue interest over time
- **Non-Transferable**: Tokens cannot be transferred between wallets
- **Permanent Delegate**: A permanent authority that can transfer tokens from any account

## Security Considerations

- Wallet files contain sensitive information. Keep them secure and backed up.
- Never commit `.env` files or wallet files to version control.
- Use small amounts for testing on testnet.
- Thoroughly test all scripts before using on mainnet.

## License

[MIT](LICENSE) 