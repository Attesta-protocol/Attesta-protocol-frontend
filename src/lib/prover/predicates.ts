/**
 * Structured predicate model — the single source of truth for the consent
 * screen AND the prover input. The consent screen renders disclosures from
 * the same object that is serialized for the prover, so UI copy cannot
 * drift from what is cryptographically proven. Unknown kinds must be
 * refused, never explained generically.
 */

export type Predicate =
  | { kind: "kyc-level"; min: number }
  | { kind: "jurisdiction"; in: string[] }
  | { kind: "inflow-threshold"; min: string; period: "month" | "year" };

export function isKnownPredicate(p: unknown): p is Predicate {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  switch (o.kind) {
    case "kyc-level":
      return typeof o.min === "number" && Number.isInteger(o.min) && o.min >= 0;
    case "jurisdiction":
      return (
        Array.isArray(o.in) &&
        o.in.length > 0 &&
        o.in.every((j) => typeof j === "string" && j.length > 0)
      );
    case "inflow-threshold":
      return (
        typeof o.min === "string" &&
        /^\d+(\.\d+)?$/.test(o.min) &&
        (o.period === "month" || o.period === "year")
      );
    default:
      return false;
  }
}

/** Canonical serialization handed to the prover (stable field order). */
export function encodePredicate(p: Predicate): string {
  switch (p.kind) {
    case "kyc-level":
      return JSON.stringify({ kind: p.kind, min: p.min });
    case "jurisdiction":
      return JSON.stringify({ kind: p.kind, in: [...p.in].sort() });
    case "inflow-threshold":
      return JSON.stringify({ kind: p.kind, min: p.min, period: p.period });
  }
}

/** Human-readable summary. Display-only, derived — never the source of truth. */
export function describePredicate(p: Predicate): string {
  switch (p.kind) {
    case "kyc-level":
      return `KYC level ${p.min} or higher passed`;
    case "jurisdiction":
      return `Resident of jurisdiction: ${p.in.join(" or ")}`;
    case "inflow-threshold":
      return `${p.period === "month" ? "Monthly" : "Yearly"} inflows above ${p.min} USDC`;
  }
}

export interface DisclosureStatements {
  revealed: string[];
  withheld: string[];
}

/**
 * The exact revealed/withheld statements for a predicate, per kind.
 * Returns null for unknown or malformed predicates — callers MUST refuse
 * to prove those ("this wallet cannot explain it" beats a generic screen).
 */
export function disclosuresFor(p: unknown): DisclosureStatements | null {
  if (!isKnownPredicate(p)) return null;
  const issuerRevealed = "the credential's issuer belongs to the approved issuer set";
  const issuerWithheld = "which specific issuer verified you";
  const identityWithheld = "your name, documents, or any other credential data";
  switch (p.kind) {
    case "kyc-level":
      return {
        revealed: [
          `you passed KYC at level ${p.min} or higher`,
          "the credential is unexpired",
          issuerRevealed,
        ],
        withheld: [
          `your exact KYC level (only "≥ ${p.min}" is provable)`,
          identityWithheld,
          issuerWithheld,
        ],
      };
    case "jurisdiction":
      return {
        revealed: [
          `your credential's jurisdiction is in: ${[...p.in].sort().join(", ")}`,
          "the credential is unexpired",
          issuerRevealed,
        ],
        withheld: [
          ...(p.in.length > 1 ? ["which jurisdiction in that set it actually is"] : []),
          "your address or residence documents",
          identityWithheld,
          issuerWithheld,
        ],
      };
    case "inflow-threshold":
      return {
        revealed: [
          `your ${p.period === "month" ? "monthly" : "yearly"} inflows exceed ${p.min} USDC`,
          "the credential is unexpired",
          issuerRevealed,
        ],
        withheld: [
          "your actual inflow amounts",
          "individual transactions or counterparties",
          identityWithheld,
          issuerWithheld,
        ],
      };
  }
}
