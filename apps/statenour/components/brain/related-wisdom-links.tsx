"use client";

/**
 * components/brain/related-wisdom-links.tsx · v10.0.409
 *
 * "See also" expander for a wisdom card · click to load the top 5
 * related wisdoms via /api/brain/wisdom/[id]/related (v10.0.402).
 *
 * Click-to-load (NOT auto-load) · prevents N+1 fetches when
 * /brain/wisdom renders 991 cards. Only fires when operator
 * actually wants the graph traversal.
 *
 * Renders compactly · just the related-wisdom keys + similarity ·
 * each links back to /brain?tab=wisdom&focus=<key> so the operator can
 * jump between related wisdoms without leaving the page.
 *
 * Auto-collapses on second click. Errors render as a small note
 * (not a toast) · failures here are non-blocking and the operator
 * may not even notice if their session is fine.
 *
 * 2026-09-02 self-audit closed three defects in this file:
 *   #2 · the empty state hardcoded "no related wisdoms above 0.40
 *        similarity" and threw away the API's `reason`, so a row with
 *        NO EMBEDDING — similarity never computed — read exactly like a
 *        genuinely isolated one. Both floors now come from the response.
 *   #3 · the header above promised deep links; the render was three
 *        <span>s with no <a>, no href and no onClick. The ?focus=<key>
 *        param and its scroll handler already worked
 *        (components/brain/wisdom-tab.tsx:165 + :284) — nothing emitted
 *        a link that used them.
 *   #5 · `ORIGIN_BADGE` here was one of two label registries and was
 *        missing `chat-scrape`, so the same principle read "Chat scrape"
 *        in the main list and "uncategorized" here, on one screen.
 */

import { useState } from "react";
import Link from "next/link";
import { ApiError, rawFetch } from "@/lib/utils/api-fetch";
import { wisdomOriginMeta } from "@/lib/brain/wisdom-origins";

interface RelatedWisdom {
  id: string;
  key: string;
  content: string;
  origin: string;
  similarity: number;
  topics: string[];
  topicLabels: string[];
}

interface RelatedResp {
  related?: RelatedWisdom[];
  cached?: boolean;
  reason?: string;
  /** Both floors ship from the route · see its SIMILARITY_FLOOR comment. */
  similarityFloor?: number;
  poolConfidenceFloor?: number;
}

/** Defaults only for a response from a deploy older than the route change. */
const FALLBACK_SIMILARITY_FLOOR = 0.4;
const FALLBACK_POOL_CONFIDENCE_FLOOR = 0.5;

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The operator-visible sentence for an empty see-also list.
 *
 * Pure and exported so the distinction this fixes is unit-testable: an
 * unembedded anchor MUST NOT be describable as "nothing similar enough".
 */
export function relatedEmptyMessage(
  reason: string | undefined,
  floors: { similarity: number; poolConfidence: number },
): string {
  switch (reason) {
    case "no_embedding_for_anchor":
      return "This wisdom has no embedding yet · similarity was never computed. The embed-backfill cron picks these up.";
    case "anchor_parse_failed":
      return "This wisdom's stored embedding could not be parsed · similarity was never computed.";
    case "empty_pool":
      return `No other wisdom at ${pct(floors.poolConfidence)}+ confidence to compare against.`;
    case "no_match_above_threshold":
      return `No related wisdoms above ${pct(floors.similarity)} similarity, among wisdoms at ${pct(floors.poolConfidence)}+ confidence.`;
    default:
      return "No related wisdoms returned · the API did not say why (expected from a deploy older than 2026-09-02).";
  }
}

/** The deep link this component's header has always promised. */
export function wisdomFocusHref(key: string): string {
  return `/brain?tab=wisdom&focus=${encodeURIComponent(key)}`;
}

/**
 * One see-also row. Exported so the link contract can be asserted on
 * rendered markup — the vitest env here is Node with no DOM, so a row
 * that only appears after an async state change is otherwise untestable.
 */
export function RelatedWisdomRow({ r }: { r: RelatedWisdom }) {
  return (
    <li>
      <Link
        href={wisdomFocusHref(r.key)}
        // The wisdom tab's own ?focus= effect scrolls the card into
        // view, so suppress Next's scroll-to-top or the two fight.
        scroll={false}
        className="flex gap-2 text-[11px] leading-snug rounded px-1 -mx-1 py-1 hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]"
      >
        <span className="font-mono text-[var(--text-tertiary)] text-[9px] w-16 shrink-0 uppercase tracking-wider pt-0.5">
          {wisdomOriginMeta(r.origin).badge}
        </span>
        <span className="text-[var(--text-secondary)] flex-1" style={{ maxWidth: "60ch" }}>
          {r.content.slice(0, 140)}
          {r.content.length > 140 ? "…" : ""}
        </span>
        <span className="font-mono text-[9px] text-[var(--text-tertiary)] tabular-nums shrink-0 pt-0.5" title={`cosine ${r.similarity}`}>
          {(r.similarity * 100).toFixed(0)}%
        </span>
      </Link>
    </li>
  );
}

export function RelatedWisdomLinks({ wisdomId }: { wisdomId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [related, setRelated] = useState<RelatedWisdom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why the list came back empty, and the floors that shaped it. Held
  // as one object so the empty state can never render half a reading.
  const [emptyNote, setEmptyNote] = useState<string | null>(null);

  async function load() {
    if (related) {
      // Already loaded · just toggle
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    // v10.0.415 · telemetry · fire-and-forget so click latency is unchanged
    void fetch("/api/brain/telemetry", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "see_also_click", tags: { wisdomId } }),
    }).catch(() => null);
    try {
      const data = await rawFetch<RelatedResp>(`/api/brain/wisdom/${wisdomId}/related`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const rows = data.related ?? [];
      setRelated(rows);
      setEmptyNote(
        rows.length === 0
          ? relatedEmptyMessage(data.reason, {
              similarity: data.similarityFloor ?? FALLBACK_SIMILARITY_FLOOR,
              poolConfidence: data.poolConfidenceFloor ?? FALLBACK_POOL_CONFIDENCE_FLOOR,
            })
          : null,
      );
      setExpanded(true);
    } catch (err) {
      // `ApiError.message` is already `HTTP <status>` for a failed response, so
      // the operator-visible text is unchanged for the case this used to handle.
      // Envelope drift arrives here too, carrying its own descriptive message
      // instead of being silently rendered as an empty list.
      setError(err instanceof ApiError ? err.message : "network");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!expanded) {
      void load();
    } else {
      setExpanded(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        // v10.0.419 · py-2 on mobile gives a 36-40px tap zone (text + padding);
        // py-0 on desktop keeps it inline-tight. min-w expansion ensures the
        // hit target isn't just the 6 letters of "see also".
        className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors py-2 sm:py-0 px-1 -mx-1"
        aria-expanded={expanded}
      >
        {loading
          ? "loading…"
          : expanded
            ? "hide see-also ↑"
            : "see also →"}
      </button>

      {expanded && error && (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)] italic">
          could not load related wisdoms ({error})
        </p>
      )}

      {expanded && related && related.length === 0 && (
        <p className="mt-2 text-[10px] text-[var(--text-tertiary)] italic">
          {emptyNote}
        </p>
      )}

      {expanded && related && related.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {related.map((r) => (
            <RelatedWisdomRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
