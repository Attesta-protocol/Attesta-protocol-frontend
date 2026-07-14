/**
 * Local key vault: spending keys, viewing keys, and credentials live in
 * browser storage encrypted under a user passphrase (AES-GCM via a
 * PBKDF2-derived key). Explicit export/backup is the only way material
 * leaves this vault; nothing here talks to the network.
 */

const VAULT_KEY = "attesta.vault.v1";
const BACKUP_FLAG_KEY = "attesta.vault.backedup.v1";
const PBKDF2_ITERATIONS = 600_000;

/** Fired whenever the persisted vault or backup flag changes (UI banners). */
export const VAULT_CHANGED_EVENT = "attesta:vault-changed";

function notifyVaultChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
  }
}

export interface VaultContents {
  version: 2;
  /** Spending key (hex). Authorizes spends; derives nullifiers. */
  spendingKey: string;
  /** Private viewing key (ECDH JWK, stringified). Decrypts incoming notes. */
  viewingPrivateJwk: string;
  /** Public encryption key (base64) — published to the chain directory. */
  viewingPublicB64: string;
  /** This account's shielded address. */
  address: string;
  credentials: StoredCredential[];
  /** Scoped viewing-key grants this account has issued (bookkeeping). */
  grants: IssuedGrant[];
  /** Outgoing transfer metadata, stored locally like any real shielded wallet. */
  sentLog: SentRecord[];
  /**
   * Incremental note-scan cache. Decrypted openings are sensitive, so this
   * lives ONLY here, inside the encrypted vault — never in plaintext storage.
   * Optional: older vaults simply rescan from zero.
   */
  scanCache?: ScanCache;
}

export interface CachedNote {
  note: { value: string; blinding: string; owner: string };
  commitment: string;
  /** Precomputed spend-marker so `spent` needs no re-derivation. */
  nullifier: string;
  eventId: string;
  eventType: "shield" | "transfer" | "unshield";
  timestamp: string;
  sender: string;
}

export interface ScanCache {
  /** Genesis id of the chain store this cache was built against. */
  genesis: string;
  /** Number of chain events already trial-decrypted. */
  cursor: number;
  notes: CachedNote[];
}

export interface IssuedGrant {
  id: string;
  label: string;
  from?: string;
  to?: string;
  createdAt: string;
  revoked: boolean;
}

export interface SentRecord {
  eventId: string;
  recipient: string;
  /** Amount in smallest units, decimal string. Local-only. */
  amount: string;
  timestamp: string;
}

export interface StoredCredential {
  id: string;
  issuer: string;
  /** Human-readable claim summary — display only, derived from `predicate`. */
  claim: string;
  /**
   * The structured predicate this credential can prove (see
   * prover/predicates.ts). Credentials predating the structured model lack
   * it and the wallet refuses to prove them (re-request from the issuer).
   */
  predicate?: unknown;
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
  notifyVaultChanged();
}

async function decryptVault(
  vault: EncryptedVault,
  passphrase: string,
): Promise<VaultContents> {
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

export async function loadVault(passphrase: string): Promise<VaultContents | null> {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  return decryptVault(JSON.parse(raw) as EncryptedVault, passphrase);
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

/** Parse a backup blob, throwing without touching storage. */
function parseBackup(blob: string): EncryptedVault {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new Error("Not a valid Attesta vault backup.");
  }
  const v = parsed as Partial<EncryptedVault> | null;
  if (
    typeof v?.salt !== "string" ||
    typeof v?.iv !== "string" ||
    typeof v?.ciphertext !== "string"
  ) {
    throw new Error("Not a valid Attesta vault backup.");
  }
  return v as EncryptedVault;
}

/**
 * Decrypt a backup blob without persisting anything — restore flows verify
 * the passphrase against the backup BEFORE any existing vault is overwritten.
 */
export async function decryptVaultBackup(
  blob: string,
  passphrase: string,
): Promise<VaultContents> {
  return decryptVault(parseBackup(blob), passphrase);
}

export function importVault(blob: string): void {
  parseBackup(blob); // validate shape before persisting
  localStorage.setItem(VAULT_KEY, blob);
  notifyVaultChanged();
}

/** True once the user has exported a backup of the current vault. */
export function hasBackedUp(): boolean {
  return localStorage.getItem(BACKUP_FLAG_KEY) !== null;
}

/** Record the first successful export; retires the backup-reminder banner. */
export function markBackedUp(): void {
  localStorage.setItem(BACKUP_FLAG_KEY, new Date().toISOString());
  notifyVaultChanged();
}

/** A fresh or restored vault needs a fresh backup. */
export function clearBackupFlag(): void {
  localStorage.removeItem(BACKUP_FLAG_KEY);
  notifyVaultChanged();
}
