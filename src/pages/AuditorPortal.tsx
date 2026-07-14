import { useEffect, useRef, useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import RequireVault from "../components/RequireVault";
import { useVault } from "../context/VaultContext";
import { formatAmount } from "../lib/notes";
import {
  buildDisclosureReport,
  decodeGrant,
  encodeGrant,
  type DisclosureRow,
} from "../lib/wallet";

type Tab = "grant" | "audit";

export default function AuditorPortal() {
  const [tab, setTab] = useState<Tab>("audit");

  return (
    <div>
      <PageHeader
        title="Auditor disclosure portal"
        subtitle="Account owners generate scoped viewing keys here; auditors load them to get an independently verifiable report. Decryption and verification against on-chain commitments happen entirely in this browser — no trust in any Attesta server required."
      />
      <div className="mb-6 flex w-fit gap-1 rounded-lg bg-surface-raised p-1">
        {(
          [
            ["audit", "Load a viewing key (auditor)"],
            ["grant", "Grant access (account owner)"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              tab === key
                ? "bg-accent-strong font-medium text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "audit" ? (
        <AuditView />
      ) : (
        <RequireVault>
          <GrantView />
        </RequireVault>
      )}
    </div>
  );
}

function GrantView() {
  const { vault, update } = useVault();
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generatedRef = useRef<HTMLDivElement>(null);

  // Move focus into the newly revealed grant panel (keyboard flow).
  useEffect(() => {
    if (generated) generatedRef.current?.focus();
  }, [generated]);

  async function generate() {
    if (!vault) return;
    const grant = encodeGrant({
      v: 1,
      account: vault.address,
      privateJwk: vault.viewingPrivateJwk,
      label: label || "unnamed grant",
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999Z`).toISOString() : undefined,
    });
    await update((v) => ({
      ...v,
      grants: [
        ...v.grants,
        {
          id: crypto.randomUUID(),
          label: label || "unnamed grant",
          from: from || undefined,
          to: to || undefined,
          createdAt: new Date().toISOString(),
          revoked: false,
        },
      ],
    }));
    setGenerated(grant);
  }

  async function copyGrant() {
    if (!generated) return;
    await navigator.clipboard.writeText(generated);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Generate a scoped viewing key">
        <label htmlFor="grant-label" className="mb-1 block text-xs text-slate-400">
          Label
        </label>
        <input
          id="grant-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. FY26 audit — Meridian LLP"
          className="mb-4 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="grant-from" className="mb-1 block text-xs text-slate-400">
              From (optional)
            </label>
            <input
              id="grant-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="grant-to" className="mb-1 block text-xs text-slate-400">
              To (optional)
            </label>
            <input
              id="grant-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        </div>
        <button
          onClick={() => void generate()}
          className="w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent"
        >
          Generate viewing key
        </button>
        {generated && (
          <div ref={generatedRef} tabIndex={-1} className="mt-4 outline-none">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs">
                {generated}
              </code>
              <button
                onClick={() => void copyGrant()}
                className="rounded-lg border border-line px-3 py-2 text-xs text-slate-300 hover:bg-surface-raised"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-warn">
              Hand this only to the intended auditor: it decrypts this account's
              note history within its scope.
            </p>
          </div>
        )}
      </Card>

      <Card title="Issued grants">
        {(vault?.grants ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">No grants issued yet.</p>
        ) : (
          <ul className="space-y-2">
            {vault!.grants.map((g) => (
              <li
                key={g.id}
                className="rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm"
              >
                <div className="text-white">{g.label}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {g.from ?? "beginning"} → {g.to ?? "open-ended"} · issued{" "}
                  {new Date(g.createdAt).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Revocation going forward (key rotation so a grant stops covering new
          activity) ships with M4 — a handed-out key can always decrypt the past
          it was scoped to, and the UI will never pretend otherwise.
        </p>
      </Card>
    </div>
  );
}

function AuditView() {
  const { chain } = useVault();
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<DisclosureRow[] | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      const grant = decodeGrant(input);
      setScope(
        `${grant.label} — account ${grant.account.slice(0, 16)}…, ` +
          `${grant.from?.slice(0, 10) ?? "beginning"} → ${grant.to?.slice(0, 10) ?? "open-ended"}`,
      );
      setRows(await buildDisclosureReport(chain, grant));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Load a scoped viewing key">
        <label htmlFor="auditor-key" className="mb-1 block text-xs text-slate-400">
          Viewing key (processed locally, never uploaded)
        </label>
        <textarea
          id="auditor-key"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          placeholder="avk1…"
          className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent"
        />
        <button
          onClick={() => void load()}
          disabled={!input.trim() || busy}
          className="mt-4 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
        >
          {busy ? "Decrypting & verifying…" : "Decrypt & verify report"}
        </button>
        <div aria-live="polite">
          {error && <p className="mt-3 text-sm text-warn">{error}</p>}
        </div>
      </Card>

      <Card title="Disclosure report">
        <p className="sr-only" aria-live="polite">
          {rows !== null
            ? `Disclosure report loaded: ${rows.length} ${rows.length === 1 ? "entry" : "entries"}.`
            : ""}
        </p>
        {rows === null ? (
          <ul className="space-y-2 text-sm text-slate-400">
            <li>· Report covers exactly the key's scope (account + date range)</li>
            <li>· Every amount is re-verified against on-chain commitments</li>
            <li>· Nothing about any other account is decryptable</li>
          </ul>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-400">{scope}</p>
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-slate-500">
                No notes decryptable under this key within its scope.
              </div>
            ) : (
              <ul className="space-y-2">
                {rows.map((r, i) => (
                  <li
                    key={`${r.eventId}-${i}`}
                    className="flex items-center justify-between rounded-lg border border-line bg-surface-raised px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm capitalize text-white">{r.eventType}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                        from {r.sender} · {new Date(r.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className="ml-4 shrink-0 text-right">
                      <div className="font-mono text-sm text-white">
                        {formatAmount(BigInt(r.amount))} USDC
                      </div>
                      <div className={`text-[11px] ${r.verified ? "text-ok" : "text-warn"}`}>
                        {r.verified
                          ? "✓ verified against on-chain commitment"
                          : "✗ COMMITMENT MISMATCH"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
