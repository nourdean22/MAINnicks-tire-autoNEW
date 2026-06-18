import { describe, it, expect } from "vitest";
import { parseStatementDate, parseAmount, parseCSV } from "@/lib/services/finance";

describe("parseStatementDate", () => {
  it("parses ISO dates to UTC midnight (no tz drift)", () => {
    expect(parseStatementDate("2026-06-18")?.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
  it("parses US M/D/Y", () => {
    expect(parseStatementDate("6/18/2026")?.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
  it("parses DD/MM/Y when the day is > 12", () => {
    expect(parseStatementDate("18/06/2026")?.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
  it("parses YYYY/MM/DD", () => {
    expect(parseStatementDate("2026/06/18")?.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
  it("expands 2-digit years", () => {
    expect(parseStatementDate("6/18/26")?.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
  it("parses spelled-out months via fallback", () => {
    expect(parseStatementDate("Jun 18 2026")?.toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });
  it("returns null for junk or empty input", () => {
    expect(parseStatementDate("not a date")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses plain and signed numbers", () => {
    expect(parseAmount("5.75")).toBe(5.75);
    expect(parseAmount("-5.75")).toBe(-5.75);
  });
  it("strips currency symbols and thousands separators", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
  });
  it("treats accounting parentheses as negative", () => {
    expect(parseAmount("(5.75)")).toBe(-5.75);
    expect(parseAmount("($1,000.00)")).toBe(-1000);
  });
  it("returns null for empty or non-numeric input", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
  });
});

describe("parseCSV", () => {
  it("imports the sample row with correct sign and UTC date", () => {
    const csv = "Date,Payee,Amount,Category,Notes\n2026-06-18,Starbucks,-5.75,Food,Morning coffee\n";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].date.toISOString()).toBe("2026-06-18T00:00:00.000Z");
    expect(rows[0].amountCents).toBe(-575);
    expect(rows[0].payee).toBe("Starbucks");
    expect(rows[0].category).toBe("Food");
    expect(rows[0].notes).toBe("Morning coffee");
  });

  it("ignores a trailing blank line (no phantom row)", () => {
    const csv = "Date,Payee,Amount\n2026-06-18,Starbucks,-5.75\n\n";
    expect(parseCSV(csv)).toHaveLength(1);
  });

  it("handles separate debit/credit columns", () => {
    const csv =
      "Date,Description,Debit,Credit\n2026-06-18,Paycheck,,2000.00\n2026-06-19,Rent,1500.00,\n";
    const rows = parseCSV(csv);
    expect(rows[0].amountCents).toBe(200000); // credit -> positive
    expect(rows[1].amountCents).toBe(-150000); // debit -> negative
  });

  it("skips rows with unparseable dates", () => {
    const csv = "Date,Payee,Amount\nnot-a-date,X,1.00\n2026-06-18,Y,2.00\n";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].payee).toBe("Y");
  });
});
