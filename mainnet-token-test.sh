#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Testing Token Fee Collection on Solana Mainnet ===${NC}"

# Configuration
TOKEN_CONFIG="token-configs/mainnet-token.json"
ENV="mainnet-beta"
WALLET_FILE="wallets/mainnet/private-key-array.json"
WALLET_ADDRESS="BfqEw1JoFiA2NUTV5B2guRntdHEPr557igEB7VYGGf7A"

# Check if the wallet exists
if [ ! -f "$WALLET_FILE" ]; then
  echo -e "${RED}Wallet not found: $WALLET_FILE${NC}"
  exit 1
fi

echo -e "${BLUE}Wallet address: ${WALLET_ADDRESS}${NC}"

# Check wallet balance
echo -e "${BLUE}Checking wallet balance...${NC}"
BALANCE=$(solana balance ${WALLET_ADDRESS} --url https://api.mainnet-beta.solana.com | awk '{print $1}')
echo -e "${BLUE}Wallet balance: ${BALANCE} SOL${NC}"

if (( $(echo "$BALANCE < 0.1" | bc -l) )); then
  echo -e "${RED}Insufficient balance. Please fund the wallet with at least 0.2 SOL${NC}"
  echo -e "${RED}Wallet address: ${WALLET_ADDRESS}${NC}"
  exit 1
fi

# Step 1: Create the token on mainnet
echo -e "${BLUE}Creating token on mainnet...${NC}"
TOKEN_OUTPUT=$(ts-node src/scripts/token/create-token-from-config.ts --env=${ENV} --private-key-file="${WALLET_FILE}" --config=${TOKEN_CONFIG})
echo "$TOKEN_OUTPUT"

# Extract the mint address from the output
MINT_ADDRESS=$(echo "$TOKEN_OUTPUT" | grep -o "Mint Address: [^ ]*" | cut -d' ' -f3)
if [ -z "$MINT_ADDRESS" ]; then
  # Try alternative pattern
  MINT_ADDRESS=$(echo "$TOKEN_OUTPUT" | grep -o "Token created with fixed supply: [^ ]*" | cut -d' ' -f6)
fi

if [ -z "$MINT_ADDRESS" ]; then
  echo -e "${RED}Failed to extract mint address from output${NC}"
  exit 1
fi

echo -e "${GREEN}Token created with mint address: ${MINT_ADDRESS}${NC}"

# Step 2: Check the token mint info
echo -e "${BLUE}Checking token mint info...${NC}"
ts-node src/scripts/token/check-mint.ts --env=${ENV} --mint=${MINT_ADDRESS}

# Step 3: Check token extensions to verify transfer fee is enabled
echo -e "${BLUE}Checking token extensions...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=${ENV} --mint=${MINT_ADDRESS} --private-key-file="${WALLET_FILE}"

# Step 4: Create a second wallet for testing transfers
echo -e "${BLUE}Creating a second wallet for testing transfers...${NC}"
SECOND_WALLET_OUTPUT=$(ts-node src/scripts/wallet/create-wallet.ts --env=${ENV} --output=mainnet-token-recipient)
SECOND_WALLET_ADDRESS=$(echo "$SECOND_WALLET_OUTPUT" | grep -o "Public Key: [^ ]*" | cut -d' ' -f3)
SECOND_WALLET_FILE=$(echo "$SECOND_WALLET_OUTPUT" | grep -o "Saved to: [^ ]*" | cut -d' ' -f3)

echo -e "${BLUE}Second wallet address: ${SECOND_WALLET_ADDRESS}${NC}"
echo -e "${BLUE}Second wallet file: ${SECOND_WALLET_FILE}${NC}"

# Step 5: Transfer a small amount of SOL to the second wallet for rent
echo -e "${BLUE}Transferring SOL to the second wallet for rent...${NC}"
solana transfer --from ${WALLET_FILE} ${SECOND_WALLET_ADDRESS} 0.01 --url https://api.mainnet-beta.solana.com --fee-payer ${WALLET_FILE}

# Step 6: Transfer tokens to the second wallet
echo -e "${BLUE}Transferring tokens to the second wallet...${NC}"
ts-node src/scripts/token/transfer-checked.ts --env=${ENV} --private-key-file="${WALLET_FILE}" --mint=${MINT_ADDRESS} --recipient=${SECOND_WALLET_ADDRESS} --amount=10000

# Step 7: Check token extensions again to see balances
echo -e "${BLUE}Checking token extensions after transfer...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=${ENV} --mint=${MINT_ADDRESS} --private-key-file="${WALLET_FILE}"

# Step 8: Transfer tokens back to test more fee collection
echo -e "${BLUE}Transferring tokens back to creator...${NC}"
# Extract the private key from the second wallet file
SECOND_WALLET_PRIVATE_KEY=$(cat ${SECOND_WALLET_FILE} | jq -r '.secretKey')
ts-node src/scripts/token/transfer-checked.ts --env=${ENV} --private-key-file="${SECOND_WALLET_FILE}" --mint=${MINT_ADDRESS} --recipient=${WALLET_ADDRESS} --amount=1000

# Step 9: Check withheld fees
echo -e "${BLUE}Checking withheld fees...${NC}"
ts-node src/scripts/token/check-withheld-fees.ts --env=${ENV} --mint=${MINT_ADDRESS} --private-key-file="${WALLET_FILE}"

# Step 10: Harvest fees
echo -e "${BLUE}Harvesting fees...${NC}"
ts-node src/scripts/token/harvest-fees.ts --env=${ENV} --mint=${MINT_ADDRESS} --private-key-file="${WALLET_FILE}"

# Step 11: Check token extensions again after harvesting
echo -e "${BLUE}Checking token extensions after harvesting fees...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=${ENV} --mint=${MINT_ADDRESS} --private-key-file="${WALLET_FILE}"

echo -e "${GREEN}=== Test completed successfully! ===${NC}"
echo -e "${GREEN}Token mint address: ${MINT_ADDRESS}${NC}"
echo -e "${GREEN}Wallet address: ${WALLET_ADDRESS}${NC}"
echo -e "${GREEN}Second wallet address: ${SECOND_WALLET_ADDRESS}${NC}" 