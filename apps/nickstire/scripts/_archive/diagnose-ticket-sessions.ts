/**
 * Wave-100 — listTicketSessions deep dive. Earlier I confirmed it
 * returns "session" headers with vehicleDescription field. Let me see
 * if that field has the line-item-style description text.
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

  const sampleTicketId = "d1cd7074-87a9-4de3-a278-80b8ef73b0a1"; // Neko Fountain · Inv#3572

  console.log("\n═══ listTicketSessions full response ═══");
  const r = await fetch(`${SHOPDRIVER_API}/api/ticket/listTicketSessions?ticketId=${sampleTicketId}`, { headers: auth });
  const data = await r.json();
  console.log(JSON.stringify(data, null, 2).slice(0, 3500));

  // Also try without parameters (might list all sessions across all tickets)
  console.log("\n\n═══ listTicketSessions WITHOUT ticketId ═══");
  const r2 = await fetch(`${SHOPDRIVER_API}/api/ticket/listTicketSessions`, { headers: auth });
  const d2 = await r2.json();
  console.log(`Status: ${r2.status} · Length: ${JSON.stringify(d2).length} chars`);
  if (Array.isArray(d2) && d2.length > 0) {
    console.log(`Items: ${d2.length}`);
    console.log("First item keys:", Object.keys(d2[0]).slice(0, 30).join(", "));
    console.log("Sample:", JSON.stringify(d2[0], null, 2).slice(0, 800));
  }

  // listTicketSessions with pagination (mirror current loop calls this)
  console.log("\n\n═══ listTicketSessions?pageNumber=1&pageSize=50 ═══");
  const r3 = await fetch(`${SHOPDRIVER_API}/api/ticket/listTicketSessions?pageNumber=1&pageSize=50`, { headers: auth });
  const d3 = await r3.json();
  console.log(`Status: ${r3.status} · Length: ${JSON.stringify(d3).length} chars`);
  if (Array.isArray(d3) && d3.length > 0) {
    console.log(`Items: ${d3.length}`);
    console.log("First item keys:", Object.keys(d3[0]).slice(0, 30).join(", "));
    // Check if vehicleDescription field present
    const t0 = d3[0] as Record<string, unknown>;
    if (t0.vehicleDescription) console.log("vehicleDescription:", JSON.stringify(t0.vehicleDescription));
    if (t0.description) console.log("description:", JSON.stringify(t0.description));
    if (t0.serviceDescription) console.log("serviceDescription:", JSON.stringify(t0.serviceDescription));
  }
}
main().catch(err => { console.error(err); process.exit(1); });
