/**
 * GSC Drilldown — query → page mapping for the highest-leverage
 * queries surfaced by the audit. Tells us which URL is actually
 * ranking so we can fix the right title/meta.
 */
import "dotenv/config";

const GSC_SITE_URL = "https://nickstire.org/";

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_* env");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })).toString("base64url");
  const crypto = await import("crypto");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey, "base64url");
  const jwt = `${header}.${claims}.${signature}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function gscQuery(token: string, body: Record<string, unknown>) {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!res.ok) throw new Error(`Query: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> }).rows || [];
}

async function main() {
  const token = await getAccessToken();
  const end = new Date(); end.setDate(end.getDate() - 2);
  const start = new Date(end); start.setDate(start.getDate() - 28);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const dr = { startDate: fmt(start), endDate: fmt(end) };

  // High-leverage queries from audit
  const targets = [
    "tire shops near me",
    "tire shop near me",
    "tire shop near me open now",
    "mechanic near me",
    "auto repair near me",
    "auto shop near me",
    "tires near me",
  ];

  for (const q of targets) {
    const rows = await gscQuery(token, {
      ...dr,
      dimensions: ["page"],
      dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "equals", expression: q }] }],
      rowLimit: 10,
    });
    console.log(`\n[${q}]`);
    if (rows.length === 0) {
      console.log("  (no impressions in window)");
      continue;
    }
    for (const r of rows.sort((a, b) => a.position - b.position)) {
      const path = r.keys[0].replace("https://nickstire.org", "") || "/";
      console.log(`  pos ${r.position.toFixed(1).padStart(5)}  clicks ${String(r.clicks).padStart(3)}  impr ${String(r.impressions).padStart(5)}  ${path}`);
    }
  }

  // /services: what queries drive its 7 clicks at pos 2.8?
  console.log("\n[/services — driving queries]");
  const svcRows = await gscQuery(token, {
    ...dr,
    dimensions: ["query"],
    dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: "https://nickstire.org/services" }] }],
    rowLimit: 15,
  });
  for (const r of svcRows.slice(0, 10)) {
    console.log(`  pos ${r.position.toFixed(1).padStart(5)}  clicks ${String(r.clicks).padStart(3)}  impr ${String(r.impressions).padStart(5)}  ctr ${(r.ctr * 100).toFixed(1)}%  "${r.keys[0]}"`);
  }
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
