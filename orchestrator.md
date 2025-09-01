# Orchestrator Guide: SOL Transaction Rules

This document outlines the rules, rate limits, and cost calculations an orchestrator must follow when processing Solana (SOL) transactions.

## RPC Rate Limits

The orchestrator must adhere to the following rate limits, which are determined by the API key's plan (Free or Premium). The API will inform the orchestrator of its current plan.

### Premium Plan
- **Advanced Operations** (`sol-advanced`, `pump-advanced`):
  - With pre-balance checks: **10 transactions per second**
  - Without pre-balance checks: **13 transactions per second**
- **Regular Operations** (all other blockchain interactions):
  - **40 requests per second**

### Free Plan
- **Advanced Operations** (`sol-advanced`, `pump-advanced`):
  - With or without pre-balance checks: **1 transaction per second**
- **Regular Operations**:
  - **4 requests per second**

---

## Solana Transaction Processing Rules

The orchestrator must follow this sequence of rules to ensure valid and successful transactions.

1.  **Enforce Minimum Balance**: The transaction must fail if the sender's total balance is less than **0.001 SOL**.

2.  **Estimate Total Costs**: Calculate the total cost by summing the base fee, priority fee, and any required rent.
    - **Rent**: A fixed **0.00089088 SOL** is required if the recipient's account is new (not yet initialized).
    - **Fees**: Priority fees are calculated based on compute units and micro-lamports, or by specifying a direct priority fee in SOL.

3.  **Auto-Reduce Transfer Amount**: If the sender's balance is insufficient to cover the desired transfer amount plus all costs, the transfer amount should be automatically reduced to the maximum possible value that remains after all costs are covered.

4.  **Validate Final Amount**: After all deductions and potential reductions, the final transfer amount must be greater than zero. If the calculated amount is zero or less, the transaction must fail.

---

## Cost Model & Calculation

- **Units**
  - 1 SOL = 1,000,000,000 lamports
  - 1 lamport = 1,000,000 micro-lamports

- **Priority Fee (lamports)**
  - `priorityLamports = (computeUnits * microLamports) / 1,000,000`

- **Total Cost to Cover (lamports)**
  ```
  TotalRequired = amountLamports
                 + rentLamports (if recipient account is new)
                 + baseFeeLamports
                 + priorityLamports
  ```

- **Maximum Sendable Amount ("Send All")**
  To calculate the maximum amount that can be sent from an account:
  ```
  maxSendLamports = senderBalanceLamports
                    - rentLamports (if recipient account is new)
                    - baseFeeLamports
                    - priorityLamports
  ```
  *Note: Use a safe estimate for `baseFeeLamports`, such as 10,000 lamports.*

---

## Quick Cost Table (Examples)

This table shows the priority fee cost in lamports for different compute unit and micro-lamport combinations. Remember to add the base fee (~5,000-10,000 lamports) and potential rent cost on top of these values.

- **Given `computeUnits = 200,000`**:
  - `microLamports = 10,000` → priority = `2,000` lamports (0.000002 SOL)
  - `microLamports = 50,000` → priority = `10,000` lamports (0.00001 SOL)
  - `microLamports = 200,000` → priority = `40,000` lamports (0.00004 SOL)

- **Given `computeUnits = 600,000`**:
  - `microLamports = 10,000` → priority = `6,000` lamports (0.000006 SOL)
  - `microLamports = 50,000` → priority = `30,000` lamports (0.00003 SOL)
  - `microLamports = 200,000` → priority = `120,000` lamports (0.00012 SOL)