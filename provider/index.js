// provider index.js

const express = require('express');
const algosdk = require('algosdk');

const ALGOD_ADDRESS = 'http://127.0.0.1';
const ALGOD_PORT = 4001;
const ALGOD_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const PROVIDER_NAME = 'test_provider'

if (!process.env.PROVIDER_MNEMONIC) {
    console.error('Missing provider account (hint: set the PROVIDER_MNEMONIC environment variable).');
    process.exit(1);
}

const app = express();
const account = algosdk.mnemonicToSecretKey(process.env.PROVIDER_MNEMONIC);
const accounts = {}

//todo do not serve static
// instead, check for login cookie:
// if present: send logged in page
// else: send login or create account page
app.use(express.static('public'));

app.listen(3000, () => {
    console.log('Example Provider');
    console.log('Name: ' + PROVIDER_NAME);
    console.log('Account: ' + account.addr);
    console.log('URL: http://127.0.0.1:3000/');
});