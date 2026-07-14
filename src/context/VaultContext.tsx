import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
  return [
    {
      id: crypto.randomUUID(),
      issuer: "Demo Anchor (SEP-12)",
      claim: "KYC level 2 passed",
      expiresAt: `${year}-01-15`,
      payload: "demo-credential",
    },
    {
      id: crypto.randomUUID(),
      issuer: "Demo Anchor (SEP-12)",
      claim: "Resident of jurisdiction: EU",
      expiresAt: `${year}-11-01`,
      payload: "demo-credential",
    },
  ];
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const chain = useMemo(() => new LocalChain(), []);
  const [vault, setVault] = useState<VaultContents | null>(null);
  // Held in memory only while unlocked, to persist vault mutations.
  const [passphrase, setPassphrase] = useState<string | null>(null);

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
      setVault(contents);
      setPassphrase(pass);
    },
    [chain],
  );

  const unlock = useCallback(
    async (pass: string) => {
      const contents = await loadVault(pass);
      if (!contents) throw new Error("No vault found — create one first.");
      // Re-register defensively (e.g. chain storage was cleared separately).
      if (!chain.lookup(contents.address)) {
        chain.register(contents.address, contents.viewingPublicB64);
      }
      setVault(contents);
      setPassphrase(pass);
    },
    [chain],
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
      setVault(contents);
      setPassphrase(pass);
    },
    [chain],
  );

  const lock = useCallback(() => {
    setVault(null);
    setPassphrase(null);
  }, []);

  const update = useCallback(
    async (mutate: (v: VaultContents) => VaultContents) => {
      if (!vault || passphrase === null) throw new Error("Vault is locked.");
      const next = mutate(vault);
      await saveVault(next, passphrase);
      setVault(next);
    },
    [vault, passphrase],
  );

  const api = useMemo(
    () => ({ status, vault, chain, create, unlock, lock, update, restore }),
    [status, vault, chain, create, unlock, lock, update, restore],
  );

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultApi {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
