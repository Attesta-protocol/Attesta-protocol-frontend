import { describe, expect, it } from "vitest";
import {
  addressFromPublic,
  commitmentOf,
  decodeNote,
  encodeNote,
  formatAmount,
  nullifierOf,
  parseAmount,
  UNIT,
} from "./notes";

describe("parseAmount / formatAmount", () => {
  it("parses whole and fractional amounts", () => {
    expect(parseAmount("1")).toBe(UNIT);
    expect(parseAmount("1.5")).toBe(15_000_000n);
    expect(parseAmount("0.0000001")).toBe(1n);
  });

  it("rejects bad input", () => {
    for (const bad of ["", "-1", "1.12345678", "abc", "0"]) {
      expect(() => parseAmount(bad)).toThrow();
    }
  });

  it("round-trips through format", () => {
    for (const s of ["1", "1.5", "0.0000001", "123456.789"]) {
      expect(formatAmount(parseAmount(s))).toBe(s);
    }
  });
});

describe("commitments and nullifiers", () => {
  const note = { value: "10000000", blinding: "ab".repeat(32), owner: "attesta1x" };

  it("commitment is deterministic and binding to every field", async () => {
    const c = await commitmentOf(note);
    expect(c).toBe(await commitmentOf({ ...note }));
    expect(await commitmentOf({ ...note, value: "10000001" })).not.toBe(c);
    expect(await commitmentOf({ ...note, blinding: "cd".repeat(32) })).not.toBe(c);
    expect(await commitmentOf({ ...note, owner: "attesta1y" })).not.toBe(c);
  });

  it("nullifier depends on the spending key", async () => {
    const c = await commitmentOf(note);
    expect(await nullifierOf(c, "key1")).not.toBe(await nullifierOf(c, "key2"));
  });
});

describe("addresses and note encoding", () => {
  it("derives a stable attesta1 address from a public key", async () => {
    const addr = await addressFromPublic("BASE64PUBKEY");
    expect(addr).toMatch(/^attesta1[0-9a-f]{40}$/);
    expect(await addressFromPublic("BASE64PUBKEY")).toBe(addr);
  });

  it("round-trips note encoding and rejects malformed plaintext", () => {
    const note = { value: "5", blinding: "aa", owner: "attesta1x" };
    expect(decodeNote(encodeNote(note))).toEqual(note);
    expect(() => decodeNote(JSON.stringify({ value: 5 }))).toThrow();
  });
});
