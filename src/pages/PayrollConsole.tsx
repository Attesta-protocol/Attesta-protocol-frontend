import { useEffect, useMemo, useRef, useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import RequireVault from "../components/RequireVault";
import { useVault } from "../context/VaultContext";
import {
  diagnosticsToCsv,
  parsePayrollCsv,
  validatePayrollRow,
  type CsvDiagnostic,
} from "../lib/csv";
import { formatAmount, parseAmount } from "../lib/notes";
import { balanceOf, transfer, type WalletCtx } from "../lib/wallet";

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
  const [importReport, setImportReport] = useState<{
    imported: number;
    skipped: number;
    diagnostics: CsvDiagnostic[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function onCsv(file: File) {
    const { rows: parsed, diagnostics } = parsePayrollCsv(await file.text());
    setImportReport({
      imported: parsed.length,
      skipped: diagnostics.filter((d) => d.field === "row").length,
      diagnostics,
    });
    if (parsed.length) {
      setRows(parsed.map((p) => ({ ...p, status: { state: "idle" } })));
    }
  }

  function downloadErrorReport() {
    if (!importReport) return;
    const url = URL.createObjectURL(
      new Blob([diagnosticsToCsv(importReport.diagnostics)], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "attesta-payroll-import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Validate on every edit with the same rules the CSV import uses. Untouched
  // blank rows are left alone; anything partially filled is checked.
  const rowIssues = useMemo(
    () =>
      rows.map((r) =>
        r.recipient.trim() || r.amount.trim()
          ? validatePayrollRow({ recipient: r.recipient.trim(), amount: r.amount.trim() })
          : [],
      ),
    [rows],
  );
  const issueFor = (i: number, field: "recipient" | "amount") =>
    rowIssues[i].find((d) => d.field === field && d.severity === "error");

  const total = rows.reduce((sum, r) => {
    try {
      return sum + parseAmount(r.amount);
    } catch {
      return sum;
    }
  }, 0n);
  const filled = rows.filter((r) => r.recipient && r.amount);

  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!ctx || running) return;
    let cancelled = false;
    void balanceOf(ctx).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx, running]); // re-check after each run completes

  // Pre-flight: catch everything that would fail mid-run, before any proving.
  const preflight = useMemo(() => {
    const problems: string[] = [];
    if (rowIssues.some((issues) => issues.some((d) => d.severity === "error"))) {
      problems.push("Fix the flagged rows above.");
    }
    const unregistered = filled.filter(
      (r) =>
        !rowIssues[rows.indexOf(r)].some((d) => d.field === "recipient") &&
        r.status.state !== "done" &&
        !chain.lookup(r.recipient.trim()),
    );
    if (unregistered.length > 0) {
      problems.push(
        `${unregistered.length} recipient${unregistered.length === 1 ? " is" : "s are"} not registered in the directory.`,
      );
    }
    // Only rows not yet paid count against the balance (done rows are skipped).
    const remaining = rows.reduce((sum, r) => {
      if (r.status.state === "done") return sum;
      try {
        return sum + parseAmount(r.amount);
      } catch {
        return sum;
      }
    }, 0n);
    if (balance !== null && remaining > balance) {
      problems.push(
        `Batch total ${formatAmount(remaining)} USDC exceeds the shielded balance of ${formatAmount(balance)} USDC.`,
      );
    }
    return problems;
  }, [rowIssues, filled, rows, chain, balance]);

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
                <td className="pr-3 pb-2 align-top">
                  <input
                    value={row.recipient}
                    onChange={(e) => updateRow(i, { recipient: e.target.value })}
                    placeholder="attesta1…"
                    disabled={running}
                    className={`w-full rounded-lg border bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent ${
                      issueFor(i, "recipient") ? "border-warn" : "border-line"
                    }`}
                  />
                  {issueFor(i, "recipient") && (
                    <p className="mt-1 text-[11px] leading-snug text-warn">
                      {issueFor(i, "recipient")!.problem}
                    </p>
                  )}
                </td>
                <td className="pr-3 pb-2 align-top">
                  <input
                    value={row.amount}
                    onChange={(e) => updateRow(i, { amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={running}
                    className={`w-full rounded-lg border bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent ${
                      issueFor(i, "amount") ? "border-warn" : "border-line"
                    }`}
                  />
                  {issueFor(i, "amount") && (
                    <p className="mt-1 text-[11px] leading-snug text-warn">
                      {issueFor(i, "amount")!.problem}
                    </p>
                  )}
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
        {importReport && (
          <div className="mt-3 rounded-lg border border-line bg-surface-raised p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <p className={importReport.diagnostics.length ? "text-warn" : "text-ok"}>
                {importReport.imported} row{importReport.imported === 1 ? "" : "s"} imported
                {importReport.skipped > 0 &&
                  `, ${importReport.skipped} line${importReport.skipped === 1 ? "" : "s"} skipped`}
                {importReport.diagnostics.length > 0 &&
                  ` — ${importReport.diagnostics.length} issue${
                    importReport.diagnostics.length === 1 ? "" : "s"
                  } found`}
                .
              </p>
              <button
                onClick={() => setImportReport(null)}
                className="text-slate-500 hover:text-slate-300"
                aria-label="Dismiss import summary"
              >
                dismiss
              </button>
            </div>
            {importReport.diagnostics.length > 0 && (
              <>
                <ul className="mt-2 space-y-1 text-slate-400">
                  {importReport.diagnostics.slice(0, 5).map((d, i) => (
                    <li key={i}>
                      line {d.line} ({d.field}): {d.problem}
                    </li>
                  ))}
                  {importReport.diagnostics.length > 5 && (
                    <li>…and {importReport.diagnostics.length - 5} more.</li>
                  )}
                </ul>
                <button
                  onClick={downloadErrorReport}
                  className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface"
                >
                  Download error report (CSV)
                </button>
              </>
            )}
          </div>
        )}
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
          <div className="flex justify-between">
            <dt className="text-slate-400">Shielded balance</dt>
            <dd className="font-mono">
              {balance === null ? "…" : `${formatAmount(balance)} USDC`}
            </dd>
          </div>
        </dl>
        <button
          onClick={() => void executeRun()}
          disabled={running || filled.length === 0 || preflight.length > 0}
          className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
        >
          {running ? "Executing run…" : "Prove & execute batch"}
        </button>
        {preflight.length > 0 && filled.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs leading-relaxed text-warn">
            {preflight.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
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
