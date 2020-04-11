// provider index.js

const express = require('express');
const algosdk = require('algosdk');
const { join } = require('path');
const WebSocket = require('ws')

const ALGOD_ADDRESS = 'http://127.0.0.1';
const ALGOD_PORT = 4001;
const ALGOD_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const PROVIDER_NAME = 'test_provider'

if (!process.env.PROVIDER_MNEMONIC) {
    console.error('Missing provider account (hint: set the PROVIDER_MNEMONIC environment variable).');
    process.exit(1);
}

const publicDir = join(__dirname, 'public');
const app = express();
const algod = new algosdk.Algod(ALGOD_TOKEN, ALGOD_ADDRESS, ALGOD_PORT);
const account = algosdk.mnemonicToSecretKey(process.env.PROVIDER_MNEMONIC);
const accounts = {};

app.use(require('cookie-parser')());

app.get('/', (req, res) => {
    if (req.cookies.a2f)
        res.sendFile('restricted.html', { root: publicDir });
    else res.sendFile('default.html', { root: publicDir });
});

app.get('/default.js', (req, res) => res.sendFile('default.js', { root: publicDir }));

const server = app.listen(3000, () => {
    console.log('Example Provider');
    console.log('Name: ' + PROVIDER_NAME);
    console.log('Account: ' + account.addr);
    console.log('URL: http://127.0.0.1:3000/');
});

const createServer = new WebSocket.Server({ server, path: '/account' });

createServer.on('connection', ws => {
    /*
    Close Codes:
    4000: unknown error
    4001: create success
    4002: create error
    4003: login success
    4004: login error
     */

    ws.on('message', async msg => {
        const data = JSON.parse(msg);

        if (data.type === 'create') {
            const { name, asset } = data;

            if (accounts[name] !== undefined) {
                ws.close(4002, 'Account name in use');
                return;
            }

            let assetInfo;
            try {
                assetInfo = await algod.assetInformation(asset);
            } catch (e) {
                ws.close(4002, 'Failed to locate asset');
                return;
            }

            // Opt into asset
            const params = await algod.getTransactionParams();
            const optInTxn = algosdk.makeAssetTransferTxn(
                account.addr, account.addr,
                undefined, undefined,
                params.fee, 0,
                params.lastRound, params.lastRound + 50,
                undefined, params.genesishashb64, params.genesisID,
                asset, await algod.getTransactionParams()
            );
            const sOptInTxn = optInTxn.signTxn(account.sk);
            await algod.sendRawTransaction(sOptInTxn);

            // Send authorization request to client
            const confirmTxn = algosdk.makeAssetTransferTxn(
                account.addr, assetInfo.creator,
                undefined, undefined,
                params.fee, 0,
                params.lastRound, params.lastRound + 50,
                new TextEncoder().encode(PROVIDER_NAME),
                params.genesishashb64, params.genesisID,
                asset, await algod.getTransactionParams()
            );
            const sConfirmTxn = confirmTxn.signTxn(account.sk);
            await algod.sendRawTransaction(sConfirmTxn);

            // Wait for acceptance
            let lastCheck = -1, count = 0;
            const task = setInterval(async () => {
                if (++count === 150) // time out after ~10 minutes
                    clearInterval(task);

                const params = await algod.getTransactionParams();
                if (lastCheck === -1)
                    lastCheck = params.lastRound - 1;

                const txns = await algod.transactionByAddress(account.addr, lastCheck, params.lastRound);
                lastCheck = params.lastRound;

                if (!txns.transactions)
                    return;
                for (let i = 0; i < txns.transactions.length; i++) {
                    const txn = txns.transactions[i];
                    if (txn.type !== 'axfer' || txn.from !== assetInfo.creator || txn.curxfer.rcv !== account.addr || txn.curxfer.amt !== 0)
                        continue;

                    // approved
                    clearInterval(task);
                    accounts[name] = asset;
                    console.log('\nAdded account \'' + name + '\' with asset ' + asset);
                    ws.close(4001, name);
                }
            }, 4000);

            if (count === 150) ws.close(4002, 'Timeout');
        } else if (data.type === 'login') {
            const { name } = data;

            const asset = accounts[name];
            if (asset === undefined) {
                ws.close(4004, 'Unknown account: ' + name);
                return;
            }

            const assetInfo = await algod.assetInformation(asset);

            console.log('Found account, waiting for verification')

            let lastCheck = -1, count = 0;
            const task = setInterval(async () => {
                if (++count === 150)
                    clearInterval(task);

                const params = await algod.getTransactionParams();
                if (lastCheck === -1)
                    lastCheck = params.lastRound - 1;
                const txns = await algod.transactionByAddress(account.addr, lastCheck, params.lastRound);
                lastCheck = params.lastRound;

                if (!txns.transactions)
                    return;
                for (let i = 0; i < txns.transactions.length; i++) {
                    const txn = txns.transactions[i];
                    if (txn.type !== 'axfer' || txn.from !== assetInfo.creator || txn.curxfer.rcv !== account.addr || txn.curxfer.amt !== 1)
                        continue;

                    clearInterval(task);
                    console.log('Account \'' + name + '\' has logged in.');
                    ws.close(4003, name);

                    // return asset
                    const returnTxn = algosdk.makeAssetTransferTxn(
                        account.addr, assetInfo.creator,
                        undefined, undefined,
                        params.fee, 1,
                        params.lastRound, params.lastRound + 50,
                        undefined, params.genesishashb64, params.genesisID, asset
                    );

                    const sReturnTxn = returnTxn.signTxn(account.sk);
                    await algod.sendRawTransaction(sReturnTxn);
                }
            }, 4000);
            if (count === 150)
                ws.close(40004, "Timeout");
        } else ws.close(4000, 'Unknown message type: ' + data.type);
    })
});