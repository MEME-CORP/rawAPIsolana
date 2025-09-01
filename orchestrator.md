# Orchestrator Guide: SOL Transfers with Priority Fees and Rent Top-Up

This document describes the preflight checks and calculations your orchestrator should perform before calling the primitives in this service to construct and send SOL transfers, especially when using priority fees (Compute Budget) and optional recipient rent top-ups.

## Goals
- Avoid “send-all” failures caused by insufficient balance for fees.
- Predict required lamports for base fee + priority fee + optional rent top-up.
- Decide whether to include rent top-up (`rentTopUp`) or skip it.

## Endpoints (from openapi.yaml)
- GET `/wallet/{publicKey}/balance/sol` → sender/recipient balances
- POST `/sol/get-transfer-transaction` → builds unsigned transfer
  - Body: `{ fromPublicKey, toPublicKey, amountSol, computeUnits?, microLamports?, rentTopUp? }`
- POST `/blockchain/sign-transaction` → signs (Base58 private key)
- POST `/blockchain/send-transaction` → sends signed Base64
- GET `/blockchain/transaction-status/{signature}` → status

## Inputs & Options
- `amountSol` (number): desired amount to transfer (in SOL).
- `computeUnits` (int, optional): Compute unit limit for the tx (ComputeBudget).
- `microLamports` (int, optional): Micro-lamports per CU for priority fee.
- `rentTopUp` (boolean, optional):
  - Default behavior: include a recipient rent top-up if needed to make recipient rent-exempt for a plain system account (0-byte data).
  - Set `false` to disable any rent top-up.

## Cost Model & Formulas
- Units
  - 1 SOL = 1,000,000,000 lamports
  - 1 lamport = 1e6 micro-lamports
- Priority fee (lamports):
  - `priorityLamports = (computeUnits * microLamports) / 1e6`
  - Example: 600,000 CUs @ 200,000 µ-lamports/CU → `600,000 * 200,000 / 1e6 = 120,000` lamports = 0.00012 SOL
- Base L1 fee (lamports):
  - Typically on the order of a few thousand lamports per signature (e.g., ~5,000–10,000 lamports). This is cluster-dependent and can vary.
- Rent top-up (optional):
  - Only relevant if the recipient is a plain system account and is not already rent-exempt.
  - Minimum rent-exempt lamports depends on account size. For a 0-byte system account, use the network’s value at runtime (our builder checks it when `rentTopUp !== false`).

### Total Cost to Cover (lamports)
```
TotalRequired = amountLamports
               + (rentTopUp ? recipientRentShortfallLamports : 0)
               + baseFeeLamports
               + priorityLamports
```

### Maximum Sendable (“send all”)
If you want to send as much as possible without failing:
```
maxSendLamports = senderBalanceLamports
                  - (rentTopUp ? recipientRentShortfallLamports : 0)
                  - baseFeeLamports
                  - priorityLamports
```
Where:
- `priorityLamports = (computeUnits * microLamports) / 1e6`
- `baseFeeLamports` ~ 5,000–10,000 (approx; use a safety buffer)
- `recipientRentShortfallLamports` = max(0, minRentExempt(0-byte) - recipientLamports)

## Practical Example (matches your test)
- Sender balance: 0.0009008 SOL = 900,800 lamports
- Desired amount: 0.0009008 SOL = 900,800 lamports
- Priority fee params: `computeUnits = 600,000`, `microLamports = 200,000`
  - `priorityLamports = 600,000 * 200,000 / 1e6 = 120,000` lamports (0.00012 SOL)
- Base fee (approx): 5,000 lamports (0.000005 SOL)
- Assume no rent top-up needed

Then:
- `TotalRequired ≈ 900,800 + 0 + 5,000 + 120,000 = 1,025,800` lamports (0.0010258 SOL)
- But the sender only has 900,800 lamports → insufficient. The tx will fail or never land.
- To succeed, reduce `amountSol` or lower priority fee (e.g., lower `microLamports`) or set `rentTopUp: false` if you know the recipient is already rent-exempt.

A safer send amount here would be:
- `maxSendLamports ≈ 900,800 - 0 - 5,000 - 120,000 = 775,800` lamports → 0.0007758 SOL

## Recommended Orchestrator Flow
1) Fetch balances:
   - Sender: GET `/wallet/{fromPublicKey}/balance/sol`
   - Recipient (optional): GET `/wallet/{toPublicKey}/balance/sol` (to decide on rentTopUp)
2) Decide `rentTopUp`:
   - If you must ensure rent-exempt recipient: set `rentTopUp: true` (default).
   - If you’re sure it’s not needed or you want to skip: set `rentTopUp: false`.
3) Pick priority fee params:
   - `computeUnits` (e.g., 200k–1.2M). For a simple SystemProgram transfer, 200k–400k is usually plenty.
   - `microLamports` based on urgency and network conditions (e.g., 10k–500k).
4) Compute `priorityLamports = (computeUnits * microLamports) / 1e6`.
5) Estimate `baseFeeLamports` (use a small buffer, e.g., 10,000 lamports).
6) If “send all”: set `amountSol = (maxSendLamports / 1e9)` using the formula above.
7) Build unsigned transaction: POST `/sol/get-transfer-transaction` with the chosen params.
8) Sign: POST `/blockchain/sign-transaction` (ensure the private key matches the fee payer; the API now validates this and returns 400 if mismatched).
9) Send: POST `/blockchain/send-transaction`.
10) Poll status: GET `/blockchain/transaction-status/{signature}` (light polling; server-side confirmation uses WebSockets).

## Quick Cost Table (examples)
All costs shown per transaction.

- Given `computeUnits = 200,000`:
  - `microLamports = 10,000` → priority = `200,000 * 10,000 / 1e6 = 2,000` lamports (0.000002 SOL)
  - `microLamports = 50,000` → priority = `10,000` lamports (0.00001 SOL)
  - `microLamports = 200,000` → priority = `40,000` lamports (0.00004 SOL)

- Given `computeUnits = 600,000`:
  - `microLamports = 10,000` → `6,000` lamports (0.000006 SOL)
  - `microLamports = 50,000` → `30,000` lamports (0.00003 SOL)
  - `microLamports = 200,000` → `120,000` lamports (0.00012 SOL)

Add base fee (~5,000–10,000 lamports) and any rent top-up on top of these numbers.

## About rentTopUp option in the API
- Yes, the API now supports `rentTopUp` on `/sol/get-transfer-transaction`.
- Default behavior: include top-up when it’s needed.
- Set `rentTopUp: false` to explicitly skip top-up (useful if you are sending “all” from a low-balance sender and know the recipient is already rent-exempt).

## Notes
- Keep build → sign → send within ~60s to avoid blockhash expiration.
- If you see a signature that encodes as all `1`s in Base58, the transaction was not properly signed. The API now rejects mismatched signer/fee payer in the sign step to avoid this.
- Priority fees are market-driven; start low and increase only if needed.
