export interface PayrollCsvRow {
  recipient: string;
  amount: string;
}

/**
 * Parse a payroll CSV of `recipient,amount` lines, entirely in the browser.
 * Tolerates a header row, blank lines, and CRLF endings. Amounts are kept as
 * strings here; they are parsed and encrypted locally at proving time.
 */
export function parsePayrollCsv(text: string): PayrollCsvRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [recipient = "", amount = ""] = line.split(",").map((s) => s.trim());
      return { recipient, amount };
    })
    .filter((r) => r.recipient && !/recipient/i.test(r.recipient));
}
