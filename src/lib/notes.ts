/**
 * Note model for the shielded pool: openings, commitments, nullifiers, and
 * shielded addresses. Commitments/nullifiers are SHA-256 in this local
 * simulation; the production scheme (Pedersen commitments over BLS12-381,
 * per the circuits layer) replaces the hash choices here without changing
 * the shapes.
 */
import { sha256Hex } from "./crypto";

/** Smallest unit: 1e-7, stroop-style. */
export const UNIT = 10_000_000n;

/** Parse a decimal USDC amount string into smallest units. Throws on bad input. */
export function parseAmount(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(s.trim());
  if (!m) throw new Error("Enter a positive amount with up to 7 decimals.");
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(7, "0") || "0");
  const value = whole * UNIT + frac;
  if (value <= 0n) throw new Error("Amount must be greater than zero.");
  return value;
}

export function formatAmount(v: bigint): string {
  const whole = v / UNIT;
  const frac = (v % UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** The private opening of a note. Only ever plaintext on the owner's device. */
export interface NotePlain {
  /** Value in smallest units, as a decimal string (JSON-safe). */
  value: string;
  /** Random blinding factor, hex. */
  blinding: string;
  /** Owner's shielded address. */
  owner: string;
}

export function commitmentOf(note: NotePlain): Promise<string> {
  return sha256Hex(`note|${note.value}|${note.blinding}|${note.owner}`);
}

/**
 * Nullifier: derivable only with the spending key, so observers can't link
 * a spend back to the commitment it consumes.
 */
export function nullifierOf(
  commitment: string,
  spendingKey: string,
): Promise<string> {
  return sha256Hex(`nul|${commitment}|${spendingKey}`);
}

export async function addressFromPublic(publicB64: string): Promise<string> {
  return "attesta1" + (await sha256Hex(`addr|${publicB64}`)).slice(0, 40);
}

export function encodeNote(note: NotePlain): string {
  return JSON.stringify(note);
}

export function decodeNote(plaintext: string): NotePlain {
  const parsed = JSON.parse(plaintext) as NotePlain;
  if (
    typeof parsed.value !== "string" ||
    typeof parsed.blinding !== "string" ||
    typeof parsed.owner !== "string"
  ) {
    throw new Error("Malformed note plaintext.");
  }
  return parsed;
}
