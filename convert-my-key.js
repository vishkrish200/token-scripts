const bs58 = require('bs58');

// Our private key array
const privateKeyArray = [
  26, 228, 117, 152, 228, 94, 66, 2, 78, 95, 194, 142, 101, 203, 218, 37, 
  119, 124, 252, 47, 146, 138, 117, 51, 163, 87, 167, 61, 66, 253, 45, 109, 
  158, 135, 124, 65, 5, 184, 226, 20, 182, 6, 242, 76, 34, 102, 77, 129, 
  129, 158, 46, 93, 100, 85, 28, 120, 210, 165, 7, 11, 77, 80, 173, 101
];

// Convert array of numbers to Uint8Array
const uint8Array = new Uint8Array(privateKeyArray);

// Convert to base58 string
const base58PrivateKey = bs58.encode(uint8Array);

console.log('Your base58 private key (import this into Phantom):');
console.log(base58PrivateKey); 