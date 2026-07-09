/**
 * Wave-99 — backfill invoices.algTicketId from ALG's listRecentTickets.
 *
 * Walks all 59 pages of ALG history, joining each ticketId to its
 * matching invoiceNumber row in our DB and setting algTicketId where
 * it's currently NULL.
 *
 * Idempotent. --commit to mutate, otherwise dry-run.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const COMMIT = process.argv.includes("--commit");
const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
const PAGE_SIZE = 50;
const MAX_PAGES = 100;
const SLEEP_MS = 1500;

interface Ticket {
  ticketId: string;
  invoiceNumber: number | null;
  ticketType: number;
}

async function authenticate(): Promise<string | null> {
  const res = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Origin": SHOPDRIVER_BASE,
      "Referer": `${SHOPDRIVER_BASE}/`,
    },
    body: JSON.stringify({
      login: process.env.AUTO_LABOR_USERNAME,
      password: process.env.AUTO_LABOR_PASSWORD,
      ipAddress: "",
      location: "",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { token?: string; jwt?: string };
  return data.token || data.jwt || null;
}

async function main() {
  console.log(`\n═══ Wave-99 invoice ticketId backfill ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT" : "🟢 DRY RUN (--commit to mutate)"}\n`);

  const token = await authenticate();
  if (!token) { console.error("Auth failed"); process.exit(1); }
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  let invoicesScanned = 0;
  let invoicesUpdated = 0;
  let invoicesNotFound = 0;
  let invoicesAlreadySet = 0;

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
        console.log(`page ${page}: empty — done`);
        break;
      }

      // Only invoices have a numeric invoiceNumber + ticketType=0
      const invoiceTickets = tickets.filter(
        (t) => t.ticketType === 0 && t.invoiceNumber != null && t.invoiceNumber !== 0
      );

      for (const t of invoiceTickets) {
        invoicesScanned++;
        const invoiceNumberStr = String(t.invoiceNumber);

        const [rowsRaw] = await conn.execute(
          `SELECT id, algTicketId FROM invoices WHERE invoiceNumber = ? LIMIT 1`,
          [invoiceNumberStr]
        );
        const rows = rowsRaw as Array<{ id: number; algTicketId: string | null }>;

        if (rows.length === 0) {
          invoicesNotFound++;
          continue;
        }
        if (rows[0].algTicketId === t.ticketId) {
          invoicesAlreadySet++;
          continue;
        }
        if (rows[0].algTicketId && rows[0].algTicketId !== t.ticketId) {
          // Mismatch — preserve existing, log
          console.log(`  ⚠ invoice id=${rows[0].id} num=${invoiceNumberStr} has algTicketId=${rows[0].algTicketId.slice(0, 8)}... but API says ${t.ticketId.slice(0, 8)}...`);
          continue;
        }
        if (COMMIT) {
          await conn.execute(
            `UPDATE invoices SET algTicketId = ? WHERE id = ?`,
            [t.ticketId, rows[0].id]
          );
        }
        invoicesUpdated++;
      }

      console.log(`page ${page}: ${invoiceTickets.length} invoice tickets · running totals: scanned=${invoicesScanned}, updated=${invoicesUpdated}, not_found=${invoicesNotFound}, already_set=${invoicesAlreadySet}`);

      if (tickets.length < PAGE_SIZE) {
        console.log(`page ${page} returned ${tickets.length} < ${PAGE_SIZE}, no more pages`);
        break;
      }
      if (page < MAX_PAGES) await new Promise((rs) => setTimeout(rs, SLEEP_MS));
    }

    console.log(`\n─── SUMMARY ───`);
    console.log(`Invoice tickets scanned in ALG:  ${invoicesScanned}`);
    console.log(`Invoices updated with ticketId:  ${COMMIT ? invoicesUpdated : `(would update ${invoicesUpdated})`}`);
    console.log(`Invoices already had ticketId:   ${invoicesAlreadySet}`);
    console.log(`ALG tickets not in our DB:       ${invoicesNotFound}`);

    if (!COMMIT) console.log(`\n🟢 Dry run only. Re-run with --commit to mutate.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => { console.error("Crashed:", err); process.exit(1); });
