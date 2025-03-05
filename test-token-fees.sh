#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Testing Token Fee Collection on Local Validator ===${NC}"

# Configuration
TOKEN_CONFIG="token-configs/test-token.json"
ENV="http://localhost:8899"  # Use the full URL instead of just "local"
CREATOR_WALLET="wallets/devnet/creator-wallet-array.json"
RECIPIENT_WALLET="wallets/devnet/recipient-wallet-array.json"
CREATOR_WALLET_PATH="creator-wallet"
RECIPIENT_WALLET_PATH="recipient-wallet"

# Check if the wallets exist
if [ ! -f "$CREATOR_WALLET" ]; then
  echo -e "${RED}Creator wallet not found: $CREATOR_WALLET${NC}"
  exit 1
fi

if [ ! -f "$RECIPIENT_WALLET" ]; then
  echo -e "${RED}Recipient wallet not found: $RECIPIENT_WALLET${NC}"
  exit 1
fi

# Get wallet public keys
CREATOR_PUBKEY="9P9nNFqHTmdGB2uDCs4HgYLhmaEagytFd7eYykiyZvUF"
RECIPIENT_PUBKEY="AffDdWJ8FjvxutDamA34jQbgCEDFhmHgp2izm7wwdLZV"

# Read wallet private keys
CREATOR_PRIVATE_KEY=$(cat "$CREATOR_WALLET")
RECIPIENT_PRIVATE_KEY=$(cat "$RECIPIENT_WALLET")

echo -e "${BLUE}Creator wallet: ${CREATOR_PUBKEY}${NC}"
echo -e "${BLUE}Recipient wallet: ${RECIPIENT_PUBKEY}${NC}"

# Check and fund wallets if needed
echo -e "${BLUE}Checking wallet balances...${NC}"
CREATOR_BALANCE=$(solana balance ${CREATOR_PUBKEY} --url ${ENV} | awk '{print $1}')
echo -e "${BLUE}Creator balance: ${CREATOR_BALANCE} SOL${NC}"

RECIPIENT_BALANCE=$(solana balance ${RECIPIENT_PUBKEY} --url ${ENV} | awk '{print $1}')
echo -e "${BLUE}Recipient balance: ${RECIPIENT_BALANCE} SOL${NC}"

if (( $(echo "$CREATOR_BALANCE < 1.0" | bc -l) )); then
  echo -e "${BLUE}Funding creator wallet with additional SOL...${NC}"
  solana airdrop 2 ${CREATOR_PUBKEY} --url ${ENV}
fi

if (( $(echo "$RECIPIENT_BALANCE < 0.5" | bc -l) )); then
  echo -e "${BLUE}Funding recipient wallet with additional SOL...${NC}"
  solana airdrop 1 ${RECIPIENT_PUBKEY} --url ${ENV}
fi

# Step 2: Create the token on local validator
echo -e "${BLUE}Creating token on local validator...${NC}"
TOKEN_OUTPUT=$(ts-node src/scripts/token/create-token-from-config.ts --env=local --private-key-file="${CREATOR_WALLET}" --config=${TOKEN_CONFIG})
echo "$TOKEN_OUTPUT"

# Extract the mint address from the output - updated pattern
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

# Step 3: Check the token mint info
echo -e "${BLUE}Checking token mint info...${NC}"
ts-node src/scripts/token/check-mint.ts --env=local --mint=${MINT_ADDRESS}

# Step 4: Check token extensions to verify transfer fee is enabled
echo -e "${BLUE}Checking token extensions...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=local --mint=${MINT_ADDRESS} --wallet="${CREATOR_WALLET_PATH}"

# Step 5: Transfer tokens to the recipient
echo -e "${BLUE}Transferring tokens to recipient...${NC}"
ts-node src/scripts/token/transfer-checked.ts --env=local --private-key="${CREATOR_PRIVATE_KEY}" --mint=${MINT_ADDRESS} --recipient=${RECIPIENT_PUBKEY} --amount=10000

# Step 6: Check token extensions again to see balances
echo -e "${BLUE}Checking token extensions after transfer...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=local --mint=${MINT_ADDRESS} --wallet="${CREATOR_WALLET_PATH}"

# Step 7: Transfer tokens back to test more fee collection
echo -e "${BLUE}Transferring tokens back to creator...${NC}"
ts-node src/scripts/token/transfer-checked.ts --env=local --private-key="${RECIPIENT_PRIVATE_KEY}" --mint=${MINT_ADDRESS} --recipient=${CREATOR_PUBKEY} --amount=1000

# Step 8: Check withheld fees
echo -e "${BLUE}Checking withheld fees...${NC}"
ts-node src/scripts/token/check-withheld-fees.ts --env=local --mint=${MINT_ADDRESS} --wallet="${CREATOR_WALLET_PATH}"

# Step 9: Harvest fees
echo -e "${BLUE}Harvesting fees...${NC}"
ts-node src/scripts/token/harvest-fees.ts --env=local --mint=${MINT_ADDRESS} --wallet="${CREATOR_WALLET_PATH}"

# Step 10: Check token extensions again after harvesting
echo -e "${BLUE}Checking token extensions after harvesting fees...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=local --mint=${MINT_ADDRESS} --wallet="${CREATOR_WALLET_PATH}"

echo -e "${GREEN}=== Test completed successfully! ===${NC}" 