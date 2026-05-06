/**
 * VOICE.md Compliance Test — automated regression guard.
 *
 * Scans customer-facing copy data (services.ts, seo-pages.ts, blog.ts)
 * for VOICE.md cliché kill list violations.
 *
 * Why this exists: today's audit caught 14 violations across 11 files
 * that built up over time. Without a test, the same regressions will
 * recur whenever someone (human or AI) writes new copy that includes
 * "trusted", "expert", "hassle-free", etc. as marketing labels.
 *
 * The test allowlists legitimate uses:
 * - Functional English (e.g. "trusted friend", "industry experts in ASE")
 * - Industry-standard part-tier ("OEM-quality parts", "quality used tires")
 * - Generational pivots from VOICE.md pattern 6
 *
 * Anything else fails the build.
 */

import { describe, expect, it } from "vitest";
import { SERVICES } from "../shared/services";
import { SEO_SERVICE_PAGES } from "../shared/seo-pages";
import { BLOG_ARTICLES } from "../shared/blog";

// VOICE.md cliché kill list — phrases that should never appear as
// marketing labels. Each pattern is paired with an `allowlist` of
// substring contexts where it's accepted.
const KILL_LIST: Array<{
  pattern: RegExp;
  label: string;
  allowedContexts: string[];
}> = [
  {
    pattern: /\b(?:Cleveland's?|the)\s+trusted\b/i,
    label: "'trusted' as marketing label (e.g. 'Cleveland's trusted shop')",
    allowedContexts: [
      // Generational pivot from VOICE.md pattern 6 — kept on Home.tsx
      // (this pattern doesn't appear in data files, only in JSX, so safe)
    ],
  },
  {
    pattern: /\bExpert\s+(?:advice|guide|diagnosis|tire advice|technicians|knowledge|backed)\b/i,
    label: "'Expert X' label (replace with 'Mechanic-grade X' or specific signal)",
    allowedContexts: [
      // ASE certification context: "tests are developed by industry experts"
      "industry experts",
      "industry-experts",
    ],
  },
  {
    pattern: /\bhassle.free\b/i,
    label: "'hassle-free' (per VOICE.md replace with 'Done before your patience runs out.')",
    allowedContexts: [],
  },
  {
    pattern: /\brest\s+assured\b/i,
    label: "'rest assured' (patronizing per VOICE.md)",
    allowedContexts: [],
  },
  {
    pattern: /\bstate.of.the.art\b/i,
    label: "'state-of-the-art' (per VOICE.md replace with the actual model number)",
    allowedContexts: [],
  },
  {
    pattern: /\btop.notch\b/i,
    label: "'top-notch' (pure filler per VOICE.md)",
    allowedContexts: [],
  },
];

interface ScannedField {
  fileName: string;
  recordSlug: string;
  field: string;
  value: string;
}

/** Walk every text field on every record and yield ScannedField entries. */
function* scanCopy(): Generator<ScannedField> {
  // Services
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
  // SEO pages
  for (const p of SEO_SERVICE_PAGES) {
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "metaTitle", value: p.metaTitle };
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "metaDescription", value: p.metaDescription };
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "heroSubline", value: p.heroSubline };
    yield { fileName: "seo-pages.ts", recordSlug: p.slug, field: "intro", value: p.intro };
  }
  // Blog
  for (const a of BLOG_ARTICLES) {
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "title", value: a.title };
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "metaTitle", value: a.metaTitle };
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "metaDescription", value: a.metaDescription };
    yield { fileName: "blog.ts", recordSlug: a.slug, field: "excerpt", value: a.excerpt };
  }
}

describe("VOICE.md Compliance — cliché kill list", () => {
  for (const rule of KILL_LIST) {
    it(`zero violations of: ${rule.label}`, () => {
      const violations: Array<{ where: string; snippet: string }> = [];
      for (const entry of scanCopy()) {
        if (!entry.value || typeof entry.value !== "string") continue;
        if (!rule.pattern.test(entry.value)) continue;
        // Allowlist check
        const matchedAllowed = rule.allowedContexts.some((ctx) =>
          entry.value.toLowerCase().includes(ctx.toLowerCase()),
        );
        if (matchedAllowed) continue;
        violations.push({
          where: `${entry.fileName}:${entry.recordSlug}.${entry.field}`,
          snippet: entry.value.slice(0, 120),
        });
      }
      expect(violations).toEqual([]);
    });
  }
});

describe("VOICE.md Compliance — meta-title length (≤60 chars)", () => {
  it("all SERVICES.metaTitle ≤60 chars", () => {
    const violations = SERVICES
      .filter((s) => s.metaTitle.length > 60)
      .map((s) => `${s.slug}: ${s.metaTitle.length}ch`);
    expect(violations).toEqual([]);
  });

  it("all SEO_SERVICE_PAGES.metaTitle ≤60 chars", () => {
    const violations = SEO_SERVICE_PAGES
      .filter((p) => p.metaTitle.length > 60)
      .map((p) => `${p.slug}: ${p.metaTitle.length}ch`);
    expect(violations).toEqual([]);
  });

  it("all BLOG_ARTICLES.title ≤60 chars (Google SERP truncation)", () => {
    const violations = BLOG_ARTICLES
      .filter((a) => a.title.length > 60)
      .map((a) => `${a.slug}: ${a.title.length}ch`);
    expect(violations).toEqual([]);
  });
});

describe("VOICE.md Compliance — meta-description length (≤170 chars)", () => {
  it("all SERVICES.metaDescription ≤170 chars", () => {
    const violations = SERVICES
      .filter((s) => s.metaDescription.length > 170)
      .map((s) => `${s.slug}: ${s.metaDescription.length}ch`);
    expect(violations).toEqual([]);
  });

  it("all BLOG_ARTICLES.metaDescription ≤170 chars", () => {
    const violations = BLOG_ARTICLES
      .filter((a) => a.metaDescription.length > 170)
      .map((a) => `${a.slug}: ${a.metaDescription.length}ch`);
    expect(violations).toEqual([]);
  });
});

// ─── Component-level scan ───────────────────────────────
// Some hardcoded marketing copy lives in TSX components, not data files.
// LocalBusinessSchema.tsx in particular ships a long `description` field
// to every page — it's the single highest-leverage string for both Google
// rich results and AI-search citation, so it MUST stay voice-compliant.
//
// We scan as plain text (read the file). Cheap + catches regressions
// the data-file scan above misses.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENT_FILES_TO_SCAN = [
  "client/src/components/LocalBusinessSchema.tsx",
  "client/src/components/InternalLinks.tsx",
  "client/src/pages/AreasServed.tsx",
  "client/src/pages/LandingPage.tsx",
  "client/src/pages/ServicesOverview.tsx",
  "client/src/pages/TireFinder.tsx",
  "client/src/pages/TireShopNearMePage.tsx",
];

describe("VOICE.md Compliance — component-level marketing copy", () => {
  for (const file of COMPONENT_FILES_TO_SCAN) {
    it(`${file} has zero kill-list violations`, () => {
      const fullPath = join(process.cwd(), file);
      const content = readFileSync(fullPath, "utf-8");
      const violations: Array<{ rule: string; snippet: string }> = [];
      for (const rule of KILL_LIST) {
        // Pull match + small surrounding context for allowlist check
        const matches = content.matchAll(new RegExp(rule.pattern.source, "gi"));
        for (const match of matches) {
          if (match.index === undefined) continue;
          const start = Math.max(0, match.index - 30);
          const end = Math.min(content.length, match.index + match[0].length + 30);
          const context = content.slice(start, end);
          const matchedAllowed = rule.allowedContexts.some((ctx) =>
            context.toLowerCase().includes(ctx.toLowerCase()),
          );
          if (matchedAllowed) continue;
          violations.push({ rule: rule.label, snippet: context.replace(/\n/g, " ") });
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
