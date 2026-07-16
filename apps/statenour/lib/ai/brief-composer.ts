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

/** aiChat NEVER throws on total provider-chain failure — it returns an
 *  "I'm having trouble connecting…" sentinel with provider "emergency"
 *  (lib/ai/provider.ts) that also echoes the first 50 chars of the last
 *  user message (here: the signal block). Caching that as a brief
 *  poisons the surface for the whole day AND leaks internal context
 *  into the UI — seen live on /journal 2026-07-15. */
export function isProviderSentinel(text: string): boolean {
  return /^I'm having trouble connecting to my AI providers/i.test(text.trim());
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
      // A cached sentinel (pre-guard rows) is a poisoned entry, not a
      // brief — treat as a miss so the next successful compose
      // overwrites it in step 3 (self-heal, no manual purge needed).
      if (cached?.content && isProviderSentinel(cached.content)) {
        log.warn("cache_poisoned_sentinel", { label: args.label, key: args.cacheKey });
      } else if (cached?.content) {
        return cached.content;
      }
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
    // Total provider-chain failure comes back as a RESULT, not a throw
    // — refuse it before it can be returned or cached. Content check is
    // belt-and-braces for callers whose mocks/paths drop the provider
    // field.
    if (result.provider === "emergency" || result.provider === "none") {
      log.warn("compose_provider_failed", { label: args.label, provider: result.provider });
      return "";
    }
    brief = scrubThinkTags(result.content ?? "");
    if (isProviderSentinel(brief)) {
      log.warn("compose_sentinel_content", { label: args.label });
      return "";
    }
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
