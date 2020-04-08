#!/usr/bin/env node

const algosdk = require('algosdk');
const {getHomeFolder} = require('platform-folders');
const {join} = require('path');
const fs = require('fs');
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });

const ALGOD_ADDRESS = 'http://127.0.0.1';
const ALGOD_PORT = 4001;
const ALGOD_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const dataFile = join(getHomeFolder(), '.a2f');
const algod = new algosdk.Algod(ALGOD_TOKEN, ALGOD_ADDRESS, ALGOD_PORT);

const repeat = (func) => new Promise(resolve => {
    const task = setInterval(async () => {
        const result = await func();
        if (result === undefined)
            return;

        clearInterval(task);
        resolve(result);
    }, 4000)
});

(async () => {
    if (!fs.existsSync(dataFile)) {
        console.log("Unable to locate existing user data... Running first time setup");
        const account = algosdk.generateAccount();

        // Wait for the user to use dispenser.
        console.log(`\nPlease visit https://bank.testnet.algorand.network/ to fund your account.\nYour address is ${account.addr}.`);
        await repeat(async () => {
            const info = await algod.accountInformation(account.addr);
            if (info.amount !== 0)
                return true;
            process.stdout.write('.');
        });
        console.log();

        // Create asset
        process.stdout.write('\nCreating verification asset.');
        const params = await algod.getTransactionParams();
        const createTxn = algosdk.makeAssetCreateTxn(
            account.addr,
            params.fee, params.lastRound, params.lastRound + 50,
            undefined, params.genesishashb64, params.genesisID,
            1e6, 0, false,
            account.addr, '', account.addr, account.addr,
            account.addr.substring(0, 8),
            'a2f-' + account.addr.substring(0, 8),
            'https://algorand.com', undefined
        );
        const sCreateTxn = createTxn.signTxn(account.sk);
        await algod.sendRawTransaction(sCreateTxn);

        const asset = await repeat(async () => {
            const info = await algod.accountInformation(account.addr);
            if (info.assets)
                return parseInt(Object.keys(info.assets)[0]);
            process.stdout.write('.')
        });
        console.log();

        const rawData = {
            account: algosdk.secretKeyToMnemonic(account.sk),
            asset,
            providers: {},
        };
        fs.writeFileSync(dataFile, JSON.stringify(rawData));

        console.log('Completed first time setup.\n');
    }

    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    data.account = algosdk.mnemonicToSecretKey(data.account);

    const help = () => {
        console.log('Algorand 2 Factor Demo');
        console.log('<description>');
        console.log('Commands:');
        console.log('  providers : View a list of authorized providers.');
        console.log('  add : Authorize a new provider.');
        console.log('  remove [name] : Remove an authorized provider.');
        console.log('  verify [name] : Verify a provider.');
        console.log('  debug (-mnemonic) : View debug information about your Algorand account.');
    }

    const providers = () => {
        console.log('Authorized Providers:');
        Object.keys(data.providers).forEach(provider => console.log('  ' + provider));
    }

    const add = async () => {
        console.log('\nYour code (asset id) is: ' + data.asset);
        console.log('This will be required for setup.\n');
        process.stdout.write('Waiting for provider information.');
        let lastCheck = -1;
        const provider = await repeat(async () => {
            process.stdout.write('.');
            const params = await algod.getTransactionParams();
            if (lastCheck === -1)
                lastCheck = params.lastRound - 1;

            const txns = await algod.transactionByAddress(data.account.addr, lastCheck, params.lastRound);
            lastCheck = params.lastRound;

            if (!txns.transactions)
                return;
            for (let i = 0; i < txns.transactions.length; i++) {
                const txn = txns.transactions[i];
                //todo better filtering is likely possible
                if (txn.type !== 'axfer' || txn.curxfer.rcv !== data.account.addr || txn.curxfer.amt !== 0 || !txn.note)
                    continue;
                const note = new TextDecoder().decode(txn.note);
                return {
                    address: txn.from,
                    name: note,
                };
            }
        });
        console.log();

        const auth = await new Promise(
            resolve => rl.question('Provider \'' + provider.name + '\' has initiated authorization. Accept provider? (y/n)',
                    ans => resolve(ans.toLowerCase() === 'y')));
        if (!auth) {
            console.log('Ignored.');
            return await add();
        }

        console.log("Approved.");
        data.providers[provider.name] = provider.address;

        const params = await algod.getTransactionParams();
        const approvalTxn = algosdk.makeAssetTransferTxn(
            data.account.addr, provider.address,
            undefined, undefined,
            params.fee, 0,
            params.lastRound, params.lastRound + 1000,
            undefined, params.genesishashb64, params.genesisID,
            data.asset
        );

        const sApprovalTxn = approvalTxn.signTxn(data.account.sk);
        await algod.sendRawTransaction(sApprovalTxn);
    }

    const remove = (args) => {
        if (args.length === 0)
            console.log('Missing required \'name\' argument!');
        else if (data.providers[args[0]] === undefined)
            console.log('Unknown provider ' + args[0] + '');
        else delete data.providers[args[0]];
    }

    const verify = async (args) => {
        if (args.length === 0)
            console.log('Missing required \'name\' argument!');
        else if (data.providers[args[0]] === undefined)
            console.log('Unknown provider ' + args[0] + '');
        else {
            const params = await algod.getTransactionParams();
            const providerAddress = data.providers[args[0]];

            const verifyTxn = algosdk.makeAssetTransferTxn(
                data.account.addr, providerAddress,
                undefined, undefined,
                params.fee, 1,
                params.lastRound, params.lastRound + 50,
                undefined, params.genesishashb64, params.genesisID, data.asset
            );

            const sVerifyTxn = verifyTxn.signTxn(data.account.sk);
            await (algod.sendRawTransaction(sVerifyTxn).catch(e => console.error(e)));
            console.log('Sent verification to provider.')
        }
    }

    const debug = async args => {
        const params = await algod.getTransactionParams();
        const info = await algod.accountInformation(data.account.addr);
        const assetBalance = info.assets[data.asset].amount;

        console.log('Running on Algorand ' + params.genesisID);
        console.log('Account: ' + data.account.addr);
        if (args.length !== 0 && args[0] === '-mnemonic')
            console.log('Mnemonic: ' + algosdk.secretKeyToMnemonic(data.account.sk));
        console.log('Balance: ' + info.amount + ' MicroAlgos');
        console.log('Asset Ownership: ' + (assetBalance / 1e4) + '% (' + assetBalance + ')');
    }

    const args = process.argv.slice(2).map(it => it.toLowerCase());
    if (args.length === 0)
        help();
    else switch (args[0]) {
        case 'providers':
        case 'list':
            providers();
            break;
        case 'add':
            await add();
            break;
        case 'remove':
            remove(args.slice(1));
            break;
        case 'verify':
        case 'approve':
            await verify(args.slice(1));
            break;
        case 'debug':
            await debug(args.slice(1));
            break;
        default:
            help();
    }

    data.account = algosdk.secretKeyToMnemonic(data.account.sk);
    fs.writeFileSync(dataFile, JSON.stringify(data));
    rl.close();
})();

