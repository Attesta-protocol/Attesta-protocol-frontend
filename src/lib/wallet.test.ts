import { beforeEach, describe, expect, it } from "vitest";
import { LocalChain } from "./chain";
import { generateViewingKeypair, randomHex } from "./crypto";
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
