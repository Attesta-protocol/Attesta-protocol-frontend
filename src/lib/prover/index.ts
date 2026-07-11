/**
 * Main-thread facade over the proving worker.
 *
 * THE TRUST RULE: proofs are generated client-side. Private amounts,
 * credentials, and viewing keys never leave this device. Nothing in this
 * module (or anything it calls) may perform a network request with private
 * inputs — only the resulting proof + public inputs are ever published.
 */
import type {
  AttestationProofInput,
  Proof,
  ProverBackend,
  ProverRequest,
  ProverResponse,
  TransferProofInput,
} from "./types";

export type { Proof, TransferProofInput, AttestationProofInput };

export interface ProveResult {
  proof: Proof;
  elapsedMs: number;
  backend: ProverBackend;
}

interface Pending {
  resolve: (r: ProveResult) => void;
  reject: (e: Error) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<ProverResponse>) => {
      const msg = event.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      if ("progress" in msg) {
        entry.onProgress?.(msg.progress);
        return;
      }
      pending.delete(msg.id);
      if (msg.ok) {
        if (msg.backend === "mock" && import.meta.env.PROD) {
          entry.reject(
            new Error(
              "Prover WASM package missing in a production build. Run `npm run build:prover`.",
            ),
          );
          return;
        }
        entry.resolve({ proof: msg.proof, elapsedMs: msg.elapsedMs, backend: msg.backend });
      } else {
        entry.reject(new Error(msg.error));
      }
    };
  }
  return worker;
}

function submit(
  req: Omit<ProverRequest, "id">,
  onProgress?: (fraction: number) => void,
): Promise<ProveResult> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...req, id });
  });
}

export function proveTransfer(
  input: TransferProofInput,
  onProgress?: (fraction: number) => void,
): Promise<ProveResult> {
  return submit({ kind: "transfer", input }, onProgress);
}

export function proveAttestation(
  input: AttestationProofInput,
  onProgress?: (fraction: number) => void,
): Promise<ProveResult> {
  return submit({ kind: "attestation", input }, onProgress);
}
