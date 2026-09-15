import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LocalChain } from "../lib/chain";
import { generateViewingKeypair, randomHex } from "../lib/crypto";
import {
  clearBackupFlag,
  decryptVaultBackup,
  importVault,
  loadVault,
  markBackedUp,
  saveVault,
  vaultExists,
  type StoredCredential,
  type VaultContents,
} from "../lib/keys";
import { addressFromPublic } from "../lib/notes";
import { describePredicate, type Predicate } from "../lib/prover/predicates";

export type VaultStatus = "none" | "locked" | "unlocked";

interface VaultApi {
  status: VaultStatus;
  vault: VaultContents | null;
  chain: LocalChain;
  create: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  /** Mutate vault contents and persist under the unlock passphrase. */
  update: (mutate: (v: VaultContents) => VaultContents) => Promise<void>;
  /**
   * Synchronous read of the current vault, bypassing React's render lag.
   * For a caller that makes several sequential wallet operations in one
   * handler (e.g. a payroll batch loop), the `vault` returned by this hook
   * is a snapshot from before the handler started and never advances mid-
   * loop — using it for every operation silently defeats the incremental
   * scan cache (each call rescans from the same stale cursor). Rebuild the
   * WalletCtx passed to each operation from `getVault()` instead.
   */
  getVault: () => VaultContents | null;
  /**
   * Restore from an exported backup blob and unlock it. Verifies the blob
   * and passphrase BEFORE overwriting any existing vault (never destructive
   * on failure). Callers are responsible for confirming the overwrite.
   */
  restore: (blob: string, passphrase: string) => Promise<void>;
}

const VaultContext = createContext<VaultApi | null>(null);

// Demo credentials seeded at vault creation, standing in for the issuer
// gateway (M5). Clearly labelled as demo issuance in the UI.
function demoCredentials(): StoredCredential[] {
  const year = new Date().getFullYear() + 1;
  const kyc: Predicate = { kind: "kyc-level", min: 2 };
  const jurisdiction: Predicate = { kind: "jurisdiction", in: ["EU"] };
  return [
    {
      id: crypto.randomUUID(),
      issuer: "Demo Anchor (SEP-12)",
      claim: describePredicate(kyc),
      predicate: kyc,
      expiresAt: `${year}-01-15`,
      payload: "demo-credential",
    },
    {
      id: crypto.randomUUID(),
      issuer: "Demo Anchor (SEP-12)",
      claim: describePredicate(jurisdiction),
      predicate: jurisdiction,
      expiresAt: `${year}-11-01`,
      payload: "demo-credential",
    },
  ];
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const chain = useMemo(() => new LocalChain(), []);
  const [vault, setVault] = useState<VaultContents | null>(null);

  // The passphrase (needed to persist mutations) and a mirror of `vault`,
  // both updated synchronously — not via React's deferred re-render — so
  // that `update()` always mutates the value the previous `update()` call
  // just persisted, even when several `update()` calls happen back-to-back
  // inside one handler (e.g. a payroll batch loop) before this component has
  // had a chance to re-render with fresh state. Without this, every
  // `update()` after the first would silently discard the ones before it,
  // since each would close over `vault` state as it was at the render
  // before the handler started.
  const vaultRef = useRef<VaultContents | null>(null);
  const passphraseRef = useRef<string | null>(null);

  const setVaultState = useCallback((next: VaultContents | null) => {
    vaultRef.current = next;
    setVault(next);
  }, []);

  const status: VaultStatus = vault ? "unlocked" : vaultExists() ? "locked" : "none";

  const create = useCallback(
    async (pass: string) => {
      if (vaultExists()) throw new Error("A vault already exists — unlock it instead.");
      const keys = await generateViewingKeypair();
      const address = await addressFromPublic(keys.publicB64);
      const contents: VaultContents = {
        version: 2,
        spendingKey: randomHex(32),
        viewingPrivateJwk: keys.privateJwk,
        viewingPublicB64: keys.publicB64,
        address,
        credentials: demoCredentials(),
        grants: [],
        sentLog: [],
      };
      chain.register(address, keys.publicB64);
      await saveVault(contents, pass);
      clearBackupFlag(); // a fresh vault needs a fresh backup
      setVaultState(contents);
      passphraseRef.current = pass;
    },
    [chain, setVaultState],
  );

  const unlock = useCallback(
    async (pass: string) => {
      const contents = await loadVault(pass);
      if (!contents) throw new Error("No vault found — create one first.");
      // Re-register defensively (e.g. chain storage was cleared separately).
      if (!chain.lookup(contents.address)) {
        chain.register(contents.address, contents.viewingPublicB64);
      }
      setVaultState(contents);
      passphraseRef.current = pass;
    },
    [chain, setVaultState],
  );

  const restore = useCallback(
    async (blob: string, pass: string) => {
      // Throws (wrong passphrase / malformed file) before anything persists.
      const contents = await decryptVaultBackup(blob, pass);
      importVault(blob);
      markBackedUp(); // the user is restoring from a backup they hold
      if (!chain.lookup(contents.address)) {
        chain.register(contents.address, contents.viewingPublicB64);
      }
      setVaultState(contents);
      passphraseRef.current = pass;
    },
    [chain, setVaultState],
  );

  const lock = useCallback(() => {
    setVaultState(null);
    passphraseRef.current = null;
  }, [setVaultState]);

  const update = useCallback(
    async (mutate: (v: VaultContents) => VaultContents) => {
      if (!vaultRef.current || passphraseRef.current === null) {
        throw new Error("Vault is locked.");
      }
      const next = mutate(vaultRef.current);
      await saveVault(next, passphraseRef.current);
      setVaultState(next);
    },
    [setVaultState],
  );

  const getVault = useCallback(() => vaultRef.current, []);

  const api = useMemo(
    () => ({ status, vault, chain, create, unlock, lock, update, restore, getVault }),
    [status, vault, chain, create, unlock, lock, update, restore, getVault],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultApi {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
