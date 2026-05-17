/**
 * Production Lighthouse Audit via PageSpeed Insights API
 *
 * Runs Google PSI against key customer-facing pages on prod, prints
 * Core Web Vitals + Lighthouse score breakdown. No local Chrome
 * dependency — PSI is Google's hosted Lighthouse service.
 *
 * Usage:
 *   npx tsx scripts/lighthouse-audit.ts                 # all pages
 *   npx tsx scripts/lighthouse-audit.ts /brakes          # one page
 *   npx tsx scripts/lighthouse-audit.ts --strategy=desktop  # desktop
 *
 * Output: human-readable summary + JSON sidecar at
 *         tmp/lighthouse-audit-<timestamp>.json for archival.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const SITE_BASE = "https://nickstire.org";

// Key pages to audit. Picked for traffic value + variety: home, services
// hub, two FocusedServicePages, two city pages.
const PAGES_TO_AUDIT = [
  "/",
  "/services",
  "/brakes",
  "/new-tires-cleveland",
  "/diagnostics",
  "/cleveland-auto-repair",
];

interface PsiResult {
  url: string;
  strategy: "mobile" | "desktop";
  score: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  cwv: {
    lcp: { ms: number; status: string } | null;
    cls: { value: number; status: string } | null;
    inp: { ms: number; status: string } | null;
    fcp: { ms: number; status: string } | null;
    ttfb: { ms: number; status: string } | null;
  };
  fetchedAt: string;
  error?: string;
}

async function runPsi(pageUrl: string, strategy: "mobile" | "desktop"): Promise<PsiResult> {
  const apiKey = process.env.PSI_API_KEY || process.env.GOOGLE_API_KEY;
  const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  url.searchParams.set("url", pageUrl);
  url.searchParams.set("strategy", strategy);
  url.searchParams.append("category", "performance");
  url.searchParams.append("category", "accessibility");
  url.searchParams.append("category", "best-practices");
  url.searchParams.append("category", "seo");
  if (apiKey) url.searchParams.set("key", apiKey);

  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      return {
        url: pageUrl,
        strategy,
        score: { performance: null, accessibility: null, bestPractices: null, seo: null },
        cwv: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
        fetchedAt,
        error: `PSI ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      lighthouseResult?: {
        categories?: {
          performance?: { score: number };
          accessibility?: { score: number };
          "best-practices"?: { score: number };
          seo?: { score: number };
        };
        audits?: Record<string, {
          numericValue?: number;
          displayValue?: string;
          score?: number;
        }>;
      };
      loadingExperience?: {
        metrics?: Record<string, { percentile?: number; category?: string }>;
      };
    };

    const lh = json.lighthouseResult;
    const cats = lh?.categories;
    const audits = lh?.audits ?? {};
    const cwv = json.loadingExperience?.metrics ?? {};

    return {
      url: pageUrl,
      strategy,
      score: {
        performance: cats?.performance?.score ? Math.round(cats.performance.score * 100) : null,
        accessibility: cats?.accessibility?.score ? Math.round(cats.accessibility.score * 100) : null,
        bestPractices: cats?.["best-practices"]?.score ? Math.round(cats["best-practices"].score * 100) : null,
        seo: cats?.seo?.score ? Math.round(cats.seo.score * 100) : null,
      },
      cwv: {
        lcp: cwv.LARGEST_CONTENTFUL_PAINT_MS
          ? { ms: cwv.LARGEST_CONTENTFUL_PAINT_MS.percentile ?? 0, status: cwv.LARGEST_CONTENTFUL_PAINT_MS.category ?? "" }
          : audits["largest-contentful-paint"]
            ? { ms: Math.round(audits["largest-contentful-paint"].numericValue ?? 0), status: scoreToStatus(audits["largest-contentful-paint"].score ?? null) }
            : null,
        cls: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE
          ? { value: (cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile ?? 0) / 100, status: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE.category ?? "" }
          : audits["cumulative-layout-shift"]
            ? { value: audits["cumulative-layout-shift"].numericValue ?? 0, status: scoreToStatus(audits["cumulative-layout-shift"].score ?? null) }
            : null,
        inp: cwv.INTERACTION_TO_NEXT_PAINT
          ? { ms: cwv.INTERACTION_TO_NEXT_PAINT.percentile ?? 0, status: cwv.INTERACTION_TO_NEXT_PAINT.category ?? "" }
          : null,
        fcp: cwv.FIRST_CONTENTFUL_PAINT_MS
          ? { ms: cwv.FIRST_CONTENTFUL_PAINT_MS.percentile ?? 0, status: cwv.FIRST_CONTENTFUL_PAINT_MS.category ?? "" }
          : null,
        ttfb: cwv.EXPERIMENTAL_TIME_TO_FIRST_BYTE
          ? { ms: cwv.EXPERIMENTAL_TIME_TO_FIRST_BYTE.percentile ?? 0, status: cwv.EXPERIMENTAL_TIME_TO_FIRST_BYTE.category ?? "" }
          : null,
      },
      fetchedAt,
    };
  } catch (err) {
    return {
      url: pageUrl,
      strategy,
      score: { performance: null, accessibility: null, bestPractices: null, seo: null },
      cwv: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function scoreToStatus(score: number | null): string {
  if (score === null) return "";
  if (score >= 0.9) return "FAST";
  if (score >= 0.5) return "AVERAGE";
  return "SLOW";
}

function fmtScore(s: number | null): string {
  if (s === null) return "  -  ";
  if (s >= 90) return `\x1b[32m${s.toString().padStart(3, " ")}\x1b[0m`;
  if (s >= 50) return `\x1b[33m${s.toString().padStart(3, " ")}\x1b[0m`;
  return `\x1b[31m${s.toString().padStart(3, " ")}\x1b[0m`;
}

async function main() {
  const args = process.argv.slice(2);
  const strategy: "mobile" | "desktop" = args.find((a) => a === "--strategy=desktop") ? "desktop" : "mobile";
  const explicitPath = args.find((a) => a.startsWith("/") && a !== "--strategy");
  const pagesToAudit = explicitPath ? [explicitPath] : PAGES_TO_AUDIT;

  console.log(`\n═══ LIGHTHOUSE AUDIT — ${SITE_BASE} (${strategy}) ═══\n`);
  console.log(
    `${"PAGE".padEnd(36)} | ${"PERF".padStart(5)} | ${"A11Y".padStart(5)} | ${"BP".padStart(5)} | ${"SEO".padStart(5)} | LCP    CLS     INP`,
  );
  console.log("─".repeat(105));

  const results: PsiResult[] = [];
  for (const path of pagesToAudit) {
    const fullUrl = `${SITE_BASE}${path}`;
    const result = await runPsi(fullUrl, strategy);
    results.push(result);
    if (result.error) {
      console.log(`${path.padEnd(36)} | ERROR: ${result.error.slice(0, 60)}`);
    } else {
      const lcp = result.cwv.lcp ? `${(result.cwv.lcp.ms / 1000).toFixed(1)}s` : "-";
      const cls = result.cwv.cls ? result.cwv.cls.value.toFixed(2) : "-";
      const inp = result.cwv.inp ? `${result.cwv.inp.ms}ms` : "-";
      console.log(
        `${path.padEnd(36)} | ${fmtScore(result.score.performance)} | ${fmtScore(result.score.accessibility)} | ${fmtScore(result.score.bestPractices)} | ${fmtScore(result.score.seo)} | ${lcp.padEnd(6)} ${cls.padEnd(7)} ${inp}`,
      );
    }
  }

  // Save sidecar JSON for archival/diff
  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const sidecarPath = join(tmpDir, `lighthouse-audit-${Date.now()}.json`);
  writeFileSync(sidecarPath, JSON.stringify({ strategy, fetchedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nFull report: ${sidecarPath}`);
  console.log("\nThresholds: LCP <2.5s good, CLS <0.1 good, INP <200ms good");
  console.log("═══ DONE ═══\n");
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
