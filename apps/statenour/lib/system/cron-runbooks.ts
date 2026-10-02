/**
 * Cron -> runbook map. Ported from the deleted components/settings/
 * cron-control-panel.tsx (full-circle wave 2, 2026-10-02) so the one
 * affordance Settings had that /system/crons lacked survives on the surface
 * that owns crons. Keys are config/crons.ts names; values are files under
 * apps/statenour/docs/runbooks/ (pnpm check:runbooks keeps that folder's
 * index honest; this map is pinned by tests/lib/system/cron-runbooks.test.ts
 * against the files that actually exist).
 */
export const CRON_RUNBOOKS: Readonly<Record<string, string>> = {
  "embed-backfill": "hf-embeddings-cutover.md",
  mega: "statenour-current-truth.md",
  "mega-evening": "statenour-current-truth.md",
  "dossier-autodraft": "action-honesty-and-receipts.md",
  "nick-action-proposal": "action-honesty-and-receipts.md",
  "nick-action-execute": "action-honesty-and-receipts.md",
  "data-cleanup": "statenour-migrations-and-deploys.md",
  "stale-tasks": "stale-doc-cleanup.md",
  "goal-drift-detector": "task-classifier-domain-missions.md",
  "conversation-mission-link": "task-classifier-domain-missions.md",
  "mastery-xp": "memory-evals.md",
};

const REPO_DOCS = "https://github.com/nourdean22/MAINnicks-tire-autoNEW/blob/main/apps/statenour/docs";

/** The runbook link for a cron, or null when none is mapped (the UI then shows no link, not a guessed one). */
export function cronRunbookHref(jobName: string): string | null {
  const file = CRON_RUNBOOKS[jobName];
  return file ? `${REPO_DOCS}/runbooks/${file}` : null;
}
