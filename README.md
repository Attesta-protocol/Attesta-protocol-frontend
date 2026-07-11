# attesta-protocol — frontend

**The web surface for Attesta: a confidential payments layer with built-in compliance for the Stellar ecosystem.** Shielded transfer amounts with selective disclosure for auditors, plus reusable ZK compliance attestations — built on Stellar Protocol 25's zero-knowledge primitives.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Built_on-Stellar%20%2F%20Soroban-black.svg)](https://stellar.org/soroban)

> **The trust rule that defines this project:** proofs are generated **client-side, in the browser or CLI**. Private amounts, credentials, and viewing keys never leave the user's device. The backend relays ciphertext and indexes public state; a fully compromised backend can censor convenience, but can never learn an amount or forge a proof. If a proposed feature violates this rule, the feature is wrong.
>
> **The standing invariant:** no change may create a code path where a plaintext amount, spending key, or raw credential reaches the backend.

## Stack

React 19 · TypeScript · Vite · TailwindCSS 4 · Freighter (outer-tx signing) · **WASM prover (Rust → wasm-bindgen)**

## Surfaces

| Route | Surface | What it does |
|---|---|---|
| `/` | **Confidential pay/receive** | Shield, transfer, unshield; QR/request flows; per-note history decrypted locally with viewing keys. |
| `/payroll` | **Payroll console** | Employer funds a shielded batch, defines recipients and locally-encrypted amounts, executes a confidential pay run. CSV import; recurring runs (M6). |
| `/attestations` | **Attestation wallet** | Issuer credentials held locally; consent screen shows exactly what is and is not revealed; one-action proof generation. |
| `/auditor` | **Auditor disclosure portal** | Load a scoped viewing key, get an independently verifiable report checked client-side against on-chain commitments — no trust in our backend required. |
| `/playground` | **Integrator docs + SDK playground** | Live `attestation_registry.check()` examples for third-party Soroban apps. |

## Status

Functional demo over a **local chain simulation** — every wallet flow works end-to-end in the browser against a simulated public ledger (`src/lib/chain.ts`) that records exactly what the real chain would make public: participants, commitments, nullifiers, note ciphertexts, proofs — never a shielded amount.

| Works today | Lands later |
|---|---|
| Full wallet loop: create/unlock encrypted vault → shield → confidential transfer → unshield, with locally-decrypted balance & history | Real Soroban contracts + indexer/note relay replace the local simulation (M2/M3) |
| Note model: SHA-256 commitments, spending-key nullifiers with double-spend rejection, ECIES (ECDH P-256 + AES-GCM) note encryption | Production Pedersen/BLS12-381 scheme from the circuits layer (M3) |
| Worker-based proving pipeline with progress UI (labelled **mock** backend; production builds refuse mock proofs) | Real Groth16 proving in the WASM crate (M3) |
| Executable payroll batch runs with per-row proving progress; CSV import | Recurring runs, employee self-service history (M6) |
| Scoped viewing-key grants (`avk1…`) + auditor portal that decrypts and re-verifies every amount against on-chain commitments, client-side | Key rotation so revoked grants stop covering new activity (M4) |
| Attestation wallet backed by the vault, consent screen, demo issuer | Issuer gateway, live attestation registry examples (M5) |

22 unit/integration tests cover the crypto, note, chain, and wallet layers — including the invariant that no plaintext transfer amount ever appears in submitted chain data.

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
  components/         Layout, shared UI
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

- **Proving in the browser is the product.** The WASM prover is a first-class build artifact with its own performance budget: a single transfer proof in seconds on a mid-range laptop; batch payroll proofs run in a local worker with progress UI. Until the circuits land (milestone M3), a clearly-labelled mock backend keeps the UI developable — production builds refuse mock proofs.
- **Honest privacy UX:** the UI states plainly what is hidden (amounts) and what is not (participants, timing) in v1. Overpromising privacy is how privacy projects die.
- Key material lives in browser storage encrypted under a user passphrase (PBKDF2 → AES-GCM), with explicit export/backup flows; Freighter signs the outer Stellar transactions and never sees shielded material.

## Contributing

Issues live under the `frontend/` labels in the main project tracker — start with `frontend/good-first-issue`. Anything touching the prover boundary or the no-secrets-server invariant carries a `security-critical` label with mandatory dual review. See the project [CONTRIBUTING.md](https://github.com/attesta-protocol) for testnet setup, local proving, and the PR checklist.

## License

Apache-2.0

---

*Attesta: private to the public, provable to the auditor.*
