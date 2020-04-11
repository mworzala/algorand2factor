# Algorand Two-Factor
A decentralized two-factor implementation based on Algorand Standard Assets. This code has an associated [Algorand Solutions](https://developer.algorand.org/solutions/decentralized-two-factor-authentication-algorand-standard-assets/) article.

## Components
* `client` A command line app to implement the user (client) side of the two factor interaction.
* `provider` An ExpressJS app to implement the server (provider) side of the two factor protocol.

## Protocol
The two factor protocol discussed in the accompanying article can be seen below. See the article for more information.
![](https://algorand-devloper-portal-app.s3.amazonaws.com/static/EditorImages/2020/04/10%2018%3A36/a2f_r1.png)

## Usage
Both projects are written with Javascript (NodeJS) using NPM, so both should be installed.

### Client
```shell script
npm install
sudo npm link
a2f
```

### Provider
```shell script
npm install
npm start
```