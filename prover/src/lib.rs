//! Attesta client-side prover (Rust → wasm-bindgen).
//!
//! THE TRUST RULE: this crate runs in the user's browser (or CLI). Private
//! amounts, note openings, and credentials enter as JSON, and only the proof
//! plus its public inputs come out. Nothing here performs I/O.
//!
//! The real Groth16 provers arrive with milestone M3, consuming the circuits
//! and proving keys published from the `circuits/` layer. Until then these
//! entry points return an explicit error rather than a fake proof — the
//! frontend's mock backend (worker.ts) handles development ergonomics, and it
//! labels its output as mock. This crate must never emit an unverifiable
//! proof without saying so.

use wasm_bindgen::prelude::*;

#[derive(serde::Serialize)]
struct ProverError<'a> {
    error: &'a str,
}

fn not_implemented(circuit: &str) -> Result<String, JsValue> {
    let msg = format!(
        "{circuit} circuit not wired yet (milestone M3): proving keys are \
         published after the trusted setup; see the roadmap in the README"
    );
    Err(JsValue::from_str(&msg))
}

/// Prove a shielded transfer. `input_json` is a `TransferProofInput`
/// (see frontend src/lib/prover/types.ts). Returns a JSON `Proof`.
#[wasm_bindgen]
pub fn prove_transfer(input_json: &str) -> Result<String, JsValue> {
    let _input: serde_json::Value = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("bad transfer input: {e}")))?;
    not_implemented("transfer")
}

/// Prove a compliance attestation predicate over a locally-held credential.
/// `input_json` is an `AttestationProofInput`. Returns a JSON `Proof`.
#[wasm_bindgen]
pub fn prove_attestation(input_json: &str) -> Result<String, JsValue> {
    let _input: serde_json::Value = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("bad attestation input: {e}")))?;
    not_implemented("attestation")
}
