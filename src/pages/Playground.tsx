import Card from "../components/Card";
import PageHeader from "../components/PageHeader";

const rustExample = `// Any Soroban contract can gate on an attestation with one call.
use attesta_sdk::AttestationRegistryClient;

pub fn deposit(env: Env, from: Address, proof: BytesN<256>) {
    let registry = AttestationRegistryClient::new(&env, &REGISTRY_ID);

    // "Caller holds a valid, unexpired KYC-level-2 credential from an
    // approved issuer" — verified on-chain, no personal data touched.
    registry.check(&from, &Predicate::KycLevel(2), &proof);

    // ... proceed with the deposit
}`;

const jsExample = `import { AttestaClient } from "@attesta/sdk";

const attesta = new AttestaClient({ network: "testnet" });

// Ask the user's attestation wallet for a proof of a predicate.
// The user sees a consent screen showing exactly what is revealed.
const proof = await attesta.requestAttestation({
  predicate: { kind: "jurisdiction", in: ["EU"] },
});

// Attach it to your contract invocation.
await attesta.invoke(contractId, "deposit", { proof });`;

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-surface-raised p-4 font-mono text-xs leading-relaxed text-slate-300">
      {code}
    </pre>
  );
}

export default function Playground() {
  return (
    <div>
      <PageHeader
        title="Integrator docs & SDK playground"
        subtitle="The attestation layer only matters if other projects adopt it. One registry call gives any Soroban app privacy-preserving compliance — an anchor checks jurisdiction, a lending pool checks an income threshold, an RWA platform checks accreditation — without touching personal data."
      />
      <div className="grid max-w-5xl gap-6">
        <Card title="Soroban contract — gate on an attestation">
          <CodeBlock code={rustExample} />
        </Card>
        <Card title="JavaScript — request a proof from the user">
          <CodeBlock code={jsExample} />
        </Card>
        <Card title="Live playground">
          <p className="text-sm leading-relaxed text-slate-400">
            Live testnet examples against a deployed{" "}
            <code className="font-mono text-xs text-accent">attestation_registry</code>{" "}
            contract ship with milestone M5, alongside the issuer gateway and
            SDK packages.
          </p>
        </Card>
      </div>
    </div>
  );
}
