#!/bin/bash
# Load environment variables
source .env
# Check if the environment variable exists
if [ -z "$TOKEN_CREATOR_PRIVATE_KEY" ]; then
  echo "Error: TOKEN_CREATOR_PRIVATE_KEY environment variable is not set."
  echo "Please create a .env file based on .env.example and set your private key."
  exit 1
fi
# Create token configuration file from environment variables
CONFIG_FILE="token-configs/env-token.json"
# Create the token-configs directory if it doesn't exist
mkdir -p token-configs

# Create the token configuration JSON with explicit metadata extension
cat > $CONFIG_FILE << EOF
{
  "name": "${TOKEN_NAME:-"Env Token"}",
  "symbol": "${TOKEN_SYMBOL:-"ENV"}",
  "decimals": ${TOKEN_DECIMALS:-9},
  "initialSupply": ${TOKEN_INITIAL_SUPPLY:-1000000},
  "feeBasisPoints": ${TOKEN_FEE_BASIS_POINTS:-100},
  "maxFee": ${TOKEN_MAX_FEE:-10},
  "metadata": {
    "name": "${TOKEN_NAME:-"Env Token"}",
    "symbol": "${TOKEN_SYMBOL:-"ENV"}",
    "description": "${TOKEN_METADATA_DESCRIPTION:-"A token created from environment variables"}",
    "uri": "${TOKEN_METADATA_URI:-""}",
    "isMutable": true
  }
}
EOF
echo "Created token configuration file: $CONFIG_FILE"
cat $CONFIG_FILE
# Create the token using the configuration file and environment variable for the private key
echo "Creating token on mainnet with metadata..."
# Add --keep-mint-authority flag to retain authority for metadata creation
npm run create-token-from-config:mainnet -- --private-key-env=TOKEN_CREATOR_PRIVATE_KEY --config=$CONFIG_FILE

# Note: The mint authority will be automatically revoked after metadata creation
echo "Done!" 