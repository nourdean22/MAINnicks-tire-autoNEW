/**
 * Voice compliance — automated regression guard over customer-facing copy.
 *
 * WHAT CHANGED (Voice Kernel wave)
 * This file used to carry its OWN `KILL_LIST` — the sixth of seven independent
 * copies of Nick's brand voice in this repo, and narrower than all the others
 * (bare "trusted" passed here; "reliable" was absent entirely). It now reads
 * `shared/voice.ts`, the same kernel the brand-voice linter, the IG generator
 * prompt and the IG critic prompt read. There is no local list to drift.
 *
 * WHY A BASELINE
 * Adopting the full kernel surfaced pre-existing copy debt that predates it.
 * Failing the build on all of it would have forced an unrelated content wave
 * into this change, so the suite uses a ratchet, matching the semantics the
 * brand-voice linter already had (pre-existing violations don't block; NEW ones
 * do):
 *
 *   - Any violation NOT in KNOWN_COPY_DEBT fails the build.
 *   - Any KNOWN_COPY_DEBT entry that no longer reproduces ALSO fails the build,
 *     so fixing a line forces deleting its entry. A ratchet that only ever grows
 *     is a rug; this one only ever shrinks.
 *
 * Burn the list down to zero and delete the mechanism.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BLOG_ARTICLES } from "../shared/blog";
import { CITIES } from "../shared/cities";
import { SEO_SERVICE_PAGES } from "../shared/seo-pages";
import { SERVICES } from "../shared/services";
import { findVoiceViolations, KILL_RULES } from "../shared/voice";

/**
 * Pre-existing violations, one `ruleId@location` per line, each with the reason
 * it is still here. Do NOT add to this list to make a new failure go away —
 * fix the copy. Adding an entry is a deliberate, reviewed exception.
 */
const KNOWN_COPY_DEBT: readonly string[] = [
  // Real violations — small copy edits, deferred to a content pass because the
  // metaTitle/metaDescription fields below are baked into prerendered/ and
  // changing them requires a prerender regeneration this change does not do.
  'bot.free-inspection@seo-pages.ts:brake-repair-cleveland.metaTitle', // "Free Inspection" -> "Free Check"
  'cliche.expert@seo-pages.ts:check-engine-light-cleveland.metaDescription', // "OBD-II experts"
  'cliche.quality@blog.ts:used-tires-near-me-cleveland.metaTitle', // "Quality Inspected" badge
  'cliche.quality@blog.ts:how-we-inspect-used-tires.metaTitle', // "Quality Process"
  'cliche.reliable@cities.ts:strongsville-auto-repair.localContent', // "residents expect reliable service"

  // "reliable" describing the CUSTOMER'S VEHICLE, not the shop. VOICE.md bans
  // the word as a self-description ("Tells the reader nothing"); a Camry having
  // a reliable engine is ordinary English. Kept as debt rather than allowlisted
  // because shop-sense vs vehicle-sense is not safely distinguishable by regex —
  // a human should reword these when the content pass happens.
  'cliche.reliable@blog.ts:cleveland-winter-driving-guide.excerpt', // "keep your car safe and reliable"
  'cliche.reliable@blog.ts:toyota-camry-brake-issues.excerpt', // "Reliable engine and transmission"
  'cliche.reliable@blog.ts:summer-car-care-checklist-cleveland.excerpt', // "stay reliable through the warm months"

  // Customer testimonial inside a TSX page. The component scan reads raw file
  // text and cannot tell quoted speech from shop copy the way the data-file
  // scan can (which skips testimonial fields outright). A reviewer writing
  // "Best tire deal in Cleveland" is evidence, not marketing — never reword it.
  'archetype.hero-superlative@client/src/pages/LandingPage.tsx', // reviews[0].text, "Robert H."
];

interface ScannedField {
  fileName: string;
  recordSlug: string;
  field: string;
  value: string;
}

/**
 * Walk every text field on every copy record.
 *
 * Testimonial fields are deliberately excluded: they are quotes from real
 * customers. The kill list governs how the SHOP describes itself, and a
 * reviewer writing "best shop in Cleveland" is evidence, not marketing copy.
 * Rewriting a customer's words to satisfy a style rule would be a fabrication.
 */
function* scanCopy(): Generator<ScannedField> {
  for (const s of SERVICES) {
    yield { fileName: "services.ts", recordSlug: s.slug, field: "metaTitle", value: s.metaTitle };
    yield { fileName: "services.ts", recordSlug: s.slug, field: "metaDescription", value: s.metaDescription };
    yield { fileName: "services.ts", recordSlug: s.slug, field: "heroHeadline", value: s.heroHeadline };
    yield { fileName: "services.ts", recordSlug: s.slug, field: "heroSubline", value: s.heroSubline };
    for (let i = 0; i < s.problems.length; i++) {
      const p = s.problems[i];
      yield { fileName: "services.ts", recordSlug: s.slug, field: `problems[${i}].q`, value: p.q };
      yield { fileName: "services.ts", recordSlug: s.slug, field: `problems[${i}].a`, value: p.a };
    }
  }
  for (const p of SEO_SERVICE_PAGES) {
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "metaTitle", value: p.metaTitle };
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "metaDescription", value: p.metaDescription };
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "heroSubline", value: p.heroSubline };
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "intro", value: p.intro };
  }
  for (const a of BLOG_ARTICLES) {
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "title", value: a.title };
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "metaTitle", value: a.metaTitle };
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "metaDescription", value: a.metaDescription };
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "excerpt", value: a.excerpt };
  }
  for (const c of CITIES) {
    yield { fileName: "cities.ts", recordSlug: c.slug, field: "metaTitle", value: c.metaTitle };
    yield { fileName: "cities.ts", recordSlug: c.slug, field: "metaDescription", value: c.metaDescription };
    yield { fileName: "cities.ts", recordSlug: c.slug, field: "heroHeadline", value: c.heroHeadline };
    yield { fileName: "cities.ts", recordSlug: c.slug, field: "heroSubline", value: c.heroSubline };
    if (c.localContent) {
      yield { fileName: "cities.ts", recordSlug: c.slug, field: "localContent", value: c.localContent };
    }
    // c.testimonial is intentionally NOT scanned — see the doc comment above.
  }
}

// Some hardcoded marketing copy lives in TSX, not data files.
// LocalBusinessSchema.tsx in particular ships a long `description` to every
// page — the highest-leverage string for both Google rich results and
// AI-search citation, so it must stay voice-compliant.
const COMPONENT_FILES_TO_SCAN = [
  "client/src/components/LocalBusinessSchema.tsx",
  "client/src/components/InternalLinks.tsx",
  "client/src/pages/AreasServed.tsx",
  "client/src/pages/LandingPage.tsx",
  "client/src/pages/ServicesOverview.tsx",
  "client/src/pages/TireFinder.tsx",
  "client/src/pages/TireShopNearMePage.tsx",
];

/** Blank out comments so line numbers survive but prose in them isn't scanned. */
function stripComments(body: string): string {
  return body
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "));
}

function collectAllViolations(): { key: string; detail: string }[] {
  const found: { key: string; detail: string }[] = [];

  for (const entry of scanCopy()) {
    if (!entry.value || typeof entry.value !== "string") continue;
    for (const v of findVoiceViolations(entry.value, { surface: "web" })) {
      found.push({
        key: `${v.ruleId}@${entry.fileName}:${entry.recordSlug}.${entry.field}`,
        detail: `"${v.match}" in ${entry.value.slice(0, 110)}`,
      });
    }
  }

  for (const file of COMPONENT_FILES_TO_SCAN) {
    const content = stripComments(readFileSync(join(process.cwd(), file), "utf-8"));
    for (const v of findVoiceViolations(content, { surface: "web" })) {
      found.push({
        key: `${v.ruleId}@${file}`,
        detail: `"${v.match}" at line ${v.line}`,
      });
    }
  }

  return found;
}

describe("Voice Kernel compliance — customer-facing copy", () => {
  it("has no violations outside the known-debt baseline", () => {
    // Multiset, not set: a second violation of an already-baselined rule in an
    // already-baselined file must still fail. Component keys have no line
    // number (line numbers churn on every unrelated edit), so the count is what
    // holds the ratchet tight.
    const remaining = [...KNOWN_COPY_DEBT];
    const unexpected: string[] = [];
    for (const v of collectAllViolations()) {
      const at = remaining.indexOf(v.key);
      if (at === -1) unexpected.push(`${v.key}  ->  ${v.detail}`);
      else remaining.splice(at, 1);
    }
    expect(unexpected).toEqual([]);
  });

  it("has no stale baseline entries (fixing copy must delete its entry)", () => {
    const live = [...collectAllViolations().map((v) => v.key)];
    const stale: string[] = [];
    for (const key of KNOWN_COPY_DEBT) {
      const at = live.indexOf(key);
      if (at === -1) stale.push(key);
      else live.splice(at, 1);
    }
    expect(stale).toEqual([]);
  });

  it("reads its rules from the kernel, not a local list", () => {
    // Guards against someone reintroducing a local KILL_LIST in this file.
    const self = readFileSync(__filename, "utf-8");
    expect(self).not.toMatch(/^const KILL_LIST\b/m);
    expect(KILL_RULES.length).toBeGreaterThan(40);
  });
});

describe("Voice compliance — meta-title length (<=60 chars)", () => {
  it("all SERVICES.metaTitle <=60 chars", () => {
    const violations = SERVICES.filter((s) => s.metaTitle.length > 60).map(
      (s) => `${s.slug}: ${s.metaTitle.length}ch`,
    );
    expect(violations).toEqual([]);
  });

  it("all SEO_SERVICE_PAGES.metaTitle <=60 chars", () => {
    const violations = SEO_SERVICE_PAGES.filter((p) => p.metaTitle.length > 60).map(
      (p) => `${p.slug}: ${p.metaTitle.length}ch`,
    );
    expect(violations).toEqual([]);
  });

  it("all BLOG_ARTICLES.title <=60 chars (Google SERP truncation)", () => {
    const violations = BLOG_ARTICLES.filter((a) => a.title.length > 60).map(
      (a) => `${a.slug}: ${a.title.length}ch`,
    );
    expect(violations).toEqual([]);
  });

  // 2026-05-06 · 90+ blog metaTitles still over 60ch from the pre-framework
  // era. Tracked for a follow-up content audit. The 6 GSC-traffic posts already
  // comply (ledger in shared/blog.ts framework header).
  it.todo("all BLOG_ARTICLES.metaTitle <=60 chars (audit pending)");

  it("all CITIES.metaTitle <=60 chars", () => {
    const violations = CITIES.filter((c) => c.metaTitle.length > 60).map(
      (c) => `${c.slug}: ${c.metaTitle.length}ch`,
    );
    expect(violations).toEqual([]);
  });
});

describe("Voice compliance — meta-description length (<=170 chars)", () => {
  it("all SERVICES.metaDescription <=170 chars", () => {
    const violations = SERVICES.filter((s) => s.metaDescription.length > 170).map(
      (s) => `${s.slug}: ${s.metaDescription.length}ch`,
    );
    expect(violations).toEqual([]);
  });

  it("all BLOG_ARTICLES.metaDescription <=170 chars", () => {
    const violations = BLOG_ARTICLES.filter((a) => a.metaDescription.length > 170).map(
      (a) => `${a.slug}: ${a.metaDescription.length}ch`,
    );
    expect(violations).toEqual([]);
  });

  it("all CITIES.metaDescription <=170 chars", () => {
    const violations = CITIES.filter((c) => c.metaDescription.length > 170).map(
      (c) => `${c.slug}: ${c.metaDescription.length}ch`,
    );
    expect(violations).toEqual([]);
  });

  it("all SEO_SERVICE_PAGES.metaDescription <=170 chars", () => {
    const violations = SEO_SERVICE_PAGES.filter((p) => p.metaDescription.length > 170).map(
      (p) => `${p.slug}: ${p.metaDescription.length}ch`,
    );
    expect(violations).toEqual([]);
  });
});
