#!/usr/bin/env node
// client index.js

const algosdk = require('algosdk');
const {getHomeFolder} = require('platform-folders');
const {join} = require('path');
const fs = require('fs');
const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });

// Basic algorand sdk parameters
const ALGOD_ADDRESS = 'http://127.0.0.1';
const ALGOD_PORT = 4001;
const ALGOD_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const dataFile = join(getHomeFolder(), '.a2f');
const algod = new algosdk.Algod(ALGOD_TOKEN, ALGOD_ADDRESS, ALGOD_PORT);

/**
 * Repeat a function until a non-undefined return value occurs.
 *
 * This is a utility function added to remove boilerplate waiting for transactions or other tasks to complete.
 *
 * @param func the function to execute on repeat
 * @returns {Promise<*>} the return value of `func`
 */
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
    // Check if the data file exists, if not we need to run startup (create an account, ensure it is funded, create an asset)
    if (!fs.existsSync(dataFile)) {
        console.log("Unable to locate existing user data... Running first time setup");
        // Generate a new account address and secret.
        const account = algosdk.generateAccount();

        // Wait for the user to use dispenser.
        console.log(`\nPlease visit https://bank.testnet.algorand.network/ to fund your account.\nYour address is ${account.addr}.`);
        await repeat(async () => {
            // Check the user account until it has a non-zero balance.
            // Notably this check is only done once, so the user could run out of algos in the future.
            // A better solution might include this check on startup each time.
            const info = await algod.accountInformation(account.addr);
            if (info.amount !== 0)
                return true;
            process.stdout.write('.');
        });
        console.log();

        // Create asset
        process.stdout.write('\nCreating verification asset.');
        // Algorand SDK transaction flow. More information can be found in the SDK docs
        // https://github.com/algorand/js-algorand-sdk
        const params = await algod.getTransactionParams();
        const createTxn = algosdk.makeAssetCreateTxn(
            account.addr,
            params.fee, params.lastRound, params.lastRound + 50,
            undefined, params.genesishashb64, params.genesisID,
            1e6, 0, false,
            account.addr, '', account.addr, account.addr,
            account.addr.substring(0, 8),
            'a2f-' + account.addr.substring(0, 8),
            'https://github.com/mworzala/algorand2factor', undefined
        );
        const sCreateTxn = createTxn.signTxn(account.sk);
        await algod.sendRawTransaction(sCreateTxn);

        // Wait until the account has an asset associated.
        // This only tests for whether the account has any assets, meaning if the account already
        // has an asset this will not work as expected. This does not matter for this implementation,
        // because the account may not be user provided.
        const asset = await repeat(async () => {
            const info = await algod.accountInformation(account.addr);
            if (info.assets)
                return parseInt(Object.keys(info.assets)[0]);
            process.stdout.write('.')
        });
        console.log();

        // Save the user data with the following format:
        /*
            {
                account: Account Mnemonic,
                asset: Asset Index,
                providers: {
                    "Provider Name": Provider Address,
                    ...
                }
            }
         */
        const rawData = {
            account: algosdk.secretKeyToMnemonic(account.sk),
            asset,
            providers: {},
        };
        fs.writeFileSync(dataFile, JSON.stringify(rawData));

        console.log('Completed first time setup.\n');
    }

    // Read the account data on startup.
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    // Convert the account field in the data object from the mnemonic to the address and private key.
    data.account = algosdk.mnemonicToSecretKey(data.account);

    // Display a help menu listing all of the available commands
    const help = () => {
        console.log('Algorand 2 Factor Demo');
        console.log('A two-factor client built on top of the Algorand blockchain.');
        console.log('Commands:');
        console.log('  providers : View a list of authorized providers.');
        console.log('  add : Authorize a new provider.');
        console.log('  remove [name] : Remove an authorized provider.');
        console.log('  verify [name] : Verify a provider.');
        console.log('  debug (-mnemonic) : View debug information about your Algorand account.');
    }

    // list the providers currently authorized.
    const providers = () => {
        console.log('Authorized Providers:');
        Object.keys(data.providers).forEach(provider => console.log('  ' + provider));
    }

    // Add a new provider
    const add = async () => {
        console.log('\nYour code (asset id) is: ' + data.asset);
        console.log('This will be required for setup.\n');
        process.stdout.write('Waiting for provider information.');

        // The following `repeat` block implements a rolling check of all blocks after it was initiated.
        let lastCheck = -1;
        const provider = await repeat(async () => {
            process.stdout.write('.');
            const params = await algod.getTransactionParams();
            if (lastCheck === -1)
                lastCheck = params.lastRound - 1;

            // Get all transactions between the last check and the current check (rolling check).
            const txns = await algod.transactionByAddress(data.account.addr, lastCheck, params.lastRound);
            lastCheck = params.lastRound;

            // Return if there are no transactions related to the client address.
            if (!txns.transactions)
                return;
            for (let i = 0; i < txns.transactions.length; i++) {
                const txn = txns.transactions[i];
                // Exit if the transaction is:
                //    An asset transfer (axfer)
                //    Sent to the client address
                //    An amount of zero asset units
                //    There is a note field.
                if (txn.type !== 'axfer' || txn.curxfer.rcv !== data.account.addr || txn.curxfer.amt !== 0 || !txn.note)
                    continue;
                // Decode the note field, this is the provider name.
                const note = new TextDecoder().decode(txn.note);
                return {
                    address: txn.from,
                    name: note,
                };
            }
        });
        console.log();

        // Prompt the user to accept the provider.
        const auth = await new Promise(
            resolve => rl.question('Provider \'' + provider.name + '\' has initiated authorization. Accept provider? (y/n)',
                    ans => resolve(ans.toLowerCase() === 'y')));
        if (!auth) {
            console.log('Ignored.');
            return await add();
        }

        console.log("Approved.");
        data.providers[provider.name] = provider.address;

        // Send a 0 asset transaction back to the provider indicating acceptance.
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

    // Remove an authorized provider.
    const remove = (args) => {
        if (args.length === 0)
            console.log('Missing required \'name\' argument!');
        else if (data.providers[args[0]] === undefined)
            console.log('Unknown provider ' + args[0] + '');
        else delete data.providers[args[0]];
    }

    // Verify (login) to an authorized provider.
    const verify = async (args) => {
        if (args.length === 0)
            console.log('Missing required \'name\' argument!');
        else if (data.providers[args[0]] === undefined)
            console.log('Unknown provider ' + args[0] + '');
        else {
            // Send a transaction to the client of 1 asset unit.
            // There are multiple flaws with this implementation discussed in the accompanying article.
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
            console.log('Sent verification to provider.');
        }
    }

    // Print some debug information about the client and it's holdings.
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

    // A very simple case-insensitive command handler.
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

    // Save the data file, since it may have been modified by the commands.
    data.account = algosdk.secretKeyToMnemonic(data.account.sk);
    fs.writeFileSync(dataFile, JSON.stringify(data));
    rl.close();
})();

