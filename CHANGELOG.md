# Changelog

## 0.3.0 — 2026-07-14

Halfway release: 5 of the 10 scoped backlog issues implemented
([ISSUES.md](ISSUES.md) #1, #3, #7, #8, #10). All work stays inside the
standing invariant — no plaintext amount, spending key, or raw credential
ever leaves the device.

### Added
- **Vault backup & restore (#1):** Vault settings card on Pay/Receive with
  encrypted export (`attesta-vault-backup-<date>.json`) and restore; restore
  is also offered on the create/unlock screen. Restores verify the file and
  passphrase *before* touching the existing vault, and overwriting requires a
  typed confirmation. A dismissable reminder banner shows until first export.
- **Incremental note scanning (#3):** scan cursor + decrypted openings cached
  inside the encrypted vault; spent status recomputed from the public
  nullifier set; concurrent scans share one in-flight promise; chain resets
  detected via a new LocalChain genesis id. Warm rescans of a 5,000-event
  chain: zero trial decryptions, ~22ms (was ~3.2s cold).
- **Payroll CSV validation & pre-flight (#7):** the parser returns per-line
  diagnostics instead of silently dropping rows; imports show a summary with
  a downloadable error-report CSV; rows validate inline on edit; the run
  button is gated on directory registration, row validity, and unpaid total
  ≤ shielded balance.
- **Structured consent predicates (#8):** typed `Predicate` model
  (kyc-level / jurisdiction / inflow-threshold) with canonical prover
  serialization; the consent screen renders exact per-kind revealed/withheld
  lists from the same object handed to the prover; unknown kinds are refused
  and can never reach the prove button; playground samples compile-check
  against the exported types.
- **Accessibility pass (#10):** real label pairing on every field,
  `role="progressbar"` semantics on both progress UIs, `aria-live`
  announcements for async outcomes (transfers, run summaries, unlock errors,
  report loads), non-color payroll status text, focus management into the
  generated grant panel, and `eslint-plugin-jsx-a11y` (recommended) enforced.

### Changed
- `parsePayrollCsv` now returns `{ rows, diagnostics }`.
- `AttestationProofInput.predicate` is a structured `Predicate`, serialized
  canonically at the WASM boundary.
- Test suite grew from 22 to 53 tests, including a scan micro-benchmark
  (`SCAN_BENCH_EVENTS=5000` reproduces the reference scenario).

## 0.2.0

Working wallet demo over a local chain simulation: encrypted vault,
shield/transfer/unshield with mock proving pipeline, payroll console,
attestation wallet, auditor disclosure portal, SDK playground.
