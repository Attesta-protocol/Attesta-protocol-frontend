import { useState } from "react";
import Card from "../components/Card";
import PageHeader from "../components/PageHeader";
import { proveAttestation, type ProveResult } from "../lib/prover";
import type { StoredCredential } from "../lib/keys";

// Placeholder credentials until the issuer gateway (M5) is live.
const demoCredentials: StoredCredential[] = [
  {
    id: "cred-1",
    issuer: "Demo Anchor (SEP-12)",
    claim: "KYC level 2 passed",
    expiresAt: "2027-01-15",
    payload: "demo",
  },
  {
    id: "cred-2",
    issuer: "Demo Anchor (SEP-12)",
    claim: "Resident of jurisdiction: EU",
    expiresAt: "2026-11-01",
    payload: "demo",
  },
];

export default function AttestationWallet() {
  const [selected, setSelected] = useState<StoredCredential | null>(null);
  const [result, setResult] = useState<ProveResult | null>(null);
  const [proving, setProving] = useState(false);

  async function onPresent(cred: StoredCredential) {
    setProving(true);
    setResult(null);
    try {
      setResult(
        await proveAttestation({
          credential: cred.payload,
          predicate: cred.claim,
          issuerSetRoot: "0x" + "0".repeat(64),
        }),
      );
    } finally {
      setProving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Attestation wallet"
        subtitle="Your issuer credentials live here, locally. When an app asks you to prove something, you see exactly what is and is not revealed before generating the proof — the underlying documents and data never leave this device."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card title="Your credentials">
          <ul className="space-y-3">
            {demoCredentials.map((cred) => (
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
                  onClick={() => setSelected(cred)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-surface"
                >
                  Present
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Credentials are issued off-chain by anchors and KYC providers (M5)
            and stored in your encrypted local vault.
          </p>
        </Card>
        <Card title="Consent — what will be revealed">
          {selected ? (
            <div>
              <div className="rounded-lg border border-line bg-surface-raised p-4 text-sm">
                <p className="text-white">
                  Prove: <span className="font-medium">“{selected.claim}”</span>
                </p>
                <ul className="mt-3 space-y-1.5 text-xs">
                  <li className="text-ok">✓ Revealed: the statement above is true</li>
                  <li className="text-ok">✓ Revealed: issuer is in the approved set</li>
                  <li className="text-slate-400">✗ Not revealed: your name or documents</li>
                  <li className="text-slate-400">✗ Not revealed: which issuer verified you</li>
                  <li className="text-slate-400">✗ Not revealed: any other credential data</li>
                </ul>
              </div>
              <button
                onClick={() => void onPresent(selected)}
                disabled={proving}
                className="mt-4 w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50"
              >
                {proving ? "Generating proof locally…" : "Generate & present proof"}
              </button>
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
    </div>
  );
}
