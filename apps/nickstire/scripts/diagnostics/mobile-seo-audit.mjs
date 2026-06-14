/**
 * Mobile + SEO sanity audit for the highest-traffic pages.
 *
 * Pulls the bot-facing prerender from production for each page
 * (Googlebot UA -> server's prerender-middleware serves the static
 * HTML), then parses critical signals:
 *   - Title length / uniqueness
 *   - Meta description length / uniqueness
 *   - Canonical URL correctness
 *   - H1 count + first H1
 *   - Hero img loading + fetchPriority
 *   - JSON-LD schema types present
 *   - Total HTML size
 *   - Mobile viewport meta
 *   - Internal link count
 *   - First-paint blockers (eager/lazy mismatch)
 *
 * No Lighthouse or Puppeteer needed — Lighthouse-style heuristics
 * applied to the static prerendered HTML, which is what Google ranks.
 */

const PAGES = [
  { path: "/", label: "Home" },
  { path: "/tires", label: "Tires hub" },
  { path: "/diagnostics", label: "Diagnostics" },
  { path: "/contact", label: "Contact" },
  { path: "/auto-repair-near-me", label: "Auto repair near me" },
  { path: "/used-tires-cleveland", label: "Used tires (new silo)" },
  { path: "/new-tires-cleveland", label: "New tires (new silo)" },
];

const BASE = "https://nickstire.org";
const BOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function rgx(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

function rgxAll(html, re) {
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function audit(html, url) {
  const result = {
    url,
    sizeKb: Math.round(html.length / 1024),
    title: rgx(html, /<title>([^<]+)<\/title>/i),
    metaDesc: rgx(html, /<meta\s+name="description"\s+content="([^"]+)"/i),
    canonical: rgx(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i),
    h1Count: rgxAll(html, /<h1[^>]*>/gi).length,
    h1First: rgx(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, "").trim().slice(0, 90) || null,
    viewport: rgx(html, /<meta\s+name="viewport"\s+content="([^"]+)"/i),
    heroImgEager: !!html.match(/<img[^>]*loading="eager"[^>]*fetchpriority="high"|<img[^>]*fetchpriority="high"[^>]*loading="eager"/i),
    heroImgLazyAboveFold: !!html.match(/<img[^>]*loading="lazy"[^>]*hero|hero[^>]*loading="lazy"/i),
    jsonLdTypes: rgxAll(html, /"@type"\s*:\s*"([^"]+)"/g),
    internalLinks: rgxAll(html, /href="(\/[a-z0-9\-/]+)"/g).filter((u) => !u.startsWith("/api") && !u.includes(".")).length,
    externalLinks: rgxAll(html, /href="(https?:\/\/[^"]+)"/g).filter((u) => !u.includes("nickstire.org")).length,
    xPrerendered: null, // populated from response header
  };
  return result;
}

async function fetchPage(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": BOT_UA } });
  const html = await res.text();
  const xPrerendered = res.headers.get("x-prerendered");
  const a = audit(html, `${BASE}${path}`);
  a.xPrerendered = xPrerendered;
  a.status = res.status;
  return a;
}

function pad(s, len) {
  s = String(s ?? "");
  return s.length > len ? s.slice(0, len - 1) + "…" : s.padEnd(len);
}

(async () => {
  console.log(`\nMobile SEO Audit · ${new Date().toISOString()}\n`);

  const results = [];
  for (const p of PAGES) {
    process.stdout.write(`  Fetching ${p.path}... `);
    try {
      const r = await fetchPage(p.path);
      results.push({ ...r, label: p.label });
      console.log(`${r.status} ${r.sizeKb}KB`);
    } catch (e) {
      console.log(`ERR ${e.message}`);
      results.push({ url: BASE + p.path, label: p.label, error: e.message });
    }
  }

  // ─── REPORT ──────────────────────────────────
  console.log(`\n=== Title + meta + h1 (${results.length} pages) ===\n`);
  for (const r of results) {
    if (r.error) { console.log(`  ${r.label}: ERROR ${r.error}\n`); continue; }
    console.log(`  ${r.label.toUpperCase()} (${r.url}) [${r.sizeKb}KB · prerendered=${r.xPrerendered}]`);
    console.log(`    title    [${r.title?.length || 0}ch]: ${r.title || "MISSING"}`);
    console.log(`    desc     [${r.metaDesc?.length || 0}ch]: ${r.metaDesc?.slice(0, 100) || "MISSING"}${(r.metaDesc?.length || 0) > 100 ? "…" : ""}`);
    console.log(`    canonical: ${r.canonical || "MISSING"}`);
    console.log(`    H1 (${r.h1Count}): ${r.h1First || "MISSING"}`);
    console.log(`    viewport : ${r.viewport || "MISSING"}`);
    console.log(`    hero LCP : eager+priority=${r.heroImgEager} | lazy-hero-bug=${r.heroImgLazyAboveFold}`);
    console.log(`    schema   : ${[...new Set(r.jsonLdTypes)].slice(0, 8).join(", ") || "NONE"}`);
    console.log(`    links    : ${r.internalLinks} internal · ${r.externalLinks} external`);
    console.log("");
  }

  // ─── HEALTH CHECK ────────────────────────────
  console.log(`=== Health flags ===\n`);
  let issues = 0;

  // Title length sanity (50-65 ideal)
  for (const r of results) {
    if (r.error) continue;
    const len = r.title?.length || 0;
    if (len < 30 || len > 70) {
      console.log(`  ⚠  ${r.label}: title length ${len}ch (ideal 30-70)`);
      issues++;
    }
  }

  // Meta desc length (120-160 ideal)
  for (const r of results) {
    if (r.error) continue;
    const len = r.metaDesc?.length || 0;
    if (len < 100 || len > 170) {
      console.log(`  ⚠  ${r.label}: meta desc ${len}ch (ideal 120-160)`);
      issues++;
    }
  }

  // Multiple H1s
  for (const r of results) {
    if (r.error) continue;
    if (r.h1Count !== 1) {
      console.log(`  ⚠  ${r.label}: ${r.h1Count} H1 tags (should be exactly 1)`);
      issues++;
    }
  }

  // Title uniqueness
  const titleCounts = {};
  for (const r of results) {
    if (r.title) titleCounts[r.title] = (titleCounts[r.title] || 0) + 1;
  }
  for (const [t, c] of Object.entries(titleCounts)) {
    if (c > 1) {
      console.log(`  ⚠  Duplicate title across ${c} pages: ${t.slice(0, 60)}…`);
      issues++;
    }
  }

  // Canonical presence
  for (const r of results) {
    if (r.error) continue;
    if (!r.canonical) {
      console.log(`  ⚠  ${r.label}: missing canonical URL`);
      issues++;
    }
  }

  // Hero LCP
  for (const r of results) {
    if (r.error) continue;
    if (r.heroImgLazyAboveFold) {
      console.log(`  ⚠  ${r.label}: hero img has loading="lazy" (LCP regression)`);
      issues++;
    }
  }

  // Prerender served
  for (const r of results) {
    if (r.error) continue;
    if (r.xPrerendered !== "true") {
      console.log(`  ⚠  ${r.label}: NOT served from prerender cache (X-Prerendered=${r.xPrerendered}). Bots get SPA shell.`);
      issues++;
    }
  }

  console.log(`\n=== Summary: ${issues} issues across ${results.filter((r) => !r.error).length} pages ===\n`);
})();
