/**
 * Proving worker. Runs the WASM prover off the main thread so batch payroll
 * proofs don't freeze the UI, and reports progress back for the progress bar.
 *
 * Loads the wasm-bindgen package produced by `npm run build:prover`
 * (src/lib/prover/pkg). If the package hasn't been built (e.g. fresh clone
 * without a Rust toolchain), it falls back to a MOCK prover that produces
 * clearly-labelled fake proofs so the UI remains developable. The mock must
 * never be reachable in a production build — main thread asserts on backend.
 */
import type { Proof, ProverBackend, ProverRequest, ProverResponse } from "./types";

interface WasmProver {
  prove_transfer(inputJson: string): string;
  prove_attestation(inputJson: string): string;
}

let wasm: WasmProver | null = null;
let backend: ProverBackend = "mock";

async function init(): Promise<void> {
  try {
    // Built by `npm run build:prover`; absent on a fresh checkout. The
    // specifier is computed so neither TS nor Vite resolves it at build time.
    const pkgUrl = new URL("./pkg/attesta_prover.js", import.meta.url).href;
    const pkg = (await import(/* @vite-ignore */ pkgUrl)) as {
      default: () => Promise<unknown>;
    } & WasmProver;
    await pkg.default();
    wasm = pkg;
    backend = "wasm";
  } catch {
    backend = "mock";
  }
}

const ready = init();

function mockProof(label: string, publicInputs: string[]): Proof {
  return {
    proof: `MOCK_PROOF_DO_NOT_USE:${label}:${crypto.randomUUID()}`,
    publicInputs,
  };
}

// bigint-safe serialization for handing inputs to the WASM boundary
function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

self.onmessage = async (event: MessageEvent<ProverRequest>) => {
  const req = event.data;
  const post = (msg: ProverResponse) => self.postMessage(msg);
  const started = performance.now();

  try {
    await ready;
    post({ id: req.id, progress: 0.05 });

    let proof: Proof;
    if (wasm) {
      const raw =
        req.kind === "transfer"
          ? wasm.prove_transfer(toJson(req.input))
          : wasm.prove_attestation(toJson(req.input));
      proof = JSON.parse(raw) as Proof;
    } else {
      // Mock path: simulate proving latency so progress UX is exercised.
      for (let step = 1; step <= 4; step++) {
        await new Promise((r) => setTimeout(r, 150));
        post({ id: req.id, progress: step / 5 });
      }
      proof =
        req.kind === "transfer"
          ? mockProof("transfer", [req.input.merkleRoot])
          : mockProof("attestation", [req.input.issuerSetRoot]);
    }

    post({
      id: req.id,
      ok: true,
      proof,
      elapsedMs: performance.now() - started,
      backend,
    });
  } catch (e) {
    post({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
