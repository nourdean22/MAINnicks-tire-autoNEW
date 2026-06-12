/**
 * GSC Audit — one-off script to pull last 28-day Search Console data
 * and surface actionable issues. Standalone, env-loaded via dotenv.
 *
 * Run: pnpm tsx scripts/gsc-audit.ts
 */

import "dotenv/config";

const GSC_SITE_URL = "https://nickstire.org/";

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_* env");

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");

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
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function gscQuery(
  token: string,
  body: Record<string, unknown>,
): Promise<GscRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!res.ok) throw new Error(`GSC query failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { rows?: GscRow[] };
  return data.rows || [];
}

async function gscIndexCoverage(token: string): Promise<unknown> {
  // Index Inspection API requires individual URLs. Skip for now and rely on
  // the queries+pages dimensions to infer health.
  return null;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function fmtPos(n: number): string {
  return n.toFixed(1);
}
function pad(s: string | number, w: number): string {
  const str = String(s);
  return str.length >= w ? str.slice(0, w) : str + " ".repeat(w - str.length);
}

async function main() {
  console.log("\n═══ GSC AUDIT — nickstire.org ═══\n");

  const token = await getAccessToken();
  console.log("✓ Auth OK\n");

  // Date range: trailing N days (default 28), ending 2 days ago (GSC has ~2-3 day lag).
  // Override with GSC_AUDIT_DAYS env var — e.g. GSC_AUDIT_DAYS=90 for the quarterly view.
  const windowDays = Math.max(1, Math.min(490, parseInt(process.env.GSC_AUDIT_DAYS || "28", 10) || 28));
  const end = new Date();
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - windowDays);
  const fmtD = (d: Date) => d.toISOString().slice(0, 10);
  const dateRange = { startDate: fmtD(start), endDate: fmtD(end) };
  console.log(`Window: ${dateRange.startDate} → ${dateRange.endDate} (${windowDays}d)\n`);

  // ─── 1. TOTALS ──────────────────────────────────────────
  const totalsRows = await gscQuery(token, { ...dateRange, dimensions: [], rowLimit: 1 });
  const totals = totalsRows[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0, keys: [] };
  console.log(`─── TOTALS (${windowDays}d) ──────────────────────`);
  console.log(`Clicks:      ${totals.clicks.toLocaleString()}`);
  console.log(`Impressions: ${totals.impressions.toLocaleString()}`);
  console.log(`CTR:         ${fmtPct(totals.ctr)}`);
  console.log(`Avg Position:${fmtPos(totals.position)}`);
  console.log("");

  // ─── 2. TOP 15 QUERIES ──────────────────────────────────
  const topQueries = await gscQuery(token, {
    ...dateRange,
    dimensions: ["query"],
    rowLimit: 15,
  });
  console.log("─── TOP 15 QUERIES (by clicks) ────────");
  console.log(pad("query", 40) + pad("clicks", 8) + pad("impr", 9) + pad("ctr", 8) + "pos");
  for (const r of topQueries) {
    console.log(
      pad(r.keys[0], 40) +
        pad(r.clicks, 8) +
        pad(r.impressions, 9) +
        pad(fmtPct(r.ctr), 8) +
        fmtPos(r.position),
    );
  }
  console.log("");

  // ─── 3. TOP 15 PAGES ────────────────────────────────────
  const topPages = await gscQuery(token, {
    ...dateRange,
    dimensions: ["page"],
    rowLimit: 15,
  });
  console.log("─── TOP 15 PAGES (by clicks) ──────────");
  console.log(pad("page", 50) + pad("clicks", 8) + pad("impr", 9) + pad("ctr", 8) + "pos");
  for (const r of topPages) {
    const path = r.keys[0].replace("https://nickstire.org", "") || "/";
    console.log(
      pad(path, 50) +
        pad(r.clicks, 8) +
        pad(r.impressions, 9) +
        pad(fmtPct(r.ctr), 8) +
        fmtPos(r.position),
    );
  }
  console.log("");

  // ─── 4. CTR OPPORTUNITIES — high impressions, low CTR ──
  // Fetch enough rows to filter — pull 500 by query.
  const allQueries = await gscQuery(token, {
    ...dateRange,
    dimensions: ["query"],
    rowLimit: 500,
  });
  const ctrOpps = allQueries
    .filter((r) => r.impressions >= 200 && r.position <= 20 && r.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 12);
  console.log("─── CTR OPPORTUNITIES — ≥200 impr, pos ≤20, CTR <2% ───");
  console.log("(Title/meta likely underselling; rewriting could 5–10x clicks)");
  console.log(pad("query", 40) + pad("impr", 9) + pad("ctr", 8) + "pos");
  for (const r of ctrOpps) {
    console.log(
      pad(r.keys[0], 40) + pad(r.impressions, 9) + pad(fmtPct(r.ctr), 8) + fmtPos(r.position),
    );
  }
  console.log("");

  // ─── 5. NEXT-PAGE QUERIES — pos 11–20 ──────────────────
  const nextPage = allQueries
    .filter((r) => r.position > 10 && r.position <= 20 && r.impressions >= 100)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 12);
  console.log("─── NEXT-PAGE QUERIES — pos 11–20, ≥100 impr ───");
  console.log("(One position bump moves these to page 1 — highest SEO leverage)");
  console.log(pad("query", 40) + pad("impr", 9) + pad("ctr", 8) + "pos");
  for (const r of nextPage) {
    console.log(
      pad(r.keys[0], 40) + pad(r.impressions, 9) + pad(fmtPct(r.ctr), 8) + fmtPos(r.position),
    );
  }
  console.log("");

  // ─── 6. CANNIBALIZATION — multiple pages for one query ─
  const queryPagePairs = await gscQuery(token, {
    ...dateRange,
    dimensions: ["query", "page"],
    rowLimit: 1000,
  });
  const queryToPages = new Map<string, Array<{ page: string; clicks: number; pos: number }>>();
  for (const r of queryPagePairs) {
    const arr = queryToPages.get(r.keys[0]) || [];
    arr.push({ page: r.keys[1], clicks: r.clicks, pos: r.position });
    queryToPages.set(r.keys[0], arr);
  }
  const cannibals = Array.from(queryToPages.entries())
    .filter(([, pages]) => pages.length >= 2 && pages.reduce((s, p) => s + p.clicks, 0) >= 5)
    .sort((a, b) => b[1].reduce((s, p) => s + p.clicks, 0) - a[1].reduce((s, p) => s + p.clicks, 0))
    .slice(0, 8);
  console.log("─── CANNIBALIZATION — ≥2 pages competing on same query ───");
  for (const [query, pages] of cannibals) {
    console.log(`  "${query}"`);
    for (const p of pages.sort((a, b) => a.pos - b.pos)) {
      console.log(`    pos ${pad(fmtPos(p.pos), 6)} clicks ${pad(p.clicks, 4)} ${p.page.replace("https://nickstire.org", "")}`);
    }
  }
  console.log("");

  // ─── 7. NEW v1.5 PAGES — booking, financing, specials, reviews ─
  const v15Pages = ["/booking", "/financing", "/specials", "/reviews", "/about", "/blog"];
  const newPagesData = await gscQuery(token, {
    ...dateRange,
    dimensions: ["page"],
    rowLimit: 500,
  });
  console.log("─── v1.5 PAGES (post-conversion-overhaul) ───");
  for (const path of v15Pages) {
    const row = newPagesData.find((r) => {
      const p = r.keys[0].replace("https://nickstire.org", "");
      return p === path || p === `${path}/` || p.startsWith(`${path}?`);
    });
    if (row) {
      console.log(
        `  ${pad(path, 14)}  ${pad(row.clicks, 5)} clicks  ${pad(row.impressions, 6)} impr  ${pad(fmtPct(row.ctr), 7)}  pos ${fmtPos(row.position)}`,
      );
    } else {
      console.log(`  ${pad(path, 14)}  no data in window`);
    }
  }
  console.log("");

  console.log("═══ AUDIT COMPLETE ═══\n");
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e);
  process.exit(1);
});
