/** Inputs to a single shielded transfer proof. All fields stay client-side. */
export interface TransferProofInput {
  /** Amount in stroops-equivalent smallest units. Never leaves the device. */
  amount: bigint;
  /** Sender note commitment openings (private). */
  inputNotes: NoteOpening[];
  /** Recipient shielded address. */
  recipient: string;
  /** Merkle root the input notes are proven against (public). */
  merkleRoot: string;
}

export interface NoteOpening {
  commitment: string;
  value: bigint;
  blinding: string;
  merklePath: string[];
}

export interface AttestationProofInput {
  /** The signed credential from an issuer, held locally. */
  credential: string;
  /** The predicate to prove, e.g. "jurisdiction in EU", "kyc_level >= 2". */
  predicate: string;
  /** Registry epoch / issuer-set root the proof is anchored to (public). */
  issuerSetRoot: string;
}

export interface Proof {
  /** Groth16 proof bytes, hex-encoded. Safe to publish. */
  proof: string;
  /** Public inputs the on-chain verifier checks against. Safe to publish. */
  publicInputs: string[];
}

export type ProverRequest =
  | { kind: "transfer"; id: number; input: TransferProofInput }
  | { kind: "attestation"; id: number; input: AttestationProofInput };

export type ProverResponse =
  | { id: number; ok: true; proof: Proof; elapsedMs: number; backend: ProverBackend }
  | { id: number; ok: false; error: string }
  | { id: number; progress: number };

export type ProverBackend = "wasm" | "mock";
