import { describe, expect, it } from "vitest";
import { parsePayrollCsv } from "./csv";

describe("parsePayrollCsv", () => {
  it("parses recipient,amount lines", () => {
    expect(parsePayrollCsv("GABC,100.50\nGDEF,2000")).toEqual([
      { recipient: "GABC", amount: "100.50" },
      { recipient: "GDEF", amount: "2000" },
    ]);
  });

  it("skips a header row, blank lines, and handles CRLF", () => {
    const text = "recipient,amount\r\n\r\nGABC,100\r\nGDEF,200\r\n";
    expect(parsePayrollCsv(text)).toEqual([
      { recipient: "GABC", amount: "100" },
      { recipient: "GDEF", amount: "200" },
    ]);
  });

  it("trims whitespace around fields", () => {
    expect(parsePayrollCsv("  GABC , 100 ")).toEqual([
      { recipient: "GABC", amount: "100" },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(parsePayrollCsv("")).toEqual([]);
  });
});
