/**
 * Micro-benchmark for Issue 3: on a synthetic high-traffic chain, an
 * incremental rescan must do zero trial decryptions and beat a cold scan
 * by a wide margin. Runs as a regular (slower) test so the win is guarded.
 *
 * Size via SCAN_BENCH_EVENTS (default 1000; use 5000 to reproduce the
 * issue's reference scenario).
 */
import { describe, expect, it } from "vitest";
import { LocalChain } from "./chain";
import { eciesDecrypt, eciesEncrypt, generateViewingKeypair, randomHex } from "./crypto";
import type { VaultContents } from "./keys";
import { addressFromPublic } from "./notes";
import { scanNotes, type WalletCtx } from "./wallet";

const EVENTS = Number(process.env.SCAN_BENCH_EVENTS ?? 1000);

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe(`scan benchmark over ${EVENTS} synthetic events`, () => {
  it("rescans incrementally with zero trial decryptions", { timeout: 120_000 }, async () => {
    const chain = new LocalChain(memoryStorage());

    const keys = await generateViewingKeypair();
    const me: VaultContents = {
      version: 2,
      spendingKey: randomHex(32),
      viewingPrivateJwk: keys.privateJwk,
      viewingPublicB64: keys.publicB64,
      address: await addressFromPublic(keys.publicB64),
      credentials: [],
      grants: [],
      sentLog: [],
    };
    const other = await generateViewingKeypair();
    const otherAddress = await addressFromPublic(other.publicB64);

    // Mostly other people's traffic, with our notes sprinkled in.
    for (let i = 0; i < EVENTS; i++) {
      const mine = i % 50 === 0;
      const box = await eciesEncrypt(
        mine ? keys.publicB64 : other.publicB64,
        JSON.stringify({
          value: "10000000",
          blinding: randomHex(32),
          owner: mine ? me.address : otherAddress,
        }),
      );
      chain.submit({
        type: "transfer",
        actor: otherAddress,
        counterparty: mine ? me.address : otherAddress,
        commitments: [randomHex(32)],
        nullifiers: [],
        ciphertexts: [{ commitment: randomHex(32), box }],
        proof: "bench",
      });
    }

    let decryptions = 0;
    const ctx: WalletCtx = {
      chain,
      vault: me,
      decrypt: (jwk, box) => {
        decryptions++;
        return eciesDecrypt(jwk, box);
      },
    };
    ctx.saveScanCache = (c) => {
      ctx.vault = { ...ctx.vault, scanCache: c };
    };

    const t0 = performance.now();
    const cold = await scanNotes(ctx);
    const coldMs = performance.now() - t0;
    const coldDecryptions = decryptions;
    expect(cold).toHaveLength(Math.ceil(EVENTS / 50));
    expect(coldDecryptions).toBe(EVENTS);

    const t1 = performance.now();
    const warm = await scanNotes(ctx);
    const warmMs = performance.now() - t1;
    expect(decryptions).toBe(coldDecryptions); // zero on the warm path
    expect(warm).toHaveLength(cold.length);

    console.log(
      `[scan-bench] ${EVENTS} events: cold ${coldMs.toFixed(0)}ms ` +
        `(${coldDecryptions} trial decryptions) → warm ${warmMs.toFixed(1)}ms (0 decryptions)`,
    );
    expect(warmMs).toBeLessThan(coldMs);
  });
});
