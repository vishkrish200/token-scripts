const fs = require('fs');

// Read the wallet file
const walletFile = fs.readFileSync('./wallets/mainnet/wallet-1741151410439.json', 'utf8');
const walletData = JSON.parse(walletFile);

// Extract just the secretKey array
const secretKeyArray = walletData.secretKey;

// Write the secretKey array to a new file
fs.writeFileSync('./wallets/mainnet/private-key-array.json', JSON.stringify(secretKeyArray));

console.log('Private key array extracted and saved to wallets/mainnet/private-key-array.json');
console.log('Public Key:', walletData.publicKey); 