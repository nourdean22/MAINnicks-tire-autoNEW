/**
 * Wave-99 — line item endpoint hunt confirmation
 * Subagent identified /api/ticket/listTicketSessions as the line-item
 * endpoint. Probe it with a real ticketId.
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
  if (!token) { console.error("auth failed"); process.exit(1); }
  const auth = { "Authorization": `Bearer ${token}`, "Accept": "application/json", "User-Agent": "Mozilla/5.0" };

  // Get a real recent ticket
  const sampleRes = await fetch(`${SHOPDRIVER_API}/api/ticket/listRecentTickets?pageNumber=1&pageSize=3`, { headers: auth });
  const samples = await sampleRes.json() as Array<{ ticketId: string; invoiceNumber: number | null; estimateNumber: number | null; total: number; firstName: string; lastName: string }>;
  console.log(`Got ${samples.length} sample tickets:`);
  for (const t of samples) {
    console.log(`  · ${t.ticketId} · ${t.firstName} ${t.lastName} · Inv#${t.invoiceNumber} · $${t.total}`);
  }

  const sample = samples[0];
  console.log(`\nProbing line-item endpoints for ticketId=${sample.ticketId}\n`);

  const tests = [
    // 1. Search endpoint — subagent rated 75%, possibly returns expanded ticket
    { method: "GET", path: `/api/Search/getTicketSearch?ticketNumber=${sample.invoiceNumber}` },
    { method: "GET", path: `/api/Search/getTicketSearch?searchTerm=${sample.invoiceNumber}` },
    { method: "GET", path: `/api/Search/getTicketSearch?invoiceNumber=${sample.invoiceNumber}` },
    { method: "GET", path: `/api/Search/getTicketSearch` },

    // 2. Drill into the SESSION (vs ticket) — sessions are sub-objects with their own IDs
    // From listTicketSessions response, first session id was: 175fb4d5-a485-473c-991d-5c0af9d89f83
    { method: "GET", path: `/api/ticket/getTicketSession?id=175fb4d5-a485-473c-991d-5c0af9d89f83` },
    { method: "GET", path: `/api/ticket/getTicketSession?ticketSessionId=175fb4d5-a485-473c-991d-5c0af9d89f83` },
    { method: "GET", path: `/api/ticket/loadTicketSession?id=175fb4d5-a485-473c-991d-5c0af9d89f83` },
    { method: "GET", path: `/api/Ticket/loadTicketSession/175fb4d5-a485-473c-991d-5c0af9d89f83` },

    // 3. PDF / print endpoints (the SPA's "Print" button must call something)
    { method: "GET", path: `/api/pdf/ticket?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/Pdf/getInvoicePdf?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/ticket/printInvoice?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/ticket/getInvoicePdf?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/ticket/getInvoicePdfBytes?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/Print/invoice?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/Print/getInvoice?ticketId=${sample.ticketId}` },

    // 4. Try POST shapes for the print/detail endpoints
    { method: "POST", path: `/api/ticket/printInvoice`, body: { ticketId: sample.ticketId } },
    { method: "POST", path: `/api/ticket/getInvoicePdf`, body: { ticketId: sample.ticketId } },
    { method: "POST", path: `/api/ticket/getTicketSession`, body: { id: "175fb4d5-a485-473c-991d-5c0af9d89f83" } },

    // 5. Other sub-entity endpoints discovered in subagent shortlist
    { method: "GET", path: `/api/MiscellaneousCharge/listMiscellaneousCharges?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/Parts/listSuggestedParts?ticketId=${sample.ticketId}` },
    { method: "GET", path: `/api/Parts/listSuggestedPartsForTicket?ticketId=${sample.ticketId}` },
  ];

  for (const t of tests) {
    try {
      const init: RequestInit = {
        method: t.method,
        headers: t.method === "POST" ? { ...auth, "Content-Type": "application/json" } : auth,
      };
      if (t.body) init.body = JSON.stringify(t.body);

      const r = await fetch(`${SHOPDRIVER_API}${t.path}`, init);
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      const truncated = text.length > 500 ? `${text.slice(0, 500)}... (len ${text.length})` : text;
      const tag = r.ok ? "✓" : "✗";
      console.log(`${tag} ${t.method} ${t.path} → ${r.status} ${ct}`);
      if (r.ok && text.length > 5 && text !== "[]" && text !== "null") {
        console.log(`  ${truncated.replace(/\s+/g, " ")}\n`);
      }
      await new Promise(rs => setTimeout(rs, 200));
    } catch (e) {
      console.log(`✗ ${t.method} ${t.path} → THREW: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
