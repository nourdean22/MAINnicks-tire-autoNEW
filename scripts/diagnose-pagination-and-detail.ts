/**
 * Wave-98 hunt — does /api/ticket/listRecentTickets paginate?
 * And does ANY endpoint return per-ticket line items?
 */
import "dotenv/config";

const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";

async function authenticate(): Promise<string | null> {
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
  const data = await res.json() as { token?: string; jwt?: string };
  return data.token || data.jwt || null;
}

async function main() {
  const token = await authenticate();
  if (!token) { console.error("Auth failed"); process.exit(1); }
  const auth = { "Authorization": `Bearer ${token}`, "Accept": "application/json", "User-Agent": "Mozilla/5.0" };

  console.log("\n═══ PART 1: Pagination probe ═══\n");
  // pageSize=500 returned 50 — server caps at 50. Walk pages until empty.
  for (const page of [1, 2, 3, 4, 5, 10, 20, 50, 100]) {
    const r = await fetch(
      `${SHOPDRIVER_API}/api/ticket/listRecentTickets?pageNumber=${page}&pageSize=50`,
      { headers: auth }
    );
    if (r.ok) {
      const items = await r.json() as Array<Record<string, unknown>>;
      const newest = items[0]?.invoiceDate || items[0]?.estimateDate || "(empty)";
      const oldest = items[items.length - 1]?.invoiceDate || items[items.length - 1]?.estimateDate || "(empty)";
      console.log(`page ${page}: ${items.length} items · newest=${newest} · oldest=${oldest}`);
      if (items.length === 0) {
        console.log(`  ↳ empty, stopping`);
        break;
      }
    } else {
      console.log(`page ${page}: ${r.status}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Try fetching the SPA's main JS bundle to look for endpoint names
  console.log("\n═══ PART 1.5: SPA bundle endpoint discovery ═══\n");
  const idx = await fetch(`${SHOPDRIVER_BASE}/`, { headers: auth });
  const idxHtml = await idx.text();
  const jsMatch = idxHtml.match(/\/static\/js\/main\.[a-f0-9]+\.js/);
  if (jsMatch) {
    console.log(`SPA bundle: ${jsMatch[0]}`);
    const bundleRes = await fetch(`${SHOPDRIVER_BASE}${jsMatch[0]}`);
    if (bundleRes.ok) {
      const bundle = await bundleRes.text();
      console.log(`Bundle length: ${bundle.length}`);
      // Look for /api/ patterns related to ticket detail / line items
      const apiCalls = [...bundle.matchAll(/\/api\/[A-Za-z]+\/[A-Za-z]+(?:\?|"|`)/g)]
        .map(m => m[0].replace(/[?"`]$/, ""));
      const unique = [...new Set(apiCalls)].sort();
      const ticketRelated = unique.filter(p => /ticket|invoice|estimate|job|service|part|item|line/i.test(p));
      console.log(`\nTicket/Invoice/Job-related endpoints found in bundle (${ticketRelated.length}):`);
      ticketRelated.forEach(p => console.log(`  ${p}`));
    }
  } else {
    console.log("Could not find SPA bundle URL in /");
  }

  // Get a sample ticketId for detail-endpoint hunt
  console.log("\n═══ PART 2: Line-item endpoint hunt ═══\n");
  const sampleRes = await fetch(`${SHOPDRIVER_API}/api/ticket/listRecentTickets?pageNumber=1&pageSize=5`, { headers: auth });
  const sampleData = await sampleRes.json() as Array<{ ticketId: string; invoiceNumber: number | null; estimateNumber: number | null }>;
  const sampleTicket = sampleData[0];
  console.log(`Hunting for line items on ticketId=${sampleTicket.ticketId} (invoiceNumber=${sampleTicket.invoiceNumber}, estimateNumber=${sampleTicket.estimateNumber})\n`);

  // Try a wider grid of endpoint variants
  const variants = [
    // POST shape with body
    { method: "POST", path: "/api/ticket/getTicket", body: { ticketId: sampleTicket.ticketId } },
    { method: "POST", path: "/api/ticket/getTicketDetails", body: { ticketId: sampleTicket.ticketId } },
    { method: "POST", path: "/api/ticket/load", body: { ticketId: sampleTicket.ticketId } },
    { method: "POST", path: "/api/ticket/get", body: { ticketId: sampleTicket.ticketId } },
    // GET with various param names
    { method: "GET", path: `/api/ticket/getById?id=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/ticket/getById?ticketId=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/ticket/load?ticketId=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/ticket/Detail/${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/ticket/${sampleTicket.ticketId}/items` },
    { method: "GET", path: `/api/ticket/${sampleTicket.ticketId}/lineItems` },
    { method: "GET", path: `/api/ticket/${sampleTicket.ticketId}/jobs` },
    { method: "GET", path: `/api/ticket/${sampleTicket.ticketId}/parts` },
    { method: "GET", path: `/api/ticket/${sampleTicket.ticketId}/services` },
    { method: "GET", path: `/api/Job/listByTicket?ticketId=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/Service/listByTicket?ticketId=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/Part/listByTicket?ticketId=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/LineItem/listByTicket?ticketId=${sampleTicket.ticketId}` },
    // Invoice/Estimate-specific
    { method: "GET", path: `/api/Invoice/get?invoiceNumber=${sampleTicket.invoiceNumber}` },
    { method: "GET", path: `/api/Invoice/getByNumber?number=${sampleTicket.invoiceNumber}` },
    { method: "GET", path: `/api/ticket/getInvoice?invoiceNumber=${sampleTicket.invoiceNumber}` },
    // Search/Report style
    { method: "GET", path: `/api/Search/ticketDetails?ticketId=${sampleTicket.ticketId}` },
    { method: "GET", path: `/api/Report/ticketDetail?ticketId=${sampleTicket.ticketId}` },
  ];

  for (const v of variants) {
    try {
      const init: RequestInit = {
        method: v.method,
        headers: v.method === "POST"
          ? { ...auth, "Content-Type": "application/json" }
          : auth,
      };
      if (v.method === "POST" && v.body) init.body = JSON.stringify(v.body);
      const r = await fetch(`${SHOPDRIVER_API}${v.path}`, init);
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("json")) {
        const text = await r.text();
        if (text.length > 50 && text !== "[]" && text !== "{}") {
          console.log(`✓ ${v.method} ${v.path} → ${r.status} · len ${text.length}`);
          console.log(`  ${text.slice(0, 400).replace(/\s+/g, " ")}`);
          console.log();
        }
      } else if (r.ok) {
        // Got 200 but not JSON
      }
      await new Promise(rs => setTimeout(rs, 200));
    } catch (e) {
      // skip errors
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
