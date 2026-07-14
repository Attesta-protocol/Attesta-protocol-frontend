import { disclosuresFor } from "../lib/prover/predicates";

/**
 * The consent screen's trust anchor: renders the exact revealed/withheld
 * statements for the predicate being proven — derived from the same
 * structured object handed to the prover, never from hardcoded copy.
 *
 * Unknown or malformed predicates render a refusal, not a generic screen;
 * pair with `disclosuresFor(...) === null` to keep the prove button away.
 */
export default function DisclosureSummary({ predicate }: { predicate: unknown }) {
  const d = disclosuresFor(predicate);
  if (!d) {
    return (
      <div className="rounded-lg border border-warn/40 bg-surface-raised p-4 text-sm">
        <p className="text-warn">
          This request uses a predicate this wallet cannot explain — so it will
          not be proven.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          A consent screen that can't state exactly what is revealed is worse
          than no proof at all. Update the wallet or re-request the credential
          from its issuer in a supported format.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {d.revealed.map((s) => (
        <li key={s} className="text-ok">
          ✓ Revealed: {s}
        </li>
      ))}
      {d.withheld.map((s) => (
        <li key={s} className="text-slate-400">
          ✗ Not revealed: {s}
        </li>
      ))}
    </ul>
  );
}
