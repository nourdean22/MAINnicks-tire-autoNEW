/**
 * Wave-97 debug — fetch ALG /recent + dump HTML structure
 */
import "dotenv/config";

async function authenticate(): Promise<string | null> {
  const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
  const username = process.env.AUTO_LABOR_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD;
  if (!username || !password) return null;

  const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
  const res = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Origin": SHOPDRIVER_BASE,
      "Referer": `${SHOPDRIVER_BASE}/`,
    },
    body: JSON.stringify({ login: username, password, ipAddress: "", location: "" }),
  });
  if (!res.ok) {
    console.error(`Auth failed: ${res.status}`);
    const text = await res.text().catch(() => "");
    console.error(`Body: ${text.slice(0, 200)}`);
    return null;
  }
  const data = await res.json() as { token?: string; jwt?: string; accessToken?: string };
  return data.token || data.jwt || data.accessToken || null;
}

async function main() {
  const token = await authenticate();
  if (!token) {
    console.error("No auth token");
    process.exit(1);
  }
  console.log(`Got token (${token.slice(0, 20)}...)`);

  const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
  const res = await fetch(`${SHOPDRIVER_BASE}/recent`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "text/html",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  console.log(`Status: ${res.status}`);
  console.log(`Headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2)}`);
  const html = await res.text();
  console.log(`HTML length: ${html.length}`);
  console.log(`First 2000 chars:\n${html.slice(0, 2000)}`);
  console.log(`\n--- Search for keywords ---`);
  console.log(`Contains "Invoice#": ${/Invoice#/i.test(html)}`);
  console.log(`Contains "Estimate#": ${/Estimate#/i.test(html)}`);
  console.log(`Contains "<table": ${html.split(/<table/gi).length - 1} occurrences`);
  console.log(`Contains MoesEuclid: ${/MoesEuclid/i.test(html)}`);
  console.log(`Contains "ng-app" (Angular): ${/ng-app/i.test(html)}`);
  console.log(`Contains "react": ${/react/i.test(html)}`);

  // Look at the API the SPA might call — check network for the data endpoint
  console.log(`\n--- Try API endpoints from auth GUID subdomain ---`);
  const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
  const probeUrls = [
    "/api/ticket/listRecent",
    "/api/ticket/listRecentTickets",
    "/api/ticket/recent",
    "/api/Recent/list",
    "/api/Dashboard/recent",
    "/api/Home/recent",
  ];
  for (const u of probeUrls) {
    const r = await fetch(`${SHOPDRIVER_API}${u}`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    const ct = r.headers.get("content-type") || "";
    if (r.ok) {
      const body = await r.text();
      const isJson = ct.includes("json");
      console.log(`✓ ${u} → ${r.status} ${ct} · len ${body.length} · ${isJson ? body.slice(0, 200) : "(html?)"}`);
    } else {
      console.log(`✗ ${u} → ${r.status}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
