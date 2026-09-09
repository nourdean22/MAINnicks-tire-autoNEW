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
  { rx: /^server\/cron\/jobs\/.*Sequences\.ts$/, surface: "sms" },
  { rx: /^server\/cron\/jobs\/.*Outreach\.ts$/, surface: "sms" },
  { rx: /^server\/cron\/jobs\/.*Recovery\.ts$/, surface: "sms" },
  { rx: /^shared\/routes\.ts$/, surface: "meta" },
];

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
