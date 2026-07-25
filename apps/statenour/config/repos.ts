/**
 * Repo ecosystem manifest · v10 Track E.2 · Apr 30.
 *
 * Single source of truth for the 8 GitHub repos in Nour's
 * ecosystem. Mirrors docs/REPO-MAP.md structure but in a typed,
 * importable shape so dashboards + briefings can read it directly.
 *
 * Whenever REPO-MAP.md changes, update this file too. The /system/
 * repos page reads this manifest + augments with live GitHub API
 * data (last commit, last deploy when known).
 *
 * v10 contract:
 *   - Read-only monitoring. NICK never writes to repos.
 *   - Each repo has a tier and ring for grouping.
 *   - `monitored` flag controls whether /system/repos polls GitHub
 *     for live state.
 *   - `nickWriteAccess` = "none" universally for v10. Future v11+
 *     work may permit "approval" or "manual" for specific repos.
 */

export type RepoRing = "personal" | "business" | "desktop" | "archive";
export type RepoTier = "core" | "active-support" | "active-satellite" | "archive";
export type RepoHost = "vercel" | "railway" | "local-windows" | "github-only";
export type RepoStatus = "active" | "stale" | "archived" | "dead";
export type NickWriteAccess = "none" | "read-only" | "approval" | "manual";

export interface RepoEntry {
  /** Short label used in URLs and pages. */
  name: string;
  /** GitHub `owner/repo` slug. */
  fullName: string;
  /** Which ring of the ecosystem the repo belongs to. */
  ring: RepoRing;
  /** Strategic priority. */
  tier: RepoTier;
  /** What it does in plain English. */
  purpose: string;
  /** Where the repo deploys (or "github-only" for libraries). */
  host: RepoHost;
  /** Production branch — null when host is github-only. */
  branch: string | null;
  /** Public production URL — null if internal-only. */
  productionUrl: string | null;
  /** Lifecycle state. */
  status: RepoStatus;
  /** Whether `/system/repos` actively monitors this repo. */
  monitored: boolean;
  /** Whether NICK can write to this repo. v10 = "none" everywhere. */
  nickWriteAccess: NickWriteAccess;
  /** What the operator should look at next on this repo. */
  nextAction?: string;
  /** Optional notes (sync contract, dependencies, etc.) */
  notes?: string;
}

export const REPOS: RepoEntry[] = [
  // ═══ PERSONAL RING — command center ═══
  {
    name: "statenour-os",
    fullName: "nourdean22/statenour-os",
    ring: "personal",
    tier: "archive",
    purpose:
      "RETIRED standalone repo. STATE NOUR (personal OS + Nick Prime + brain + crons) now lives in the nourdean22/MAINnicks-tire-autoNEW monorepo at apps/statenour and deploys to bdnick.info from there. Kept here as an archived pointer only.",
    // 2026-06-09 truth cleanup — corrected from active/core/bdnick.info. The
    // standalone repo + its statenour-master CI mirror + Vercel are all retired
    // (see docs/CURRENT-TRUTH.md). bdnick.info now ships from the monorepo.
    host: "github-only",
    branch: null,
    productionUrl: null,
    // 2026-07-25 lifecycle sync — GitHub does NOT mark this repo archived
    // (verified via `gh repo list`), so "archived" here overstated reality.
    // "stale" = retired for production but the GitHub archive flag is still
    // pending (see nextAction). Flip to "archived" once actually archived.
    status: "stale",
    monitored: false,
    nickWriteAccess: "none",
    nextAction: "Archive on GitHub (retired — superseded by the monorepo)",
    notes: "Production source moved to apps/statenour in nourdean22/MAINnicks-tire-autoNEW (branch main → Railway → bdnick.info). The statenour-master mirror is retired.",
  },

  // ═══ BUSINESS RING — Nick's Tire & Auto ═══
  {
    name: "MAINnicks-tire-autoNEW",
    fullName: "nourdean22/MAINnicks-tire-autoNEW",
    ring: "business",
    tier: "core",
    purpose:
      "Monorepo hosting BOTH rings: apps/nickstire (Nick's Tire & Auto storefront + admin + booking, → nickstire.org) AND apps/statenour (STATE NOUR personal OS + Nick Prime + brain, → bdnick.info). Branch main auto-deploys both to Railway.",
    // v10.0.43 — corrected from "vercel" to "railway". Cross-checked
    // against ARCHITECTURE.md (Express 4 · tRPC 11 · Drizzle · TiDB ·
    // Railway), REPO-MAP.md deployment matrix, and nickstire-cron-worker
    // notes. Bug since v10.0.6 when this manifest was first introduced;
    // /system/repos was rendering wrong host badge.
    host: "railway",
    branch: "main",
    productionUrl: "https://nickstire.org",
    status: "active",
    monitored: true,
    nickWriteAccess: "none",
    nextAction: "Verify recent deploy clean",
  },
  {
    name: "nickstire-cron-worker",
    fullName: "nourdean22/nickstire-cron-worker",
    ring: "business",
    tier: "active-support",
    purpose:
      "Railway-deployed cron worker for Nick's Tire. Runs scheduled syncs and alert pipelines that don't fit Vercel's serverless model.",
    host: "railway",
    branch: "main",
    productionUrl: null,
    status: "active",
    monitored: true,
    nickWriteAccess: "none",
    nextAction: "Confirm sync contract with statenour-os matches",
    notes: "Hits the /api/webhooks/nickstire endpoint (now hardened in v9.1.14).",
  },
  {
    name: "easy-nickstire",
    fullName: "nourdean22/easy-nickstire",
    ring: "business",
    tier: "active-satellite",
    purpose:
      "easy.nickstire.org · simplified customer-facing booking surface. Optimized for low-friction quote requests + appointment scheduling.",
    // 2026-07-25 lifecycle sync — GitHub marked this repo ARCHIVED on
    // 2026-05-22 (verified via `gh repo list`); the manifest still said
    // active/monitored, so /system briefings showed a dead repo as live.
    host: "vercel",
    branch: "main",
    productionUrl: "https://easy.nickstire.org",
    status: "archived",
    monitored: false,
    nickWriteAccess: "none",
    nextAction: "None — archived on GitHub 2026-05-22",
  },
  {
    name: "nicks-tire-social",
    fullName: "nourdean22/nicks-tire-social",
    ring: "business",
    tier: "active-satellite",
    purpose:
      "Instagram + Buffer automation for Nick's Tire content. Schedules posts, manages content calendar, surfaces engagement metrics.",
    // 2026-07-25 lifecycle sync — GitHub marked this repo ARCHIVED on
    // 2026-05-22 (verified via `gh repo list`). Social automation now
    // lives inside the monorepo (packages/social-assets + nickstire).
    host: "github-only",
    branch: null,
    productionUrl: null,
    status: "archived",
    monitored: false,
    nickWriteAccess: "none",
    nextAction: "None — archived on GitHub 2026-05-22",
  },

  // ═══ DESKTOP LAYER ═══
  {
    name: "nour-os-unified",
    fullName: "nourdean22/nour-os-unified",
    ring: "desktop",
    tier: "active-support",
    purpose:
      "Windows local agent · device bridge + heartbeat + local file watch + scheduled tasks. Communicates with statenour-os via /api/devices and /api/runner.",
    // 2026-07-25 lifecycle sync — GitHub marked this repo ARCHIVED on
    // 2026-05-22 (verified via `gh repo list`); the manifest still said
    // active/monitored with a heartbeat next-action pointing at the
    // deleted /system/devices page.
    host: "local-windows",
    branch: "main",
    productionUrl: null,
    status: "archived",
    monitored: false,
    nickWriteAccess: "none",
    nextAction: "None — archived on GitHub 2026-05-22",
  },

  // ═══ ARCHIVED / DEAD ═══
  {
    name: "NICKS-TIRE-NEW-GITHUB",
    fullName: "nourdean22/NICKS-TIRE-NEW-GITHUB",
    ring: "archive",
    tier: "archive",
    purpose:
      "Pre-MAINnicks-tire-autoNEW iteration. Replaced by the current main repo; kept for reference only.",
    host: "github-only",
    branch: null,
    productionUrl: null,
    status: "archived",
    monitored: false,
    nickWriteAccess: "none",
    nextAction: "Archive on GitHub (mark read-only)",
  },
  {
    name: "nour-os-bootstrap",
    fullName: "nourdean22/nour-os-bootstrap",
    ring: "archive",
    tier: "archive",
    purpose:
      "Earliest scaffolding for the personal OS. Subsumed by statenour-os; no longer references in production.",
    host: "github-only",
    branch: null,
    productionUrl: null,
    status: "dead",
    monitored: false,
    nickWriteAccess: "none",
    nextAction: "Delete or archive",
  },
];

/** Convenience: only the actively-monitored repos. */
export const MONITORED_REPOS: RepoEntry[] = REPOS.filter((r) => r.monitored);

/** Convenience: repos in the business ring. */
export const BUSINESS_REPOS: RepoEntry[] = REPOS.filter(
  (r) => r.ring === "business",
);

/** Convenience: repos in the personal ring. */
export const PERSONAL_REPOS: RepoEntry[] = REPOS.filter(
  (r) => r.ring === "personal",
);

/** Total count for telemetry / RECONCILIATION verification. */
export const REPO_COUNT = REPOS.length;
