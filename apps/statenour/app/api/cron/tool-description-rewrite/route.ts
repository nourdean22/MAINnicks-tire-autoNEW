/**
 * GET /api/cron/tool-description-rewrite · 2026-08-13 · BDN-202
 *
 * Nightly (mega-evening fan-out). Drafts description rewrites for the
 * tool-usage census's highFailure bucket — one fast-lane LLM pass per
 * tool over its recent failure evidence, capped at 3 tools/run.
 * DRAFTS ONLY: rows land in BrainMemory(tool_description_draft) for
 * the operator; nothing self-applies (descriptions are code, pinned by
 * two snapshots).
 */

import { cronHandler } from "@/lib/utils/http";
import { runToolDescriptionRewrite } from "@/lib/ai/tool-description-rewrite";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const result = await runToolDescriptionRewrite();
  return { ok: true, ...result };
});
