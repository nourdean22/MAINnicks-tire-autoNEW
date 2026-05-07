/**
 * Wave-99 deep dive — full response from getTicketSearch + check
 * for nested line-item arrays that I missed earlier.
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

  // Get ticket #3572 (the most recent invoice)
  const r = await fetch(`${SHOPDRIVER_API}/api/Search/getTicketSearch?ticketNumber=3572`, { headers: auth });
  const data = await r.json();
  console.log("Full /api/Search/getTicketSearch?ticketNumber=3572 response:");
  console.log(JSON.stringify(data, null, 2));

  // Also try with searchTerm + invoiceNumber variations
  for (const param of ["searchTerm", "invoiceNumber", "estimateNumber", "ticketId"]) {
    const r2 = await fetch(`${SHOPDRIVER_API}/api/Search/getTicketSearch?${param}=3572`, { headers: auth });
    const d2 = await r2.json();
    console.log(`\nWith ${param}=3572: ${JSON.stringify(d2).length} chars`);
    if (Array.isArray(d2) && d2.length > 0 && JSON.stringify(d2).length > 600) {
      console.log("  Different shape:", Object.keys(d2[0]).slice(0, 30).join(", "));
    }
  }

  // Try variations of getTicketSearch with different params
  const sampleTicketId = "d1cd7074-87a9-4de3-a278-80b8ef73b0a1";
  const probeUrls = [
    `/api/Search/getTicketSearch?ticketId=${sampleTicketId}`,
    `/api/Search/getTicketSearch?ticketId=${sampleTicketId}&includeLineItems=true`,
    `/api/Search/getTicketSearch?ticketId=${sampleTicketId}&full=true`,
    `/api/Search/getTicketSearch?ticketId=${sampleTicketId}&expand=lineItems`,
    `/api/Search/getTicketSearch?ticketId=${sampleTicketId}&expand=parts`,
    `/api/Search/getTicketSearch?ticketId=${sampleTicketId}&detail=true`,
    `/api/Ticket/emailTicketInvoice/${sampleTicketId}`,
    `/api/Ticket/getTicketInvoiceHtml/${sampleTicketId}`,
    `/api/Ticket/preview?ticketId=${sampleTicketId}`,
  ];
  for (const u of probeUrls) {
    const rr = await fetch(`${SHOPDRIVER_API}${u}`, { headers: auth });
    const ct = rr.headers.get("content-type") || "";
    const text = await rr.text();
    const tag = rr.ok ? "✓" : "✗";
    console.log(`${tag} ${u} → ${rr.status} · ${ct} · len ${text.length}`);
    if (rr.ok && text.length > 100 && (ct.includes("json") || ct.includes("html"))) {
      console.log(`  Preview: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
