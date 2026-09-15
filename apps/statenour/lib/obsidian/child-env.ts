/**
 * lib/obsidian/child-env.ts · 2026-09-15
 *
 * `lib/ai/budget.ts` imports "server-only" deliberately: it pulls prisma, and
 * without that guard a transitive client import would drag @next/env -> fs into
 * the client bundle and break `next build` (see the comment at budget.ts:1-7).
 * Under Next the import is aliased away. Under plain `tsx` it resolves to the
 * package's index.js, which throws unconditionally.
 *
 * The obsidian engine's scripts reach budget.ts transitively:
 *   ingest-obsidian-candidates -> knowledge/candidate-store
 *     -> brain/memory-manager -> brain/embedding-utils -> ai/provider -> ai/budget
 * so `pnpm obsidian:ingest` exited 1 on every run from 2026-09-09 to 2026-09-15
 * while scripts/graphify-obsidian-sync.ps1 still logged
 * `=== sync done (labels: LLM) ===`. The vault digests are written by an EARLIER
 * step, so the visible artifacts stayed current and nothing downstream noticed;
 * the only trace was one WARN line above the done line.
 *
 * server-only ships its own escape hatch: its exports map resolves the
 * "react-server" condition to an empty module. Adding that condition to the
 * child's NODE_OPTIONS is exactly what Next's RSC layer does, costs no source
 * change to budget.ts, and leaves the client-bundle guard fully intact for
 * `next build`.
 */

/** The resolution condition that maps `server-only` to its empty module. */
export const SERVER_ONLY_CONDITION = "--conditions=react-server";

/**
 * Child env for a `tsx` script that imports server-side app modules.
 *
 * Appends to NODE_OPTIONS rather than replacing it, so an operator's existing
 * flags (--max-old-space-size, an inspector port) survive; re-applying is a
 * no-op so a nested spawn cannot accumulate duplicates.
 */
export function withServerOnlyShim(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const existing = env.NODE_OPTIONS?.trim();
  if (existing?.includes(SERVER_ONLY_CONDITION)) return { ...env };
  return {
    ...env,
    NODE_OPTIONS: existing ? `${existing} ${SERVER_ONLY_CONDITION}` : SERVER_ONLY_CONDITION,
  };
}
