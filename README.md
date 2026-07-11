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

Early scaffold, tracking the project roadmap:

| Works today | Lands later |
|---|---|
| All five surfaces routed and navigable | Indexer/note-relay connection for real shielded history (M2/M3) |
| Freighter connect + outer-tx signing helpers | Real Groth16 proving — the WASM crate returns explicit errors until circuits ship (M3) |
| Worker-based proving pipeline with progress UI (labelled **mock** backend; production builds refuse mock proofs) | Scoped viewing-key report verification in the auditor portal (M4) |
| Local encrypted vault (PBKDF2 → AES-GCM) with export/import | Issuer gateway, live attestation registry examples (M5) |
| In-browser payroll CSV import (unit-tested) | Batch payroll proving + recurring runs (M6) |

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

## Layout

```
prover/               Rust wasm-bindgen crate — the client-side prover
scripts/build-prover.mjs
src/
  components/         Layout, shared UI
  pages/              one file per surface (see table above)
  lib/
    freighter.ts      Freighter wallet integration (outer Stellar txs only)
    keys.ts           local encrypted vault: spending/viewing keys, credentials
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
