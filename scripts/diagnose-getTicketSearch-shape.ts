/**
 * Wave-100 — confirm getTicketSearch response includes serviceDescription.
 * Compare its shape vs listRecentTickets to find enrichment fields.
 */
import "dotenv/config";

const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";

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
  const token = await authenticate();
  if (!token) { console.error("auth failed"); process.exit(1); }
  const auth = { "Authorization": `Bearer ${token}`, "Accept": "application/json", "User-Agent": "Mozilla/5.0" };

  // Test against a few different invoice numbers
  for (const inv of ["3572", "3500", "3450", "3000"]) {
    console.log(`\n═══ getTicketSearch?invoiceNumber=${inv} ═══`);
    const r = await fetch(`${SHOPDRIVER_API}/api/Search/getTicketSearch?invoiceNumber=${inv}`, { headers: auth });
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      const t = data[0];
      console.log("Keys:", Object.keys(t).join(", "));
      console.log("description:", JSON.stringify(t.description));
      console.log("serviceDescription:", JSON.stringify(t.serviceDescription));
      console.log("totalAmount:", t.totalAmount, "total:", t.total);
      console.log("partsCost:", t.partsCost, "laborCost:", t.laborCost, "taxAmount:", t.taxAmount);
      // Look for any field that might have line items / job text
      for (const [k, v] of Object.entries(t)) {
        if (typeof v === "string" && v.length > 30) {
          console.log(`  ${k}: "${v.slice(0, 100)}..."`);
        } else if (Array.isArray(v) && v.length > 0) {
          console.log(`  ${k}: Array(${v.length}) — first item keys: ${Object.keys(v[0] as object).slice(0, 10).join(", ")}`);
        }
      }
    } else {
      console.log(`Response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    await new Promise(rs => setTimeout(rs, 500));
  }
}
main().catch(err => { console.error(err); process.exit(1); });
