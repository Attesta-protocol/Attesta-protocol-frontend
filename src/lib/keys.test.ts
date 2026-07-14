import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBackupFlag,
  decryptVaultBackup,
  exportVault,
  hasBackedUp,
  importVault,
  loadVault,
  markBackedUp,
  saveVault,
  vaultExists,
  type VaultContents,
} from "./keys";

function memoryLocalStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const contents: VaultContents = {
  version: 2,
  spendingKey: "ab".repeat(32),
  viewingPrivateJwk: '{"kty":"EC"}',
  viewingPublicB64: "UFVCS0VZ",
  address: "attesta1" + "a".repeat(40),
  credentials: [],
  grants: [],
  sentLog: [],
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vault export / backup", () => {
  it("exports only the encrypted blob — no plaintext key material", async () => {
    await saveVault(contents, "correct horse");
    const blob = exportVault();
    const parsed = JSON.parse(blob) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["ciphertext", "iv", "salt"]);
    expect(blob).not.toContain(contents.spendingKey);
    expect(blob).not.toContain(contents.address);
    expect(blob).not.toContain("spendingKey");
  });

  it("round-trips export → import → unlock", async () => {
    await saveVault(contents, "correct horse");
    const blob = exportVault();
    vi.stubGlobal("localStorage", memoryLocalStorage()); // "cleared storage"
    expect(vaultExists()).toBe(false);
    importVault(blob);
    expect(await loadVault("correct horse")).toEqual(contents);
  });
});

describe("restore guard (decryptVaultBackup)", () => {
  it("rejects a wrong passphrase without touching the stored vault", async () => {
    await saveVault(contents, "correct horse");
    const before = exportVault();
    const backup = exportVault();
    await expect(decryptVaultBackup(backup, "wrong")).rejects.toThrow(
      /wrong passphrase/i,
    );
    expect(exportVault()).toBe(before); // existing vault untouched
  });

  it("rejects malformed blobs with the backup error, storage untouched", async () => {
    await saveVault(contents, "correct horse");
    const before = exportVault();
    for (const bad of ["not json", "{}", '{"salt":"x"}', '{"salt":1,"iv":2,"ciphertext":3}', "null"]) {
      await expect(decryptVaultBackup(bad, "any")).rejects.toThrow(
        "Not a valid Attesta vault backup.",
      );
      expect(() => importVault(bad)).toThrow("Not a valid Attesta vault backup.");
    }
    expect(exportVault()).toBe(before);
  });

  it("decrypts a valid backup with the right passphrase", async () => {
    await saveVault(contents, "correct horse");
    expect(await decryptVaultBackup(exportVault(), "correct horse")).toEqual(contents);
  });
});

describe("backup-reminder flag", () => {
  it("is unset until marked, then survives until cleared", () => {
    expect(hasBackedUp()).toBe(false);
    markBackedUp();
    expect(hasBackedUp()).toBe(true);
    clearBackupFlag();
    expect(hasBackedUp()).toBe(false);
  });
});
