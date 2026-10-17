import type { PageContextPayload } from "@/components/chat/page-context-bridge";

/** The fields of the bridge's payload that travel in the chat request body (the server's GatePass names). */
export const PAGE_ANCHOR_KEYS = [
  "lastTaskId",
  "lastGoalId",
  "lastJournalEntryId",
  "lastDecisionId",
  "lastPinId",
  "lastReflectionId",
  "lastMissionId",
  // 2026-08-12 · the source page's route — the server has consumed
  // body.contextRoute (route hint + TOOL_BIAS) since Wave 30, but no
  // text-chat client ever sent it. The bridge now stores it per page.
  "contextRoute",
] as const;

export type PageAnchors = Partial<Record<(typeof PAGE_ANCHOR_KEYS)[number], string>>;

/**
 * W3b: what this turn sends and what the chip above the composer shows. Page context used to be
 * attached silently and always; the chip makes it visible and its x detaches it for this turn
 * (nothing is written on the server: the anchors are simply left out of the body).
 */
export function pageContextForTurn(
  ctx: PageContextPayload | null,
  detached: boolean,
): { anchors: PageAnchors; chip: { route: string } | null } {
  if (!ctx || detached) return { anchors: {}, chip: null };
  const anchors: PageAnchors = {};
  for (const key of PAGE_ANCHOR_KEYS) {
    const value = ctx[key];
    if (value) anchors[key] = value;
  }
  return { anchors, chip: ctx.contextRoute ? { route: ctx.contextRoute } : null };
}
