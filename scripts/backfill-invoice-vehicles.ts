/**
 * Wave-99 — backfill invoices.vehicleInfo from ALG's listRecentTickets.
 *
 * The mirror normalizer was looking for raw.vehicleYear/Make/Model but
 * the actual API fields are year/make/model. Result: 2,540/2,563
 * invoices have NULL vehicleInfo. Fix is shipped; this backfills.
 *
 * Idempotent. --commit to mutate, dry-run otherwise.
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
  year?: number | string;
  make?: string;
  model?: string;
  vin?: string;
  engine?: string;
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

function buildVehicle(t: Ticket): string | null {
  const parts: string[] = [];
  if (t.year) parts.push(String(t.year));
  if (t.make) parts.push(t.make);
  if (t.model) parts.push(t.model);
  return parts.length > 0 ? parts.join(" ").trim() : null;
}

async function main() {
  console.log(`\n═══ Wave-99 invoice vehicleInfo backfill ═══`);
  console.log(`Mode: ${COMMIT ? "🔴 COMMIT" : "🟢 DRY RUN (--commit to mutate)"}\n`);

  const token = await authenticate();
  if (!token) { console.error("Auth failed"); process.exit(1); }
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  let scanned = 0;
  let updated = 0;
  let alreadySet = 0;
  let noVehicleData = 0;
  let invoiceNotFound = 0;

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

      const invoiceTickets = tickets.filter(
        (t) => t.ticketType === 0 && t.invoiceNumber != null && t.invoiceNumber !== 0
      );

      for (const t of invoiceTickets) {
        scanned++;
        const vehicleInfo = buildVehicle(t);
        if (!vehicleInfo) {
          noVehicleData++;
          continue;
        }

        const [rowsRaw] = await conn.execute(
          `SELECT id, vehicleInfo FROM invoices WHERE invoiceNumber = ? LIMIT 1`,
          [String(t.invoiceNumber)]
        );
        const rows = rowsRaw as Array<{ id: number; vehicleInfo: string | null }>;
        if (rows.length === 0) {
          invoiceNotFound++;
          continue;
        }
        if (rows[0].vehicleInfo) {
          alreadySet++;
          continue;
        }
        if (COMMIT) {
          await conn.execute(
            `UPDATE invoices SET vehicleInfo = ? WHERE id = ?`,
            [vehicleInfo, rows[0].id]
          );
        }
        updated++;
      }

      console.log(`page ${page}: ${invoiceTickets.length} invoices · running: scanned=${scanned}, updated=${updated}, already_set=${alreadySet}, no_data=${noVehicleData}, not_found=${invoiceNotFound}`);

      if (tickets.length < PAGE_SIZE) {
        console.log(`page ${page} returned ${tickets.length} < ${PAGE_SIZE}, no more pages`);
        break;
      }
      if (page < MAX_PAGES) await new Promise((rs) => setTimeout(rs, SLEEP_MS));
    }

    console.log(`\n─── SUMMARY ───`);
    console.log(`Invoices scanned:               ${scanned}`);
    console.log(`Vehicle backfilled:             ${COMMIT ? updated : `(would update ${updated})`}`);
    console.log(`Already had vehicle info:       ${alreadySet}`);
    console.log(`Ticket had no vehicle data:     ${noVehicleData}`);
    console.log(`Invoice not in our DB:          ${invoiceNotFound}`);

    if (!COMMIT) console.log(`\n🟢 Dry run only. Re-run with --commit to mutate.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => { console.error("Crashed:", err); process.exit(1); });
