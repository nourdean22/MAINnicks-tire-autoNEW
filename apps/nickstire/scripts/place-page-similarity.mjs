#!/usr/bin/env node
/**
 * Read-only: how alike are the place-named prerendered pages?
 *
 * Why: Google's spam policy lists pages aimed at specific cities that funnel
 * users to one destination as doorway abuse. Nothing measured how alike our
 * place pages are (docs/agent-audit/REVIEW-ACCURACY-2026-10-25.md, ranked item 1).
 *
 * Which pages: the route list the site uses (shared/routes.ts) -- every entry in
 * group "city" or "neighborhood" -- read through tsx exactly as check-prerender.mjs
 * does. Set B adds any OTHER prerendered page (blog, guides, root) whose slug
 * contains one of those place names, because the sitemap carries those too.
 *
 * Similarity: Jaccard over word 3-shingles of the <main> text (nav, footer, scripts
 * stripped). Shingles catch reused phrases, which is what a template leaves behind;
 * a plain word-set Jaccard is inflated by shared vocabulary ("brakes", "tires").
 * Two scores per pair: RAW, and MASKED, where each page's own place name is replaced
 * by one token, so a city-swapped template scores as the copy it is.
 *
 * No network, no DB, writes only to the OS temp dir (controls). Run from apps/nickstire:
 *   node scripts/place-page-similarity.mjs [--threshold 0.8]
 * Exit 0 = controls passed and pages were measured; 1 = a control failed; 2 = nothing measured.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRERENDER = path.join(ROOT, "prerendered");
const tIdx = process.argv.indexOf("--threshold");
const THRESHOLD = tIdx > -1 ? Number(process.argv[tIdx + 1]) : 0.8;
const PLACE_GROUPS = ["city", "neighborhood"];
const SLUG_SUFFIX = /-(ohio|oh|auto-repair|tire-shop|tires)$/;

/** Route paths of the place groups, from the live route table (one tsx call, no shell quoting). */
function placeRoutes() {
  const code =
    "import { ALL_ROUTES } from './shared/routes.ts';" +
    `const g = new Set(${JSON.stringify(PLACE_GROUPS)});` +
    "console.log(JSON.stringify(ALL_ROUTES.filter(function (r) { return g.has(r.group); }).map(function (r) { return r.path; })));";
  const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) throw new Error(`route list read failed (exit ${r.status}): ${(r.stderr || "").slice(0, 300)}`);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

function walkIndexFiles(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walkIndexFiles(path.join(dir, e.name), `${prefix}/${e.name}`));
    else if (e.name === "index.html") out.push(prefix || "/");
  }
  return out;
}

const ENT = { "&amp;": "&", "&#x27;": "'", "&#39;": "'", "&quot;": '"', "&nbsp;": " ", "&lt;": "<", "&gt;": ">" };
/** Main text of a prerendered page: <main> only, minus nav/footer/aside/script/style. Lowercased words. */
export function mainText(html) {
  const m = /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(html);
  if (!m) return null; // no <main>: UNMEASURED for this page, never an empty string scoring 0
  let t = m[1];
  t = t.replace(/<(script|style|noscript|svg|nav|footer|aside|header)\b[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ").replace(/&[#a-z0-9]+;/gi, (e) => ENT[e.toLowerCase()] ?? " ");
  return t.toLowerCase().replace(/[^a-z0-9$%']+/g, " ").trim();
}

export function shingles(text, k = 3) {
  const w = text.split(" ").filter(Boolean);
  const s = new Set();
  for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" "));
  return s;
}

export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return null; // two empty pages: no score, not 1 and not 0
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Replace the page's own place name (slug minus suffix, hyphens as spaces) with one token. */
export function maskPlace(text, place) {
  return text.replace(new RegExp(`\\b${place.replace(/-/g, " ")}\\b`, "g"), "xplacex");
}

export function placeOf(routePath) {
  return routePath.replace(/^\//, "").split("/").pop().replace(SLUG_SUFFIX, "");
}

function loadPage(routePath, htmlPath) {
  const text = mainText(readFileSync(htmlPath, "utf8"));
  if (text === null) return { routePath, text: null };
  const place = placeOf(routePath);
  return { routePath, place, text, raw: shingles(text), masked: shingles(maskPlace(text, place)), words: text.split(" ").length };
}

const f = (n) => (n === null ? "n/a" : n.toFixed(3));

// ---- controls (printed first) ----
function controls() {
  const dir = mkdtempSync(path.join(tmpdir(), "place-sim-"));
  const src = (r) => path.join(PRERENDER, r.replace(/^\//, ""), "index.html");
  const a = src("/amherst-ohio");
  const copy = path.join(dir, "copy.html");
  copyFileSync(a, copy);
  const swapped = path.join(dir, "swapped.html");
  writeFileSync(swapped, readFileSync(a, "utf8").replace(/Amherst/g, "Zzyzx").replace(/amherst/g, "zzyzx"));
  const A = loadPage("/amherst-ohio", a);
  const C = loadPage("/amherst-ohio", copy);
  const S = loadPage("/zzyzx-ohio", swapped);
  const U1 = loadPage("/brakes", src("/brakes"));
  const U2 = loadPage("/car-care-guide", src("/car-care-guide"));
  const res = [
    ["C1 two copies of one page, raw", jaccard(A.raw, C.raw), (v) => v === 1],
    ["C2 two unrelated pages (/brakes vs /car-care-guide), raw", jaccard(U1.raw, U2.raw), (v) => v !== null && v < 0.3],
    ["C3 same page with the city renamed, MASKED (must be 1.0)", jaccard(A.masked, S.masked), (v) => v === 1],
    ["C4 same page with the city renamed, RAW (must be below 1.0: proves masking is what closed the gap)", jaccard(A.raw, S.raw), (v) => v !== null && v < 1],
  ];
  console.log("CONTROLS");
  let ok = true;
  for (const [name, v, pass] of res) {
    const p = pass(v);
    ok &&= p;
    console.log(`  ${p ? "PASS" : "FAIL"}  ${name}: ${f(v)}`);
  }
  return ok;
}

function main() {
  if (!existsSync(PRERENDER)) { console.error(`UNMEASURED: no prerendered tree at ${PRERENDER}`); process.exit(2); }
  if (!controls()) { console.error("A control failed: the numbers below are not trustworthy. Stopping."); process.exit(1); }

  const routes = placeRoutes();
  const present = new Set(walkIndexFiles(PRERENDER));
  const setA = routes.filter((r) => present.has(r));
  const missingA = routes.filter((r) => !present.has(r));
  const places = new Set(routes.map(placeOf).filter((p) => p.length >= 4));
  const inA = new Set(setA);
  const setB = [...present].filter((r) => !inA.has(r) && r !== "/" && [...places].some((p) => `-${r.split("/").pop()}-`.includes(`-${p.replace(/ /g, "-")}-`)));

  const pages = [];
  const noMain = [];
  for (const [label, list] of [["A", setA], ["B", setB]]) {
    for (const r of list) {
      const p = loadPage(r, path.join(PRERENDER, r.replace(/^\//, ""), "index.html"));
      if (p.text === null) { noMain.push(r); continue; }
      p.set = label;
      pages.push(p);
    }
  }
  console.log(`\nPAGES: set A (route groups ${PLACE_GROUPS.join("+")}) ${setA.length} of ${routes.length} routes have a prerendered file` +
    `${missingA.length ? ` (${missingA.length} UNMEASURED, no file: ${missingA.join(" ")})` : ""}; set B (other pages naming a place) ${setB.length}; ` +
    `no <main> ${noMain.length}${noMain.length ? ` (${noMain.join(" ")})` : ""}; measured ${pages.length}`);
  if (pages.length < 2) { console.error("UNMEASURED: fewer than 2 pages"); process.exit(2); }
  const words = pages.map((p) => p.words).sort((x, y) => x - y);
  console.log(`MAIN-TEXT WORDS per page: min ${words[0]}, median ${words[words.length >> 1]}, max ${words[words.length - 1]}`);
  console.log(`SET B pages: ${setB.join(" ") || "(none)"}`);

  const pairs = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      pairs.push({ a: pages[i], b: pages[j], raw: jaccard(pages[i].raw, pages[j].raw), masked: jaccard(pages[i].masked, pages[j].masked) });
    }
  }
  const scored = pairs.filter((p) => p.raw !== null && p.masked !== null);
  console.log(`PAIRS: ${scored.length} scored of ${pairs.length} (${pairs.length - scored.length} UNMEASURED, an empty page)`);

  const aa = scored.filter((p) => p.a.set === "A" && p.b.set === "A");
  // Both populations: set A alone is the place-page question; all pairs include set B and dilute it.
  for (const [pop, list] of [["SET A ONLY", aa], ["ALL MEASURED", scored]]) {
    for (const key of ["raw", "masked"]) {
      const buckets = new Array(10).fill(0);
      for (const p of list) buckets[Math.min(9, Math.floor(p[key] * 10))]++;
      console.log(`\nDISTRIBUTION ${pop} (${key.toUpperCase()}), pairs per 0.1 bucket, denominator ${list.length}`);
      buckets.forEach((n, i) => console.log(`  ${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}${i === 9 ? "]" : ")"}  ${String(n).padStart(5)}  ${((100 * n) / list.length).toFixed(1)}%`));
    }
  }

  const hot = scored.filter((p) => p.raw >= THRESHOLD || p.masked >= THRESHOLD).sort((x, y) => y.masked - x.masked);
  const hotAA = aa.filter((p) => p.raw >= THRESHOLD || p.masked >= THRESHOLD);
  console.log(`\nPAIRS AT OR ABOVE ${THRESHOLD} (raw or masked): ${hot.length} of ${scored.length} (${((100 * hot.length) / scored.length).toFixed(1)}%); within set A only: ${hotAA.length} of ${aa.length} (${((100 * hotAA.length) / aa.length).toFixed(1)}%)`);
  console.log("  masked  raw    pageA  pageB");
  for (const p of hot) console.log(`  ${f(p.masked)}  ${f(p.raw)}  ${p.a.routePath}  ${p.b.routePath}`);

  // Pages with the most near-duplicate partners (masked), the first merge/noindex candidates.
  const deg = new Map();
  for (const p of hot) for (const x of [p.a.routePath, p.b.routePath]) deg.set(x, (deg.get(x) ?? 0) + 1);
  const top = [...deg].sort((x, y) => y[1] - x[1]).slice(0, 10);
  console.log(`\nTOP PAGES BY PARTNERS AT OR ABOVE ${THRESHOLD}: ${top.map(([r, n]) => `${r}=${n}`).join(" ") || "(none)"}`);
  console.log(`READ AT ${new Date().toISOString()} from ${PRERENDER}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
