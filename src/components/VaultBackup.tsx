import { useEffect, useRef, useState, type FormEvent } from "react";
import { useVault } from "../context/VaultContext";
import {
  exportVault,
  hasBackedUp,
  markBackedUp,
  vaultExists,
  VAULT_CHANGED_EVENT,
} from "../lib/keys";
import Card from "./Card";

/** Download the encrypted vault blob and retire the reminder banner. */
export function downloadVaultBackup(): void {
  const blob = exportVault(); // throws if there is no vault
  const date = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(new Blob([blob], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `attesta-vault-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  markBackedUp();
}

/**
 * Restore-from-backup form: file picker → passphrase → (typed confirmation
 * when overwriting an existing vault) → restore + unlock. Verification runs
 * against the backup before anything is overwritten, so a wrong passphrase
 * or malformed file never destroys the current vault.
 */
export function RestoreVaultForm({ onDone }: { onDone?: () => void }) {
  const { restore } = useVault();
  const [blob, setBlob] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const overwriting = vaultExists();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!blob) {
      setError("Choose a backup file first.");
      return;
    }
    if (overwriting && confirmText !== "restore") {
      setError('This replaces the existing vault on this device — type "restore" to confirm.');
      return;
    }
    setBusy(true);
    try {
      await restore(blob, passphrase);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
      <div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
        >
          {fileName ? `File: ${fileName}` : "Choose backup file…"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              void f.text().then((t) => {
                setBlob(t);
                setFileName(f.name);
                setError(null);
              });
            }
            e.target.value = "";
          }}
        />
      </div>
      <label className="block text-xs text-slate-400">
        Backup passphrase
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase the backup was created under"
          className="mt-1 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-slate-200 outline-none focus:border-accent"
        />
      </label>
      {overwriting && (
        <label className="block text-xs text-warn">
          Restoring replaces the vault already on this device. Type{" "}
          <code className="font-mono">restore</code> to confirm.
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="restore"
            className="mt-1 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
      )}
      {error && <p className="text-sm text-warn">{error}</p>}
      <button
        type="submit"
        disabled={busy || !blob || !passphrase}
        className="w-full rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
      >
        {busy ? "Restoring…" : "Restore & unlock"}
      </button>
    </form>
  );
}

/** Vault settings card: export a backup, or restore from one. */
export function VaultSettingsCard() {
  const [exported, setExported] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title="Vault settings">
      <p className="text-xs leading-relaxed text-slate-500">
        Your keys exist only in this browser. If this storage is cleared without
        a backup, the vault — spending key, viewing key, credentials, history —
        is gone irrecoverably.
      </p>
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => {
            try {
              downloadVaultBackup();
              setExported(true);
              setError(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
        >
          Export backup
        </button>
        <button
          onClick={() => setShowRestore((s) => !s)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
        >
          {showRestore ? "Hide restore" : "Restore from backup"}
        </button>
      </div>
      {exported && (
        <p className="mt-3 text-xs leading-relaxed text-ok">
          Backup downloaded. The file is still encrypted under your passphrase —
          it is useless without it, and worthless to anyone who only finds the file.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-warn">{error}</p>}
      {showRestore && (
        <div className="mt-4 border-t border-line pt-4">
          <RestoreVaultForm onDone={() => setShowRestore(false)} />
        </div>
      )}
    </Card>
  );
}

/**
 * Persistent, dismissable reminder shown after vault creation until the
 * first successful export.
 */
export function BackupBanner() {
  const [needed, setNeeded] = useState(() => vaultExists() && !hasBackedUp());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const recompute = () => setNeeded(vaultExists() && !hasBackedUp());
    window.addEventListener(VAULT_CHANGED_EVENT, recompute);
    return () => window.removeEventListener(VAULT_CHANGED_EVENT, recompute);
  }, []);

  if (!needed || dismissed) return null;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line bg-surface-raised px-8 py-2 text-xs text-slate-300">
      <span>
        <span className="text-warn">Back up your vault.</span> Your keys live only
        in this browser — export an encrypted backup from Vault settings on the
        Pay/Receive page before you rely on this wallet.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-slate-500 hover:text-slate-300"
        aria-label="Dismiss backup reminder"
      >
        dismiss
      </button>
    </div>
  );
}
