/**
 * Local key vault: spending keys, viewing keys, and credentials live in
 * browser storage encrypted under a user passphrase (AES-GCM via a
 * PBKDF2-derived key). Explicit export/backup is the only way material
 * leaves this vault; nothing here talks to the network.
 */

const VAULT_KEY = "attesta.vault.v1";
const PBKDF2_ITERATIONS = 600_000;

export interface VaultContents {
  spendingKey?: string;
  viewingKeys: ViewingKey[];
  credentials: StoredCredential[];
}

export interface ViewingKey {
  id: string;
  label: string;
  /** Scope of history this key can decrypt, e.g. an account + date range. */
  scope: { account: string; from?: string; to?: string };
  key: string;
  revoked: boolean;
}

export interface StoredCredential {
  id: string;
  issuer: string;
  /** Human-readable claim summary, e.g. "KYC level 2". */
  claim: string;
  expiresAt: string;
  /** The raw signed credential — private, only ever fed to the local prover. */
  payload: string;
}

interface EncryptedVault {
  salt: string;
  iv: string;
  ciphertext: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function saveVault(contents: VaultContents, passphrase: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(JSON.stringify(contents)),
  );
  const vault: EncryptedVault = {
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(ciphertext)),
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

export async function loadVault(passphrase: string): Promise<VaultContents | null> {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  const vault = JSON.parse(raw) as EncryptedVault;
  const key = await deriveKey(passphrase, fromB64(vault.salt));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(vault.iv) as BufferSource },
      key,
      fromB64(vault.ciphertext) as BufferSource,
    );
    return JSON.parse(dec.decode(plaintext)) as VaultContents;
  } catch {
    throw new Error("Wrong passphrase or corrupted vault.");
  }
}

export function vaultExists(): boolean {
  return localStorage.getItem(VAULT_KEY) !== null;
}

/** Export the encrypted vault blob for backup. Still passphrase-protected. */
export function exportVault(): string {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) throw new Error("No vault to export.");
  return raw;
}

export function importVault(blob: string): void {
  // Validate shape before persisting.
  const parsed = JSON.parse(blob) as EncryptedVault;
  if (!parsed.salt || !parsed.iv || !parsed.ciphertext) {
    throw new Error("Not a valid Attesta vault backup.");
  }
  localStorage.setItem(VAULT_KEY, blob);
}
