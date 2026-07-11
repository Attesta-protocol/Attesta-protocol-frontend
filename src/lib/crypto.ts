/**
 * Low-level crypto helpers for the local simulation of the shielded pool.
 *
 * Note encryption uses an ECIES-style construction over WebCrypto ECDH
 * (P-256) + AES-GCM: each account publishes an encryption public key in the
 * directory; senders encrypt note openings to it with an ephemeral keypair.
 * Holding the private viewing key (or a scoped grant containing it) is what
 * lets a wallet — or an auditor — decrypt.
 *
 * This is simulation-grade plumbing for the sub-second UX loop; the
 * production note-encryption scheme ships with the circuits (M3) and is
 * specified alongside them.
 */

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export const toB64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));
export const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ViewingKeypair {
  /** Private viewing key (JWK, stringified). Never leaves the vault except in a scoped grant. */
  privateJwk: string;
  /** Public encryption key (raw point, base64). Published to the directory. */
  publicB64: string;
}

export async function generateViewingKeypair(): Promise<ViewingKeypair> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const privateJwk = JSON.stringify(
    await crypto.subtle.exportKey("jwk", pair.privateKey),
  );
  const publicRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return { privateJwk, publicB64: toB64(new Uint8Array(publicRaw)) };
}

/** An ECIES box: ephemeral public key + AES-GCM iv/ciphertext, all base64. */
export interface EciesBox {
  epk: string;
  iv: string;
  ct: string;
}

async function deriveAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function eciesEncrypt(
  recipientPublicB64: string,
  plaintext: string,
): Promise<EciesBox> {
  const recipientPub = await crypto.subtle.importKey(
    "raw",
    fromB64(recipientPublicB64) as BufferSource,
    ECDH,
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const aes = await deriveAesKey(ephemeral.privateKey, recipientPub);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    aes,
    new TextEncoder().encode(plaintext),
  );
  const epkRaw = await crypto.subtle.exportKey("raw", ephemeral.publicKey);
  return {
    epk: toB64(new Uint8Array(epkRaw)),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

/** Decrypt an ECIES box. Throws if the key does not match (wrong recipient). */
export async function eciesDecrypt(
  privateJwk: string,
  box: EciesBox,
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(privateJwk) as JsonWebKey,
    ECDH,
    false,
    ["deriveBits"],
  );
  const epk = await crypto.subtle.importKey(
    "raw",
    fromB64(box.epk) as BufferSource,
    ECDH,
    false,
    [],
  );
  const aes = await deriveAesKey(privateKey, epk);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(box.iv) as BufferSource },
    aes,
    fromB64(box.ct) as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
