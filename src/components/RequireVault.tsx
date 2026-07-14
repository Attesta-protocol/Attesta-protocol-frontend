import { useState, type FormEvent, type ReactNode } from "react";
import { useVault } from "../context/VaultContext";
import Card from "./Card";
import { RestoreVaultForm } from "./VaultBackup";

/**
 * Gates a surface behind an unlocked vault, rendering the create/unlock
 * flow in place. Key material is generated locally and encrypted under the
 * passphrase before it touches storage.
 */
export default function RequireVault({ children }: { children: ReactNode }) {
  const { status, create, unlock } = useVault();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  if (status === "unlocked") return <>{children}</>;

  const creating = status === "none";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (creating && passphrase !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    if (creating && passphrase.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await (creating ? create(passphrase) : unlock(passphrase));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={creating ? "Create your local vault" : "Unlock your vault"}
      className="max-w-md"
    >
      <p className="mb-4 text-sm leading-relaxed text-slate-400">
        {creating
          ? "Your spending key, viewing key, and credentials are generated on this device and stored encrypted under this passphrase (PBKDF2 → AES-GCM). Nothing is sent anywhere."
          : "Enter your passphrase to decrypt your local vault. Decryption happens in this browser."}
      </p>
      <form onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="vault-passphrase" className="mb-1 block text-xs text-slate-400">
          Passphrase
        </label>
        <input
          id="vault-passphrase"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          className="mb-3 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {creating && (
          <>
            <label
              htmlFor="vault-passphrase-confirm"
              className="mb-1 block text-xs text-slate-400"
            >
              Confirm passphrase
            </label>
            <input
              id="vault-passphrase-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm passphrase"
              className="mb-3 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </>
        )}
        {/* Announced without focus changes (e.g. wrong passphrase). */}
        <div aria-live="polite">
          {error && <p className="mb-3 text-sm text-warn">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={busy || !passphrase}
          className="w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Working…" : creating ? "Create vault" : "Unlock"}
        </button>
      </form>
      <div className="mt-4 border-t border-line pt-4">
        <button
          onClick={() => setRestoring((r) => !r)}
          className="text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
        >
          {restoring ? "Cancel restore" : "Restore from a backup file instead"}
        </button>
        {restoring && (
          <div className="mt-3">
            <RestoreVaultForm />
          </div>
        )}
      </div>
    </Card>
  );
}
