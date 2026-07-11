import { useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";

export default function AuditorPortal() {
  const [viewingKey, setViewingKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  return (
    <div>
      <PageHeader
        title="Auditor disclosure portal"
        subtitle="Load a scoped viewing key handed to you by an account owner. Decryption and verification against on-chain commitments happen entirely in this browser — you get an independently verifiable report without trusting any Attesta server. The key reveals only that account's history within its scope, nothing about anyone else."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card title="Load a scoped viewing key">
          <label className="mb-1 block text-xs text-slate-400">
            Viewing key (processed locally, never uploaded)
          </label>
          <textarea
            value={viewingKey}
            onChange={(e) => setViewingKey(e.target.value)}
            rows={4}
            placeholder="avk1…"
            className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-xs outline-none focus:border-accent"
          />
          <button
            onClick={() => setLoaded(true)}
            disabled={!viewingKey.trim()}
            className="mt-4 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
          >
            Decrypt & verify report
          </button>
        </Card>
        <Card title="Disclosure report">
          {loaded ? (
            <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-slate-500">
              Client-side note scanning and commitment verification land with
              milestone M4. This surface will show the decrypted history for the
              key's scope, each entry checked against on-chain commitments.
            </div>
          ) : (
            <ul className="space-y-2 text-sm text-slate-400">
              <li>· Report covers exactly the key's scope (account + date range)</li>
              <li>· Every amount is re-verified against on-chain commitments</li>
              <li>· Keys are revocable going forward by the account owner</li>
              <li>· Exportable as a signed report for audit workpapers</li>
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
