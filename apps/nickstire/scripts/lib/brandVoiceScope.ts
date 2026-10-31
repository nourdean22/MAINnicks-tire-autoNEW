/**
 * Path-scope logic for the brand-voice linter — lifted out of
 * `lint-brand-voice.ts` for the same reason `scanText.ts` was: that script
 * runs its scan at import time (and calls `process.exit()`), so a test
 * cannot import it directly. This is the piece a 2026-09 regression lived
 * in: `IN_SCOPE`'s regexes are anchored to bare paths (`^client/src/...`),
 * but in this monorepo `git diff --cached --name-only` — run with `cwd` set
 * to `apps/nickstire` — returns REPO-ROOT-relative paths
 * (`apps/nickstire/client/src/...`) regardless of cwd. Passing that
 * unstripped path straight into `scopeOf()` never matches anything, so the
 * pre-commit gate silently scanned zero files for as long as this bug
 * existed. See `brandVoiceScope.test.ts` for the exact regression case.
 */
import type { VoiceSurface } from "../../shared/voice";

// ─── Scope: only files where customers see the text ─────────────────────────
// Out of scope on purpose: tests, types, drizzle/schema.ts, admin/* (internal
// operator UI), server/_core, server/lib, server/routers (infra, not copy).
export const IN_SCOPE: { rx: RegExp; surface: VoiceSurface }[] = [
  { rx: /^client\/src\/pages\/.*\.tsx$/, surface: "web" },
  { rx: /^client\/src\/components\/.*\.tsx$/, surface: "web" },
  { rx: /^server\/services\/vapi\.ts$/, surface: "voice" },
  // The voice-agent tool procedures return strings the receptionist reads to
  // callers verbatim (the "noted" reply, size-lookup notes, stock hints); the
  // server/routers exclusion above would otherwise leave that copy unscanned.
  { rx: /^server\/routers\/voiceAgent\.ts$/, surface: "voice" },
  { rx: /^server\/cron\/jobs\/.*Sequences\.ts$/, surface: "sms" },
  { rx: /^server\/cron\/jobs\/.*Outreach\.ts$/, surface: "sms" },
  { rx: /^server\/cron\/jobs\/.*Recovery\.ts$/, surface: "sms" },
  { rx: /^shared\/routes\.ts$/, surface: "meta" },
  // Data files that hold page copy (2026-10-30, humanizer PR F): most of the site's text
  // lives here, not in the page components. Excluded on purpose: business.ts (facts; its
  // hour ranges use en dashes), customer-testimonials.ts (real customers' words) and
  // disclaimers.ts (legal text).
  { rx: /^client\/src\/data\/[^/]+\.tsx?$/, surface: "web" },
  {
    rx: /^shared\/(?:blog|guides|neighborhoods|cities|services|seo-pages|tireSizes|tireBrands|tireSizeContent|global-faq|discountPages|seasonal|jobOpenings)\.ts$/,
    surface: "web",
  },
];

/** The data files the 2026-10-30 widening added to the gate (see IN_SCOPE above). */
const NEWLY_SCOPED = /^(?:client\/src\/data\/|shared\/(?:blog|guides|neighborhoods|cities|services|seo-pages|tireSizes|tireBrands|tireSizeContent|global-faq|discountPages|seasonal|jobOpenings)\.ts$)/;

/**
 * Files whose copy has had the humanizer pass. Structure rules BLOCK here now. A page
 * group's PR adds its files to this list in the same change that cleans them.
 */
export const STRUCTURE_CLEAN_FILES: readonly string[] = [
  "client/src/pages/Home.tsx",
  "client/src/pages/TireFinderV2.tsx",
  "client/src/pages/TireSizePage.tsx",
  "client/src/pages/TireBrandPage.tsx",
  "shared/tireBrands.ts",
];

/**
 * Dated ramp (manager ruling 2026-10-30): until this date, structure-rule hits outside
 * STRUCTURE_CLEAN_FILES, and every hit in a newly scoped data file, are reported as
 * `warn` instead of blocking, so an edit to an old line does not stall another session
 * while the page groups are cleaned. After it, everything blocks. A test fails once the
 * date passes, so the ramp cannot be forgotten.
 */
export const STRUCTURE_WARN_UNTIL = "2026-11-30";

export function effectiveSeverity(
  file: string,
  ruleId: string,
  severity: "block" | "warn",
  now: Date = new Date(),
): "block" | "warn" {
  if (severity === "warn") return "warn";
  if (now.getTime() > Date.parse(`${STRUCTURE_WARN_UNTIL}T23:59:59-05:00`)) return "block";
  if (STRUCTURE_CLEAN_FILES.includes(file)) return "block";
  if (ruleId.startsWith("structure.") || NEWLY_SCOPED.test(file)) return "warn";
  return "block";
}

/**
 * `IN_SCOPE`'s regexes expect paths relative to `apps/nickstire` (this
 * script's own workspace root), NOT the monorepo root. Every path that
 * originates from a git command MUST pass through this before `scopeOf()`,
 * whether it came from `--name-only` output or a `+++ b/...` diff header —
 * both are repo-root-relative in this monorepo, always, regardless of the
 * git command's `cwd`. The opposite direction matters too: a path passed AS
 * a pathspec argument TO git (`git diff -- <path>`) must be the STRIPPED
 * form, because pathspecs resolve relative to cwd — the inverse convention
 * from `--name-only`'s output. Both directions are empirically confirmed,
 * not assumed; see the 2026-09 fix commit for the exact probe commands.
 */
export function stripWorkspacePrefix(relPath: string): string {
  return relPath.replace(/^apps\/nickstire\//, "");
}

export function scopeOf(relPath: string): VoiceSurface | null {
  if (relPath.includes("admin/")) return null;
  return IN_SCOPE.find((s) => s.rx.test(relPath))?.surface ?? null;
}
