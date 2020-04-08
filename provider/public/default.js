// provider public default.js

const nameInput = document.getElementById('create-username');
const codeInput = document.getElementById('create-code');
const createButton = document.getElementById('create-button');

const loginInput = document.getElementById('login-username');
const loginButton = document.getElementById('login-button')

function lockInput() {
    createButton.disabled = true;
    loginButton.disabled = true;
}

function unlockInput() {
    createButton.disabled = false;
    nameInput.value = '';
    codeInput.value = '';
    loginButton.disabled = false;
    loginInput.value = '';
}

function createAccount() {
    lockInput()
    const name = nameInput.value.toLowerCase();
    const asset = parseInt(codeInput.value);

    const ws = new WebSocket('ws://localhost:3000/account');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'create', name, asset }));

    ws.onclose = event => {
        unlockInput();
        switch (event.code) {
            case 4001:
                alert('Successfully created account! You may now login with your username (' + event.reason + ').');
                break;
            case 4002:
                alert(event.reason);
                break;
            default:
                alert('An unknown error has occurred. Check the console for more info!');
                console.error('An unknown error has occurred: Exit code ' + event.code);
                console.error(event.reason);
        }
    }
}

function login() {
    lockInput();
    const name = loginInput.value.toLowerCase();

    const ws = new WebSocket('ws://localhost:3000/account');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'login', name }));

    ws.onclose = event => {
        unlockInput();
        switch (event.code) {
            case 4003:
                document.cookie = 'a2f=' + name + '; path=/';
                window.location.reload();
                break;
            case 4004:
                alert(event.reason);
                break;
            default:
                alert('An unknown error has occurred. Check the console for more info!');
                console.error('An unknown error has occurred: Exit code ' + event.code);
                console.error(event.reason);
        }
    }
}