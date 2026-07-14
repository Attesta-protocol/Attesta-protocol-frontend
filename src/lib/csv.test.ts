import { describe, expect, it } from "vitest";
import {
  diagnosticsToCsv,
  parsePayrollCsv,
  validatePayrollRow,
} from "./csv";

const A = "attesta1" + "a".repeat(40);
const B = "attesta1" + "b".repeat(40);

describe("parsePayrollCsv", () => {
  it("parses recipient,amount lines without diagnostics", () => {
    const { rows, diagnostics } = parsePayrollCsv(`${A},100.50\n${B},2000`);
    expect(rows).toEqual([
      { recipient: A, amount: "100.50" },
      { recipient: B, amount: "2000" },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("skips a header row, blank lines, and handles CRLF", () => {
    const text = `recipient,amount\r\n\r\n${A},100\r\n${B},200\r\n`;
    const { rows, diagnostics } = parsePayrollCsv(text);
    expect(rows).toEqual([
      { recipient: A, amount: "100" },
      { recipient: B, amount: "200" },
    ]);
    expect(diagnostics).toEqual([]);
  });

  it("trims whitespace around fields", () => {
    expect(parsePayrollCsv(`  ${A} , 100 `).rows).toEqual([
      { recipient: A, amount: "100" },
    ]);
  });

  it("returns an empty result for empty input", () => {
    expect(parsePayrollCsv("")).toEqual({ rows: [], diagnostics: [] });
  });

  it("reports wrong field counts as row errors and skips those lines", () => {
    const { rows, diagnostics } = parsePayrollCsv(`${A},100,extra\n${B},200`);
    expect(rows).toEqual([{ recipient: B, amount: "200" }]);
    expect(diagnostics).toEqual([
      {
        line: 1,
        field: "row",
        problem: 'Expected "recipient,amount" (2 fields), got 3.',
        severity: "error",
      },
    ]);
  });

  it("keeps rows with bad fields but reports them with 1-based line numbers", () => {
    const text = `recipient,amount\nnot-an-address,100\n${A},12.34.56\n${B},50`;
    const { rows, diagnostics } = parsePayrollCsv(text);
    expect(rows).toHaveLength(3); // nothing silently dropped
    expect(diagnostics).toEqual([
      expect.objectContaining({ line: 2, field: "recipient", severity: "error" }),
      expect.objectContaining({ line: 3, field: "amount", severity: "error" }),
    ]);
  });

  it("flags duplicate recipients as warnings, keeping both rows", () => {
    const { rows, diagnostics } = parsePayrollCsv(`${A},100\n${A},200`);
    expect(rows).toHaveLength(2);
    expect(diagnostics).toEqual([
      {
        line: 2,
        field: "recipient",
        problem: "Duplicate recipient (first used on line 1) — allowed, but check it's intended.",
        severity: "warning",
      },
    ]);
  });

  it("only treats the first non-blank line as a potential header", () => {
    const { rows, diagnostics } = parsePayrollCsv(`${A},100\nrecipient,amount`);
    expect(rows).toHaveLength(2);
    // the second line is data with a bad address and amount, not a header
    expect(diagnostics.filter((d) => d.line === 2)).toHaveLength(2);
  });

  it("surfaces every failure mode of a mixed fixture at once", () => {
    const fixture = [
      "recipient,amount",
      `${A},100`, // fine
      "bad-address,50", // bad address
      `${B},not-a-number`, // bad amount
      `${A},25`, // duplicate (warning)
      "only-one-field", // wrong field count
      `${B},`, // missing amount
    ].join("\n");
    const { rows, diagnostics } = parsePayrollCsv(fixture);
    expect(rows).toHaveLength(5); // all but the structurally-broken line
    expect(diagnostics.map((d) => [d.line, d.field, d.severity])).toEqual([
      [3, "recipient", "error"],
      [4, "amount", "error"],
      [5, "recipient", "warning"],
      [6, "row", "error"],
      [7, "amount", "error"],
      [7, "recipient", "warning"], // B reused from line 4
    ]);
  });
});

describe("validatePayrollRow", () => {
  it("passes a valid row", () => {
    expect(validatePayrollRow({ recipient: A, amount: "1.5" })).toEqual([]);
  });

  it("reports missing and malformed fields with line 0 for UI edits", () => {
    expect(validatePayrollRow({ recipient: "", amount: "" })).toEqual([
      expect.objectContaining({ line: 0, field: "recipient", severity: "error" }),
      expect.objectContaining({ line: 0, field: "amount", severity: "error" }),
    ]);
    expect(
      validatePayrollRow({ recipient: "attesta1short", amount: "-5" }),
    ).toHaveLength(2);
  });
});

describe("diagnosticsToCsv", () => {
  it("emits a header plus one line per diagnostic, escaping quotes and commas", () => {
    const csv = diagnosticsToCsv([
      { line: 3, field: "amount", problem: 'Says "12,5" — use a dot.', severity: "error" },
    ]);
    expect(csv).toBe(
      'line,field,severity,problem\n3,amount,error,"Says ""12,5"" — use a dot."',
    );
  });
});
