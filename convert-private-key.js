require('dotenv').config();
const bs58 = require('bs58');

// Function to convert array of numbers to base58 private key
function convertArrayToBase58(privateKeyArray) {
    // Convert array of numbers to Uint8Array
    const uint8Array = new Uint8Array(privateKeyArray);
    
    // Convert to base58 string
    const base58PrivateKey = bs58.encode(uint8Array);
    
    return base58PrivateKey;
}

// Get private key array from .env
const privateKeyArray = JSON.parse(process.env.TOKEN_CREATOR_PRIVATE_KEY);

// Convert and display the result
const base58PrivateKey = convertArrayToBase58(privateKeyArray);
console.log('Your base58 private key (import this into Phantom):');
console.log(base58PrivateKey); 