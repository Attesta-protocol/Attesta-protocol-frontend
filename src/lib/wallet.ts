/**
 * High-level wallet operations over the local chain simulation.
 *
 * THE TRUST RULE applies here concretely: openings are decrypted, selected,
 * and re-encrypted on this device; only commitments, nullifiers, ciphertexts,
 * and proofs are submitted. The `prove` function is injectable so the pure
 * logic is testable without a Web Worker.
 */
import { LocalChain, type ChainEvent, type EncryptedNote } from "./chain";
import { eciesDecrypt, eciesEncrypt, fromB64, randomHex, toB64 } from "./crypto";
import type { SentRecord, VaultContents } from "./keys";
import {
  commitmentOf,
  decodeNote,
  encodeNote,
  nullifierOf,
  type NotePlain,
} from "./notes";
import { proveTransfer, type ProveResult, type TransferProofInput } from "./prover";

export type ProveFn = (
  input: TransferProofInput,
  onProgress?: (fraction: number) => void,
) => Promise<ProveResult>;

export interface WalletCtx {
  chain: LocalChain;
  vault: VaultContents;
  prove?: ProveFn;
}

/** A note this wallet can decrypt, with its on-chain context. */
export interface OwnedNote {
  note: NotePlain;
  commitment: string;
  eventId: string;
  eventType: ChainEvent["type"];
  timestamp: string;
  sender: string;
  spent: boolean;
}

async function encryptTo(
  chain: LocalChain,
  address: string,
  note: NotePlain,
): Promise<EncryptedNote> {
  const publicB64 = chain.lookup(address);
  if (!publicB64) {
    throw new Error(
      `Recipient ${address.slice(0, 16)}… is not registered in the directory.`,
    );
  }
  return {
    commitment: await commitmentOf(note),
    box: await eciesEncrypt(publicB64, encodeNote(note)),
  };
}

/** Scan the chain, trial-decrypting every ciphertext with our viewing key. */
export async function scanNotes(ctx: WalletCtx): Promise<OwnedNote[]> {
  const owned: OwnedNote[] = [];
  for (const event of ctx.chain.events()) {
    for (const enc of event.ciphertexts) {
      let note: NotePlain;
      try {
        note = decodeNote(await eciesDecrypt(ctx.vault.viewingPrivateJwk, enc.box));
      } catch {
        continue; // not ours
      }
      const nullifier = await nullifierOf(enc.commitment, ctx.vault.spendingKey);
      owned.push({
        note,
        commitment: enc.commitment,
        eventId: event.id,
        eventType: event.type,
        timestamp: event.timestamp,
        sender: event.actor,
        spent: ctx.chain.isSpent(nullifier),
      });
    }
  }
  return owned;
}

export async function balanceOf(ctx: WalletCtx): Promise<bigint> {
  const notes = await scanNotes(ctx);
  return notes
    .filter((n) => !n.spent && n.note.owner === ctx.vault.address)
    .reduce((sum, n) => sum + BigInt(n.note.value), 0n);
}

/** Greedy note selection; returns inputs covering `amount` plus the change. */
async function selectInputs(ctx: WalletCtx, amount: bigint) {
  const unspent = (await scanNotes(ctx)).filter(
    (n) => !n.spent && n.note.owner === ctx.vault.address,
  );
  unspent.sort((a, b) => (BigInt(b.note.value) > BigInt(a.note.value) ? 1 : -1));
  const inputs: OwnedNote[] = [];
  let total = 0n;
  for (const n of unspent) {
    if (total >= amount) break;
    inputs.push(n);
    total += BigInt(n.note.value);
  }
  if (total < amount) {
    throw new Error("Insufficient shielded balance.");
  }
  return { inputs, change: total - amount };
}

function newNote(owner: string, value: bigint): NotePlain {
  return { value: value.toString(), blinding: randomHex(32), owner };
}

/** Deposit into the pool. The deposit amount is public (boundary op). */
export async function shield(ctx: WalletCtx, amount: bigint): Promise<ChainEvent> {
  const note = newNote(ctx.vault.address, amount);
  const enc = await encryptTo(ctx.chain, ctx.vault.address, note);
  return ctx.chain.submit({
    type: "shield",
    actor: ctx.vault.address,
    publicAmount: amount.toString(),
    commitments: [enc.commitment],
    nullifiers: [],
    ciphertexts: [enc],
    proof: "n/a (public deposit)",
  });
}

async function proveSpend(
  ctx: WalletCtx,
  inputs: OwnedNote[],
  amount: bigint,
  recipient: string,
  onProgress?: (fraction: number) => void,
): Promise<ProveResult> {
  const prove = ctx.prove ?? proveTransfer;
  return prove(
    {
      amount,
      inputNotes: inputs.map((n) => ({
        commitment: n.commitment,
        value: BigInt(n.note.value),
        blinding: n.note.blinding,
        merklePath: [],
      })),
      recipient,
      merkleRoot: await ctx.chain.root(),
    },
    onProgress,
  );
}

/** Confidential transfer: amount hidden, participants public (v1 scope). */
export async function transfer(
  ctx: WalletCtx,
  recipient: string,
  amount: bigint,
  onProgress?: (fraction: number) => void,
): Promise<{ event: ChainEvent; sent: SentRecord }> {
  if (!ctx.chain.lookup(recipient)) {
    throw new Error(
      `Recipient ${recipient.slice(0, 16)}… is not registered in the directory.`,
    );
  }
  const { inputs, change } = await selectInputs(ctx, amount);
  const proof = await proveSpend(ctx, inputs, amount, recipient, onProgress);

  const outputs: EncryptedNote[] = [
    await encryptTo(ctx.chain, recipient, newNote(recipient, amount)),
  ];
  if (change > 0n) {
    outputs.push(
      await encryptTo(ctx.chain, ctx.vault.address, newNote(ctx.vault.address, change)),
    );
  }
  const nullifiers = await Promise.all(
    inputs.map((n) => nullifierOf(n.commitment, ctx.vault.spendingKey)),
  );
  const event = ctx.chain.submit({
    type: "transfer",
    actor: ctx.vault.address,
    counterparty: recipient,
    commitments: outputs.map((o) => o.commitment),
    nullifiers,
    ciphertexts: outputs,
    proof: proof.proof.proof,
  });
  const sent: SentRecord = {
    eventId: event.id,
    recipient,
    amount: amount.toString(),
    timestamp: event.timestamp,
  };
  return { event, sent };
}

/** Withdraw from the pool. The withdrawn amount is public (boundary op). */
export async function unshield(
  ctx: WalletCtx,
  amount: bigint,
  onProgress?: (fraction: number) => void,
): Promise<ChainEvent> {
  const { inputs, change } = await selectInputs(ctx, amount);
  const proof = await proveSpend(ctx, inputs, amount, ctx.vault.address, onProgress);

  const outputs: EncryptedNote[] = [];
  if (change > 0n) {
    outputs.push(
      await encryptTo(ctx.chain, ctx.vault.address, newNote(ctx.vault.address, change)),
    );
  }
  const nullifiers = await Promise.all(
    inputs.map((n) => nullifierOf(n.commitment, ctx.vault.spendingKey)),
  );
  return ctx.chain.submit({
    type: "unshield",
    actor: ctx.vault.address,
    publicAmount: amount.toString(),
    commitments: outputs.map((o) => o.commitment),
    nullifiers,
    ciphertexts: outputs,
    proof: proof.proof.proof,
  });
}

// ---------------------------------------------------------------------------
// Scoped viewing-key grants (auditor disclosure)
// ---------------------------------------------------------------------------

export interface ViewingGrant {
  v: 1;
  account: string;
  privateJwk: string;
  label: string;
  from?: string;
  to?: string;
}

const GRANT_PREFIX = "avk1";

export function encodeGrant(grant: ViewingGrant): string {
  return GRANT_PREFIX + toB64(new TextEncoder().encode(JSON.stringify(grant)));
}

export function decodeGrant(encoded: string): ViewingGrant {
  const trimmed = encoded.trim();
  if (!trimmed.startsWith(GRANT_PREFIX)) {
    throw new Error("Not a valid viewing key (expected avk1… format).");
  }
  const grant = JSON.parse(
    new TextDecoder().decode(fromB64(trimmed.slice(GRANT_PREFIX.length))),
  ) as ViewingGrant;
  if (grant.v !== 1 || !grant.account || !grant.privateJwk) {
    throw new Error("Malformed viewing key.");
  }
  return grant;
}

/** One row of an auditor report: a decrypted note, re-verified on-chain. */
export interface DisclosureRow {
  eventId: string;
  eventType: ChainEvent["type"];
  timestamp: string;
  sender: string;
  /** Decrypted amount, smallest units as string. */
  amount: string;
  /** True iff recomputing the commitment from the opening matches the chain. */
  verified: boolean;
}

/**
 * Auditor-side report: decrypt what the grant's key can decrypt, restricted
 * to the grant's scope, and independently verify each opening against the
 * on-chain commitment. No Attesta server involved.
 */
export async function buildDisclosureReport(
  chain: LocalChain,
  grant: ViewingGrant,
): Promise<DisclosureRow[]> {
  const rows: DisclosureRow[] = [];
  for (const event of chain.events()) {
    if (grant.from && event.timestamp < grant.from) continue;
    if (grant.to && event.timestamp > grant.to) continue;
    if (event.actor !== grant.account && event.counterparty !== grant.account) {
      continue;
    }
    for (const enc of event.ciphertexts) {
      let note: NotePlain;
      try {
        note = decodeNote(await eciesDecrypt(grant.privateJwk, enc.box));
      } catch {
        continue; // not decryptable under this grant
      }
      if (note.owner !== grant.account) continue; // outside the grant's scope
      rows.push({
        eventId: event.id,
        eventType: event.type,
        timestamp: event.timestamp,
        sender: event.actor,
        amount: note.value,
        verified: (await commitmentOf(note)) === enc.commitment,
      });
    }
  }
  return rows;
}
