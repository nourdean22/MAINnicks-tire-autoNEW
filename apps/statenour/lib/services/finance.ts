import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const log = logger.withSurface("services/finance");

export interface CSVTransaction {
  date: Date;
  amountCents: number;
  payee: string;
  category: string;
  notes: string;
}

/**
 * Parses a single CSV line respecting field values wrapped in double quotes.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

/**
 * Normalizes a bank-statement date string to UTC midnight of the intended
 * calendar date, so it survives storage + a UTC-rendered display regardless of
 * the viewer's timezone. Handles ISO (YYYY-MM-DD), YYYY/MM/DD, and slashed or
 * dashed D/M/Y / M/D/Y (with a >12 heuristic, US default), plus a Date()
 * fallback for spelled-out months. Returns null for unparseable input.
 */
export function parseStatementDate(raw: string): Date | null {
  const s = (raw || "").trim();
  if (!s) return null;

  const mk = (y: number, m: number, d: number): Date | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y < 100 ? 2000 + y : y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  let m: RegExpMatchArray | null;
  // ISO: 2026-06-18 (optionally with a time suffix)
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
  // YYYY/MM/DD
  if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))) return mk(+m[1], +m[2], +m[3]);
  // D/M/Y or M/D/Y (slash or dash). Disambiguate by the >12 rule, default US.
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/))) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    if (a > 12 && b <= 12) return mk(y, b, a); // DD/MM
    return mk(y, a, b); // MM/DD (US default)
  }
  // Fallback: let Date() try (e.g. "Jun 18 2026"); keep its calendar date in UTC.
  const fallback = new Date(s);
  if (Number.isNaN(fallback.getTime())) return null;
  return mk(fallback.getFullYear(), fallback.getMonth() + 1, fallback.getDate());
}

/**
 * Parses a money string to a number. Handles currency symbols, thousands
 * separators, leading +/-, and accounting-style parentheses for negatives
 * (e.g. "(5.75)" -> -5.75). Returns null if no numeric value is present.
 */
export function parseAmount(raw: string): number | null {
  let s = (raw || "").trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.\-+]/g, ""); // drop currency symbols, commas, spaces
  if (s === "" || s === "-" || s === "+") return null;
  const val = parseFloat(s);
  if (!Number.isFinite(val)) return null;
  return negative ? -Math.abs(val) : val;
}

/**
 * Parses bank statement CSV text and returns structured CSVTransaction objects.
 */
export function parseCSV(csvText: string): CSVTransaction[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0].toLowerCase());

  // Find column indexes
  const dateIdx = headers.findIndex((h) => h.includes("date"));
  const payeeIdx = headers.findIndex((h) => h.includes("payee") || h.includes("description") || h.includes("name"));
  const amountIdx = headers.findIndex((h) => h.includes("amount") || h.includes("value"));
  const debitIdx = headers.findIndex((h) => h.includes("debit"));
  const creditIdx = headers.findIndex((h) => h.includes("credit"));
  const categoryIdx = headers.findIndex((h) => h.includes("category") || h.includes("type"));
  const notesIdx = headers.findIndex((h) => h.includes("notes") || h.includes("memo"));

  if (dateIdx === -1 || payeeIdx === -1 || (amountIdx === -1 && debitIdx === -1 && creditIdx === -1)) {
    throw new Error("CSV structure not recognized. Header must contain Date, Payee/Description, and Amount/Debit/Credit columns.");
  }

  const transactions: CSVTransaction[] = [];

  for (let i = 1; i < lines.length; i++) {
    const columns = parseCSVLine(lines[i]);
    if (columns.length < Math.max(dateIdx, payeeIdx) + 1) continue;

    // Parse Date (normalized to UTC midnight of the calendar date)
    const parsedDate = parseStatementDate(columns[dateIdx]);
    if (!parsedDate) continue; // Skip malformed dates

    // Parse Payee
    const payee = columns[payeeIdx] || "Unknown Payee";

    // Parse Amount Cents (single amount col, else debit/credit pair)
    let amountCents = 0;
    if (amountIdx !== -1 && columns[amountIdx]) {
      const amountVal = parseAmount(columns[amountIdx]);
      if (amountVal !== null) {
        amountCents = Math.round(amountVal * 100);
      }
    } else {
      const debit = debitIdx !== -1 ? parseAmount(columns[debitIdx]) : null;
      const credit = creditIdx !== -1 ? parseAmount(columns[creditIdx]) : null;
      if (credit !== null && credit !== 0) {
        amountCents = Math.round(Math.abs(credit) * 100);
      } else if (debit !== null && debit !== 0) {
        amountCents = Math.round(-Math.abs(debit) * 100);
      }
    }

    const category = categoryIdx !== -1 && columns[categoryIdx] ? columns[categoryIdx] : "Uncategorized";
    const notes = notesIdx !== -1 && columns[notesIdx] ? columns[notesIdx] : "";

    transactions.push({
      date: parsedDate,
      amountCents,
      payee,
      category,
      notes,
    });
  }

  return transactions;
}

/**
 * Saves parsed transactions to the database, skipping duplicates using deterministic hashes.
 */
export async function syncTransactions(transactions: CSVTransaction[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    // Create a deterministic hash for deduplication
    const dateStr = tx.date.toISOString().slice(0, 10);
    const hashBase = `${dateStr}:${tx.payee}:${tx.amountCents}:${tx.notes}:${i}`;
    const hash = createHash("sha256").update(hashBase).digest("hex").slice(0, 32);
    const plaidTransactionId = `csv:${hash}`;

    try {
      const created = await prisma.financialTransaction.create({
        data: {
          date: tx.date,
          amountCents: tx.amountCents,
          payee: tx.payee,
          category: tx.category,
          notes: tx.notes,
          plaidTransactionId,
        },
      });

      imported++;

      // Trigger AI classification in background via Inngest
      try {
        const { getInngest } = await import("@/src/inngest/client");
        await getInngest().send({
          name: "finance/transaction.created",
          data: {
            transactionId: created.id,
            payee: created.payee,
            amountCents: created.amountCents,
            category: created.category,
            date: dateStr,
          },
        });
      } catch (e) {
        log.error("failed_dispatching_inngest_transaction_event", { error: String(e) });
      }
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        // Unique constraint violation (duplicate skipped)
        skipped++;
      } else {
        log.error("error_importing_transaction", { error: String(err) });
        throw err;
      }
    }
  }

  return { imported, skipped };
}
