import { useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import { proveTransfer, type ProveResult } from "../lib/prover";

type Action = "shield" | "transfer" | "unshield";

export default function PayReceive() {
  const [action, setAction] = useState<Action>("transfer");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ProveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onProve() {
    setError(null);
    setResult(null);
    setProgress(0);
    try {
      const res = await proveTransfer(
        {
          amount: BigInt(Math.round(Number(amount || "0") * 10_000_000)),
          inputNotes: [],
          recipient,
          merkleRoot: "0x" + "0".repeat(64),
        },
        setProgress,
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Confidential pay / receive"
        subtitle="Shield stablecoins into the pool, transfer with hidden amounts, or unshield back to a public balance. The proof for each action is generated in your browser — the amount below never leaves this device."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card title="New action">
          <div className="mb-4 flex gap-1 rounded-lg bg-surface-raised p-1">
            {(["shield", "transfer", "unshield"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                  action === a
                    ? "bg-accent-strong font-medium text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <label className="mb-1 block text-xs text-slate-400">
            Amount (USDC) — <span className="text-shielded">shielded, stays local</span>
          </label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="mb-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          {action === "transfer" && (
            <>
              <label className="mb-1 block text-xs text-slate-400">
                Recipient shielded address — <span className="text-warn">public in v1</span>
              </label>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="attesta1…"
                className="mb-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
            </>
          )}
          <button
            onClick={onProve}
            disabled={progress !== null || !amount}
            className="w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
          >
            {progress !== null
              ? `Proving locally… ${Math.round(progress * 100)}%`
              : "Generate proof & submit"}
          </button>
          {progress !== null && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full bg-shielded transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          {error && <p className="mt-3 text-sm text-warn">{error}</p>}
          {result && (
            <div className="mt-4 rounded-lg border border-line bg-surface-raised p-3 text-xs">
              <p className="text-ok">
                Proof generated in {(result.elapsedMs / 1000).toFixed(2)}s
                {result.backend === "mock" && (
                  <span className="ml-2 text-warn">
                    (mock backend — run `npm run build:prover` for the real WASM prover)
                  </span>
                )}
              </p>
              <p className="mt-2 truncate font-mono text-slate-500">{result.proof.proof}</p>
            </div>
          )}
        </Card>
        <Card title="Shielded history (decrypted locally)">
          <p className="text-sm leading-relaxed text-slate-400">
            Your note history appears here once the indexer relay is connected
            (milestone M2/M3). Notes are scanned and decrypted in this browser
            with your viewing key — the backend only ever sees ciphertext.
          </p>
          <div className="mt-4 rounded-lg border border-dashed border-line p-6 text-center text-xs text-slate-500">
            No notes yet — shield funds to get started.
          </div>
        </Card>
      </div>
    </div>
  );
}
