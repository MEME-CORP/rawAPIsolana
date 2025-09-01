---
trigger: always_on
---

# Agentic IDE Rules — v1.1 “Vanilla-First & Docs-Heavy”

> These rules hard-lock the IDE’s assistants to the approach in the v1.1 refactor plan. **Do not bypass, ignore, or reinterpret** any rule unless explicitly overridden in the prompt. When in doubt, **choose the simpler, better-documented path**.

---

## 0) Mission

Build and evolve a **Blockchain Primitives API** that exposes **raw, composable, stateless primitives**. The **orchestrator** composes and signs; this service **constructs** (and sometimes **sends** if the endpoint is explicitly for that). Optimize for **LLM one-shot success** via **vanilla JavaScript (ESM), JSDoc hints, and Zod validation**.

---

## 1) Ten Unbreakable Rules

1. **Language & Module System:** Use **JavaScript (ESM)** only. `import`/`export` everywhere. **No TypeScript**, no build step.
2. **Types & Validation:** Use **JSDoc for hints** and **Zod for runtime validation** on **every** external input.
3. **Architecture:** **Vertical slices** under `src/features/<slice>/`. Each capability has `*.handler.js` and `*.schema.js` co-located.
4. **Contract Source of Truth:** The **OpenAPI `openapi.yaml`** defines routes, request/response shapes, and errors. **Do not invent routes or shapes.**
5. **Primitives over Flows:** Handlers **construct unsigned transactions** and return **Base64 strings**. Orchestrator signs/sends—**not** this API (except `/blockchain/send-transaction`).
6. **Security:** **Accept private keys only when required to sign a transaction.** Keys must never be persisted or logged. If an endpoint does not explicitly perform signing, it **must not** accept key material. `/wallet/create` may return a private key (creation-time only).
7. **Dependencies:** Prefer **vanilla Node** and **well-documented libs** only: `express`, `zod`, `@solana/web3.js`. Avoid “magic” frameworks, reflection, heavy ORMs, codegen.
8. **Locality:** Keep **concept, code, config, and contract close**. Minimize indirection, layers, and abstractions.
9. **Errors:** Throw **`ApiError`** and rely on the shared **error middleware**. Responses follow `components.responses.*`.
10. **Determinism:** Handlers must be **stateless and idempotent** relative to their inputs; no hidden global state, file writes, or side-effects.

---

## 2) Allowed / Discouraged / Forbidden

* **Allowed:** `express`, `zod`, `@solana/web3.js`, Node built-ins (`node:*`).
* **Discouraged:** Any library that adds ceremony without clarity (DI containers, decorators, metaprogramming).
* **Forbidden:** TypeScript, Babel, code generators that change runtime behavior, reflection-heavy libs, writing key material to disk, changing OpenAPI response envelopes.

---

## 3) Repository Shape (enforced)

```
src/
  core/
    solana/
      connection.js        # singleton connection factory
      rpc-config.js        # RPC_CONFIGS, rate limit helpers
    errors/
      api-error.js         # ApiError class (code, message)
    middleware/
      error-handler.js     # central error serializer
  features/
    <slice>/
      <action>.handler.js
      <action>.schema.js
app.js                      # express, routes, middleware
server.js                   # start server
openapi.yaml                # single source of truth
```

**Do not** add new top-level layers. **Do** add new slices under `features/`.

---

## 4) Route Wiring Rules

* **Map 1:1** from `openapi.yaml` to Express routes in `app.js`.
* Each route delegates to **one handler** inside its feature slice.
* **All inputs** (params, query, body) are parsed via **Zod** defined in the co-located `*.schema.js`.
* Responses conform to `ApiSuccess*` or `ApiError` envelopes **exactly**.

---

## 5) Handler Pattern (canonical)

```js
// src/features/pump/get-buy-transaction.handler.js
import { z } from 'zod';
import { getConnection } from '../../core/solana/connection.js';
import { schema } from './get-buy-transaction.schema.js';
import { ApiError } from '../../core/errors/api-error.js';

/**
 * @typedef {import('express').Request} Request
 * @typedef {import('express').Response} Response
 */

/** @param {Request} req @param {Response} res */
export async function getBuyTransactionHandler(req, res) {
  const parsed = schema.parse(req.body); // Zod validates & narrows
  const connection = getConnection();

  // Pure, stateless logic producing an **unsigned**, serialized, Base64 tx
  // (Call documented external API if required, but do NOT sign/send.)
  const unsignedTxBase64 = await buildUnsignedBuyTx(connection, parsed);

  return res.status(200).json({
    ok: true,
    data: { unsignedTx: unsignedTxBase64 },
  });
}
```

---

## 6) Schema Pattern (canonical)

```js
// src/features/pump/get-buy-transaction.schema.js
import { z } from 'zod';

export const schema = z.object({
  buyerPublicKey: z.string().min(1),
  mintAddress: z.string().min(1),
  solAmount: z.number().positive(),
  slippageBps: z.number().int().nonnegative(),
});
```

**Always** export a single Zod schema and use it in the handler.

---

## 7) Error Handling (uniform)

* Throw `new ApiError(code, message)` for predictable client errors (e.g., `INVALID_INPUT`).
* Let unexpected errors bubble to `error-handler.js`, which returns:

  * `400 | 404 | 500` with `{ ok: false, error: { code, message } }` matching OpenAPI.
* **Never** leak stack traces or raw provider errors to clients.

---

## 8) Solana & RPC Rules

* Use **`getConnection()`** from `core/solana/connection.js` (singleton).
* Centralize **RPC config**, rate limiting, and confirmation logic in `rpc-config.js`.
* For `/blockchain/send-transaction`:

  * Accept **Base64 signed** tx (`signedTx`), send via `sendRawTransaction`, confirm via the robust confirm helper, return `{ signature }`.
* For `/blockchain/transaction-status/{signature}`:

  * Poll status and map to enum: `pending | confirmed | finalized | failed`.

---

## 9) Serialization & Amount Rules

* **Transactions:** Base64, serialized. Fields:

  * Unsigned → `data.unsignedTx`
  * Signed → `data.signedTx` (only if endpoint requires; generally inputs, not outputs)
* **Large numeric values** (token amounts) that may overflow JS: represent as **strings** per OpenAPI.
* **SOL** amounts can be `number` when UI amounts are safe; **lamports** as strings.

---

## 10) Feature-by-Feature Guardrails

* **Wallet**

  * `POST /wallet/create`: generate in-memory keypairs; **do not write to disk**.
  * `GET /wallet/{publicKey}/balance/sol`: query via `@solana/web3.js`; return both SOL and lamports.
* **SPL**

  * `GET /spl/{mintAddress}/balance/{walletPublicKey}`: resolve ATA, return UI + raw amounts.
* **SOL**

  * `POST /sol/get-transfer-transaction`: build **unsigned** SystemProgram transfer; return Base64.
* **Pump.fun / Bonk.fun**

  * `get-*-transaction`: call documented endpoints to **fetch unsigned tx** only; do **not** sign or send.
  * For Bonk, set `pool: "bonk"`.
* **Jupiter**

  * `get-quote` and `get-swap-transaction`: fetch quote/unsigned swap tx; keep logic granular and stateless.

---

## 11) Response Envelopes (don’t improvise)

* **Success (200):**

  ```json
  { "ok": true, "data": { /* as per schema */ } }
  ```
* **Error (400/404/500):**

  ```json
  { "ok": false, "error": { "code": "INVALID_INPUT", "message": "..." } }
  ```

---

## 12) Naming & Files

* Handlers: `verb-noun.handler.js` (e.g., `get-quote.handler.js`).
* Schemas: same stem: `verb-noun.schema.js`.
* Only **one** top-level `app.js` for route registration and middleware.

---

## 13) LLM Work Routine (always follow)

1. **Read** the relevant **OpenAPI path** and **components**.
2. **Create/Update** the feature slice with `*.schema.js` then `*.handler.js`.
3. **Validate** inputs with Zod at the boundary.
4. **Use** `getConnection()` if Solana is involved.
5. **Return** exactly the envelope defined by OpenAPI.
6. **Wire** route in `app.js` with the same HTTP method and path.
7. **Self-check** against the checklist below.

---

## 14) Self-Check Checklist (block on failure)

* [ ] JS **ESM** only; **no TS** imports/types remain.
* [ ] **Zod** schema exists and is used for every input.
* [ ] Response matches **`ApiSuccess*`** or **`ApiError`** shape.
* [ ] Handler is **stateless** and has **no file I/O** or secret handling.
* [ ] For txs, output is **Base64** and **unsigned** unless endpoint says otherwise.
* [ ] Errors use **`ApiError`**; no raw `res.status(...).json(...)` scattered.
* [ ] Route is registered in `app.js` and mirrors **OpenAPI** exactly.
* [ ] Code is minimal, readable, and relies on **well-documented** libs only.
* [ ] JSDoc present on public functions to aid tooling/LLMs.
* [ ] No new abstractions that reduce locality or add indirection.

---

## 15) What to Do When Conflicts Arise

* If a prior file contradicts these rules, **refactor toward v1.1**.
* If an external example suggests TypeScript or complex frameworks, **decline and keep vanilla**.
* If an endpoint isn’t in OpenAPI, **do not implement it**; request a contract update first (out of band).

---

## 16) Definition of Done (gate)

Refactor/feature work is complete **only if**:

* All affected code is **ESM JS with JSDoc**.
* Inputs guarded by **Zod**.
* **OpenAPI routes implemented** and wired.
* **Private keys accepted only when signing is explicitly required**; otherwise endpoints reject key material.
* Repo shape matches section **3**.
* README updated with setup and links to **Express**, **Zod**, **@solana/web3.js**.

---

**Remember:** **Vanilla-First & Docs-Heavy** is not a preference; it’s a contract. Keep it simple, predictable, and close to the docs so LLMs (and humans) can get it right the first time.