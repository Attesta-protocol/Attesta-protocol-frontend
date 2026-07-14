import { describe, expect, it } from "vitest";
import {
  describePredicate,
  disclosuresFor,
  encodePredicate,
  isKnownPredicate,
  type Predicate,
} from "./predicates";

const kyc: Predicate = { kind: "kyc-level", min: 2 };
const juris: Predicate = { kind: "jurisdiction", in: ["EU", "UK"] };
const inflow: Predicate = { kind: "inflow-threshold", min: "5000", period: "month" };

describe("predicate validation", () => {
  it("accepts each known, well-formed kind", () => {
    expect(isKnownPredicate(kyc)).toBe(true);
    expect(isKnownPredicate(juris)).toBe(true);
    expect(isKnownPredicate(inflow)).toBe(true);
  });

  it("rejects unknown kinds and malformed known kinds", () => {
    for (const bad of [
      null,
      "kyc-level",
      { kind: "sanctions-screening" }, // unknown kind
      { kind: "kyc-level", min: "2" }, // wrong type
      { kind: "kyc-level", min: 1.5 }, // not an integer
      { kind: "jurisdiction", in: [] }, // empty set
      { kind: "jurisdiction", in: [42] },
      { kind: "inflow-threshold", min: "5,000", period: "month" },
      { kind: "inflow-threshold", min: "5000", period: "week" },
    ]) {
      expect(isKnownPredicate(bad)).toBe(false);
      expect(disclosuresFor(bad)).toBeNull(); // refusal path
    }
  });
});

describe("canonical encoding (the string handed to the prover)", () => {
  it("is deterministic and round-trips to the same structured object", () => {
    for (const p of [kyc, juris, inflow]) {
      expect(encodePredicate(p)).toBe(encodePredicate({ ...p } as Predicate));
      // Single source of truth: what the prover gets parses back to the
      // exact object the consent screen rendered from.
      const decoded = JSON.parse(encodePredicate(p)) as unknown;
      expect(disclosuresFor(decoded)).toEqual(disclosuresFor(p));
    }
  });

  it("sorts jurisdiction sets so equivalent predicates encode identically", () => {
    expect(encodePredicate({ kind: "jurisdiction", in: ["UK", "EU"] })).toBe(
      encodePredicate({ kind: "jurisdiction", in: ["EU", "UK"] }),
    );
  });
});

describe("per-kind disclosures", () => {
  it("differ between predicate kinds (no generic screen)", () => {
    const dk = disclosuresFor(kyc)!;
    const dj = disclosuresFor(juris)!;
    const di = disclosuresFor(inflow)!;
    expect(dk.revealed).not.toEqual(dj.revealed);
    expect(dj.revealed).not.toEqual(di.revealed);
    expect(dk.withheld).not.toEqual(di.withheld);
  });

  it("matches the snapshot for each kind", () => {
    expect({
      kyc: disclosuresFor(kyc),
      jurisdiction: disclosuresFor(juris),
      inflow: disclosuresFor(inflow),
      singleJurisdiction: disclosuresFor({ kind: "jurisdiction", in: ["EU"] }),
    }).toMatchSnapshot();
  });

  it("only claims set-membership hiding when the set has multiple entries", () => {
    const single = disclosuresFor({ kind: "jurisdiction", in: ["EU"] })!;
    expect(single.withheld.join(" ")).not.toContain("which jurisdiction");
    const multi = disclosuresFor(juris)!;
    expect(multi.withheld.join(" ")).toContain("which jurisdiction");
  });
});

describe("display strings", () => {
  it("derives a human summary per kind", () => {
    expect(describePredicate(kyc)).toBe("KYC level 2 or higher passed");
    expect(describePredicate(juris)).toBe("Resident of jurisdiction: EU or UK");
    expect(describePredicate(inflow)).toBe("Monthly inflows above 5000 USDC");
  });
});
