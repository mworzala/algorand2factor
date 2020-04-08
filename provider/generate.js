// provider generate.js

const algosdk = require('algosdk');

const account = algosdk.generateAccount();

console.log('Generated new account!');
console.log('Address: ' + account.addr);
console.log('Mnemonic: ' + algosdk.secretKeyToMnemonic(account.sk));

console.log('Note: The account may be funded on TestNet at the following url: https://bank.testnet.algorand.network/')