# PowerShell Test Commands


## Wallet & Balance Quick Commands (PowerShell)

```powershell
# Create 1 wallet
$createBody = @{ count = 1 } | ConvertTo-Json
$w = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/wallet/create" -Method POST -ContentType "application/json" -Body $createBody
$w | ConvertTo-Json -Depth 6
$pub  = $w.data[0].publicKey
$priv = $w.data[0].privateKey   # Base58; use only for signing calls
$pub; $priv

# Create multiple (3) wallets
$w3 = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/wallet/create" -Method POST -ContentType "application/json" -Body (@{ count = 3 } | ConvertTo-Json)
$w3 | ConvertTo-Json -Depth 6

# SOL balance for a wallet
$pk = $pub  # or set explicitly: $pk = "<PUBLIC_KEY>"
$solBal = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/wallet/$pk/balance/sol" -Method GET
$solBal | ConvertTo-Json -Depth 6

# SPL token balance for a wallet
$mint = "<MINT_ADDRESS>"
$wallet = $pk  # or set explicitly
$splBal = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/spl/$mint/balance/$wallet" -Method GET
$splBal | ConvertTo-Json -Depth 6
```

## Sign, send and review transactions

> Replace the placeholder values with your keys. Strings must be quoted.

```powershell
# 1) Build unsigned SOL transfer
$from = "<FROM_PUBLIC_KEY>"
$to   = "<TO_PUBLIC_KEY>"
$amt  = 0.0001

$body = @{ fromPublicKey = $from; toPublicKey = $to; amountSol = $amt } | ConvertTo-Json
$unsignedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/sol/get-transfer-transaction" -Method POST -ContentType "application/json" -Body $body
$unsignedResp | ConvertTo-Json -Depth 6
$unsignedTx = $unsignedResp.data.unsignedTx
$unsignedTx

# 2) Sign (Base58 private key)
$priv = "<BASE58_PRIVATE_KEY>"
$signBody = @{ unsignedTx = $unsignedTx; privateKey = $priv } | ConvertTo-Json
$signedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/sign-transaction" -Method POST -ContentType "application/json" -Body $signBody
$signedResp | ConvertTo-Json -Depth 6
$signedTx = $signedResp.data.signedTx
$signedTx

# 3) Send
$sendBody = @{ signedTx = $signedTx } | ConvertTo-Json
$sendResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/send-transaction" -Method POST -ContentType "application/json" -Body $sendBody
$sendResp | ConvertTo-Json -Depth 6
$signature = $sendResp.data.signature
$signature

# 4) Poll status (retry up to 12x with 2s delay)
$attempts = 12
for ($i = 0; $i -lt $attempts; $i++) {
  try {
    $statusResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/transaction-status/$signature" -Method GET
    $status = $statusResp.data.status
    $statusResp | ConvertTo-Json -Depth 6
    if ($status -eq "confirmed" -or $status -eq "finalized" -or $status -eq "failed") { break }
  } catch { }
  Start-Sleep -Seconds 2
}

## Notes
- PowerShell does not print variable assignments by default. Print with `$var` or `| ConvertTo-Json`.
- Quote long Base64 strings when building hashtables.
- Correct quoting for status URL: use `$signature` inside the string; avoid nested quotes like `".../status/"$signature""`.
- Solana recent blockhashes expire after ~2 minutes. If you wait too long between steps, rebuild the unsigned tx.
- If the send returns a signature but later fails, use the status endpoint to see `failed`.

## Advanced Diagnostic (timed fast-path)

```powershell
# Measures timings, enforces a TTL guard between build -> sign -> send, and prints a compact timeline.
# 1) Fill in your keys
$from = "<FROM_PUBLIC_KEY>"
$to   = "<TO_PUBLIC_KEY>"
$priv = "<BASE58_PRIVATE_KEY>"
$amt  = 0.0001

# 2) Params
$ttlSeconds = 60   # hard guard between unsigned build and send
$statusAttempts = 15
$statusDelaySec = 2

# 3) Priority fee controls (optional)
$computeUnits = 200000         # 200k CUs
$microLamports = 10000         # 10k micro-lamports per CU (as per quicknode)
$rentTopUp = $true             # include recipient rent top-up if needed (set $false to skip)

$sw = [System.Diagnostics.Stopwatch]::StartNew()
function ts { return "[$([DateTime]::UtcNow.ToString('HH:mm:ss.fff')) + 'Z' | Out-String]".Trim() }

Write-Host "$(ts) Start diagnostic"

# Build unsigned
$t0 = $sw.Elapsed.TotalSeconds
# Include optional priority fee params and rent toggle
$body = @{ fromPublicKey = $from; toPublicKey = $to; amountSol = $amt; computeUnits = $computeUnits; microLamports = $microLamports; rentTopUp = $rentTopUp } | ConvertTo-Json
$unsignedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/sol/get-transfer-transaction" -Method POST -ContentType "application/json" -Body $body
$unsignedTx = $unsignedResp.data.unsignedTx
Write-Host "$(ts) Built unsigned tx (len=$($unsignedTx.Length))"

# Sign
$t1 = $sw.Elapsed.TotalSeconds
if (($t1 - $t0) -gt $ttlSeconds) { throw "TTL guard tripped after build. Rebuild unsigned tx and try again quickly." }
$signBody = @{ unsignedTx = $unsignedTx; privateKey = $priv } | ConvertTo-Json
$signedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/sign-transaction" -Method POST -ContentType "application/json" -Body $signBody
$signedTx = $signedResp.data.signedTx
Write-Host "$(ts) Signed tx (len=$($signedTx.Length))"

# Send
$t2 = $sw.Elapsed.TotalSeconds
if (($t2 - $t0) -gt $ttlSeconds) { throw "TTL guard tripped before send. Rebuild unsigned tx and retry promptly." }
$sendBody = @{ signedTx = $signedTx } | ConvertTo-Json
$sendResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/send-transaction" -Method POST -ContentType "application/json" -Body $sendBody
$signature = $sendResp.data.signature
Write-Host "$(ts) Sent tx -> signature: $signature"

# Poll status
$timeline = @()
for ($i = 0; $i -lt $statusAttempts; $i++) {
  try {
    $resp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/transaction-status/$signature" -Method GET
    $status = $resp.data.status
    $timeline += "$(ts) [$i] status=$status"
    if ($status -eq "confirmed" -or $status -eq "finalized" -or $status -eq "failed") { break }
  } catch {
    $timeline += "$(ts) [$i] status=request_error"
  }
  Start-Sleep -Seconds $statusDelaySec
}

Write-Host "--- Timeline ---"
$timeline | ForEach-Object { Write-Host $_ }
Write-Host "$(ts) Done (total ${([math]::Round($sw.Elapsed.TotalSeconds,2))}s)"

### Tips
- Keep build → sign → send under ~60s to avoid blockhash expiry.
- If TTL guard trips, immediately rebuild the unsigned tx and retry without delays.
- If status stays `pending` for >30s, share the timeline output so we can compare send/confirm behavior.
```

## Advanced SOL Transfer (batched one-call)

```powershell
# One call: build, sign (in-memory), send, confirm, and return pre/post balances.
# WARNING: This will spend real SOL on mainnet if your RPC points to mainnet. Double-check $amt.

$from = "<FROM_PUBLIC_KEY>"
$to   = "<TO_PUBLIC_KEY>"
$priv = "<BASE58_PRIVATE_KEY>"  # must match $from
$amt  = 0.0001

# Optional priority fee controls and commitment
$computeUnits = 200000
$microLamports = 10000
$commitment = "confirmed"  # or "finalized"

$body = @{
  fromPublicKey = $from
  toPublicKey   = $to
  amountSol     = $amt
  privateKey    = $priv
  computeUnits  = $computeUnits
  microLamports = $microLamports
  commitment    = $commitment
} | ConvertTo-Json

$resp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/sol/advanced-transfer" -Method POST -ContentType "application/json" -Body $body
$resp | ConvertTo-Json -Depth 8

$signature = $resp.data.signature
$signature

# Optional: cross-check status via status endpoint (especially if you requested finalized commitment)
$attempts = 15
$statusDelaySec = 2
for ($i = 0; $i -lt $attempts; $i++) {
  try {
    $s = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/transaction-status/$signature" -Method GET
    $stat = $s.data.status
    Write-Host "[$i] status=$stat"
    if ($stat -eq "confirmed" -or $stat -eq "finalized" -or $stat -eq "failed") { break }
  } catch { }
  Start-Sleep -Seconds $statusDelaySec
}

# Inspect balances returned by the advanced endpoint
$resp.data.preBalances  | ConvertTo-Json -Depth 6
$resp.data.postBalances | ConvertTo-Json -Depth 6
```

## Upload: Pinata image (base64)

```powershell
# Requires PINATA_JWT in environment: $env:PINATA_JWT = "<TOKEN>"
$filePath = "C:\path\to\image.png"
$contentType = "image/png"
$fileName = [System.IO.Path]::GetFileName($filePath)

$bytes = [System.IO.File]::ReadAllBytes($filePath)
$imageBase64 = [System.Convert]::ToBase64String($bytes)

$body = @{ fileName = $fileName; contentType = $contentType; imageBase64 = $imageBase64 } | ConvertTo-Json
$upload = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/upload/pinata-image" -Method POST -ContentType "application/json" -Body $body
$upload | ConvertTo-Json -Depth 6

# Use this ipfsUri as imageUrl for Pump create
$imageUrl = $upload.data.ipfsUri
$imageUrl
```

## Pump.fun (buy/sell/create)

### Buy
```powershell
$buyer = "<BUYER_PUBLIC_KEY>"
$privBuyer = "<BUYER_PRIVATE_KEY_BASE58>"
$mint = "<MINT_ADDRESS>"
$solAmount = 0.001
$slippageBps = 100  # 1%
$priorityFeeSol = 0.0005  # optional override

$body = @{ buyerPublicKey = $buyer; mintAddress = $mint; solAmount = $solAmount; slippageBps = $slippageBps; priorityFeeSol = $priorityFeeSol } | ConvertTo-Json
$unsignedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pump/get-buy-transaction" -Method POST -ContentType "application/json" -Body $body
$unsignedTx = $unsignedResp.data.unsignedTx

$signBody = @{ unsignedTx = $unsignedTx; privateKey = $privBuyer } | ConvertTo-Json
$signedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/sign-transaction" -Method POST -ContentType "application/json" -Body $signBody
$signedTx = $signedResp.data.signedTx

$sendResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/send-transaction" -Method POST -ContentType "application/json" -Body (@{ signedTx = $signedTx } | ConvertTo-Json)
$signature = $sendResp.data.signature
$signature
```

### Sell
```powershell
$seller = "<SELLER_PUBLIC_KEY>"
$privSeller = "<SELLER_PRIVATE_KEY_BASE58>"
$mint = "<MINT_ADDRESS>"
$tokenAmount = "100%"   # or a numeric string like "123456.789"
$slippageBps = 100
$priorityFeeSol = 0.0005  # optional override

$body = @{ sellerPublicKey = $seller; mintAddress = $mint; tokenAmount = $tokenAmount; slippageBps = $slippageBps; priorityFeeSol = $priorityFeeSol } | ConvertTo-Json
$unsignedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pump/get-sell-transaction" -Method POST -ContentType "application/json" -Body $body
$unsignedTx = $unsignedResp.data.unsignedTx

$signBody = @{ unsignedTx = $unsignedTx; privateKey = $privSeller } | ConvertTo-Json
$signedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/sign-transaction" -Method POST -ContentType "application/json" -Body $signBody
$signedTx = $signedResp.data.signedTx

$sendResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/send-transaction" -Method POST -ContentType "application/json" -Body (@{ signedTx = $signedTx } | ConvertTo-Json)
$signature = $sendResp.data.signature
$signature
```

### Create (unsigned build, then multi-sign)
```powershell
# Provide your FUNDED creator wallet (Base58 private key). Do NOT auto-generate.
$creatorPub  = "<CREATOR_PUBLIC_KEY>"
$creatorPriv = "<CREATOR_PRIVATE_KEY_BASE58>"

# Mint keypair: either provide your own, or generate just the mint via the wallet endpoint.
# Option A: Provide your own mint keys
# $mintPub  = "<MINT_PUBLIC_KEY>"
# $mintPriv = "<MINT_PRIVATE_KEY_BASE58>"

# Option B: Generate only the mint (new keypair) for convenience
$wMint = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/wallet/create" -Method POST -ContentType "application/json" -Body (@{ count = 1 } | ConvertTo-Json)
$mintPub  = $wMint.data[0].publicKey
$mintPriv = $wMint.data[0].privateKey

$creatorPub; $mintPub

# Image/metadata handling
# If you ran the Upload section above, reuse its result:
# $imageUrl is already set from the upload step (ipfs://CID)
# Otherwise, provide a direct URL as a fallback:
if (-not $imageUrl) { $imageUrl = "https://raw.githubusercontent.com/github/explore/main/topics/solana/solana.png" }

# Provide a pre-hosted metadataUri OR set PINATA_JWT env var to auto-upload JSON metadata.
$metadataUri = $null    # e.g., "ipfs://<CID>"; leave $null to use Pinata (requires $env:PINATA_JWT)

$body = @{
  creatorPublicKey = $creatorPub
  mintPublicKey    = $mintPub
  name             = "My Pump Token"
  symbol           = "MPT"
  description      = "Created via Primitives API"
  imageUrl         = $imageUrl
  metadataUri      = $metadataUri
  devBuyAmount     = 0.001
  slippageBps      = 100
  priorityFeeSol   = 0.0005
} | ConvertTo-Json

$unsignedResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pump/get-create-transaction" -Method POST -ContentType "application/json" -Body $body
$unsignedTx = $unsignedResp.data.unsignedTx

# Multi-sign: sign with creator and mint. The order shouldn't matter for v0 txs.
$signed1 = (Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/sign-transaction" -Method POST -ContentType "application/json" -Body (@{ unsignedTx = $unsignedTx; privateKey = $creatorPriv } | ConvertTo-Json)).data.signedTx
$signed2 = (Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/sign-transaction" -Method POST -ContentType "application/json" -Body (@{ unsignedTx = $signed1;    privateKey = $mintPriv    } | ConvertTo-Json)).data.signedTx

$sendResp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/send-transaction" -Method POST -ContentType "application/json" -Body (@{ signedTx = $signed2 } | ConvertTo-Json)
$signature = $sendResp.data.signature
$signature

# Status
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/transaction-status/$signature" -Method GET | ConvertTo-Json -Depth 6
```

> Notes for create:
> - If you do not set `$env:PINATA_JWT`, you must provide `metadataUri`. Otherwise the create call will error.
> - The create transaction typically requires both creator and mint signatures. Our `/blockchain/sign-transaction` supports adding signatures sequentially.
> - Keep build → sign → send under ~60s to avoid blockhash expiry.
> - In `.env`, define `PINATA_JWT` without spaces or quotes: `PINATA_JWT=<TOKEN>`. Alternatively set at runtime: `$env:PINATA_JWT = "<TOKEN>"`.

## Pump.fun Advanced (one-call flows)

### Advanced Buy (build → sign → send → confirm)
```powershell
# WARNING: Real mainnet transaction if your RPC points to mainnet.
$buyer = "<BUYER_PUBLIC_KEY>"
$privBuyer = "<BUYER_PRIVATE_KEY_BASE58>"
$mint = "<MINT_ADDRESS>"
$solAmount = 0.001
$slippageBps = 100
$priorityFeeSol = 0.0005
$commitment = "confirmed"   # or "finalized"

$body = @{
  buyerPublicKey = $buyer
  mintAddress    = $mint
  solAmount      = $solAmount
  slippageBps    = $slippageBps
  priorityFeeSol = $priorityFeeSol
  privateKey     = $privBuyer
  commitment     = $commitment
} | ConvertTo-Json

$resp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pump/advanced-buy" -Method POST -ContentType "application/json" -Body $body
$resp | ConvertTo-Json -Depth 8
$signature = $resp.data.signature
$signature
```

### Advanced Sell (build → sign → send → confirm)
```powershell
# WARNING: Real mainnet transaction if your RPC points to mainnet.
$seller = "<SELLER_PUBLIC_KEY>"
$privSeller = "<SELLER_PRIVATE_KEY_BASE58>"
$mint = "<MINT_ADDRESS>"
$tokenAmount = "100%"   # or numeric string like "123456.789"
$slippageBps = 100
$priorityFeeSol = 0.0005
$commitment = "confirmed"   # or "finalized"

$body = @{
  sellerPublicKey = $seller
  mintAddress     = $mint
  tokenAmount     = $tokenAmount
  slippageBps     = $slippageBps
  priorityFeeSol  = $priorityFeeSol
  privateKey      = $privSeller
  commitment      = $commitment
} | ConvertTo-Json

$resp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pump/advanced-sell" -Method POST -ContentType "application/json" -Body $body
$resp | ConvertTo-Json -Depth 8
$signature = $resp.data.signature
$signature
```

### Advanced Create (multi-sign: creator + mint)
```powershell
# WARNING: Real mainnet transaction if your RPC points to mainnet.
# Requires two Base58 private keys: creator (fee payer) and mint. Neither is persisted or logged by the API.

$creatorPub  = "<CREATOR_PUBLIC_KEY>"
$creatorPriv = "<CREATOR_PRIVATE_KEY_BASE58>"

# Option A: Use your own mint keys
# $mintPub  = "<MINT_PUBLIC_KEY>"
# $mintPriv = "<MINT_PRIVATE_KEY_BASE58>"

# Option B: Generate a new mint keypair via wallet endpoint
$wMint = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/wallet/create" -Method POST -ContentType "application/json" -Body (@{ count = 1 } | ConvertTo-Json)
$mintPub  = $wMint.data[0].publicKey
$mintPriv = $wMint.data[0].privateKey

# Metadata
# If you already uploaded an image (see Upload section above), reuse it:
# $imageUrl = $upload.data.ipfsUri
if (-not $imageUrl) { $imageUrl = "https://raw.githubusercontent.com/github/explore/main/topics/solana/solana.png" }
# Provide metadataUri explicitly OR set $env:PINATA_JWT to let the API upload JSON to Pinata.
$metadataUri = $null  # e.g., "ipfs://<CID>"; keep $null to trigger Pinata path (requires PINATA_JWT)

$commitment = "confirmed"   # or "finalized"

$body = @{
  creatorPublicKey = $creatorPub
  mintPublicKey    = $mintPub
  name             = "My Pump Token"
  symbol           = "MPT"
  description      = "Created via Primitives API"
  imageUrl         = $imageUrl
  metadataUri      = $metadataUri
  devBuyAmount     = 0.001
  slippageBps      = 100
  priorityFeeSol   = 0.0005
  privateKey       = $creatorPriv
  mintPrivateKey   = $mintPriv
  commitment       = $commitment
} | ConvertTo-Json

$resp = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/pump/advanced-create" -Method POST -ContentType "application/json" -Body $body
$resp | ConvertTo-Json -Depth 8
$signature = $resp.data.signature
$signature

# Optional: Cross-check status
$attempts = 15
$statusDelaySec = 2
for ($i = 0; $i -lt $attempts; $i++) {
  try {
    $s = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/blockchain/transaction-status/$signature" -Method GET
    $stat = $s.data.status
    Write-Host "[$i] status=$stat"
    if ($stat -eq "confirmed" -or $stat -eq "finalized" -or $stat -eq "failed") { break }
  } catch { }
  Start-Sleep -Seconds $statusDelaySec
}
```

> Notes for advanced flows:
> - Private keys are used only in-memory to sign the tx; they are not persisted or logged.
> - All advanced responses include `unsignedTx` (Base64) for audit across create/buy/sell.
> - Keep the call durations tight to avoid blockhash expiry. If you get an expired-blockhash error, retry immediately.
> - For create, if `metadataUri` is omitted you must set `$env:PINATA_JWT` before running the command.
