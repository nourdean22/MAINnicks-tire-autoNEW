/**
 * lib/services/recall-inbox.ts · Wave W Phase 4 (2026-05-24).
 *
 * Single aggregator that fuses the four "needs your attention"
 * surfaces operator currently checks across 3 separate pages:
 *
 *   1. Pinned memories          → via listPins() (lib/services/pins.ts)
 *   2. Unreviewed link-review   → semantic-edge proposals
 *      candidates                 (BrainMemory category=link_review · status=pending)
 *   3. Unresolved contradictions→ via loadRecentContradictions()
 *                                  (lib/brain/contradiction-surfacer.ts)
 *   4. Active alerts             → drift/persona/stagnation alerts
 *                                  (BrainMemory category=active_alert · unacknowledged)
 *
 * Pre-Wave-W these lived behind 3 separate /brain sub-pages. Wave V's
 * agents flagged this as "the four sources each have one client today.
 * None is checked daily because each is a separate URL. Single inbox =
 * daily ritual = the suggestion-loop finally gets the supervised signal
 * volume it was built for."
 *
 * This service mirrors `lib/services/system-hub.ts`:
 *   · Parallel reads via Promise.allSettled (each source isolated)
 *   · safeQuery wrapper · helper failure degrades to 0 items + an
 *     error string (UI can show "couldn't load contradictions"
 *     without breaking the whole inbox)
 *   · Top-3 items per source · operator can drill into the source
 *     page for the full list
 *
 * Wave M discipline · every reader wrapped in try/catch + logger.warn
 * · degrade-to-empty fallback per source.
 */

import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";

const log = rootLogger.withSurface("services/recall-inbox");

export interface RecallItem {
  /** Stable id for React keys + click-to-source navigation. */
  id: string;
  /** Short text the operator sees in the inbox row. */
  preview: string;
  /** Optional metadata · source-specific. */
  meta?: string | null;
  /** Optional timestamp · ISO · drives the "Nd ago" tail. */
  at?: string | null;
}

export interface RecallInbox {
  /** Top-3 pins · sticky in the operator's mental model. */
  pins: { items: RecallItem[]; total: number; error: string | null };
  /** Top-3 link-review candidates awaiting decision. */
  linkReview: { items: RecallItem[]; total: number; error: string | null };
  /** Top-3 unresolved contradictions. */
  contradictions: {
    items: RecallItem[];
    total: number;
    error: string | null;
  };
  /** Top-3 active alerts. */
  alerts: { items: RecallItem[]; total: number; error: string | null };
  /** Overall count for the inbox header badge. */
  totalCount: number;
  /** ISO timestamp the bag was assembled. */
  generatedAt: string;
}

const EMPTY_BUCKET = {
  items: [] as RecallItem[],
  total: 0,
  error: null as string | null,
} as const;

function clipPreview(s: string | null | undefined, max = 140): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function readPins(): Promise<RecallInbox["pins"]> {
  try {
    const { listPins } = await import("@/lib/services/pins");
    const result = (await listPins()) as {
      pins?: Array<{
        id: string;
        content: string;
        source?: string | null;
        updatedAt?: Date | string;
      }>;
      count?: number;
    };
    const pins = result.pins ?? [];
    return {
      items: pins.slice(0, 3).map((p) => ({
        id: p.id,
        preview: clipPreview(p.content),
        meta: p.source ?? null,
        at:
          p.updatedAt instanceof Date
            ? p.updatedAt.toISOString()
            : (p.updatedAt as string | null) ?? null,
      })),
      total: result.count ?? pins.length,
      error: null,
    };
  } catch (err) {
    log.warn("recall_inbox_pins_failed", { error: sanitizeError(err) });
    return { ...EMPTY_BUCKET, error: "pins_read_failed" };
  }
}

async function readLinkReview(): Promise<RecallInbox["linkReview"]> {
  try {
    const { listLinkCandidates } = await import(
      "@/lib/services/link-review"
    );
    const { candidates, count } = await listLinkCandidates();
    return {
      items: candidates.slice(0, 3).map((c) => ({
        id: c.id,
        preview: clipPreview(
          c.conversationTitle && c.missionTitle
            ? `${c.conversationTitle} ↔ ${c.missionTitle}`
            : c.pinnedSummary ?? "(untitled candidate)",
        ),
        meta:
          typeof c.similarity === "number"
            ? `${Math.round(c.similarity * 100)}% similarity`
            : null,
        at: c.lastSeen.toISOString(),
      })),
      total: count,
      error: null,
    };
  } catch (err) {
    log.warn("recall_inbox_link_review_failed", { error: sanitizeError(err) });
    return { ...EMPTY_BUCKET, error: "link_review_read_failed" };
  }
}

async function readContradictions(): Promise<RecallInbox["contradictions"]> {
  try {
    const { loadRecentContradictions } = await import(
      "@/lib/brain/contradiction-surfacer"
    );
    const all = await loadRecentContradictions(30, false); // unresolved only
    return {
      items: all.slice(0, 3).map((c) => ({
        id: c.key,
        preview: clipPreview(c.new_excerpt),
        meta: `${c.signal} · ${c.days_apart}d apart`,
        at: c.surfaced_at,
      })),
      total: all.length,
      error: null,
    };
  } catch (err) {
    log.warn("recall_inbox_contradictions_failed", {
      error: sanitizeError(err),
    });
    return { ...EMPTY_BUCKET, error: "contradictions_read_failed" };
  }
}

async function readAlerts(): Promise<RecallInbox["alerts"]> {
  try {
    const { buildActiveAlerts } = await import(
      "@/lib/services/brain-domain"
    );
    // 14d window · top-10 per alert category · we flatten across
    // categories then take top-3 by recency in the inbox.
    const view = await buildActiveAlerts({ limit: 10, sinceDays: 14 });
    const flat: Array<{
      id: string;
      category: string;
      content: string;
      createdAt: string;
    }> = [];
    for (const cat of Object.keys(view.alerts)) {
      for (const row of view.alerts[cat] ?? []) {
        flat.push({
          id: row.id,
          category: row.category,
          content: row.content,
          createdAt: row.createdAt,
        });
      }
    }
    flat.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      items: flat.slice(0, 3).map((a) => ({
        id: a.id,
        preview: clipPreview(a.content),
        meta: a.category,
        at: a.createdAt,
      })),
      total: flat.length,
      error: null,
    };
  } catch (err) {
    log.warn("recall_inbox_alerts_failed", { error: sanitizeError(err) });
    return { ...EMPTY_BUCKET, error: "alerts_read_failed" };
  }
}

/**
 * Build the unified recall inbox. Parallel reads · per-source error
 * isolation · stable shape · degrades to all-empty on catastrophic
 * failure (the wrapping consumer always gets a usable object · never
 * throws to React).
 */
export async function buildRecallInbox(): Promise<RecallInbox> {
  const [pins, linkReview, contradictions, alerts] = await Promise.all([
    readPins(),
    readLinkReview(),
    readContradictions(),
    readAlerts(),
  ]);
  return {
    pins,
    linkReview,
    contradictions,
    alerts,
    totalCount:
      pins.total + linkReview.total + contradictions.total + alerts.total,
    generatedAt: new Date().toISOString(),
  };
}
