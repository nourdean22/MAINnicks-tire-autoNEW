/**
 * Prerender Audit — classifies every route + prerendered file into tiers
 * based on real GSC impression/click data from search_performance table.
 *
 * Tiers:
 *   T1 🏆 Revenue Drivers      ≥100 clicks/30d OR rank top 10         → auto-regen nightly
 *   T2 📈 Growth Candidates    ≥500 imps/30d AND rank 10–30           → regen weekly
 *   T3 🌱 Supporting Cast      ≥50 imps/30d                           → regen monthly
 *   T4 💤 Dormant              <50 imps/30d, >0 imps ever             → regen on request
 *   T5 ❌ Dead Weight           0 imps / not in routes / orphan files  → candidate for deletion
 *
 * Output:
 *   tmp/prerender-audit.json   — machine-readable
 *   tmp/prerender-audit.md     — human-readable report with action plan
 *
 * Usage: node scripts/audit-prerender.mjs
 */

import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDERED_DIR = path.join(ROOT, "prerendered");
const TMP_DIR = path.join(ROOT, "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const envText = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const DATABASE_URL = envText
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .replace("DATABASE_URL=", "");

// ─── Load routes from registry ──────────────────────────
async function loadRoutesFromRegistry() {
  try {
    const result = execSync(
      `node --import tsx/esm -e "import { PRERENDER_ROUTES } from './shared/routes.ts'; console.log(JSON.stringify(PRERENDER_ROUTES.map(r => ({ path: r.path, title: r.title, description: r.description, group: r.group, priority: r.priority }))));"`,
      { cwd: ROOT, encoding: "utf-8", timeout: 20000 },
    );
    return JSON.parse(result.trim());
  } catch (err) {
    console.error("Failed to load routes from registry:", err.message);
    return [];
  }
}

// ─── Map a prerendered file back to a route path ───────
function fileToRoutePath(relPath) {
  // prerendered/index.html      → /
  // prerendered/brakes/index.html → /brakes
  // prerendered/blog/winter-car-care-cleveland/index.html → /blog/winter-car-care-cleveland
  if (relPath === "index.html") return "/";
  if (relPath.endsWith("/index.html")) {
    return "/" + relPath.slice(0, -"/index.html".length);
  }
  return "/" + relPath.replace(/\.html$/, "");
}

// ─── Walk prerendered dir, return list of existing files ───
function walkPrerendered(dir, prefix = "") {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkPrerendered(p, rel));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      const stat = fs.statSync(p);
      const firstChunk = fs.readFileSync(p, "utf8").slice(0, 2000);
      const titleMatch = firstChunk.match(/<title>([^<]*)<\/title>/);
      results.push({
        relPath: rel,
        routePath: fileToRoutePath(rel),
        bytes: stat.size,
        mtime: stat.mtime,
        title: titleMatch ? titleMatch[1] : null,
        looksBroken: /NOUR OS|^(\s|undefined)*$/.test(titleMatch?.[1] || "") || stat.size < 50000,
      });
    }
  }
  return results;
}

// ─── Pull GSC data per URL for the last 30 days ────────
async function loadGscData(conn) {
  const [rows] = await conn.execute(`
    SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
           AVG(position)/100 AS avgPosition
    FROM search_performance
    WHERE date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 30 DAY), '%Y-%m-%d')
      AND page IS NOT NULL
    GROUP BY page
  `);
  const map = new Map();
  for (const r of rows) {
    const page = String(r.page || "");
    // Extract just the pathname from the full URL
    const pathOnly = page.replace(/^https?:\/\/[^/]+/, "") || "/";
    const existing = map.get(pathOnly);
    const clicks = Number(r.clicks || 0);
    const imps = Number(r.impressions || 0);
    // If multiple rows (http vs https), sum them
    map.set(pathOnly, {
      clicks: (existing?.clicks || 0) + clicks,
      impressions: (existing?.impressions || 0) + imps,
      avgPosition: Number(r.avgPosition || 0),
    });
  }
  return map;
}

// ─── Classify a route into a tier ──────────────────────
function classifyTier({ clicks, impressions, avgPosition }) {
  if (!impressions || impressions === 0) return "T5";
  if (clicks >= 100) return "T1";
  if (avgPosition && avgPosition > 0 && avgPosition <= 10) return "T1";
  if (impressions >= 500 && avgPosition >= 10 && avgPosition <= 30) return "T2";
  if (impressions >= 50) return "T3";
  return "T4";
}

// ─── Guess which category a route belongs to ───────────
function categorize(routePath) {
  if (routePath === "/") return "core";
  const p = routePath.slice(1); // strip leading /
  const first = p.split("/")[0];

  if (/^(about|contact|faq|careers|privacy-policy|terms|financing|status|reviews|appointment|booking|services|estimate|diagnose|my-garage|fleet|rewards|pricing|cost-estimator|ask|share|review|seasonal)$/.test(first)) return "core";
  if (/^(tires|brakes|diagnostics|emissions|oil-change|general-repair|ac-repair|transmission|electrical|battery|exhaust|cooling|pre-purchase-inspection|belts-hoses|starter-alternator|alignment|synthetic-oil-change|tire-shop-near-me|auto-repair-near-me)$/.test(first)) return "service";
  if (/(-auto-repair|-mechanic)$/.test(first)) return "city";
  if (/^(blog)$/.test(first) || p.startsWith("blog/")) return "blog";
  if (/^(bmw|chevrolet|dodge|ford|honda|hyundai|jeep|kia|toyota|nissan|mazda|subaru|audi|mercedes|vw|volkswagen|volvo)-/.test(first)) return "vehicle";
  if (/(grinding|shaking|pulling|overheating|squeal|stall|wont-start|noise|leaking|bumpy|smoking|light-on|flashing|clicking)/.test(first)) return "problem";
  if (/^\d+/.test(first) || /(street|avenue|blvd|intersection|points|square|mall)/.test(first)) return "intersection";
  // Default: likely a neighborhood
  return "neighborhood";
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  console.log("[audit] Loading routes from registry…");
  const routes = await loadRoutesFromRegistry();
  console.log(`[audit] Found ${routes.length} routes with prerender:true`);

  console.log("[audit] Walking prerendered/ directory…");
  const files = walkPrerendered(PRERENDERED_DIR);
  console.log(`[audit] Found ${files.length} prerendered HTML files`);

  console.log("[audit] Loading GSC data (last 30d)…");
  const conn = await mysql.createConnection(DATABASE_URL);
  const gsc = await loadGscData(conn);
  await conn.end();
  console.log(`[audit] Loaded GSC data for ${gsc.size} URLs`);

  // Build a unified map of ALL route paths (from both registry + disk)
  const allPaths = new Set();
  for (const r of routes) allPaths.add(r.path);
  for (const f of files) allPaths.add(f.routePath);

  // Build per-route audit record
  const audit = [];
  for (const routePath of allPaths) {
    const route = routes.find((r) => r.path === routePath);
    const file = files.find((f) => f.routePath === routePath);
    const metrics = gsc.get(routePath) || { clicks: 0, impressions: 0, avgPosition: 0 };
    const tier = classifyTier(metrics);
    const category = categorize(routePath);

    audit.push({
      path: routePath,
      category,
      tier,
      inRegistry: !!route,
      hasPrerender: !!file,
      fileBytes: file?.bytes || 0,
      fileTitle: file?.title || null,
      looksBroken: file?.looksBroken || false,
      mtime: file?.mtime ? file.mtime.toISOString() : null,
      clicks: metrics.clicks,
      impressions: metrics.impressions,
      avgPosition: Math.round(metrics.avgPosition * 10) / 10,
      registryTitle: route?.title || null,
      actionNeeded: (() => {
        if (!route && file) return "ORPHAN — file exists but not in route registry";
        if (route && !file) return "MISSING — in registry but no prerendered HTML";
        if (file?.looksBroken) return "BROKEN — file exists but looks malformed (likely 'NOUR OS' bug)";
        if (tier === "T5" && metrics.impressions === 0) return "DORMANT — candidate for deletion";
        if (tier === "T1" || tier === "T2") return "HIGH-VALUE — keep fresh";
        return null;
      })(),
    });
  }

  audit.sort((a, b) => b.impressions - a.impressions);

  // Aggregate tallies
  const tiers = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 };
  const cats = {};
  const needsAction = {
    orphans: [],
    missing: [],
    broken: [],
    dormant: [],
    highValue: [],
  };
  for (const a of audit) {
    tiers[a.tier]++;
    cats[a.category] = (cats[a.category] || 0) + 1;
    if (a.actionNeeded?.startsWith("ORPHAN")) needsAction.orphans.push(a);
    else if (a.actionNeeded?.startsWith("MISSING")) needsAction.missing.push(a);
    else if (a.actionNeeded?.startsWith("BROKEN")) needsAction.broken.push(a);
    else if (a.actionNeeded?.startsWith("DORMANT")) needsAction.dormant.push(a);
    else if (a.actionNeeded?.startsWith("HIGH-VALUE")) needsAction.highValue.push(a);
  }

  // Write JSON
  fs.writeFileSync(
    path.join(TMP_DIR, "prerender-audit.json"),
    JSON.stringify({ tallies: { tiers, categories: cats }, audit }, null, 2),
  );

  // Write human-readable markdown
  const md = [];
  md.push(`# Prerender Audit — ${new Date().toISOString().slice(0, 10)}\n`);
  md.push(`## Summary\n`);
  md.push(`- Total routes/files examined: **${audit.length}**`);
  md.push(`- In route registry: ${routes.length}`);
  md.push(`- On disk as HTML: ${files.length}`);
  md.push(`- GSC-tracked URLs: ${gsc.size}\n`);

  md.push(`## Tier Breakdown\n`);
  md.push("| Tier | Count | Criteria |");
  md.push("|---|---|---|");
  md.push(`| 🏆 T1 Revenue Drivers | ${tiers.T1} | ≥100 clicks/30d OR rank top 10 |`);
  md.push(`| 📈 T2 Growth Candidates | ${tiers.T2} | ≥500 imps, rank 10-30 |`);
  md.push(`| 🌱 T3 Supporting Cast | ${tiers.T3} | ≥50 imps |`);
  md.push(`| 💤 T4 Dormant | ${tiers.T4} | <50 imps but >0 ever |`);
  md.push(`| ❌ T5 Dead Weight | ${tiers.T5} | 0 imps or orphan |\n`);

  md.push(`## Category Breakdown\n`);
  md.push("| Category | Count |");
  md.push("|---|---|");
  for (const [cat, n] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${cat} | ${n} |`);
  }
  md.push("");

  md.push(`## 🚨 Action Items\n`);

  md.push(`### BROKEN prerender files (${needsAction.broken.length}) — highest priority`);
  if (needsAction.broken.length === 0) md.push(`_None._`);
  for (const a of needsAction.broken.slice(0, 20)) {
    md.push(`- \`${a.path}\` — ${a.fileBytes}b · title: "${a.fileTitle}" · tier ${a.tier} · ${a.impressions} imps`);
  }
  md.push("");

  md.push(`### MISSING HTML for registered routes (${needsAction.missing.length})`);
  for (const a of needsAction.missing.slice(0, 20)) {
    md.push(`- \`${a.path}\` — tier ${a.tier} · ${a.impressions} imps · needs prerender`);
  }
  md.push("");

  md.push(`### ORPHAN files (${needsAction.orphans.length}) — not in route registry`);
  for (const a of needsAction.orphans.slice(0, 25)) {
    md.push(`- \`${a.path}\` — ${a.fileBytes}b · ${a.impressions} imps · not in shared/routes.ts`);
  }
  md.push("");

  md.push(`### HIGH-VALUE pages (T1+T2) — keep fresh (${needsAction.highValue.length})`);
  for (const a of needsAction.highValue.slice(0, 30)) {
    md.push(`- \`${a.path}\` — tier ${a.tier} · ${a.impressions} imps · ${a.clicks} clicks · rank #${a.avgPosition || "?"}`);
  }
  md.push("");

  md.push(`### T5 Dormant (${needsAction.dormant.length}) — candidates for deletion`);
  md.push(`_Sample of 15 (full list in JSON):_`);
  for (const a of needsAction.dormant.slice(0, 15)) {
    md.push(`- \`${a.path}\` — 0 imps`);
  }
  md.push("");

  md.push(`## Top 20 by Impressions\n`);
  md.push("| Path | Imps | Clicks | Pos | Tier | File | Category |");
  md.push("|---|---|---|---|---|---|---|");
  for (const a of audit.slice(0, 20)) {
    md.push(`| \`${a.path}\` | ${a.impressions} | ${a.clicks} | ${a.avgPosition} | ${a.tier} | ${a.hasPrerender ? `${Math.round(a.fileBytes / 1024)}KB` : "—"} | ${a.category} |`);
  }

  fs.writeFileSync(path.join(TMP_DIR, "prerender-audit.md"), md.join("\n"));

  // Console summary
  console.log("\n──── AUDIT COMPLETE ────");
  console.log(`Tiers:   T1=${tiers.T1}  T2=${tiers.T2}  T3=${tiers.T3}  T4=${tiers.T4}  T5=${tiers.T5}`);
  console.log(`Action:  ${needsAction.broken.length} broken · ${needsAction.missing.length} missing · ${needsAction.orphans.length} orphan · ${needsAction.dormant.length} dormant`);
  console.log(`\nReports written:`);
  console.log(`  ${path.join(TMP_DIR, "prerender-audit.json")}`);
  console.log(`  ${path.join(TMP_DIR, "prerender-audit.md")}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
