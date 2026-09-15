import { useState } from "react";
import { connectFreighter, type WalletConnection } from "../lib/freighter";

export default function WalletButton() {
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      setWallet(await connectFreighter());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }

  if (wallet) {
    return (
      <span className="flex items-center gap-2">
        <span
          className="rounded-lg bg-surface-raised px-3 py-1.5 font-mono text-xs text-ok"
          title={wallet.publicKey}
        >
          {wallet.publicKey.slice(0, 4)}…{wallet.publicKey.slice(-4)}
        </span>
        <button
          onClick={() => setWallet(null)}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          Disconnect
        </button>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-warn">{error}</span>}
      <button
        onClick={onConnect}
        disabled={busy}
        className="rounded-lg bg-accent-strong px-3.5 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect Freighter"}
      </button>
    </div>
  );
}
