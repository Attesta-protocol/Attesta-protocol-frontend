import { beforeEach, describe, expect, it } from "vitest";
import { LocalChain } from "./chain";
import { eciesDecrypt, generateViewingKeypair, randomHex } from "./crypto";
import type { VaultContents } from "./keys";
import { addressFromPublic, parseAmount } from "./notes";
import {
  balanceOf,
  buildDisclosureReport,
  decodeGrant,
  encodeGrant,
  scanNotes,
  shield,
  transfer,
  unshield,
  type ProveFn,
  type WalletCtx,
} from "./wallet";

/** In-memory Storage stand-in for node tests. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const stubProve: ProveFn = async (_input, onProgress) => {
  onProgress?.(1);
  return {
    proof: { proof: "STUB_PROOF", publicInputs: [] },
    elapsedMs: 0,
    backend: "mock",
  };
};

async function makeAccount(chain: LocalChain): Promise<VaultContents> {
  const keys = await generateViewingKeypair();
  const address = await addressFromPublic(keys.publicB64);
  chain.register(address, keys.publicB64);
  return {
    version: 2,
    spendingKey: randomHex(32),
    viewingPrivateJwk: keys.privateJwk,
    viewingPublicB64: keys.publicB64,
    address,
    credentials: [],
    grants: [],
    sentLog: [],
  };
}

describe("wallet end-to-end over the local chain", () => {
  let chain: LocalChain;
  let alice: WalletCtx;
  let bob: WalletCtx;

  beforeEach(async () => {
    chain = new LocalChain(memoryStorage());
    alice = { chain, vault: await makeAccount(chain), prove: stubProve };
    bob = { chain, vault: await makeAccount(chain), prove: stubProve };
  });

  it("shield → transfer → unshield with correct balances", async () => {
    await shield(alice, parseAmount("100"));
    expect(await balanceOf(alice)).toBe(parseAmount("100"));

    await transfer(alice, bob.vault.address, parseAmount("30"));
    expect(await balanceOf(alice)).toBe(parseAmount("70"));
    expect(await balanceOf(bob)).toBe(parseAmount("30"));

    await unshield(bob, parseAmount("10"));
    expect(await balanceOf(bob)).toBe(parseAmount("20"));
  });

  it("never records a plaintext transfer amount on the chain", async () => {
    await shield(alice, parseAmount("100"));
    await transfer(alice, bob.vault.address, parseAmount("30"));
    const transferEvents = chain.events().filter((e) => e.type === "transfer");
    expect(transferEvents).toHaveLength(1);
    expect(transferEvents[0].publicAmount).toBeUndefined();
    expect(JSON.stringify(transferEvents[0])).not.toContain(
      parseAmount("30").toString(),
    );
  });

  it("rejects transfers beyond the shielded balance", async () => {
    await shield(alice, parseAmount("5"));
    await expect(
      transfer(alice, bob.vault.address, parseAmount("6")),
    ).rejects.toThrow(/insufficient/i);
  });

  it("rejects transfers to unregistered addresses", async () => {
    await shield(alice, parseAmount("5"));
    await expect(
      transfer(alice, "attesta1" + "0".repeat(40), parseAmount("1")),
    ).rejects.toThrow(/not registered/i);
  });

  it("bob cannot decrypt alice's change note", async () => {
    await shield(alice, parseAmount("100"));
    await transfer(alice, bob.vault.address, parseAmount("30"));
    const bobNotes = await scanNotes(bob);
    expect(bobNotes.map((n) => n.note.owner)).toEqual([bob.vault.address]);
  });

  it("auditor grant reveals exactly the account's notes, verified on-chain", async () => {
    await shield(alice, parseAmount("100"));
    await transfer(alice, bob.vault.address, parseAmount("30"));

    const grant = decodeGrant(
      encodeGrant({
        v: 1,
        account: bob.vault.address,
        privateJwk: bob.vault.viewingPrivateJwk,
        label: "annual audit",
      }),
    );
    const report = await buildDisclosureReport(chain, grant);
    expect(report).toHaveLength(1);
    expect(report[0].amount).toBe(parseAmount("30").toString());
    expect(report[0].verified).toBe(true);
    expect(report[0].sender).toBe(alice.vault.address);
  });

  it("grant date scope filters events", async () => {
    await shield(alice, parseAmount("100"));
    await transfer(alice, bob.vault.address, parseAmount("30"));
    const grant = {
      v: 1 as const,
      account: bob.vault.address,
      privateJwk: bob.vault.viewingPrivateJwk,
      label: "expired scope",
      to: "2000-01-01T00:00:00.000Z",
    };
    expect(await buildDisclosureReport(chain, grant)).toHaveLength(0);
  });
});

describe("incremental note scanning with the vault cache", () => {
  let chain: LocalChain;
  let alice: WalletCtx;
  let bob: WalletCtx;
  let decryptCalls: number;

  const countingDecrypt: typeof eciesDecrypt = (jwk, box) => {
    decryptCalls++;
    return eciesDecrypt(jwk, box);
  };

  beforeEach(async () => {
    chain = new LocalChain(memoryStorage());
    decryptCalls = 0;
    alice = {
      chain,
      vault: await makeAccount(chain),
      prove: stubProve,
      decrypt: countingDecrypt,
    };
    alice.saveScanCache = (c) => {
      alice.vault = { ...alice.vault, scanCache: c };
    };
    bob = { chain, vault: await makeAccount(chain), prove: stubProve };
  });

  it("second scan performs zero trial decryptions for scanned events", async () => {
    await shield(alice, parseAmount("100"));
    await transfer(alice, bob.vault.address, parseAmount("30"));
    const warm = await scanNotes(alice);
    const afterWarm = decryptCalls;
    expect(afterWarm).toBeGreaterThan(0);

    const cached = await scanNotes(alice);
    expect(decryptCalls).toBe(afterWarm); // zero new trial decryptions
    expect(JSON.stringify(cached)).toBe(JSON.stringify(warm));
  });

  it("cached results are byte-identical to a cold rescan", async () => {
    await shield(alice, parseAmount("100"));
    await transfer(alice, bob.vault.address, parseAmount("30"));
    const cached = await scanNotes(alice);
    const cold: WalletCtx = {
      chain,
      vault: { ...alice.vault, scanCache: undefined },
      prove: stubProve,
    };
    expect(JSON.stringify(cached)).toBe(JSON.stringify(await scanNotes(cold)));
  });

  it("advances the cursor and only decrypts new ciphertexts", async () => {
    await shield(alice, parseAmount("100"));
    await scanNotes(alice);
    expect(alice.vault.scanCache?.cursor).toBe(chain.events().length);
    const afterFirst = decryptCalls;

    await transfer(alice, bob.vault.address, parseAmount("30"));
    await scanNotes(alice);
    expect(alice.vault.scanCache?.cursor).toBe(chain.events().length);
    // Only the transfer's ciphertexts (bob's note + alice's change) are new.
    expect(decryptCalls - afterFirst).toBe(2);
  });

  it("spent status updates from the nullifier set without re-decrypting", async () => {
    await shield(alice, parseAmount("100"));
    await scanNotes(alice);
    expect((await scanNotes(alice)).map((n) => n.spent)).toEqual([false]);

    await transfer(alice, bob.vault.address, parseAmount("30"));
    const notes = await scanNotes(alice);
    const original = notes.find((n) => n.note.value === parseAmount("100").toString());
    expect(original?.spent).toBe(true);
  });

  it("discards the cache when the chain store resets", async () => {
    await shield(alice, parseAmount("100"));
    await scanNotes(alice);
    expect(alice.vault.scanCache?.notes.length).toBeGreaterThan(0);

    // Simulate the chain store being cleared while the vault survives.
    const freshChain = new LocalChain(memoryStorage());
    freshChain.register(alice.vault.address, alice.vault.viewingPublicB64);
    const ctx: WalletCtx = { chain: freshChain, vault: alice.vault, prove: stubProve };
    expect(await scanNotes(ctx)).toEqual([]); // no stale notes
  });

  it("treats an event-count regression as a reset even with the same genesis", async () => {
    await shield(alice, parseAmount("100"));
    await scanNotes(alice);
    const tampered: WalletCtx = {
      chain,
      vault: {
        ...alice.vault,
        scanCache: { ...alice.vault.scanCache!, cursor: 999 },
      },
      prove: stubProve,
    };
    expect((await scanNotes(tampered)).length).toBe(1); // full rescan, correct result
  });

  it("concurrent callers share a single in-flight scan", async () => {
    await shield(alice, parseAmount("100"));
    const ctx: WalletCtx = {
      chain,
      vault: { ...alice.vault, scanCache: undefined },
      decrypt: countingDecrypt,
    };
    decryptCalls = 0;
    const [a, b] = await Promise.all([scanNotes(ctx), scanNotes(ctx)]);
    expect(a).toBe(b); // same promise, same result object
    expect(decryptCalls).toBe(1); // the one shield ciphertext, decrypted once
  });
});
