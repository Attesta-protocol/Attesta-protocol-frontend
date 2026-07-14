# Attesta Frontend — Issue Backlog

Ten concrete issues derived from the current state of the codebase — all filed on the [issue tracker](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues) as #1–#10. Labels follow the project taxonomy: a layer label (`frontend/…`), a difficulty label (🟢 good first issue / 🟡 help wanted / 🔴 core), and `security-critical` where the change touches the prover boundary or the no-secrets-server invariant (mandatory dual review).

**The standing invariant applies to every issue here:** no change may create a code path where a plaintext amount, spending key, or raw credential leaves the user's device.

---

## Issue 1 — Vault export / backup and restore UI ([#1](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/1))

**Labels:** `frontend/good-first-issue` 🟢 · **Status: ✅ implemented** (e2e coverage waits on Issue 9)

### Description

`src/lib/keys.ts` already implements `exportVault()` and `importVault()` (the encrypted blob, still passphrase-protected), but no surface exposes them. A user who clears browser storage today loses their spending key, viewing key, credentials, and sent-payment history irrecoverably — for a wallet holding real value this is the single most dangerous gap in the UX. The main README promises "explicit export/backup flows" as a design decision.

### Tasks

- [x] Add a **Vault settings** section (either a new card on Pay/Receive or a small `/settings` route) with *Export backup* and *Restore from backup* actions.
- [x] Export: download the encrypted blob as `attesta-vault-backup-<date>.json` via a Blob URL; show a confirmation stating the file is still encrypted under the passphrase and useless without it.
- [x] Restore: file picker → `importVault()` → prompt for passphrase → unlock; surface the existing "Not a valid Attesta vault backup" error inline.
- [x] Warn before restoring over an existing vault (destructive action — require typed confirmation).
- [x] Show a persistent, dismissable "back up your vault" banner after vault creation until the first export.
- [x] Unit tests for the restore-over-existing guard logic *(done)*; ~~extend the Playwright smoke~~ *(blocked on Issue 9 — no e2e harness in repo yet)*: original ask was to export → clear storage → restore → verify balance is intact.

### Acceptance criteria

- A user can export the vault, wipe `localStorage`, restore the file, unlock with their passphrase, and see identical address, balance, credentials, and sent history.
- The exported file contains only the `EncryptedVault` shape (`salt`, `iv`, `ciphertext`) — no plaintext key material (assert in a test).
- Restoring with a wrong passphrase or malformed file shows an inline error and never destroys the existing vault.
- The backup banner appears after creation and never again after the first successful export.

---

## Issue 2 — Wire real Groth16 proving into the WASM prover crate (M3) ([#2](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/2))

**Labels:** `frontend/core`, `security-critical` 🔴

### Description

`prover/src/lib.rs` intentionally returns `not_implemented` errors from `prove_transfer` / `prove_attestation`, and the browser falls back to the clearly-labelled mock backend in `src/lib/prover/worker.ts`. Once the circuits layer publishes the transfer/withdraw circuits and proving keys (M1), this crate must produce real Groth16 proofs over BLS12-381 client-side, within the published performance budget: **single transfer proof in seconds on a mid-range laptop**.

### Tasks

- [ ] Add `ark-groth16`, `ark-bls12-381`, `ark-serialize` dependencies and a proving-key loading path (fetched once, cached in IndexedDB, integrity-checked against a pinned hash).
- [ ] Implement `prove_transfer`: deserialize `TransferProofInput` (see `src/lib/prover/types.ts`), build the witness (note openings, Merkle path, nullifier preimages), prove, return `{ proof, publicInputs }` hex-encoded.
- [ ] Implement `prove_attestation` over the credential circuit equivalently.
- [ ] Replace the placeholder `merklePath: []` plumbing in `src/lib/wallet.ts` with real paths once the chain layer provides them (coordinate with Issue 4).
- [ ] Add a Rust test suite (`cargo test` + `wasm-pack test --headless`) with known-good vectors from the circuits repo.
- [ ] Add a performance benchmark script reporting proof time; wire it into CI with a regression threshold.
- [ ] Update `worker.ts` so the WASM path reports honest incremental progress (witness build / proving phases) instead of the mock's simulated steps.

### Acceptance criteria

- With the prover built, a transfer on Pay/Receive produces a proof that verifies against the published verifying key (verified in a test, not by inspection).
- Single-transfer proving completes in ≤ 5s on a mid-range laptop reference machine (documented in the benchmark output).
- `backend: "wasm"` is reported end-to-end; the mock path is unreachable when the pkg is present.
- Production-build behaviour is unchanged: mock proofs are still refused (`src/lib/prover/index.ts`).
- No private input (amount, blinding, credential) appears in any log, error message, or network request — reviewed under the `security-critical` dual-review rule.

---

## Issue 3 — Note-scanning efficiency: incremental scan with a local cache ([#3](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/3))

**Labels:** `frontend/help-wanted` 🟡 · **Status: ✅ implemented**

### Description

`scanNotes()` in `src/lib/wallet.ts` trial-decrypts **every ciphertext of every event on every call**, and it's called on each balance refresh and after each action. `PayReceive` even triggers it multiple times per render cycle (balance + history). On the local simulation this is invisible; against a real indexer with thousands of pool events it becomes O(events × refreshes) ECDH operations and will visibly jank the UI. This is the "note-scanning efficiency" item from the main project's help-wanted list.

### Tasks

- [x] Introduce a scan cursor: persist (in the vault) the last event index scanned plus the decrypted results, and only trial-decrypt events after the cursor on subsequent scans.
- [x] Recompute `spent` status cheaply from the nullifier set without re-decrypting.
- [x] Deduplicate concurrent scans (a single in-flight scan promise shared by balance and history callers).
- [x] Invalidate the cache correctly when the chain resets (e.g. `attesta.localchain.v1` cleared while a vault survives) — detect via event-count regression or a chain genesis id.
- [x] Add unit tests: cache hit produces identical results to a full rescan; cursor advances; reset invalidation works.
- [x] Add a micro-benchmark (vitest bench or a script) demonstrating the improvement on a synthetic 5,000-event chain.

### Acceptance criteria

- On a synthetic 5,000-event chain, a second `scanNotes()` call performs zero trial decryptions for already-scanned events (assert via an injected decryption counter).
- Balance and history results are byte-identical between cached and cold scans in tests.
- Clearing the chain store does not leave the wallet showing stale notes.
- Cached openings live **only inside the encrypted vault**, never in plaintext storage.

---

## Issue 4 — Replace the LocalChain simulation with Soroban testnet integration (M2) ([#4](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/4))

**Labels:** `frontend/core`, `security-critical` 🔴

### Description

`src/lib/chain.ts` simulates the public chain in `localStorage` behind a deliberately narrow interface (`register/lookup/events/isSpent/root/submit`). When the shielded-pool contracts and indexer land (M2), this module should be swappable for a real client without touching `wallet.ts` or any page. The seam exists; this issue makes it real.

### Tasks

- [ ] Extract the current `LocalChain` public surface into a `ChainClient` interface; make `LocalChain` one implementation.
- [ ] Implement `SorobanChain`: submit operations via `@stellar/stellar-sdk` (already a dependency), sign outer transactions with Freighter (`signWithFreighter` in `src/lib/freighter.ts` is currently unused), and read events/nullifiers/directory from the indexer's public API.
- [ ] Fetch real Merkle roots and membership paths for spends (feeds Issue 2).
- [ ] Add a network switcher (Local simulation / Testnet) in the header where the hard-coded "Local simulation" badge sits in `Layout.tsx`; persist the choice.
- [ ] Handle asynchrony the simulation hides: pending-tx states in the UI, retry on sequence collisions, event polling/streaming.
- [ ] Keep the full test suite running against `LocalChain`; add integration tests for `SorobanChain` against a mocked indexer.

### Acceptance criteria

- `wallet.ts` and all pages compile and pass tests unchanged against the `ChainClient` interface.
- On testnet mode with Freighter connected, shield/transfer/unshield produce real testnet transactions; the UI shows pending → confirmed states.
- The indexer/backend receives **only** ciphertexts, commitments, nullifiers, and proofs — verified by an interception test asserting no request body ever contains a plaintext transfer amount or key (the standing invariant, now against real HTTP).
- Local-simulation mode remains fully functional offline.

---

## Issue 5 — Viewing-key rotation so revoked grants stop covering new activity (M4) ([#5](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/5))

**Labels:** `frontend/core`, `security-critical` 🔴

### Description

The auditor portal issues scoped grants (`encodeGrant` in `src/lib/wallet.ts`) that embed the account's **only** viewing private key. The UI is honest about the consequence (`AuditorPortal.tsx`: revocation "ships with M4 — a handed-out key can always decrypt the past"), but the mechanism is missing: there is no way to stop an auditor from reading *future* activity. The fix is key rotation — an epoch of viewing keypairs, where new notes are encrypted to the newest key and a grant only carries keys up to its issuance epoch.

### Tasks

- [ ] Extend the vault schema (v3, with migration from v2) to hold an ordered list of viewing keypairs (epochs) instead of a single pair.
- [ ] Add a `rotateViewingKey()` operation: generate a new keypair, publish the new public key to the directory (address stays stable — derive it from the epoch-0 key), mark the epoch boundary.
- [ ] Encrypt new outgoing/change notes to the recipient's **latest** directory key; scanning tries each of the wallet's epoch keys.
- [ ] Grants embed only the keys for epochs within their scope; `buildDisclosureReport` uses all keys in the grant.
- [ ] Wire the *Revoke* action on the "Issued grants" list: revoking triggers rotation and flags the grant; update the honesty copy to state exactly what revocation does and does not undo.
- [ ] Tests: post-rotation transfers are undecryptable under a pre-rotation grant; pre-rotation history remains decryptable; balances survive rotation.

### Acceptance criteria

- After issuing a grant and then revoking it, a new incoming payment does **not** appear when the auditor reloads the same grant string; all pre-revocation rows still do.
- The account address is unchanged by rotation and other wallets can still pay it without any manual step.
- Vault v2 → v3 migration is automatic and covered by a test; a v2 backup restores correctly.
- Dual review confirms no epoch private key ever leaves the vault except inside an explicitly generated grant.

---

## Issue 6 — QR codes and payment-request flow for pay/receive ([#6](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/6))

**Labels:** `frontend/help-wanted` 🟡

### Description

The project README specifies "QR/request flows" for the pay/receive surface; today receiving is copy-paste only (`PayReceive.tsx` Receive card). A payment request should encode address plus optional amount and memo, render as a QR code, and prefill the sender's form when opened — with the crucial nuance that a requested amount travels **inside the request link, not on the chain** (the transfer itself stays shielded).

### Tasks

- [ ] Define a request format: `attesta:pay?to=<address>&amount=<decimal>&memo=<text>` (versioned, documented in the README).
- [ ] Add a *Request payment* panel to the Receive card: optional amount/memo → generated link + QR code. Render the QR with a small self-contained encoder (no network — CSP/trust rule) such as a vendored MIT implementation; justify the dependency in the PR.
- [ ] Handle incoming requests: a route (`/pay?...`) that validates the address against the directory, prefills the transfer form, and highlights what the recipient asked for vs. what the user is sending.
- [ ] Support scanning via image upload or `getUserMedia` camera where available (progressive enhancement — copy-paste always works).
- [ ] Show the memo in the sender's local sent-log entry (extend `SentRecord`; memo is local metadata, never submitted).
- [ ] Unit tests for encode/parse round-trips and malformed-URI rejection; Playwright coverage for request → prefill → transfer.

### Acceptance criteria

- Generating a request for `25.50` and opening its link in the same browser lands on a prefilled transfer form showing recipient and amount, requiring only confirmation.
- The QR renders offline (no external fetch — verify no network request in devtools) and scans with a standard phone camera.
- Malformed or unregistered-address requests show a clear error, never a half-filled form.
- Chain data for a request-initiated transfer is indistinguishable from a manual one (no amount/memo leakage — assert in a test).

---

## Issue 7 — Payroll: CSV validation report and per-row pre-flight checks ([#7](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/7))

**Labels:** `frontend/good-first-issue` 🟢 · **Status: ✅ implemented**

### Description

`parsePayrollCsv` (`src/lib/csv.ts`) silently keeps whatever splits into two fields, and the console only discovers problems row-by-row **during** the run, mid-way through spending real notes. An employer importing a 200-row payroll needs errors *before* proving starts: bad addresses, bad amounts, duplicates, unregistered recipients, and a total exceeding the shielded balance.

### Tasks

- [x] Extend the CSV parser to return per-line diagnostics `{ line, field, problem }` alongside parsed rows instead of silently dropping malformed lines.
- [x] Validate each row on import and on edit: address shape (`attesta1` + 40 hex), `parseAmount` success, duplicate recipient warning (allowed, but flagged).
- [x] Add a pre-flight check to *Prove & execute batch*: every recipient registered in the directory, and total ≤ current shielded balance; block the run with a summary of failures.
- [x] Render an import summary ("187 rows imported, 3 skipped — download error report") with the diagnostics as a downloadable CSV.
- [x] Keep all validation client-side (amounts are private data).
- [x] Unit tests for each diagnostic type; a test fixture CSV mixing every failure mode.

### Acceptance criteria

- Importing a CSV with a malformed amount, a bad address, and a duplicate shows all three findings at once, before any proving.
- The run button is disabled with an explanatory message when total exceeds balance or any recipient is unregistered; fixing the rows re-enables it without re-import.
- Valid rows from a partially-bad CSV import cleanly; nothing is silently dropped without appearing in the diagnostics.
- No new network calls; existing csv tests still pass.

---

## Issue 8 — Attestation consent screen: render disclosures from a structured predicate, not hardcoded copy ([#8](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/8))

**Labels:** `frontend/help-wanted` 🟡 · **Status: ✅ implemented**

### Description

The consent card in `AttestationWallet.tsx` shows a **hardcoded** revealed/not-revealed list, identical for every credential. The consent screen is the product's trust anchor ("always shows exactly what is and is not revealed") — it must be derived from the actual predicate being proven, so that when the M5 attestation circuits define real predicate types (KYC level ≥ N, jurisdiction ∈ set, inflow threshold), the UI cannot drift from the cryptographic truth.

### Tasks

- [x] Define a typed `Predicate` model in `src/lib/prover/types.ts` (e.g. `{ kind: "kyc-level", min: 2 }`, `{ kind: "jurisdiction", in: ["EU"] }`, `{ kind: "inflow-threshold", min: "5000", period: "month" }`) replacing the free-string `predicate`.
- [x] Store structured claims on `StoredCredential` (keep the display string as derived data).
- [x] Build a `DisclosureSummary` component that maps each predicate kind to its exact revealed/withheld statements; unknown kinds must render a refusal ("this app requests a predicate this wallet cannot explain — not proving"), never a generic screen.
- [x] Thread the structured predicate through `proveAttestation` and the worker to the (mock/real) prover.
- [x] Update the SDK Playground examples to the structured format.
- [x] Unit tests: one snapshot per predicate kind; the unknown-kind refusal path.

### Acceptance criteria

- Presenting the KYC credential vs. the jurisdiction credential shows *different*, predicate-specific revealed/not-revealed lists.
- An unrecognised predicate kind can never reach the "Generate & present proof" button.
- The string handed to the prover is generated from the same structured object the consent screen rendered (single source of truth — assert in a test).
- Playground code samples compile-check against the exported types.

---

## Issue 9 — CI pipeline and promotion of the Playwright smoke into the repo ([#9](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/9))

**Labels:** `frontend/help-wanted` 🟡

### Description

The repo has 22 vitest tests, an eslint config, a typechecked build — and nothing that runs them automatically. A full-flow Playwright smoke (vault → shield → transfer → payroll → attestation → auditor report) was written during development but lives outside the repo. Every future issue on this list (rotation, prover, chain client) needs CI to land safely, and the `security-critical` dual-review rule is meaningless without a green-check baseline.

### Tasks

- [ ] Add `e2e/smoke.spec.ts` using `@playwright/test` (convert the existing script's ten checks into proper spec assertions; use its web-server option to boot `vite dev`).
- [ ] Add `.github/workflows/ci.yml`: install → lint → typecheck/build → unit tests → e2e, on pushes to `main` and all PRs; cache npm and Playwright browsers.
- [ ] Run the prover build script in CI without Rust to lock in the documented mock-fallback behaviour, and add a second (allowed-to-be-slow, optional) job that installs Rust + wasm-pack and asserts `build:prover` compiles the crate.
- [ ] Fail CI on eslint warnings (`--max-warnings 0`).
- [ ] Add a branch-protection note to the README contributing section: PRs require green CI.
- [ ] Badge in the README.

### Acceptance criteria

- A PR breaking any of: types, lint, a unit test, or a smoke step, shows a red check with the failing step identifiable from the summary line.
- The e2e job covers at minimum: vault creation, shield, confidential transfer with balance assertions, payroll batch, grant → verified auditor report.
- CI completes in under ~8 minutes on a warm cache.
- `main`'s current state passes the full pipeline as merged.

---

## Issue 10 — Accessibility pass: labels, focus management, and non-color status signalling ([#10](https://github.com/Attesta-protocol/Attesta-protocol-frontend/issues/10))

**Labels:** `frontend/good-first-issue` 🟢 · **Status: ✅ implemented** (manual keyboard sweep + axe run pending Issue 9)

### Description

The surfaces use visual-only patterns that exclude keyboard and screen-reader users: inputs are associated with labels by proximity only (no `htmlFor`/`id` pairing anywhere in `src/pages/` or `RequireVault.tsx`), proving progress is a bare colored `div` (no `role="progressbar"`), row status in the payroll table is conveyed by color plus a symbol with no accessible name, and the vault unlock error is not announced (`aria-live` missing). A payments-and-compliance tool will be used under audit and workplace-accessibility requirements; this is table stakes.

### Tasks

- [x] Pair every input/textarea with a real `<label htmlFor>` (Pay/Receive, Payroll, Auditor, RequireVault, AttestationWallet).
- [x] Give both progress bars (`PayReceive`, payroll rows) `role="progressbar"` with `aria-valuenow/min/max` and an `aria-label` naming the operation.
- [x] Announce async outcomes (transfer notice, run summary, unlock errors, auditor report load) via `aria-live="polite"` regions.
- [x] Ensure payroll row status is readable without color: keep the ✓/✗ glyphs but add visually-hidden text ("paid", "failed: <reason>").
- [ ] Verify the whole demo walkthrough is completable with keyboard only *(focus management added, e.g. into the generated grant panel; full manual sweep still to do)* (tab order, `Enter` submits, focus moves into newly revealed panels such as the generated grant).
- [x] Add `eslint-plugin-jsx-a11y` (recommended config) to keep regressions out; fix what it flags.

### Acceptance criteria

- `eslint-plugin-jsx-a11y` passes with zero disables in page/component code (any justified exception is commented at the site).
- The README's two-minute demo walkthrough can be completed with keyboard only; a checklist of the steps is included in the PR description with confirmation.
- VoiceOver/NVDA reads a meaningful label for every form field and announces transfer completion and payroll summary without user focus changes.
- Axe (via `@axe-core/playwright` in the e2e suite, if Issue 9 has landed) reports no critical violations on the four main surfaces.
