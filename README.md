# Token Scripts

A collection of scripts for creating and managing tokens on the Solana blockchain, with a focus on tokens with high transfer fees.

## Features

- Create tokens with high transfer fees (4%)
- Distribute tokens to multiple wallets
- Transfer tokens between wallets
- Check for withheld fees in token accounts
- Harvest and withdraw withheld fees
- Create liquidity pools and swap tokens on DEXs (experimental)

## Scripts

- `create-token-with-high-fees`: Create a new token with high transfer fees (4%)
- `distribute-token`: Distribute tokens to multiple wallets
- `transfer-between-wallets`: Transfer tokens between wallets to generate fees
- `check-mint-fees`: Check if there are any fees withheld at the mint level
- `check-all-token-accounts`: Check all token accounts for a specific mint to find any withheld fees
- `check-token-extensions`: Check token account extension data
- `harvest-fees`: Harvest and withdraw fees from token accounts
- `create-liquidity-pool`: Create a liquidity pool for a token on a DEX (experimental)
- `swap-tokens`: Swap SOL for tokens on a DEX (experimental)
- `check-swap-fees`: Check for fees after swapping tokens on a DEX (experimental)

## Usage

### Create a token with high fees

```bash
npm run create-token-with-high-fees:testnet -- --wallet=<wallet-name> --name=<token-name> --symbol=<token-symbol>
```

### Distribute tokens

```bash
npm run distribute-token:testnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name> --tokenAmount=<amount>
```

### Transfer tokens between wallets

```bash
npm run transfer-between-wallets:testnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name> --amount=<amount> --count=<count>
```

### Check for withheld fees

```bash
npm run check-all-token-accounts:testnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name>
```

### Harvest fees

```bash
npm run harvest-fees:testnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name>
```

### Create a liquidity pool (experimental)

```bash
npm run create-liquidity-pool:devnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name> --sol-amount=<amount> --token-amount=<amount>
```

### Swap tokens on a DEX (experimental)

```bash
npm run swap-tokens:devnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name> --amount=<amount> --slippage=<percentage>
```

### Check for fees after swapping (experimental)

```bash
npm run check-swap-fees:devnet -- --wallet=<wallet-name> --mint=<mint-address> --name=<token-name>
```

## Findings

During our testing, we found that:

1. We can successfully create tokens with high transfer fees (4%) on the Solana testnet.
2. We can distribute tokens to multiple wallets.
3. We can transfer tokens between wallets.
4. However, the transfer fees are not being withheld in the token accounts or at the mint level.

This could be due to several reasons:

1. The Solana testnet might not fully support the transfer fee extension.
2. There might be an issue with how the transfer fee extension is being initialized.
3. The transfer fee might be applied but not withheld for later collection.

## Alternative Approach: DEX Integration

As an alternative approach to collecting fees, we've implemented experimental scripts to:

1. Create a liquidity pool for the token on a DEX
2. Swap SOL for tokens through the DEX
3. Check if fees are withheld after swapping

This approach might be more effective for fee collection as DEXs often handle token transfers differently than direct transfers.

## Next Steps

1. Test on the Solana mainnet to see if the transfer fee extension works as expected.
2. Investigate the Solana documentation and examples for transfer fee extension.
3. Modify the token creation script to ensure the transfer fee extension is properly initialized.
4. Explore DEX integration for more reliable fee collection.

## License

MIT 