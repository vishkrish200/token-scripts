#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Testing Token Fee Collection on Local Validator ===${NC}"

# Configuration
ENV="http://localhost:8899"  # Use the full URL instead of just "local"
CREATOR_PUBKEY="9P9nNFqHTmdGB2uDCs4HgYLhmaEagytFd7eYykiyZvUF"
RECIPIENT_PUBKEY="AffDdWJ8FjvxutDamA34jQbgCEDFhmHgp2izm7wwdLZV"

# Check wallet balances
echo -e "${BLUE}Checking wallet balances...${NC}"
CREATOR_BALANCE=$(solana balance ${CREATOR_PUBKEY} --url ${ENV} | awk '{print $1}')
echo -e "${BLUE}Creator balance: ${CREATOR_BALANCE} SOL${NC}"

RECIPIENT_BALANCE=$(solana balance ${RECIPIENT_PUBKEY} --url ${ENV} | awk '{print $1}')
echo -e "${BLUE}Recipient balance: ${RECIPIENT_BALANCE} SOL${NC}"

# Ask for the mint address
echo -e "${BLUE}Enter the mint address of the token you want to transfer:${NC}"
read MINT_ADDRESS

if [ -z "$MINT_ADDRESS" ]; then
  echo -e "${RED}No mint address provided. Exiting.${NC}"
  exit 1
fi

# Create temporary private key files in the correct format
TEMP_DIR=$(mktemp -d)
CREATOR_KEY_FILE="${TEMP_DIR}/creator_key.json"
RECIPIENT_KEY_FILE="${TEMP_DIR}/recipient_key.json"

# Extract the private key arrays from the wallet files
CREATOR_KEY=$(cat wallets/devnet/creator-wallet-array.json)
RECIPIENT_KEY=$(cat wallets/devnet/recipient-wallet-array.json)

# Write the keys to temporary files
echo $CREATOR_KEY > $CREATOR_KEY_FILE
echo $RECIPIENT_KEY > $RECIPIENT_KEY_FILE

echo -e "${BLUE}Created temporary key files in ${TEMP_DIR}${NC}"

# Check token extensions to verify transfer fee is enabled
echo -e "${BLUE}Checking token extensions...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=local --mint=${MINT_ADDRESS} --wallet="creator-wallet"

# Transfer tokens to the recipient using the private key file with the fixed script
echo -e "${BLUE}Transferring tokens to recipient...${NC}"
ts-node src/scripts/token/transfer-checked.ts --env=local --private-key-file=${CREATOR_KEY_FILE} --mint=${MINT_ADDRESS} --recipient=${RECIPIENT_PUBKEY} --amount=10

# Check token extensions again to see balances
echo -e "${BLUE}Checking token extensions after transfer...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=local --mint=${MINT_ADDRESS} --wallet="creator-wallet"

# Transfer tokens back to test more fee collection
echo -e "${BLUE}Transferring tokens back to creator...${NC}"
ts-node src/scripts/token/transfer-checked.ts --env=local --private-key-file=${RECIPIENT_KEY_FILE} --mint=${MINT_ADDRESS} --recipient=${CREATOR_PUBKEY} --amount=1

# Check withheld fees
echo -e "${BLUE}Checking withheld fees...${NC}"
ts-node src/scripts/token/check-withheld-fees.ts --env=local --mint=${MINT_ADDRESS} --wallet="creator-wallet"

# Harvest fees
echo -e "${BLUE}Harvesting fees...${NC}"
ts-node src/scripts/token/harvest-fees.ts --env=local --mint=${MINT_ADDRESS} --wallet="creator-wallet"

# Check token extensions again after harvesting
echo -e "${BLUE}Checking token extensions after harvesting fees...${NC}"
ts-node src/scripts/token/check-token-extensions.ts --env=local --mint=${MINT_ADDRESS} --wallet="creator-wallet"

# Clean up temporary files
rm -rf $TEMP_DIR

echo -e "${GREEN}=== Test completed successfully! ===${NC}" 