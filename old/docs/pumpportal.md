Transaction API Docs
To get a transaction for signing and sending with a custom RPC, send a POST request to

https://pumpportal.fun/api/trade-local

Your request body must contain the following options:

publicKey: Your wallet public key
action: "buy" or "sell"
mint: The contract address of the token you want to trade (this is the text after the '/' in the pump.fun url for the token.)
amount: The amount of SOL or tokens to trade. If selling, amount can be a percentage of tokens in your wallet (ex. amount: "100%")
denominatedInSol: "true" if amount is SOL, "false" if amount is tokens
slippage: The percent slippage allowed
priorityFee: Amount to use as priority fee
pool: (optional) Currently 'pump', 'raydium', 'pump-amm', 'launchlab', 'raydium-cpmm', 'bonk', and 'auto' are supported options. Default is 'pump'.
If your parameters are valid, you will receive a serialized transaction in response. See the examples below for how to send this transaction with Python (Solders) or JavaScript (Web3.js).

Examples
Python
JavaScript
import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import bs58 from "bs58";

const RPC_ENDPOINT = "Your RPC Endpoint";
const web3Connection = new Connection(
    RPC_ENDPOINT,
    'confirmed',
);

async function sendPortalTransaction(){
  const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
      method: "POST",
      headers: {
          "Content-Type": "application/json"
      },
      body: JSON.stringify({
          "publicKey": "your-public-key",  // Your wallet public key
          "action": "buy",                 // "buy" or "sell"
          "mint": "token-ca-here",         // contract address of the token you want to trade
          "denominatedInSol": "false",     // "true" if amount is amount of SOL, "false" if amount is number of tokens
          "amount": 1000,                  // amount of SOL or tokens
          "slippage": 10,                  // percent slippage allowed
          "priorityFee": 0.00001,          // priority fee
          "pool": "auto"                   // exchange to trade on. "pump", "raydium", "pump-amm", 'launchlab', 'raydium-cpmm', 'bonk' or "auto"
      })
  });
  if(response.status === 200){ // successfully generated transaction
      const data = await response.arrayBuffer();
      const tx = VersionedTransaction.deserialize(new Uint8Array(data));
      const signerKeyPair = Keypair.fromSecretKey(bs58.decode("your-wallet-private-key"));
      tx.sign([signerKeyPair]);
      const signature = await web3Connection.sendTransaction(tx)
      console.log("Transaction: https://solscan.io/tx/" + signature);
  } else {
      console.log(response.statusText); // log error
  }
}

sendPortalTransaction();


---

Pump.fun Token Creation
You can create tokens via the pump.fun API.

There is no additional fee for token creation. The standard trading fee is applied to the initial dev buy.

Examples below:

Local Transaction Examples:
Python
JavaScript
import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import bs58 from "bs58";

const RPC_ENDPOINT = "Your RPC Endpoint";
const web3Connection = new Connection(
    RPC_ENDPOINT,
    'confirmed',
);

async function sendLocalCreateTx(){
    const signerKeyPair = Keypair.fromSecretKey(bs58.decode("your-wallet-private-key"));

    // Generate a random keypair for token
    const mintKeypair = Keypair.generate(); 

    // Define token metadata
    const formData = new FormData();
    formData.append("file", await fs.openAsBlob("./example.png")), // Image file
    formData.append("name", "PPTest"),
    formData.append("symbol", "TEST"),
    formData.append("description", "This is an example token created via PumpPortal.fun"),
    formData.append("twitter", "https://x.com/a1lon9/status/1812970586420994083"),
    formData.append("telegram", "https://x.com/a1lon9/status/1812970586420994083"),
    formData.append("website", "https://pumpportal.fun"),
    formData.append("showName", "true");

    // Create IPFS metadata storage
    const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        body: formData,
    });
    const metadataResponseJSON = await metadataResponse.json();

    // Get the create transaction
    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "publicKey": 'your-wallet-public-key',
            "action": "create",
            "tokenMetadata": {
                name: metadataResponseJSON.metadata.name,
                symbol: metadataResponseJSON.metadata.symbol,
                uri: metadataResponseJSON.metadataUri
            },
            "mint": mintKeypair.publicKey.toBase58(),
            "denominatedInSol": "true",
            "amount": 1, // dev buy of 1 SOL
            "slippage": 10, 
            "priorityFee": 0.0005,
            "pool": "pump"
        })
    });
    if(response.status === 200){ // successfully generated transaction
        const data = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        tx.sign([mintKeypair, signerKeyPair]);
        const signature = await web3Connection.sendTransaction(tx)
        console.log("Transaction: https://solscan.io/tx/" + signature);
    } else {
        console.log(response.statusText); // log error
    }
}

sendLocalCreateTx();

### important note for pump token creation

the metadata storage through pump api ipfs so pinata or similar services should be used. 