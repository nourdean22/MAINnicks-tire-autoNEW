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

    // Parse Date
    const rawDate = columns[dateIdx];
    const parsedDate = new Date(rawDate);
    if (isNaN(parsedDate.getTime())) continue; // Skip malformed dates

    // Parse Payee
    const payee = columns[payeeIdx] || "Unknown Payee";

    // Parse Amount Cents
    let amountCents = 0;
    if (amountIdx !== -1 && columns[amountIdx]) {
      const amountVal = parseFloat(columns[amountIdx].replace(/[$,]/g, ""));
      if (!isNaN(amountVal)) {
        amountCents = Math.round(amountVal * 100);
      }
    } else {
      // Debit/Credit columns
      let debit = 0;
      let credit = 0;
      if (debitIdx !== -1 && columns[debitIdx]) {
        const val = parseFloat(columns[debitIdx].replace(/[$,]/g, ""));
        if (!isNaN(val)) debit = val;
      }
      if (creditIdx !== -1 && columns[creditIdx]) {
        const val = parseFloat(columns[creditIdx].replace(/[$,]/g, ""));
        if (!isNaN(val)) credit = val;
      }
      if (credit > 0) {
        amountCents = Math.round(credit * 100);
      } else if (debit > 0) {
        amountCents = Math.round(-debit * 100);
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
