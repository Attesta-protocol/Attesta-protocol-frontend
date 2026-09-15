/**
 * Local simulation of the on-chain public state, backed by browser storage.
 * This stands in for the Soroban contracts + indexer until M2: it records
 * exactly what the real chain would make public — participants, commitments,
 * nullifiers, note ciphertexts, proofs — and NEVER a shielded amount.
 * Boundary operations (shield/unshield) carry a public amount, as they do on
 * the real chain where tokens visibly enter/leave the pool.
 */
import { sha256Hex, type EciesBox } from "./crypto";

export interface EncryptedNote {
  commitment: string;
  box: EciesBox;
}

export interface ChainEvent {
  id: string;
  type: "shield" | "transfer" | "unshield";
  timestamp: string;
  /** Sender's shielded address — public in v1 (amounts-only privacy). */
  actor: string;
  /** Recipient's shielded address for transfers — public in v1. */
  counterparty?: string;
  /** Public amount for boundary ops only; transfers never carry one. */
  publicAmount?: string;
  /**
   * Which entries of `commitments` are change flowing back to `actor`
   * rather than value newly delivered to `counterparty`. Lets an auditor
   * disclosure report (see wallet.ts) tell "I sent X and got Y back" apart
   * from "I received Y" — both decrypt identically under the actor's own
   * viewing key otherwise. Already inferable from output ordering/count by
   * anyone reading this open-source client, so making it explicit adds no
   * new leakage beyond the existing v1 scope (participants/timing public).
   */
  changeCommitments?: string[];
  commitments: string[];
  nullifiers: string[];
  ciphertexts: EncryptedNote[];
  proof: string;
}

interface ChainState {
  /** Random id minted when this chain store is first created. A cleared or
   * replaced store gets a new one, letting wallets invalidate scan caches. */
  genesis: string;
  events: ChainEvent[];
  nullifiers: string[];
  /** address → encryption public key (base64). Set once at registration. */
  directory: Record<string, string>;
}

const CHAIN_KEY = "attesta.localchain.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export class LocalChain {
  constructor(private storage: StorageLike = localStorage) {}

  private load(): ChainState {
    const raw = this.storage.getItem(CHAIN_KEY);
    if (raw) {
      const state = JSON.parse(raw) as ChainState;
      if (!state.genesis) {
        // Store predates genesis ids — mint one, once.
        state.genesis = crypto.randomUUID();
        this.save(state);
      }
      return state;
    }
    const fresh: ChainState = {
      genesis: crypto.randomUUID(),
      events: [],
      nullifiers: [],
      directory: {},
    };
    this.save(fresh); // persist immediately so the id is stable
    return fresh;
  }

  private save(state: ChainState): void {
    this.storage.setItem(CHAIN_KEY, JSON.stringify(state));
  }

  register(address: string, publicB64: string): void {
    const state = this.load();
    if (state.directory[address] && state.directory[address] !== publicB64) {
      throw new Error(`Address ${address} is already registered.`);
    }
    state.directory[address] = publicB64;
    this.save(state);
  }

  lookup(address: string): string | undefined {
    return this.load().directory[address];
  }

  /** Identifies this chain store's lifetime; changes when the store resets. */
  genesisId(): string {
    return this.load().genesis;
  }

  events(): ChainEvent[] {
    return this.load().events;
  }

  isSpent(nullifier: string): boolean {
    return this.load().nullifiers.includes(nullifier);
  }

  /** The full spent set, loaded once — for callers checking many notes. */
  nullifierSet(): Set<string> {
    return new Set(this.load().nullifiers);
  }

  /** Root over all commitments — stands in for the Merkle root (M2). */
  async root(): Promise<string> {
    const commitments = this.load().events.flatMap((e) => e.commitments);
    return commitments.length === 0
      ? "0x" + "0".repeat(64)
      : "0x" + (await sha256Hex(commitments.join("|")));
  }

  /**
   * Append an event, enforcing the no-double-spend invariant.
   *
   * NOT safe against two browser tabs racing a spend of the same note: this
   * is a synchronous check-then-write over `localStorage`, which gives no
   * cross-tab atomicity. On the real chain this is enforced by consensus;
   * here, only single-tab use is guaranteed to reject a double-spend before
   * it lands. Multi-tab races would need the Web Locks API (or an
   * equivalent lock) wrapped around this read-check-write sequence.
   */
  submit(event: Omit<ChainEvent, "id" | "timestamp">): ChainEvent {
    const state = this.load();
    for (const nul of event.nullifiers) {
      if (state.nullifiers.includes(nul)) {
        throw new Error("Rejected: nullifier already spent (double-spend).");
      }
    }
    const full: ChainEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    state.events.push(full);
    state.nullifiers.push(...event.nullifiers);
    this.save(state);
    return full;
  }
}
