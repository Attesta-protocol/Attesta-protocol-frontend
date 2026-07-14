import { useCallback, useEffect, useMemo, useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import RequireVault from "../components/RequireVault";
import { VaultSettingsCard } from "../components/VaultBackup";
import { useVault } from "../context/VaultContext";
import { generateViewingKeypair } from "../lib/crypto";
import { addressFromPublic, formatAmount, parseAmount } from "../lib/notes";
import {
  balanceOf,
  scanNotes,
  shield,
  transfer,
  unshield,
  type WalletCtx,
} from "../lib/wallet";

type Action = "shield" | "transfer" | "unshield";

interface HistoryEntry {
  key: string;
  direction: "in" | "out" | "boundary";
  label: string;
  amount: bigint;
  counterparty: string;
  timestamp: string;
}

const DEMO_RECIPIENTS_KEY = "attesta.demo-recipients.v1";

interface DemoRecipient {
  label: string;
  address: string;
  /** Kept so a demo auditor grant can be built for this recipient. */
  privateJwk: string;
}

function loadDemoRecipients(): DemoRecipient[] {
  return JSON.parse(localStorage.getItem(DEMO_RECIPIENTS_KEY) ?? "[]") as DemoRecipient[];
}

export default function PayReceive() {
  return (
    <div>
      <PageHeader
        title="Confidential pay / receive"
        subtitle="Shield stablecoins into the pool, transfer with hidden amounts, or unshield back to a public balance. Proofs and note decryption happen in your browser — transfer amounts never leave this device. Deposits and withdrawals are boundary operations, so those amounts are public, as on the real chain."
      />
      <RequireVault>
        <Wallet />
      </RequireVault>
    </div>
  );
}

function Wallet() {
  const { vault, chain, update } = useVault();
  const ctx = useMemo<WalletCtx | null>(
    () =>
      vault
        ? {
            chain,
            vault,
            // Persist decrypted openings (encrypted vault only) so later
            // scans skip already-seen events.
            saveScanCache: (cache) => update((v) => ({ ...v, scanCache: cache })),
          }
        : null,
    [chain, vault, update],
  );

  const [action, setAction] = useState<Action>("shield");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [demoRecipients, setDemoRecipients] = useState<DemoRecipient[]>(loadDemoRecipients);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    setBalance(await balanceOf(ctx));
    const notes = await scanNotes(ctx);
    const incoming: HistoryEntry[] = notes
      .filter((n) => n.sender !== ctx.vault.address)
      .map((n) => ({
        key: `in-${n.commitment}`,
        direction: "in",
        label: "Received (shielded)",
        amount: BigInt(n.note.value),
        counterparty: n.sender,
        timestamp: n.timestamp,
      }));
    const outgoing: HistoryEntry[] = ctx.vault.sentLog.map((s) => ({
      key: `out-${s.eventId}`,
      direction: "out",
      label: "Sent (shielded)",
      amount: BigInt(s.amount),
      counterparty: s.recipient,
      timestamp: s.timestamp,
    }));
    const boundary: HistoryEntry[] = chain
      .events()
      .filter((e) => e.actor === ctx.vault.address && e.publicAmount)
      .map((e) => ({
        key: `b-${e.id}`,
        direction: "boundary",
        label: e.type === "shield" ? "Shielded (public deposit)" : "Unshielded (public withdrawal)",
        amount: BigInt(e.publicAmount!),
        counterparty: "pool",
        timestamp: e.timestamp,
      }));
    setHistory(
      [...incoming, ...outgoing, ...boundary].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      ),
    );
  }, [ctx, chain]);

  useEffect(() => void refresh(), [refresh]);

  async function run() {
    if (!ctx) return;
    setError(null);
    setNotice(null);
    try {
      const value = parseAmount(amount);
      if (action === "shield") {
        await shield(ctx, value);
        setNotice(`Shielded ${amount} USDC into the pool.`);
      } else if (action === "unshield") {
        setProgress(0);
        await unshield(ctx, value, setProgress);
        setNotice(`Unshielded ${amount} USDC back to your public balance.`);
      } else {
        setProgress(0);
        const { sent } = await transfer(ctx, recipient.trim(), value, setProgress);
        await update((v) => ({ ...v, sentLog: [...v.sentLog, sent] }));
        setNotice(`Confidential transfer complete — the amount is visible only to you and the recipient.`);
      }
      setAmount("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  async function addDemoRecipient() {
    const keys = await generateViewingKeypair();
    const address = await addressFromPublic(keys.publicB64);
    chain.register(address, keys.publicB64);
    const next = [
      ...demoRecipients,
      {
        label: `Demo recipient ${demoRecipients.length + 1}`,
        address,
        privateJwk: keys.privateJwk,
      },
    ];
    localStorage.setItem(DEMO_RECIPIENTS_KEY, JSON.stringify(next));
    setDemoRecipients(next);
  }

  async function copyAddress() {
    if (!ctx) return;
    await navigator.clipboard.writeText(ctx.vault.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid max-w-6xl gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card title="Shielded balance">
          <div className="font-mono text-3xl text-shielded">
            {balance === null ? "…" : formatAmount(balance)}{" "}
            <span className="text-base text-slate-500">USDC</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Computed locally by decrypting your unspent notes with your viewing key.
          </p>
        </Card>

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
          <label htmlFor="pr-amount" className="mb-1 block text-xs text-slate-400">
            Amount (USDC) —{" "}
            {action === "transfer" ? (
              <span className="text-shielded">shielded, stays local</span>
            ) : (
              <span className="text-warn">public (boundary operation)</span>
            )}
          </label>
          <input
            id="pr-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="mb-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          {action === "transfer" && (
            <>
              <label htmlFor="pr-recipient" className="mb-1 block text-xs text-slate-400">
                Recipient shielded address — <span className="text-warn">public in v1</span>
              </label>
              <input
                id="pr-recipient"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="attesta1…"
                list="demo-recipients"
                className="mb-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
              <datalist id="demo-recipients">
                {demoRecipients.map((r) => (
                  <option key={r.address} value={r.address}>
                    {r.label}
                  </option>
                ))}
              </datalist>
            </>
          )}
          <button
            onClick={() => void run()}
            disabled={progress !== null || !amount || (action === "transfer" && !recipient)}
            className="w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
          >
            {progress !== null
              ? `Proving locally… ${Math.round(progress * 100)}%`
              : action === "shield"
                ? "Shield funds"
                : "Generate proof & submit"}
          </button>
          {progress !== null && (
            <div
              role="progressbar"
              aria-label={`Generating ${action} proof locally`}
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-raised"
            >
              <div
                className="h-full bg-shielded transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          {/* Persistent live region so async outcomes are announced. */}
          <div aria-live="polite">
            {error && <p className="mt-3 text-sm text-warn">{error}</p>}
            {notice && <p className="mt-3 text-sm text-ok">{notice}</p>}
          </div>
        </Card>

        <Card title="Receive">
          <div className="mb-1 text-xs text-slate-400">Your shielded address</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs">
              {vault?.address}
            </code>
            <button
              onClick={() => void copyAddress()}
              className="rounded-lg border border-line px-3 py-2 text-xs text-slate-300 hover:bg-surface-raised"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <button
              onClick={() => void addDemoRecipient()}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
            >
              + Create demo recipient
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Generates a registered counterparty (keys held in this browser) so you
              can try transfers, payroll runs, and auditor disclosure end-to-end.
            </p>
            {demoRecipients.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {demoRecipients.map((r) => (
                  <li key={r.address} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 text-slate-400">{r.label}</span>
                    <code className="truncate font-mono text-slate-500">{r.address}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <VaultSettingsCard />
      </div>

      <Card title="History (decrypted locally)">
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-slate-500">
            No activity yet — shield funds to get started.
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li
                key={h.key}
                className="flex items-center justify-between rounded-lg border border-line bg-surface-raised px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm text-white">{h.label}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {h.counterparty} · {new Date(h.timestamp).toLocaleString()}
                  </div>
                </div>
                <div
                  className={`ml-4 shrink-0 font-mono text-sm ${
                    h.direction === "in"
                      ? "text-ok"
                      : h.direction === "out"
                        ? "text-shielded"
                        : "text-slate-300"
                  }`}
                >
                  {h.direction === "in" ? "+" : h.direction === "out" ? "−" : ""}
                  {formatAmount(h.amount)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Received amounts come from trial-decrypting on-chain note ciphertexts with
          your viewing key; sent amounts are local wallet metadata. Neither is
          derivable from public chain data.
        </p>
      </Card>
    </div>
  );
}
