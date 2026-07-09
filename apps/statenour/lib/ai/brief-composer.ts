/**
 * Shared brief composer · AG-40 (2026-07-09)
 *
 * Ten+ summary surfaces each hand-rolled the same ~200-line pattern:
 * BrainMemory cache-read by date key → tracedAiChat with an inline
 * system prompt → trim → cache-write. Copy-paste drift was the result
 * (the intelligence daily brief's compose step was duplicated verbatim
 * in its manual route; only conversation-compress scrubbed <think>
 * tags; grounding rules were inconsistent).
 *
 * composeBrief owns the shared mechanics; each route keeps ONLY its
 * auth + signal gathering + system prompt. Response shapes stay
 * byte-identical ({ brief }) so UI consumers need no changes.
 *
 * The universal grounding footer is appended to every system prompt —
 * the same rule AG-02 added to the intelligence brief after it was
 * caught inventing competitor prices for sections its data never fed.
 */

import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/brief-composer");

export const GROUNDING_FOOTER = `
GROUNDING (absolute): every number, name, and claim MUST come verbatim from the signals above. If a signal block is empty or unavailable, say exactly what is missing — never invent data around it.`;

export interface ComposeBriefArgs {
  /** Trace label (tracedAiChat) + log surface, e.g. "journal-brief". */
  label: string;
  /** BrainMemory cache category (use BRAIN_CATEGORIES constants). */
  cacheCategory: string;
  /** Cache key — usually `<YYYY-MM-DD>` or `<YYYY-MM-DD>:v2` (version
   *  suffixes invalidate stale same-day briefs on format changes). */
  cacheKey: string;
  /** The brief's own voice/format rules. The grounding footer is
   *  appended automatically. */
  systemPrompt: string;
  /** Gathered signals — the ONLY data the model may draw from. */
  signalBlock: string;
  /** tracedAiChat task type (default "reason"). */
  taskType?: string;
  /** Hard cap on the returned brief (default 800 chars). */
  maxChars?: number;
  /** Skip the cache entirely (compose-fresh callers). */
  bypassCache?: boolean;
}

/** Strip <think>…</think> scratchpads some providers leak into output.
 *  Previously only conversation-compress did this — every other brief
 *  surface could cache a scratchpad. */
export function scrubThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function composeBrief(args: ComposeBriefArgs): Promise<string> {
  const taskType = args.taskType ?? "reason";
  const maxChars = args.maxChars ?? 800;

  // 1 · cache read (best-effort — a failed read composes fresh).
  if (!args.bypassCache) {
    try {
      const cached = await prisma.brainMemory.findFirst({
        where: { category: args.cacheCategory, key: args.cacheKey },
        select: { content: true },
      });
      if (cached?.content) return cached.content;
    } catch (err) {
      log.warn("cache_read_failed", {
        label: args.label,
        err: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    }
  }

  // 2 · compose.
  let brief = "";
  try {
    const result = await tracedAiChat(
      { label: args.label, source: "tool" },
      [
        { role: "system", content: `${args.systemPrompt}\n${GROUNDING_FOOTER}` },
        { role: "user", content: args.signalBlock },
      ],
      taskType as never,
    );
    brief = scrubThinkTags(result.content ?? "");
    if (brief.length > maxChars) brief = brief.slice(0, maxChars);
  } catch (err) {
    log.warn("compose_failed", {
      label: args.label,
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return "";
  }
  if (!brief) return "";

  // 3 · cache write (idempotent per key; best-effort).
  if (!args.bypassCache) {
    try {
      const existing = await prisma.brainMemory.findFirst({
        where: { category: args.cacheCategory, key: args.cacheKey },
        select: { id: true },
      });
      const payload = {
        content: brief,
        confidence: 0.9,
        source: `tool:${args.label}`,
        createdBy: "ai" as const,
        metadata: { generatedAt: new Date().toISOString() } as never,
      };
      if (existing) {
        await prisma.brainMemory.update({
          where: { id: existing.id },
          data: { ...payload, lastSeen: new Date() },
        });
      } else {
        await prisma.brainMemory.create({
          data: { category: args.cacheCategory, key: args.cacheKey, ...payload },
        });
      }
    } catch (err) {
      log.warn("cache_write_failed", {
        label: args.label,
        err: err instanceof Error ? err.message.slice(0, 160) : String(err),
      });
    }
  }

  return brief;
}

/** Today's date in the operator's timezone — the family's standard
 *  cache-key base. */
export function briefDateKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
