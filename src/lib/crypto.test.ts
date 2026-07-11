import { describe, expect, it } from "vitest";
import { eciesDecrypt, eciesEncrypt, generateViewingKeypair, randomHex, sha256Hex } from "./crypto";

describe("sha256Hex", () => {
  it("hashes deterministically to 64 hex chars", async () => {
    const a = await sha256Hex("attesta");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("attesta")).toBe(a);
    expect(await sha256Hex("attestb")).not.toBe(a);
  });
});

describe("randomHex", () => {
  it("returns the requested byte length in hex", () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(randomHex(32)).not.toBe(randomHex(32));
  });
});

describe("ECIES note encryption", () => {
  it("round-trips a plaintext to the right recipient", async () => {
    const alice = await generateViewingKeypair();
    const box = await eciesEncrypt(alice.publicB64, "secret note");
    expect(await eciesDecrypt(alice.privateJwk, box)).toBe("secret note");
  });

  it("fails to decrypt with the wrong private key", async () => {
    const alice = await generateViewingKeypair();
    const eve = await generateViewingKeypair();
    const box = await eciesEncrypt(alice.publicB64, "secret note");
    await expect(eciesDecrypt(eve.privateJwk, box)).rejects.toThrow();
  });
});
