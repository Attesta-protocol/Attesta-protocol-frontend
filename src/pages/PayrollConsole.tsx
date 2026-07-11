import { useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import RequireVault from "../components/RequireVault";
import { useVault } from "../context/VaultContext";
import { parsePayrollCsv } from "../lib/csv";
import { formatAmount, parseAmount } from "../lib/notes";
import { transfer, type WalletCtx } from "../lib/wallet";

type RowStatus =
  | { state: "idle" }
  | { state: "proving"; progress: number }
  | { state: "done" }
  | { state: "error"; message: string };

interface Row {
  recipient: string;
  amount: string;
  status: RowStatus;
}

const emptyRow = (): Row => ({ recipient: "", amount: "", status: { state: "idle" } });

export default function PayrollConsole() {
  return (
    <div>
      <PageHeader
        title="Payroll console"
        subtitle="Define recipients and amounts, then execute a confidential pay run: one proof per payment, generated locally with per-row progress. Employees can decrypt their own history; the public chain sees only that payments occurred."
      />
      <RequireVault>
        <Console />
      </RequireVault>
    </div>
  );
}

function Console() {
  const { vault, chain, update } = useVault();
  const ctx = useMemo<WalletCtx | null>(
    () => (vault ? { chain, vault } : null),
    [chain, vault],
  );

  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function onCsv(file: File) {
    const parsed = parsePayrollCsv(await file.text());
    if (parsed.length) {
      setRows(parsed.map((p) => ({ ...p, status: { state: "idle" } })));
    }
  }

  const total = rows.reduce((sum, r) => {
    try {
      return sum + parseAmount(r.amount);
    } catch {
      return sum;
    }
  }, 0n);
  const filled = rows.filter((r) => r.recipient && r.amount);

  async function executeRun() {
    if (!ctx) return;
    setRunning(true);
    setSummary(null);
    let ok = 0;
    let failed = 0;
    // Sequential on purpose: one prover worker, and each transfer's change
    // note must land before the next spend selects inputs.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.recipient || !row.amount || row.status.state === "done") continue;
      updateRow(i, { status: { state: "proving", progress: 0 } });
      try {
        const value = parseAmount(row.amount);
        const { sent } = await transfer(ctx, row.recipient.trim(), value, (p) =>
          updateRow(i, { status: { state: "proving", progress: p } }),
        );
        await update((v) => ({ ...v, sentLog: [...v.sentLog, sent] }));
        updateRow(i, { status: { state: "done" } });
        ok++;
      } catch (e) {
        updateRow(i, {
          status: { state: "error", message: e instanceof Error ? e.message : String(e) },
        });
        failed++;
      }
    }
    setSummary(
      failed === 0
        ? `Pay run complete: ${ok} confidential payment${ok === 1 ? "" : "s"} executed.`
        : `Pay run finished with errors: ${ok} succeeded, ${failed} failed — fix the flagged rows and re-run (completed rows are skipped).`,
    );
    setRunning(false);
  }

  return (
    <div className="grid max-w-6xl gap-6 lg:grid-cols-3">
      <Card title="Pay run" className="lg:col-span-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-2 font-normal">Recipient (public in v1)</th>
              <th className="pb-2 font-normal">
                Amount USDC <span className="text-shielded">(shielded)</span>
              </th>
              <th className="pb-2 font-normal">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="pr-3 pb-2">
                  <input
                    value={row.recipient}
                    onChange={(e) => updateRow(i, { recipient: e.target.value })}
                    placeholder="attesta1…"
                    disabled={running}
                    className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                  />
                </td>
                <td className="pr-3 pb-2">
                  <input
                    value={row.amount}
                    onChange={(e) => updateRow(i, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={running}
                    className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                  />
                </td>
                <td className="pr-3 pb-2 text-xs">
                  {row.status.state === "idle" && <span className="text-slate-500">—</span>}
                  {row.status.state === "proving" && (
                    <span className="text-shielded">
                      proving {Math.round(row.status.progress * 100)}%
                    </span>
                  )}
                  {row.status.state === "done" && <span className="text-ok">✓ paid</span>}
                  {row.status.state === "error" && (
                    <span className="text-warn" title={row.status.message}>
                      ✗ {row.status.message}
                    </span>
                  )}
                </td>
                <td className="pb-2">
                  <button
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    disabled={rows.length === 1 || running}
                    className="text-xs text-slate-500 hover:text-warn disabled:opacity-30"
                  >
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-3">
          <button
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
            disabled={running}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
          >
            + Add recipient
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={running}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
          >
            Import CSV
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onCsv(f);
              e.target.value = "";
            }}
          />
        </div>
      </Card>

      <Card title="Run summary">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-400">Recipients</dt>
            <dd className="font-mono">{filled.length}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-400">Total (local only)</dt>
            <dd className="font-mono text-shielded">{formatAmount(total)} USDC</dd>
          </div>
        </dl>
        <button
          onClick={() => void executeRun()}
          disabled={running || filled.length === 0}
          className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
        >
          {running ? "Executing run…" : "Prove & execute batch"}
        </button>
        {summary && <p className="mt-3 text-xs leading-relaxed text-ok">{summary}</p>}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Each payment is proven locally in the proving worker; recipients must be
          registered in the directory (create demo recipients on the Pay/Receive
          page). Recurring runs land with M6.
        </p>
      </Card>
    </div>
  );
}
