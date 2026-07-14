import { useState } from "react";
import Card from "../components/Card";
import DisclosureSummary from "../components/DisclosureSummary";
import PageHeader from "../components/PageHeader";
import RequireVault from "../components/RequireVault";
import { useVault } from "../context/VaultContext";
import type { StoredCredential } from "../lib/keys";
import { proveAttestation, type ProveResult } from "../lib/prover";
import {
  describePredicate,
  disclosuresFor,
  isKnownPredicate,
  type Predicate,
} from "../lib/prover/predicates";

export default function AttestationWallet() {
  return (
    <div>
      <PageHeader
        title="Attestation wallet"
        subtitle="Your issuer credentials live in your encrypted local vault. When an app asks you to prove something, you see exactly what is and is not revealed before generating the proof — the underlying documents and data never leave this device."
      />
      <RequireVault>
        <Credentials />
      </RequireVault>
    </div>
  );
}

function Credentials() {
  const { vault, update } = useVault();
  const [selected, setSelected] = useState<StoredCredential | null>(null);
  const [result, setResult] = useState<ProveResult | null>(null);
  const [proving, setProving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const credentials = vault?.credentials ?? [];

  async function onPresent(cred: StoredCredential) {
    // The refusal path in the UI keeps unknown predicates away from this
    // button; this guard makes the invariant hold even if it didn't.
    if (!isKnownPredicate(cred.predicate)) {
      setError("This credential's predicate is not supported by this wallet.");
      return;
    }
    setProving(true);
    setResult(null);
    setError(null);
    try {
      setResult(
        await proveAttestation({
          credential: cred.payload,
          // Same structured object the consent screen rendered from.
          predicate: cred.predicate,
          issuerSetRoot: "0x" + "0".repeat(64),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProving(false);
    }
  }

  async function requestDemoCredential() {
    const year = new Date().getFullYear() + 1;
    const inflow: Predicate = { kind: "inflow-threshold", min: "5000", period: "month" };
    await update((v) => ({
      ...v,
      credentials: [
        ...v.credentials,
        {
          id: crypto.randomUUID(),
          issuer: "Demo Anchor (SEP-12)",
          claim: describePredicate(inflow),
          predicate: inflow,
          expiresAt: `${year}-06-30`,
          payload: "demo-credential",
        },
      ],
    }));
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Your credentials">
        {credentials.length === 0 ? (
          <p className="text-sm text-slate-500">No credentials in your vault yet.</p>
        ) : (
          <ul className="space-y-3">
            {credentials.map((cred) => (
              <li
                key={cred.id}
                className="flex items-center justify-between rounded-lg border border-line bg-surface-raised p-4"
              >
                <div>
                  <div className="text-sm font-medium text-white">{cred.claim}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {cred.issuer} · expires {cred.expiresAt}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelected(cred);
                    setResult(null);
                  }}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface"
                >
                  Present
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          onClick={() => void requestDemoCredential()}
          className="mt-4 rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface-raised"
        >
          + Request demo credential
        </button>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Credentials are issued off-chain by anchors and KYC providers. The demo
          issuer stands in for the issuer gateway (M5); credentials are stored in
          your encrypted vault either way.
        </p>
      </Card>

      <Card title="Consent — what will be revealed">
        {selected ? (
          <div>
            {disclosuresFor(selected.predicate) ? (
              <div className="rounded-lg border border-line bg-surface-raised p-4 text-sm">
                <p className="text-white">
                  Prove: <span className="font-medium">“{selected.claim}”</span>
                </p>
                <div className="mt-3">
                  <DisclosureSummary predicate={selected.predicate} />
                </div>
              </div>
            ) : (
              <DisclosureSummary predicate={selected.predicate} />
            )}
            {/* Unknown predicates can never reach the prove button. */}
            {disclosuresFor(selected.predicate) && (
              <button
                onClick={() => void onPresent(selected)}
                disabled={proving}
                className="mt-4 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
              >
                {proving ? "Generating proof locally…" : "Generate & present proof"}
              </button>
            )}
            {error && <p className="mt-3 text-sm text-warn">{error}</p>}
            {result && (
              <div className="mt-4 rounded-lg border border-line bg-surface-raised p-3 text-xs">
                <p className="text-ok">
                  Proof ready in {(result.elapsedMs / 1000).toFixed(2)}s
                  {result.backend === "mock" && (
                    <span className="ml-2 text-warn">(mock backend)</span>
                  )}
                </p>
                <p className="mt-2 truncate font-mono text-slate-500">
                  {result.proof.proof}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Select a credential to see the exact disclosure before proving.
          </p>
        )}
      </Card>
    </div>
  );
}
