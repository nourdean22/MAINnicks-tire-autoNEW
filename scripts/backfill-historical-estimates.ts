/**
 * Wave-98 historical backfill — paginate through ALG's
 * /api/ticket/listRecentTickets to backfill `alg_estimates` from
 * 2024-05 → today. The live cron only ever sees the last 50 tickets
 * (recency-bound), so historical declined-work data was missing.
 *
 * Strategy:
 *   1. Walk pageNumber 1 → maxPages with pageSize=50
 *   2. For each page, route by ticketType:
 *        - ticketType=0 (invoice) → SKIP (mirror handles invoices)
 *        - ticketType=1 OR (no invoiceNumber + has estimateNumber)
 *          → upsert into alg_estimates by external_id = String(estimateNumber)
 *   3. When a ticket has BOTH invoiceNumber AND estimateNumber AND
 *      ticketType=0, it's a converted estimate. Set
 *      alg_estimates.matched_invoice_id = invoices.id (lookup by
 *      invoiceNumber).
 *   4. Sleep 1.5s between pages (≈2 minutes total for ~80 pages)
 *
 * SAFETY: dry-run by default. --commit to mutate.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-historical-estimates.ts          # dry-run
 *   pnpm tsx scripts/backfill-historical-estimates.ts --commit # mutate
 *   pnpm tsx scripts/backfill-historical-estimates.ts --commit --max-pages=20
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");
const MAX_PAGES_ARG = process.argv.find((a) => a.startsWith("--max-pages="));
const MAX_PAGES = MAX_PAGES_ARG
  ? parseInt(MAX_PAGES_ARG.split("=")[1], 10)
  : 100;
const PAGE_SIZE = 50;
const SLEEP_BETWEEN_PAGES_MS = 1500;

const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";

interface Ticket {
  ticketId: string;
  customerId: string;
  firstName?: string;
  lastName?: string;
  businessName?: string | null;
  primaryNumber?: string;
  year?: string;
  make?: string;
  model?: string;
  invoiceNumber: number | null;
  estimateNumber: number | null;
  ticketType: number;
  invoiceDate?: string;
  estimateDate?: string;
  total: number;
  description?: string;
  customerDateCreated?: string;
}

async function authenticate(): Promise<string | null> {
  const username = process.env.AUTO_LABOR_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD;
  if (!username || !password) {
    console.error("AUTO_LABOR_USERNAME / AUTO_LABOR_PASSWORD missing");
    return null;
  }
  const res = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Origin": SHOPDRIVER_BASE,
      "Referer": `${SHOPDRIVER_BASE}/`,
    },
    body: JSON.stringify({ login: username, password, ipAddress: "", location: "" }),
  });
  if (!res.ok) {
    console.error(`Auth failed: ${res.status}`);
    return null;
  }
  const data = await res.json() as { token?: string; jwt?: string };
  return data.token || data.jwt || null;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function isEstimate(t: Ticket): boolean {
  if (t.ticketType === 1) return true;
  return (t.invoiceNumber == null || t.invoiceNumber === 0) &&
    t.estimateNumber != null && t.estimateNumber !== 0;
}

function buildVehicleInfo(t: Ticket): string | null {
  return [t.year, t.make, t.model].filter(Boolean).join(" ") || null;
}

function buildCustomerName(t: Ticket): string {
  if (t.businessName) return t.businessName;
  return `${t.firstName || ""} ${t.lastName || ""}`.trim() || "Unknown";
}

async function main() {
  console.log(`\n═══ Wave-98 historical estimate backfill ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT" : "🟢 DRY RUN (--commit to mutate)"}`);
  console.log(`Max pages: ${MAX_PAGES} · Page size: ${PAGE_SIZE} · Sleep: ${SLEEP_BETWEEN_PAGES_MS}ms`);
  console.log(`Estimated runtime: ~${Math.ceil((MAX_PAGES * SLEEP_BETWEEN_PAGES_MS) / 60000)} min\n`);

  const token = await authenticate();
  if (!token) process.exit(1);

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  let totalFetched = 0;
  let totalEstimates = 0;
  let totalInvoices = 0;
  let estimatesInserted = 0;
  let estimatesUpdated = 0;
  let estimatesAlreadyExisted = 0;
  let matchedToInvoice = 0;
  let lastPageReached = 0;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(
        `${SHOPDRIVER_API}/api/ticket/listRecentTickets?pageNumber=${page}&pageSize=${PAGE_SIZE}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
          },
        }
      );

      if (!res.ok) {
        console.log(`page ${page}: HTTP ${res.status} — stopping`);
        break;
      }

      const tickets = await res.json() as Ticket[];
      if (!Array.isArray(tickets) || tickets.length === 0) {
        console.log(`page ${page}: empty — backfill complete`);
        lastPageReached = page;
        break;
      }

      lastPageReached = page;
      totalFetched += tickets.length;
      const estimates = tickets.filter(isEstimate);
      const invoices = tickets.length - estimates.length;
      totalEstimates += estimates.length;
      totalInvoices += invoices;

      const newest = tickets[0]?.estimateDate || tickets[0]?.invoiceDate || "?";
      const oldest = tickets[tickets.length - 1]?.estimateDate || tickets[tickets.length - 1]?.invoiceDate || "?";
      console.log(`page ${page}: ${tickets.length} tix (${estimates.length} est, ${invoices} inv) · ${newest.slice(0, 10)} → ${oldest.slice(0, 10)}`);

      if (COMMIT) {
        for (const t of estimates) {
          const externalId = t.estimateNumber != null && t.estimateNumber !== 0
            ? String(t.estimateNumber)
            : t.ticketId;
          const customerName = buildCustomerName(t);
          const customerPhone = normalizePhone(t.primaryNumber || "");
          const vehicleInfo = buildVehicleInfo(t);
          const estimatedAmount = Math.round(t.total * 100);
          const dateStr = t.estimateDate || t.invoiceDate || t.customerDateCreated || new Date().toISOString();
          const estimateDate = new Date(dateStr);

          // Check if already exists
          const [existingRaw] = await conn.execute(
            `SELECT id FROM alg_estimates WHERE external_id = ?`,
            [externalId]
          );
          const existing = existingRaw as Array<{ id: number }>;

          if (existing.length === 0) {
            await conn.execute(
              `INSERT INTO alg_estimates
                (external_id, customer_name, customer_phone, vehicle_info,
                 service_description, estimated_amount, estimate_date,
                 source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'alg-historical', NOW(), NOW())`,
              [externalId, customerName, customerPhone, vehicleInfo,
                t.description || null, estimatedAmount, estimateDate]
            );
            estimatesInserted++;
          } else {
            // Refresh the row in case data changed
            await conn.execute(
              `UPDATE alg_estimates
               SET customer_name = ?, customer_phone = ?, vehicle_info = ?,
                   service_description = ?, estimated_amount = ?,
                   estimate_date = ?, updated_at = NOW()
               WHERE id = ?`,
              [customerName, customerPhone, vehicleInfo,
                t.description || null, estimatedAmount, estimateDate, existing[0].id]
            );
            estimatesUpdated++;
          }
        }

        // Match converted-estimate tickets (have BOTH inv + est numbers)
        const converted = tickets.filter((t) =>
          t.ticketType === 0 &&
          t.invoiceNumber != null && t.invoiceNumber !== 0 &&
          t.estimateNumber != null && t.estimateNumber !== 0
        );
        for (const t of converted) {
          // Find the invoice in the DB by invoiceNumber
          const [invRaw] = await conn.execute(
            `SELECT id FROM invoices WHERE invoiceNumber = ?`,
            [String(t.invoiceNumber)]
          );
          const inv = invRaw as Array<{ id: number }>;
          if (inv.length > 0) {
            const externalId = String(t.estimateNumber);
            const [updateRes] = await conn.execute(
              `UPDATE alg_estimates
               SET matched_invoice_id = ?, matched_at = NOW()
               WHERE external_id = ? AND matched_invoice_id IS NULL`,
              [inv[0].id, externalId]
            );
            const result = updateRes as { affectedRows: number };
            if (result.affectedRows > 0) {
              matchedToInvoice++;
            }
          }
        }
      } else {
        // Dry-run — count what would happen
        for (const t of estimates) {
          const externalId = t.estimateNumber != null && t.estimateNumber !== 0
            ? String(t.estimateNumber)
            : t.ticketId;
          const [existingRaw] = await conn.execute(
            `SELECT id FROM alg_estimates WHERE external_id = ?`,
            [externalId]
          );
          const existing = existingRaw as Array<{ id: number }>;
          if (existing.length === 0) estimatesInserted++;
          else estimatesAlreadyExisted++;
        }
      }

      if (page < MAX_PAGES) {
        await new Promise((rs) => setTimeout(rs, SLEEP_BETWEEN_PAGES_MS));
      }
    }

    console.log(`\n─── SUMMARY ───`);
    console.log(`Pages walked:       ${lastPageReached}`);
    console.log(`Tickets fetched:    ${totalFetched}`);
    console.log(`  - Invoices:       ${totalInvoices}`);
    console.log(`  - Estimates:      ${totalEstimates}`);
    if (COMMIT) {
      console.log(`Estimates inserted: ${estimatesInserted}`);
      console.log(`Estimates updated:  ${estimatesUpdated}`);
      console.log(`Matched to invoice: ${matchedToInvoice} (converted estimates)`);
    } else {
      console.log(`Would insert:       ${estimatesInserted} new estimate rows`);
      console.log(`Would skip:         ${estimatesAlreadyExisted} already-existing rows`);
      console.log(`\n🟢 Dry run only. Re-run with --commit to mutate.`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
