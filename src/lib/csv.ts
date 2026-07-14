import { isShieldedAddress, parseAmount } from "./notes";

export interface PayrollCsvRow {
  recipient: string;
  amount: string;
}

/** One problem found while importing or editing payroll data. */
export interface CsvDiagnostic {
  /** 1-based line number in the imported file; 0 for rows edited in the UI. */
  line: number;
  field: "recipient" | "amount" | "row";
  problem: string;
  /** Warnings (e.g. duplicates) are flagged but don't block the row. */
  severity: "error" | "warning";
}

export interface PayrollCsvResult {
  rows: PayrollCsvRow[];
  diagnostics: CsvDiagnostic[];
}

/**
 * Parse a payroll CSV of `recipient,amount` lines, entirely in the browser
 * (amounts are private data — they must never leave the device for parsing).
 * Tolerates a header row, blank lines, and CRLF endings. Nothing is silently
 * dropped: every malformed or suspicious line produces a diagnostic, and
 * structurally-sound rows are kept even when a field is invalid so the user
 * can fix them in place.
 */
export function parsePayrollCsv(text: string): PayrollCsvResult {
  const rows: PayrollCsvRow[] = [];
  const diagnostics: CsvDiagnostic[] = [];
  const firstSeen = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  let headerCandidate = true;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (!line) continue;
    const fields = line.split(",").map((s) => s.trim());
    if (headerCandidate && /recipient/i.test(fields[0])) {
      headerCandidate = false;
      continue;
    }
    headerCandidate = false; // only the first non-blank line can be a header
    if (fields.length !== 2) {
      diagnostics.push({
        line: lineNo,
        field: "row",
        problem: `Expected "recipient,amount" (2 fields), got ${fields.length}.`,
        severity: "error",
      });
      continue;
    }
    const row: PayrollCsvRow = { recipient: fields[0], amount: fields[1] };
    diagnostics.push(...validatePayrollRow(row, lineNo));
    if (row.recipient) {
      const dup = firstSeen.get(row.recipient);
      if (dup !== undefined) {
        diagnostics.push({
          line: lineNo,
          field: "recipient",
          problem: `Duplicate recipient (first used on line ${dup}) — allowed, but check it's intended.`,
          severity: "warning",
        });
      } else {
        firstSeen.set(row.recipient, lineNo);
      }
    }
    rows.push(row);
  }
  return { rows, diagnostics };
}

/** Field-level checks shared by CSV import and in-table editing. */
export function validatePayrollRow(
  row: PayrollCsvRow,
  line = 0,
): CsvDiagnostic[] {
  const out: CsvDiagnostic[] = [];
  if (!row.recipient) {
    out.push({
      line,
      field: "recipient",
      problem: "Missing recipient address.",
      severity: "error",
    });
  } else if (!isShieldedAddress(row.recipient)) {
    out.push({
      line,
      field: "recipient",
      problem: "Not a shielded address (expected attesta1 followed by 40 hex characters).",
      severity: "error",
    });
  }
  if (!row.amount) {
    out.push({ line, field: "amount", problem: "Missing amount.", severity: "error" });
  } else {
    try {
      parseAmount(row.amount);
    } catch (e) {
      out.push({
        line,
        field: "amount",
        problem: e instanceof Error ? e.message : String(e),
        severity: "error",
      });
    }
  }
  return out;
}

/** Serialize diagnostics as a downloadable error-report CSV. */
export function diagnosticsToCsv(diagnostics: CsvDiagnostic[]): string {
  const escape = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
  return [
    "line,field,severity,problem",
    ...diagnostics.map((d) =>
      [d.line, d.field, d.severity, escape(d.problem)].join(","),
    ),
  ].join("\n");
}
