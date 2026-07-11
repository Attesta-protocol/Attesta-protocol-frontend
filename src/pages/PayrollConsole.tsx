import { useRef, useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import { parsePayrollCsv, type PayrollCsvRow as PayrollRow } from "../lib/csv";

export default function PayrollConsole() {
  const [rows, setRows] = useState<PayrollRow[]>([{ recipient: "", amount: "" }]);
  const fileInput = useRef<HTMLInputElement>(null);

  function updateRow(i: number, patch: Partial<PayrollRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function onCsv(file: File) {
    // CSV is parsed entirely in the browser: recipient,amount per line.
    const parsed = parsePayrollCsv(await file.text());
    if (parsed.length) setRows(parsed);
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return (
    <div>
      <PageHeader
        title="Payroll console"
        subtitle="Fund a shielded batch, define recipients and locally-encrypted amounts, and execute a confidential pay run in one flow. Employees can decrypt their own history; the public chain sees only that payments occurred."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-3">
        <Card title="Pay run" className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-normal">Recipient (public in v1)</th>
                <th className="pb-2 font-normal">
                  Amount USDC <span className="text-shielded">(shielded)</span>
                </th>
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
                      placeholder="G… or attesta1…"
                      className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                    />
                  </td>
                  <td className="pr-3 pb-2">
                    <input
                      value={row.amount}
                      onChange={(e) => updateRow(i, { amount: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                    />
                  </td>
                  <td className="pb-2">
                    <button
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      disabled={rows.length === 1}
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
              onClick={() => setRows((rs) => [...rs, { recipient: "", amount: "" }])}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
            >
              + Add recipient
            </button>
            <button
              onClick={() => fileInput.current?.click()}
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
              <dd className="font-mono">{rows.filter((r) => r.recipient).length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Total (local only)</dt>
              <dd className="font-mono text-shielded">{total.toFixed(2)} USDC</dd>
            </div>
          </dl>
          <button
            disabled
            title="Batch proving lands with milestone M6"
            className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white opacity-50"
          >
            Prove & execute batch
          </button>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Batch proofs run in a local worker with progress per recipient.
            Recurring runs and employee self-service history arrive with M6.
          </p>
        </Card>
      </div>
    </div>
  );
}
