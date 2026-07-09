/**
 * GSC setup + error audit for nickstire.org — read-only.
 * Reuses the proven JWT service-account auth (multi-line .env parser).
 *
 * Reports:
 *  1. sites.list        — every property the SA can see + permission level
 *  2. sitemaps.list     — per accessible property: paths, errors, warnings, lastDownloaded, counts
 *  3. urlInspection     — top pages: verdict, coverageState, robots, indexingState,
 *                         lastCrawlTime, googleCanonical vs userCanonical
 *  4. www-variant probe — searchanalytics on https://www.nickstire.org/ (traffic-split check)
 *
 * Run from apps/nickstire:  pnpm exec tsx <this file>
 */
import path from "node:path";
import fs from "node:fs";

const NICKSTIRE_DIR = "C:/Users/nourd/NOURCITY/apps/nickstire";
const OUT = "C:/Users/nourd/NOURCITY/ad-factory/2026-07-04/gsc-audit.json";

// Multi-line-aware .env parse (PEM key spans lines).
const envText = fs.readFileSync(path.join(NICKSTIRE_DIR, ".env"), "utf8");
const env: Record<string, string> = {};
{
  const lines = envText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
    if (quote && !(value.length > 1 && value.endsWith(quote))) {
      const parts = [value.slice(1)];
      while (++i < lines.length) {
        if (lines[i].endsWith(quote)) { parts.push(lines[i].slice(0, -1)); break; }
        parts.push(lines[i]);
      }
      value = parts.join("\n");
    } else if (quote) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
}

const { google } = await import("googleapis");
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/webmasters"],
});
const sc = google.searchconsole({ version: "v1", auth });

const report: any = { generatedAt: new Date().toISOString(), serviceAccount: env.GOOGLE_SERVICE_ACCOUNT_EMAIL };

// ── 1. Properties visible to the service account ────────────────
try {
  const sites = await sc.sites.list({});
  report.sites = (sites.data.siteEntry ?? []).map((s) => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
} catch (e: any) {
  report.sites = { error: e?.message ?? String(e) };
}

// ── 2. Sitemaps per accessible property ─────────────────────────
report.sitemaps = {};
const props: string[] = Array.isArray(report.sites)
  ? report.sites.map((s: any) => s.siteUrl)
  : ["https://nickstire.org/"];
for (const prop of props) {
  try {
    const sm = await sc.sitemaps.list({ siteUrl: prop });
    report.sitemaps[prop] = (sm.data.sitemap ?? []).map((m) => ({
      path: m.path,
      lastSubmitted: m.lastSubmitted,
      lastDownloaded: m.lastDownloaded,
      isPending: m.isPending,
      errors: m.errors,
      warnings: m.warnings,
      contents: m.contents?.map((c) => ({ type: c.type, submitted: c.submitted, indexed: c.indexed })),
    }));
  } catch (e: any) {
    report.sitemaps[prop] = { error: (e?.message ?? String(e)).slice(0, 200) };
  }
}

// ── 3. URL inspection on the money pages ────────────────────────
const SITE = "https://nickstire.org/";
const TOP_PATHS = [
  "/", "/tires", "/oil-change", "/emissions", "/diagnose", "/brakes",
  "/services", "/diagnostics", "/financing", "/parma-auto-repair",
  "/used-tires-cleveland", "/booking",
];
report.inspections = [];
for (const p of TOP_PATHS) {
  const url = `https://nickstire.org${p === "/" ? "/" : p}`;
  try {
    const r = await sc.urlInspection.index.inspect({
      requestBody: { inspectionUrl: url, siteUrl: SITE },
    });
    const ix = r.data.inspectionResult?.indexStatusResult;
    const amp = r.data.inspectionResult?.mobileUsabilityResult;
    const rich = r.data.inspectionResult?.richResultsResult;
    report.inspections.push({
      url,
      verdict: ix?.verdict,
      coverageState: ix?.coverageState,
      indexingState: ix?.indexingState,
      robotsTxtState: ix?.robotsTxtState,
      pageFetchState: ix?.pageFetchState,
      lastCrawlTime: ix?.lastCrawlTime,
      googleCanonical: ix?.googleCanonical,
      userCanonical: ix?.userCanonical,
      crawledAs: ix?.crawledAs,
      mobileVerdict: amp?.verdict ?? null,
      richResults: rich?.verdict ?? null,
      richTypes: rich?.detectedItems?.map((d) => d.richResultType) ?? [],
    });
  } catch (e: any) {
    report.inspections.push({ url, error: (e?.message ?? String(e)).slice(0, 200) });
  }
}

// ── 4. www-variant traffic probe (split-property check) ─────────
try {
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const r = await sc.searchanalytics.query({
    siteUrl: "https://www.nickstire.org/",
    requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["page"], rowLimit: 5 },
  });
  report.wwwVariant = { rows: r.data.rows ?? [] };
} catch (e: any) {
  report.wwwVariant = { error: (e?.message ?? String(e)).slice(0, 200) };
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
