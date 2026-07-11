# attesta-protocol — frontend

**The web surface for Attesta: a confidential payments layer with built-in compliance for the Stellar ecosystem.** Shielded transfer amounts with selective disclosure for auditors, plus reusable ZK compliance attestations — built on Stellar Protocol 25's zero-knowledge primitives.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Built_on-Stellar%20%2F%20Soroban-black.svg)](https://stellar.org/soroban)

> **The trust rule that defines this project:** proofs are generated **client-side, in the browser or CLI**. Private amounts, credentials, and viewing keys never leave the user's device. The backend relays ciphertext and indexes public state; a fully compromised backend can censor convenience, but can never learn an amount or forge a proof. If a proposed feature violates this rule, the feature is wrong.
>
> **The standing invariant:** no change may create a code path where a plaintext amount, spending key, or raw credential reaches the backend.

## Why this exists

Every payment amount on Stellar is public forever. That blocks entire categories of adoption: on-chain payroll publishes every salary permanently; B2B settlement hands supplier prices and treasury movements to anyone with an explorer; and regulated entities are stuck choosing between full transparency and going off-chain entirely. Attesta targets the missing middle — **private to the public, provable to the auditor**:

1. **Confidential payments** — transfer amounts inside a shielded pool are hidden behind cryptographic commitments, while the sender/receiver graph stays public (a deliberate v1 scope choice that keeps regulators able to see who transacts with whom).
2. **Selective disclosure** — every account can hand a *scoped viewing key* to an auditor or tax authority, revealing exactly its own history — nothing about anyone else.
3. **ZK compliance attestations** — prove "KYC level 2 passed" or "resident of the EU" to any Soroban app without revealing names, documents, or even which issuer verified you.

This repository is the React frontend: five product surfaces plus the client-side proving pipeline that makes the trust rule real.

## Stack

React 19 · TypeScript · Vite · TailwindCSS 4 · Freighter (outer-tx signing) · **WASM prover (Rust → wasm-bindgen)**

## Surfaces

| Route | Surface | What it does |
|---|---|---|
| `/` | **Confidential pay/receive** | Shield, transfer, unshield; per-note history decrypted locally with viewing keys; demo recipient generator. |
| `/payroll` | **Payroll console** | Define recipients and locally-held amounts, execute a confidential pay run with per-row proving progress; CSV import. |
| `/attestations` | **Attestation wallet** | Issuer credentials held in the encrypted vault; consent screen shows exactly what is and is not revealed; one-action proof generation. |
| `/auditor` | **Auditor disclosure portal** | Owners generate scoped viewing keys; auditors load one and get a report decrypted and re-verified against on-chain commitments — no trust in any Attesta server. |
| `/playground` | **Integrator docs + SDK playground** | `attestation_registry.check()` examples for third-party Soroban apps. |

## How it works

### Keys, vault, and identity

Creating a vault (first visit to any gated surface) generates, **on your device**:

- a **spending key** — 32 random bytes; authorizes spends and derives nullifiers,
- a **viewing keypair** — ECDH P-256; the private half decrypts incoming notes, the public half is published so others can encrypt notes *to* you,
- your **shielded address** — `attesta1` + the first 40 hex chars of `SHA-256(public viewing key)`.

All of it is stored in browser storage encrypted under your passphrase: PBKDF2 (600k iterations, SHA-256) derives an AES-256-GCM key; only the resulting `{salt, iv, ciphertext}` blob is persisted (`src/lib/keys.ts`). The vault also holds your credentials, issued disclosure grants, and sent-payment metadata. Locking the app simply drops the decrypted copy from memory.

The address→public-key mapping lives in a public **directory** (on the real chain, a registration entry; in the local simulation, part of the chain store), so sending to an address requires no out-of-band key exchange.

### The note model

The pool doesn't track balances — it tracks **notes**, like cash. A note's private *opening* is `{value, blinding, owner}`; what the chain sees is only its **commitment**:

```
commitment = SHA-256("note" | value | blinding | owner)
```

The random blinding factor makes the commitment reveal nothing about the value (in production this becomes a Pedersen commitment over BLS12-381 from the circuits layer; the shapes here are deliberately identical). Your **balance** is the sum of your unspent notes — a number that exists only on your device, computed by decryption, never stored anywhere.

**Shield (deposit).** Moving 100 USDC into the pool creates a note owned by you. The deposit amount is necessarily public — tokens visibly leave your Stellar account — which is why the UI labels shield/unshield amounts as public "boundary operations." From that moment on, the value only exists as a commitment.

**Transfer.** To pay 30 to Bob, your wallet (all in `src/lib/wallet.ts`, all local):

1. selects unspent input notes covering 30 (greedy, largest-first) and computes the change,
2. generates a **zero-knowledge proof** in the proving worker: *"I own valid unspent notes under the current Merkle root; inputs = outputs; nothing is created or destroyed"* — without revealing which notes or what amounts,
3. derives a **nullifier** for each spent note — `SHA-256("nul" | commitment | spendingKey)` — a spend-marker that observers cannot link back to the commitment it kills (no spending key, no link),
4. encrypts the new openings — Bob's 30-note to Bob's public viewing key, your change-note to your own — using ephemeral-key ECIES (ECDH → AES-GCM), so each ciphertext is readable *only* by its owner's viewing key,
5. submits `{commitments, nullifiers, ciphertexts, proof}` to the chain. The chain verifies the proof, checks no nullifier was seen before (double-spend rejection), and appends the event.

**Receiving** requires no interaction: wallets **scan** the chain, trial-decrypting every note ciphertext with their viewing key. Decryption succeeds only for your notes; each success adds to your balance and history. Sent amounts aren't recoverable from the chain even by you — the wallet keeps a local sent-log in the vault, exactly like real shielded wallets do.

**Unshield (withdraw)** spends notes and releases a public amount back out of the pool, with change returning as a fresh shielded note.

### What's public vs. private (v1, stated honestly)

| Public on-chain | Private (device-only) |
|---|---|
| That a transfer happened; its timestamp | **Transfer amounts** |
| Sender and recipient addresses (the graph) | Note openings, balances |
| Shield/unshield (boundary) amounts | Spending keys, viewing keys |
| Commitments, nullifiers, ciphertexts, proofs | Credentials and personal data |

Full graph privacy is explicitly out of scope for v1 — the UI says so on every surface. Overpromising privacy is how privacy projects die.

### Selective disclosure

An account owner generates a **scoped viewing key** (`avk1…` string): the viewing private key plus a scope — account, optional date range, label. An auditor pastes it into the disclosure portal, which then, entirely client-side:

1. filters chain events to the grant's scope,
2. decrypts every ciphertext the key can open,
3. **re-computes each note's commitment from the decrypted opening and checks it against the on-chain commitment** — so the report is independently verifiable, not taken on faith from any server.

A viewing key can decrypt but never spend (that needs the spending key). The portal is honest about the current limitation: a handed-out key can always decrypt the past it was scoped to; making revoked grants stop covering *new* activity requires viewing-key rotation (milestone M4, see [ISSUES.md](ISSUES.md) issue 5).

### Compliance attestations

Issuers (anchors already doing SEP-12 KYC) sign credentials to users off-chain; users hold them in the vault and generate ZK proofs over them: *"I hold a valid, unexpired credential from an approved issuer satisfying predicate P"* — revealing nothing else. The attestation wallet's consent screen shows the exact revealed/withheld list before any proof is generated. Any Soroban contract consumes the result through one registry call (`/playground` shows integration examples). The two products compose: the pool itself can require a valid attestation to enter, making it compliant-by-construction rather than a mixer.

### The proving pipeline

Proving runs in a **Web Worker** (`src/lib/prover/worker.ts`) so the UI never freezes; the main-thread facade (`src/lib/prover/index.ts`) exposes `proveTransfer` / `proveAttestation` with progress callbacks. The worker loads the wasm-bindgen package built from `prover/` (Rust). Until the circuits ship (M3), the Rust entry points intentionally return errors and the worker falls back to a **clearly-labelled mock backend** that simulates proving latency — and the facade **refuses mock proofs in production builds**, so the mock can never silently ship.

### The local chain simulation

Until the Soroban contracts and indexer land (M2), `src/lib/chain.ts` simulates the public chain in `localStorage` — storing **exactly what the real chain would make public** (events, commitments, nullifier set, ciphertexts, directory) and enforcing double-spend rejection. It sits behind a narrow interface so it can be swapped for a real chain client without touching the wallet logic or any page. A test asserts the invariant directly: no plaintext transfer amount ever appears in submitted chain data.

Storage keys, for the curious: `attesta.vault.v1` (encrypted vault), `attesta.localchain.v1` (simulated public chain), `attesta.demo-recipients.v1` (demo counterparties).

## Status

Functional demo over the local chain simulation — every flow below works end-to-end in the browser today.

| Works today | Lands later |
|---|---|
| Full wallet loop: create/unlock encrypted vault → shield → confidential transfer → unshield, with locally-decrypted balance & history | Real Soroban contracts + indexer/note relay replace the local simulation (M2/M3) |
| Note model: SHA-256 commitments, spending-key nullifiers with double-spend rejection, ECIES (ECDH P-256 + AES-GCM) note encryption | Production Pedersen/BLS12-381 scheme from the circuits layer (M3) |
| Worker-based proving pipeline with progress UI (labelled **mock** backend; production builds refuse mock proofs) | Real Groth16 proving in the WASM crate (M3) |
| Executable payroll batch runs with per-row proving progress; CSV import | Recurring runs, employee self-service history (M6) |
| Scoped viewing-key grants (`avk1…`) + auditor portal that decrypts and re-verifies every amount against on-chain commitments, client-side | Key rotation so revoked grants stop covering new activity (M4) |
| Attestation wallet backed by the vault, consent screen, demo issuer | Issuer gateway, live attestation registry examples (M5) |

22 unit/integration tests cover the crypto, note, chain, and wallet layers, and a Playwright browser smoke drives the full demo flow.

## Getting started

```bash
npm install
npm run build:prover   # builds the WASM prover (needs Rust + wasm-pack; falls back to a labelled mock without them)
npm run dev
```

Other scripts:

```bash
npm run build      # typecheck + production build
npm test           # vitest
npm run lint       # eslint
```

## Try the demo in two minutes

Everything below runs against the local chain simulation — no testnet account, tokens, or Rust toolchain needed.

1. **Create your vault** — open [http://localhost:5173](http://localhost:5173); the Pay/Receive page asks for a passphrase and generates your spending key, viewing keypair, and `attesta1…` address locally.
2. **Shield funds** — enter an amount (e.g. `100`) and click *Shield funds*. Your shielded balance appears, computed by decrypting your own note.
3. **Create a demo recipient** — in the *Receive* card, click *+ Create demo recipient* to get a registered counterparty address.
4. **Transfer confidentially** — switch to *transfer*, paste the recipient address, send `30`. Watch the proof progress bar (mock prover in dev), then check your history: the amount is visible to you, but inspect `localStorage` key `attesta.localchain.v1` and you'll find only commitments, nullifiers, and ciphertexts on the "chain".
5. **Run payroll** — on the Payroll Console, add rows (or import a `recipient,amount` CSV) and click *Prove & execute batch* for per-row proving progress.
6. **Audit yourself** — on the Auditor Portal, generate a scoped viewing key under *Grant access*, then switch to the auditor tab, paste it, and get a report where every amount is decrypted and re-verified against the on-chain commitments — all client-side.

## Layout

```
prover/               Rust wasm-bindgen crate — the client-side prover
scripts/build-prover.mjs
src/
  components/         Layout, RequireVault gate, shared UI
  pages/              one file per surface (see table above)
  context/            VaultContext: create/unlock/lock + persisted mutations
  lib/
    freighter.ts      Freighter wallet integration (outer Stellar txs only)
    keys.ts           local encrypted vault: spending/viewing keys, credentials
    crypto.ts         SHA-256, ECIES note encryption (ECDH P-256 + AES-GCM)
    notes.ts          note openings, commitments, nullifiers, addresses
    chain.ts          local simulation of on-chain public state (until M2)
    wallet.ts         shield/transfer/unshield, note scanning, auditor grants
    csv.ts            local payroll CSV parsing
    prover/           worker + facade over the WASM prover
      index.ts        main-thread API (proveTransfer / proveAttestation)
      worker.ts       runs proving off the main thread, reports progress
      pkg/            wasm-pack output (gitignored; `npm run build:prover`)
```

## Design decisions

- **Proving in the browser is the product.** The WASM prover is a first-class build artifact with its own performance budget: a single transfer proof in seconds on a mid-range laptop; batch payroll proofs run in a local worker with progress UI.
- **Honest privacy UX:** the UI states plainly what is hidden (amounts) and what is not (participants, timing, boundary amounts) in v1.
- **Simulation-grade crypto with production shapes:** SHA-256 commitments and symmetric-free ECIES note encryption stand in for the Pedersen/BLS12-381 constructions the circuits layer will specify — swappable without changing any interface.
- Key material lives in browser storage encrypted under a user passphrase (PBKDF2 → AES-GCM); Freighter signs the outer Stellar transactions and never sees shielded material.

## Contributing

Start with [ISSUES.md](ISSUES.md) — ten scoped issues with tasks and acceptance criteria, from good-first-issues (vault backup UI, CSV validation, accessibility) to core work (real Groth16 proving, Soroban chain client, viewing-key rotation). Anything touching the prover boundary or the no-secrets-server invariant carries a `security-critical` label with mandatory dual review.

## License

Apache-2.0

---

*Attesta: private to the public, provable to the auditor.*
