#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRERENDERED = path.join(ROOT, "prerendered");
const CANONICAL_ORIGIN = "https://nickstire.org";
const PHONE_DIGITS = "2168620005";
const BUSINESS_NAME = /Nick(?:'|’|&#39;|&apos;)s Tire/i;

const ROUTES = [
  "/", "/tires", "/brakes", "/oil-change", "/diagnostics",
  "/emissions", "/services", "/about", "/contact",
  // The AEO price page had no metadata coverage at all despite being the one
  // page built to be quoted by answer engines. It passes every rule below
  // today (checked 2026-08-15) — it was simply never added.
  "/tire-prices-cleveland",
];

function routeFile(route) {
  return route === "/"
    ? path.join(PRERENDERED, "index.html")
    : path.join(PRERENDERED, route.slice(1), "index.html");
}

function textMatch(html, regex) {
  return regex.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function attributeFromTag(html, tagPattern, attribute) {
  const tag = tagPattern.exec(html)?.[0] ?? "";
  return textMatch(tag, new RegExp(`${attribute}="([^"]*)"`, "i"))
    || textMatch(tag, new RegExp(`${attribute}='([^']*)'`, "i"));
}

function normalizedDigits(value) {
  return value.replace(/\D/g, "");
}

function inspect(route) {
  const file = routeFile(route);
  const errors = [];
  if (!fs.existsSync(file)) return [`${route}: missing ${path.relative(ROOT, file)}`];

  const html = fs.readFileSync(file, "utf8");
  const title = textMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = attributeFromTag(
    html,
    /<meta\b[^>]*\bname=["']description["'][^>]*>/i,
    "content",
  );
  const canonical = attributeFromTag(
    html,
    /<link\b[^>]*\brel=["']canonical["'][^>]*>/i,
    "href",
  );
  const h1 = textMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, "").trim();
  const expectedCanonical = `${CANONICAL_ORIGIN}${route === "/" ? "" : route}`;

  if (!title || title.length < 10) errors.push(`${route}: missing or weak title`);
  if (!description || description.length < 50) errors.push(`${route}: missing or weak meta description`);
  if (!h1) errors.push(`${route}: missing H1`);
  if (canonical.replace(/\/$/, "") !== expectedCanonical.replace(/\/$/, "")) {
    errors.push(`${route}: canonical ${canonical || "missing"} != ${expectedCanonical}`);
  }
  if (!BUSINESS_NAME.test(html)) errors.push(`${route}: business name missing`);
  if (!normalizedDigits(html).includes(PHONE_DIGITS)) errors.push(`${route}: primary phone missing`);
  if (!/<script[^>]+type=["']application\/ld\+json["']/i.test(html)) errors.push(`${route}: JSON-LD missing`);
  if (/autonicks\.com|example\.com|localhost:\d+/i.test(html)) errors.push(`${route}: stale or placeholder host found`);
  if (/href=["']javascript:void\(0\)["']/i.test(html)) errors.push(`${route}: javascript placeholder link found`);

  return errors;
}

// ─── Payload rules ────────────────────────────────────
// The checks above prove a page EXISTS for crawlers with the right identity.
// They cannot prove it still carries the content it exists FOR — and prod
// serves two different documents: browsers get the ~14KB SPA shell, crawlers
// get this committed HTML. A page can therefore lose its entire value here
// while every other signal stays green (200, title, canonical, JSON-LD).
//
// Two live misses that motivated these rules, both invisible to the checks above:
//   · 2026-08-15 — the homepage five-star showcase rendered a 1-star review,
//     because Places returns the most RECENT reviews at any rating.
//   · 2026-08-11 → present — /tire-prices-cleveland prerendered with zero
//     per-size floor rows: the snapshot was captured before the first
//     shop_settings.tirePriceFloors write, so the page's proprietary data
//     (the whole point of an AEO page) is absent for Googlebot.
//
// A rule may be non-fatal ONLY with a stated reason and a flip condition — the
// same stale-vs-invalid split the capability ledger uses. Non-fatal still prints.

function countOccurrences(html, needle) {
  return html.split(needle).length - 1;
}

// The PER-CARD attribution label, and only that. Matching the bare string
// "Google Review" is what a first draft of this file did, and it is wrong:
// /reviews carries 9 such hits of which only 5 are review cards — the other
// four are the "1,705+ Google Reviews" stat, two "Leave a Google Review →"
// CTAs and an aria-label, all of which render with zero reviews on the page.
// A threshold set against the loose count therefore has a static floor built
// into it and passes on a nearly empty page. Measured 2026-08-15: loose 9 vs
// exact 5 on /reviews, loose 5 vs exact 3 on /.
const REVIEW_LABEL = ">Google Review</span>";

function countReviewLabels(html) {
  return countOccurrences(html, REVIEW_LABEL);
}

// A review card is a `tilt-card` container holding one attribution label; its
// star SVGs sit above that label inside the same container. Homepage cards
// render only the stars they earned (`[...Array(r.stars)]`), so counting
// `lucide-star` up to the label yields the rating. Measured: [5, 5, 5].
function reviewCards(html) {
  const starts = [];
  const marker = /tilt-card/g;
  let match;
  while ((match = marker.exec(html)) !== null) starts.push(match.index);

  const cards = [];
  for (let i = 0; i < starts.length; i++) {
    const segment = html.slice(starts[i], starts[i + 1] ?? html.length);
    const labelAt = segment.indexOf(REVIEW_LABEL);
    if (labelAt === -1) continue; // a tilt-card that is not a review card
    cards.push({ stars: countOccurrences(segment.slice(0, labelAt), "lucide-star") });
  }
  return cards;
}

const PAYLOAD_RULES = [
  {
    route: "/",
    // FIVE, not four. Home.tsx filters the showcase to `rating >= 5` precisely
    // because the headline above it says "five-star reviews", so a gate set at
    // >=4 is looser than the source's own guarantee: a regression that relaxed
    // the filter to >=4 would pass this check while recreating the exact
    // headline/content contradiction the rule exists to prevent.
    label: "homepage showcase: >=3 review cards, all five-star",
    fatal: true,
    check(html) {
      const cards = reviewCards(html);
      const errors = [];
      if (cards.length < 3) {
        errors.push(`only ${cards.length} review card(s) rendered, expected >=3`);
      }
      const low = cards.filter((card) => card.stars < 5);
      if (low.length > 0) {
        errors.push(
          `${low.length} review card(s) under 5 stars (${low.map((c) => c.stars).join(", ")}) — ` +
            "the section headline above them claims five-star reviews",
        );
      }
      return errors;
    },
  },
  {
    route: "/reviews",
    // Threshold is 3, not "however many the API returned today": Google can
    // return fewer reviews without anything being broken, and this rule exists
    // to catch the page rendering EMPTY, not to pin a count. Measured 5.
    label: "reviews page carries review content",
    fatal: true,
    check(html) {
      const attributions = countReviewLabels(html);
      return attributions >= 3
        ? []
        : [`only ${attributions} review card(s) rendered, expected >=3`];
    },
  },
  {
    route: "/tire-prices-cleveland",
    label: "AEO price page carries live per-size floors",
    // NON-FATAL until the next refresh lands. The first draft of this comment
    // blamed the snapshot predating the first tirePriceFloors write; that was
    // wrong. Real cause, found by bisecting the committed tree: commit
    // 6d99b9e3c (2026-08-11) rewrote all 344 prerendered files from a LOCAL
    // `pnpm run regen` in which no DB-backed payload resolved, overwriting the
    // healthy tree the 2026-08-10 CI refresh had produced. The same commit turned
    // 10 dynamic blog articles into soft-404s (see the soft404 rule below).
    // A CI refresh regenerates correctly — 8d31ca036 proves it. FLIP TO
    // fatal: true once one has run and this passes.
    fatal: false,
    check(html) {
      const sizes = new Set(html.match(/\b\d{3}\/\d{2}R\d{2}\b/g) ?? []);
      return sizes.size >= 1
        ? []
        : ["no per-size tire rows — the page's proprietary data is invisible to crawlers"];
    },
  },
];

// Tree-wide, not per-route: a prerendered page that renders the client's
// "not found" branch is a SOFT 404 — HTTP 200, full Article JSON-LD, and
// "ARTICLE NOT FOUND" as the only visible copy. Google is being handed these
// in the sitemap. Ten of them shipped in 6d99b9e3c and nothing noticed for four
// days; the same thing happened once before in 9a6c5ef04 (2026-07-09) and was
// only cleaned up by the next weekly refresh happening to run.
const SOFT_404_MARKERS = ["ARTICLE NOT FOUND", "PAGE NOT FOUND"];

function collectPrerenderedFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectPrerenderedFiles(full, found);
    else if (entry.name === "index.html") found.push(full);
  }
  return found;
}

function findSoft404s() {
  return collectPrerenderedFiles(PRERENDERED)
    .filter((file) => {
      const html = fs.readFileSync(file, "utf8");
      return SOFT_404_MARKERS.some((marker) => html.includes(marker));
    })
    .map((file) => "/" + path.relative(PRERENDERED, file).replace(/\\/g, "/").replace(/\/?index\.html$/, ""));
}

function inspectPayload(rule) {
  const file = routeFile(rule.route);
  if (!fs.existsSync(file)) return [`${rule.route}: missing ${path.relative(ROOT, file)}`];
  return rule.check(fs.readFileSync(file, "utf8")).map((issue) => `${rule.route}: ${issue}`);
}

if (!fs.existsSync(PRERENDERED)) {
  console.error("[prerender:semantic] prerendered/ is missing");
  process.exit(1);
}

const failures = ROUTES.flatMap(inspect);

const payloadFatal = [];
const payloadReported = [];
for (const rule of PAYLOAD_RULES) {
  const issues = inspectPayload(rule);
  if (issues.length === 0) continue;
  (rule.fatal ? payloadFatal : payloadReported).push(...issues);
}

// Same non-fatal reasoning as the tire-price rule, and the same flip condition:
// 10 pages fail today, the fix is a prerender refresh rather than a code change.
const soft404s = findSoft404s();
if (soft404s.length > 0) {
  payloadReported.push(
    `${soft404s.length} prerendered page(s) render a NOT FOUND branch at HTTP 200 — ` +
      `soft 404s, and they are in the sitemap: ${soft404s.slice(0, 6).join(", ")}` +
      (soft404s.length > 6 ? `, +${soft404s.length - 6} more` : ""),
  );
}

if (payloadReported.length > 0) {
  console.warn(
    `[prerender:semantic] \u29D7 ${payloadReported.length} payload issue(s) reported, not fatal — ` +
      "see the rule comment for the flip condition:",
  );
  for (const issue of payloadReported) console.warn(`  - ${issue}`);
}

const allFatal = [...failures, ...payloadFatal];
if (allFatal.length) {
  console.error(`[prerender:semantic] FAIL · ${allFatal.length} semantic issue(s)`);
  for (const failure of allFatal) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `[prerender:semantic] OK · ${ROUTES.length} key routes match current identity and metadata rules; ` +
    `${PAYLOAD_RULES.length} payload rules checked`,
);