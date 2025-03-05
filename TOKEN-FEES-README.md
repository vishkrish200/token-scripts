# Token Transfer Fee Handling

This document explains how to properly handle token transfers with fees in the Solana Token 2022 program.

## Understanding Error Code 32 (InsufficientFunds)

Error code 32 corresponds to "InsufficientFunds" in the Solana Token program. This error occurs when a token account doesn't have enough tokens to complete a transaction.

When working with tokens that have transfer fees enabled, this error can occur if:

1. The account doesn't have enough tokens for the transfer amount itself.
2. The account has enough for the transfer amount but not enough to cover both the transfer amount and the fee.

## Fixed Scripts

We've fixed the following scripts to properly handle token transfer fees:

### 1. `transfer-checked.ts`

This script now:
- Explicitly calculates the fee based on the transfer fee configuration
- Checks if the source account has enough tokens for both the transfer amount and the fee
- Passes the calculated fee to the `createTransferCheckedWithFeeInstruction` function

### 2. `check-token-extensions.ts`

This script now:
- Properly handles token account errors
- Displays token account information more reliably
- Provides helpful error messages when token accounts aren't found

## How to Use

### Testing Token Transfers with Fees

Use the `fix-token-transfer.sh` script to test token transfers with fees:

```bash
./fix-token-transfer.sh
```

When prompted, enter the mint address of the token you want to transfer.

### Manual Token Transfers

To manually transfer tokens with fees:

```bash
ts-node src/scripts/token/transfer-checked.ts --env=local --wallet="your-wallet" --mint=<MINT_ADDRESS> --recipient=<RECIPIENT_ADDRESS> --amount=<AMOUNT>
```

Or using a private key file:

```bash
ts-node src/scripts/token/transfer-checked.ts --env=local --private-key-file=<PATH_TO_KEY_FILE> --mint=<MINT_ADDRESS> --recipient=<RECIPIENT_ADDRESS> --amount=<AMOUNT>
```

## Fee Calculation

Fees are calculated as follows:

1. Calculate the fee: `amount * feeBasisPoints / 10000`
2. Cap at maximum fee if set: `if (maxFee > 0 && fee > maxFee) fee = maxFee`
3. Check if there are enough tokens: `sourceAccount.amount >= (amount + fee)`

## Troubleshooting

If you encounter "InsufficientFunds" errors:

1. Check your token balance: `ts-node src/scripts/token/check-token-extensions.ts --env=local --wallet="your-wallet" --mint=<MINT_ADDRESS>`
2. Ensure you have enough tokens to cover both the transfer amount and the fee
3. For large transfers, be aware that the fee might be capped at the maximum fee set in the token's configuration

## Harvesting Fees

To check for withheld fees:

```bash
ts-node src/scripts/token/check-withheld-fees.ts --env=local --wallet="your-wallet" --mint=<MINT_ADDRESS>
```

To harvest fees:

```bash
ts-node src/scripts/token/harvest-fees.ts --env=local --wallet="your-wallet" --mint=<MINT_ADDRESS>
```

Note: Only the fee authority can harvest fees. 