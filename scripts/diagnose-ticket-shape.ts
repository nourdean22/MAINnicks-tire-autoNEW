/**
 * Wave-97 — peek at /api/ticket/listRecentTickets JSON shape to find
 * the invoice-vs-estimate discriminator field.
 */
import "dotenv/config";

async function authenticate(): Promise<string | null> {
  const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
  const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
  const username = process.env.AUTO_LABOR_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD;
  if (!username || !password) return null;
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
  if (!res.ok) return null;
  const data = await res.json() as { token?: string; jwt?: string; accessToken?: string };
  return data.token || data.jwt || data.accessToken || null;
}

async function main() {
  const token = await authenticate();
  if (!token) { console.error("Auth failed"); process.exit(1); }
  const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
  const res = await fetch(`${SHOPDRIVER_API}/api/ticket/listRecentTickets?pageNumber=1&pageSize=20`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });
  console.log(`Status: ${res.status}`);
  const data = await res.json() as Array<Record<string, unknown>>;
  console.log(`Total tickets: ${data.length}`);
  if (data.length === 0) return;

  console.log(`\n--- Keys present in first ticket: ---`);
  console.log(Object.keys(data[0]).join(", "));

  console.log(`\n--- First 3 tickets, abbreviated: ---`);
  for (let i = 0; i < Math.min(3, data.length); i++) {
    const t = data[i];
    const compact: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      if (v !== null && v !== undefined && v !== "" && typeof v !== "object") {
        compact[k] = v;
      }
    }
    console.log(`\n[${i}]:`);
    console.log(JSON.stringify(compact, null, 2));
  }

  console.log(`\n--- Look for type/status fields across all tickets: ---`);
  const typeFields = ["type", "ticketType", "status", "ticketStatus", "isInvoice", "isEstimate", "stage", "phase", "kind", "category"];
  for (const field of typeFields) {
    const values = new Set(data.map(t => t[field]).filter(v => v !== null && v !== undefined));
    if (values.size > 0) {
      console.log(`${field}: ${Array.from(values).map(v => JSON.stringify(v)).join(", ")}`);
    }
  }

  // Group by ticketType + presence of invoiceNumber/estimateNumber
  console.log(`\n--- Group by ticketType + presence of inv/est numbers: ---`);
  const buckets: Record<string, Array<Record<string, unknown>>> = {};
  for (const t of data) {
    const hasInv = t.invoiceNumber != null && t.invoiceNumber !== 0;
    const hasEst = t.estimateNumber != null && t.estimateNumber !== 0;
    const key = `ticketType=${t.ticketType} | hasInv=${hasInv} | hasEst=${hasEst}`;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(t);
  }
  for (const [key, items] of Object.entries(buckets)) {
    console.log(`  ${key}: ${items.length} tickets`);
    const sample = items[0];
    console.log(`    sample: ticketId=${sample.ticketId}, invoiceNumber=${sample.invoiceNumber}, estimateNumber=${sample.estimateNumber}, total=$${sample.total}`);
  }

  // Try to fetch a specific ticket to see if line items come back
  console.log(`\n--- Probe ticket detail endpoint for line items: ---`);
  const sampleTicketId = data[0].ticketId;
  const detailEndpoints = [
    `/api/ticket/get?ticketId=${sampleTicketId}`,
    `/api/ticket/getTicket?ticketId=${sampleTicketId}`,
    `/api/ticket/${sampleTicketId}`,
    `/api/ticket/getTicketDetails?ticketId=${sampleTicketId}`,
    `/api/Estimate/get?id=${sampleTicketId}`,
    `/api/Invoice/get?id=${sampleTicketId}`,
    `/api/ticket/getLineItems?ticketId=${sampleTicketId}`,
    `/api/ticket/getJobs?ticketId=${sampleTicketId}`,
  ];
  for (const ep of detailEndpoints) {
    const r = await fetch(`${SHOPDRIVER_API}${ep}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });
    const ct = r.headers.get("content-type") || "";
    if (r.ok) {
      const body = await r.text();
      const isJson = ct.includes("json");
      const summary = isJson ? body.slice(0, 250).replace(/\s+/g, " ") : "(html)";
      console.log(`✓ ${ep} → ${r.status} ${ct} · len ${body.length}\n  ${summary}\n`);
    } else {
      console.log(`✗ ${ep} → ${r.status}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
