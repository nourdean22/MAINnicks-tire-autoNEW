/**
 * Pure helpers that pluck per-message metadata out of an assistant
 * message's persisted `tokenUsage` blob (or the in-memory live-stream
 * cache where applicable). Used by /chat to feed the various badge /
 * pill / footer surfaces.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · these four
 * pure functions sat at the bottom of the page. Moving them out of
 * the client component file lets the unit tests import them without
 * having to mount the page, and keeps the page focused on render +
 * state orchestration.
 */

import type { ContextBlocks } from "@/components/chat/context-block-badges";
import type { QualityPayload } from "@/components/chat/quality-bar";

/**
 * extractContextBlocks — pulls the per-turn brain-block fire flags
 * out of the assistant message's tokenUsage (persisted messages) or
 * the in-memory live-stream cache (current streaming message).
 */
export function extractContextBlocks(
  msg: { tokenUsage?: unknown; role?: string },
  liveCache: ContextBlocks | null,
): ContextBlocks | undefined {
  if (msg.role !== "assistant") return undefined;
  const tu = msg.tokenUsage as { contextBlocks?: ContextBlocks } | undefined;
  if (tu?.contextBlocks) return tu.contextBlocks;
  if (liveCache) return liveCache;
  return undefined;
}

/**
 * extractQuality — pulls critic + gate + factCheck out of a saved
 * assistant message's tokenUsage blob for rendering in QualityBar.
 */
export function extractQuality(msg: { tokenUsage?: unknown; role?: string }): QualityPayload | undefined {
  if (msg.role !== "assistant") return undefined;
  const tu = msg.tokenUsage as {
    critic?: QualityPayload["critic"];
    gate?: QualityPayload["gate"];
    factCheck?: QualityPayload["factCheck"];
    truth?: QualityPayload["truth"];
    receipt?: QualityPayload["receipt"];
  } | undefined;
  if (!tu) return undefined;
  if (!tu.critic && !tu.gate && !tu.factCheck && !tu.truth && !tu.receipt) return undefined;
  return {
    critic: tu.critic,
    gate: tu.gate,
    factCheck: tu.factCheck,
    truth: tu.truth,
    receipt: tu.receipt,
  };
}

/**
 * v6 · extractModel — pulls the provider/model that generated this turn
 * out of the persisted tokenUsage blob so the model badge can render in
 * history view. Live-streaming messages don't have it until the server
 * onFinish writes the blob.
 */
export function extractModel(msg: { tokenUsage?: unknown; role?: string; model?: string | null }): string | null {
  if (msg.role !== "assistant") return null;
  // 1. Direct model field (set on chat_messages row at insert time)
  if (msg.model && typeof msg.model === "string") return msg.model;
  // 2. Persisted tokenUsage.model (richer, includes provider context)
  const tu = msg.tokenUsage as { model?: string; provider?: string } | undefined;
  if (tu?.model && typeof tu.model === "string") return tu.model;
  return null;
}

/**
 * extractCitations — pulls [brain:X] citation anchors out of tokenUsage.
 */
export function extractCitations(
  msg: { tokenUsage?: unknown; role?: string },
): Array<{ raw: string; category: string; detail?: string; start?: number; end?: number }> | undefined {
  if (msg.role !== "assistant") return undefined;
  const tu = msg.tokenUsage as {
    citations?: Array<{ raw: string; category: string; detail?: string; start?: number; end?: number }>;
  } | undefined;
  return tu?.citations;
}
