"use client";

/**
 * /relationships — Power Atlas surface (Phase 1 daily-driver).
 *
 * Pre-Phase-1 this was a flat list. Phase 1 extends it into the canonical
 * Power Atlas bento: the existing roll-up + sorted person list still
 * anchors the top (operator's familiar entry point); below it, a
 * selectable detail panel surfaces the dossier · ledger · Greene laws ·
 * power balance · log/blow-up actions.
 *
 * Aesthetic per spec section "Aesthetic · minimalist-UI inside statenour
 * dark/gold": serif page title (via font-serif utility) · monospace
 * amounts · 1px borders rgba(255,255,255,0.06) · 8-12px radii · NO
 * emojis on the new bento components · quiet motion (mount fade via
 * page-fade-in on StandardPage).
 *
 * NOTE: existing list rows preserve their original Lucide-free styling
 * to avoid scope creep · ONLY the new power-atlas components follow the
 * Phosphor/Radix mandate (and those use zero icons in v1, text glyphs
 * only). This matches the executor brief.
 */

import { useState, useEffect, useMemo, useCallback, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

import { NicksRelationshipsBrief } from "@/components/relationships/nicks-relationships-brief";
import { TodaysPicks } from "@/components/relationships/todays-picks";
import {
  RelationshipsWatchlist,
  type WatchlistItem,
} from "@/components/relationships/relationships-watchlist";
import { ContextualGreeneSidebar } from "@/components/relationships/contextual-greene-sidebar";
import { PersonEditDrawer } from "@/components/relationships/person-edit-drawer";
import { useMissionSurfaceTelemetry } from "@/lib/telemetry/mission-surface";

import DossierEditor from "@/components/power-atlas/DossierEditor";
import LedgerTimeline from "@/components/power-atlas/LedgerTimeline";
import PowerBalanceGauge from "@/components/power-atlas/PowerBalanceGauge";
import BlowUpModal from "@/components/power-atlas/BlowUpModal";
import LogLedgerModal from "@/components/power-atlas/LogLedgerModal";
import AlphaMoments from "@/components/power-atlas/AlphaMoments";
import ArcProjection from "@/components/power-atlas/ArcProjection";
import PowerPlaysModal from "@/components/power-atlas/PowerPlaysModal";
import SocialProof from "@/components/power-atlas/SocialProof";
import ReciprocityCard from "@/components/power-atlas/ReciprocityCard";
import ToneShiftCard from "@/components/power-atlas/ToneShiftCard";
import TopicGoalOverlapCard from "@/components/power-atlas/TopicGoalOverlapCard";
import PowerPlaysHistory from "@/components/power-atlas/PowerPlaysHistory";
import {
  PendingClassificationBanner,
  RelationshipXpChip,
  OpenPromisesPanel,
} from "@/components/power-atlas/PersonInsights";

interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  trustScore: number;
  leverageNotes: string | null;
  lastInteraction: string | null;
  interactionCount: number;
  daysSinceInteraction: number | null;
  isNeglected: boolean;
}

interface PeopleResponse {
  people: PersonRow[];
  totals: {
    total: number;
    neglected: number;
    high_trust: number;
    sparse: number;
  };
  generatedAt: string;
}

type SortKey = "recent" | "trust" | "neglect";
const VALID_SORTS = ["recent", "trust", "neglect"] as const;
const VISIBLE_CAP = 10; // ADHD-adaptation · max 10 above the fold

function trustTone(score: number): { bg: string; text: string } {
  if (score >= 0.7)
    return {
      bg: "bg-emerald-500/[0.08] border-emerald-500/30",
      text: "text-emerald-200",
    };
  if (score >= 0.4)
    return {
      bg: "bg-sky-500/[0.08] border-sky-500/30",
      text: "text-sky-200",
    };
  return { bg: "bg-zinc-500/[0.08] border-zinc-500/30", text: "text-zinc-300" };
}

function relativeTime(daysSince: number | null): string {
  if (daysSince === null) return "—";
  if (daysSince === 0) return "today";
  if (daysSince === 1) return "1d ago";
  if (daysSince < 30) return `${daysSince}d ago`;
  if (daysSince < 365) return `${Math.round(daysSince / 30)}mo ago`;
  return `${Math.round(daysSince / 365)}y ago`;
}

export default function RelationshipsPage() {
  const [sortKey, setSortKey] = useLocalStorageState<SortKey>(
    "relationships:sortKey",
    "recent",
    VALID_SORTS,
  );
  const [showAll, setShowAll] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  // Wave AS · 2026-05-28 · controlled <details> so external CTAs (e.g.
  // RelationshipsWatchlist Link href="/people#person-X") can auto-open
  // the collapsed-by-default browse-all section. Without this, the row
  // anchor sits in display:none and the smooth-scroll silently no-ops.
  const [browseOpen, setBrowseOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logModalDirection, setLogModalDirection] = useState<
    "deposit" | "withdraw"
  >("deposit");
  const [blowUpOpen, setBlowUpOpen] = useState(false);

  // ── Wave AB · Sam-layer state ──
  // Bumped when ledger writes happen · drives the picks refetch so just-
  // logged outreach immediately drops out of "today's picks".
  const [picksRefetchKey, setPicksRefetchKey] = useState(0);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const telemetry = useMissionSurfaceTelemetry("relationships");

  // Wave AB.b · person CRUD drawer · `null` = create mode, string = edit mode.
  const [editPersonOpen, setEditPersonOpen] = useState(false);
  const [editPersonId, setEditPersonId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<
    React.ComponentProps<typeof PersonEditDrawer>["initial"]
  >(undefined);

  // ── 2026-08-09 · the two compound intents this page actually has ──
  //
  // Three pieces of state have to move TOGETHER or the operator sees nothing:
  // `browseOpen` (the browse <details> is collapsed by default, so a row
  // inside it is display:none), `showAll` (rows past VISIBLE_CAP are sliced
  // out entirely), and `selectedPersonId`. Setting any one without the others
  // silently no-ops — that is the failure the hash-anchor comment above
  // describes, and it had been hand-written at SIX call sites, one of which
  // documented itself as "Mirrors the hash-anchor useEffect above" rather
  // than sharing it. Naming the intent removes the duplication and makes the
  // invariant enforceable in one place instead of six.
  //
  // Deliberately NOT a useReducer. The 12 useState calls here are a real
  // consolidation candidate, but the duplication was never the state SHAPE —
  // it was these two unnamed transitions. Two named callbacks fix the actual
  // defect with zero behavior change; rewriting the state model of a
  // 1,002-line page carries regression risk that nothing observed justifies.

  /** Reveal a specific person's row: open browse, lift the cap, select them. */
  const revealPerson = useCallback((personId: string) => {
    setBrowseOpen(true);
    setSelectedPersonId(personId);
    setShowAll(true); // ensure the row isn't past VISIBLE_CAP
  }, []);

  /** Reveal the browse list itself, optionally re-sorted by a stat tile. */
  const revealBrowse = useCallback(
    (sort?: (typeof VALID_SORTS)[number]) => {
      setBrowseOpen(true);
      if (sort) setSortKey(sort);
      setShowAll(true);
    },
    [setSortKey],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/relationships/watchlist", {
          credentials: "include",
        });
        if (!res.ok) throw new Error("watchlist_failed");
        const data = (await res.json()) as { items: WatchlistItem[] };
        if (!cancelled) setWatchlist(data.items ?? []);
      } catch {
        if (!cancelled) setWatchlist([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picksRefetchKey]);

  const { data, loading, error, reload } = usePollingFetch<PeopleResponse>(
    `/api/people?sort=${sortKey}&limit=100`,
    { intervalMs: 5 * 60_000 }, // 5min · people change slowly
  );

  // Wave AS · 2026-05-28 · hash-anchor wiring · when the operator lands
  // on /people#person-X (e.g. from the watchlist Link or any cross-page
  // CTA), open the browse <details>, mark the person selected, and
  // re-scroll once the DOM has the row in flow. The browser's native
  // scroll fires BEFORE the details opens (the element is still
  // display:none at first paint) so we re-trigger after a frame.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    const m = /^#person-([\w-]+)$/.exec(hash);
    if (!m) return;
    const personId = m[1];
    revealPerson(personId);
    // Defer scrollIntoView so the <details> open animation + row render
    // happen first. Two RAF gets us past Suspense boundaries reliably.
    let r1 = 0;
    let r2 = 0;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        const el = document.getElementById(`person-${personId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
    // `revealPerson` is useCallback([]) — stable for the component's life, so
    // listing it satisfies exhaustive-deps without changing when this re-fires.
  }, [data, revealPerson]); // re-fire when data lands · row may not exist on first render

  const visiblePeople = useMemo(() => {
    if (!data) return [];
    return showAll ? data.people : data.people.slice(0, VISIBLE_CAP);
  }, [data, showAll]);

  // Detail query · fires when a person is selected
  const personDetail = trpc.task.personProfile.useQuery(
    { personId: selectedPersonId ?? "" },
    { enabled: !!selectedPersonId },
  );

  // Wave AC.b · 2026-05-28 · operator complaint "no where to just delete
  // people in relationships". The drawer already had a delete button but
  // required Edit → drawer → scroll → tap. Per-row inline delete makes it
  // 2-tap: confirm → delete. Uses the same softDeletePerson mutation
  // (deletedAt set · ledger preserved · revivable). Reload triggers an
  // immediate /api/people refetch which now correctly filters deleted.
  const softDeleteFromRow = trpc.task.softDeletePerson.useMutation();
  // PWA-safe delete confirm. window.confirm() is SILENTLY suppressed in iOS
  // standalone PWAs (the operator's actual environment — manifest display:
  // standalone) — it returns false and the delete never fires. Two-tap inline
  // confirm instead: first tap arms (button → "sure?"), second tap within 4s
  // deletes; auto-disarms so a stray arm doesn't linger.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleRowDelete = (personId: string) => {
    if (softDeleteFromRow.isPending) return;
    if (confirmDeleteId !== personId) {
      setConfirmDeleteId(personId);
      window.setTimeout(
        () => setConfirmDeleteId((cur) => (cur === personId ? null : cur)),
        4000,
      );
      return;
    }
    setConfirmDeleteId(null);
    softDeleteFromRow.mutate(
      { personId },
      {
        onSuccess: () => {
          if (selectedPersonId === personId) setSelectedPersonId(null);
          telemetry.event("deletePersonInline", { personId });
          reload();
        },
      },
    );
  };

  return (
    <StandardPage
      eyebrow="brain · people"
      title="people"
      description="Your Power Atlas — tap a name to open their dossier, ledger, and open promises."
      rhythm="comfortable"
      width="2xl"
      loading={loading && !data}
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditPersonId(null);
              setEditInitial(undefined);
              setEditPersonOpen(true);
              telemetry.event("addPersonOpen");
            }}
            className="text-[11px] font-mono uppercase tracking-[0.15em]"
          >
            + add person
          </Button>
          <FreshnessChip
            lastFetchedAt={data?.generatedAt}
            source="people-intelligence engine"
            onReload={reload}
          />
        </div>
      }
    >
      {/* ═══ Wave AB · Sam-layer header trio ═══════════════════════════
       *  Nick's daily brief → Today's 3 outreach picks → Watchlist.
       *  This is the page now. The dossier surface below collapses by
       *  default · the operator opens it only when researching a
       *  specific person. */}
      <NicksRelationshipsBrief activePeopleCount={data?.totals.total ?? 0} />
      {/* Wave BC · 2026-05-28 · reorder · watchlist gives broad triage
       *  (categorized chips) · picks gives the focused single action.
       *  Pre-BC the obnoxious TodaysPicks cards came FIRST and pushed
       *  the watchlist below the fold. Operator: "it doesnt have to be
       *  the first thing i see". Watchlist now leads · picks follows in
       *  a one-line collapsed eyebrow (TodaysPicks rewritten BC). */}
      <RelationshipsWatchlist
        items={watchlist}
        onSelect={(personId) => {
          telemetry.event("watchlistOpen", { personId });
          revealPerson(personId);
        }}
      />
      <TodaysPicks
        refetchKey={picksRefetchKey}
        onLogged={() => {
          telemetry.event("outreachLogged");
          setPicksRefetchKey((k) => k + 1);
          reload();
        }}
      />

      {/* Roll-up stats · ALWAYS VISIBLE (2026-06-01 de-bulk: lifted out of
       *  the collapsed browse section — these at-a-glance numbers are the
       *  most useful thing on the page, they shouldn't be buried behind a
       *  disclosure). Each tile taps through to the browse list, pre-sorted. */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="people"
            value={data.totals.total}
            tint="text-[var(--text-primary)]"
            onClick={() => revealBrowse()}
          />
          <Stat
            label="neglected"
            value={data.totals.neglected}
            tint={data.totals.neglected > 0 ? "text-amber-300" : "text-zinc-500"}
            onClick={() => revealBrowse("neglect")}
          />
          <Stat
            label="high trust"
            value={data.totals.high_trust}
            tint="text-emerald-300"
            onClick={() => revealBrowse("trust")}
          />
          <Stat
            label="needs info"
            value={data.totals.sparse}
            tint={data.totals.sparse > 5 ? "text-amber-300" : "text-zinc-500"}
            onClick={() => revealBrowse()}
          />
        </div>
      )}

      {/* ═══ The full dossier surface · collapsed by default ═════════
       *  Operator opens this only when researching a specific person.
       *  Pre-Wave-AB this was the page · now it's secondary.
       *  Wave AS · controlled `open` state so external CTAs + hash
       *  anchors can pop the section open when targeting a row inside. */}
      <details
        open={browseOpen}
        onToggle={(e) => setBrowseOpen(e.currentTarget.open)}
        className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]"
      >
        <summary
          aria-label={`Browse all people${data ? `, ${data.totals.total} total` : ""}`}
          className="px-3 py-2.5 cursor-pointer text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] list-none"
        >
          <span aria-hidden="true">▸ </span>browse all people
        </summary>
        <div className="border-t border-[var(--border-default)]/60 p-3 space-y-3">

      {/* Sort + show-all */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
          {sortKey === "neglect"
            ? "needs attention"
            : sortKey === "trust"
              ? "highest trust"
              : "most recent"}
        </h2>
        <SortDropdown
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          ariaLabel="Sort people"
          options={[
            { value: "recent", label: "most recent first" },
            { value: "trust", label: "trust · highest first" },
            { value: "neglect", label: "neglected first" },
          ]}
        />
      </div>

      {/* People list · tap-to-select for in-page detail (no nav) */}
      {data && data.people.length === 0 && !loading && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          No people profiles yet · the people-intelligence engine builds these
          from your chat history. Open a few chat conversations that mention
          specific people, then check back.
        </div>
      )}

      {data && data.people.length > 0 && (
        <div className="grid gap-2">
          {visiblePeople.map((p) => {
            const tone = trustTone(p.trustScore);
            const isSelected = selectedPersonId === p.id;
            return (
              <div
                key={p.id}
                id={`person-${p.id}`}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setSelectedPersonId(isSelected ? null : p.id)
                }
                onKeyDown={(e) => {
                  // Row is a div-as-button so the inner edit/delete buttons
                  // aren't nested inside a <button> (invalid HTML). Keep
                  // keyboard activation parity with the old <button>.
                  if (
                    (e.key === "Enter" || e.key === " ") &&
                    e.target === e.currentTarget
                  ) {
                    e.preventDefault();
                    setSelectedPersonId(isSelected ? null : p.id);
                  }
                }}
                // Wave AS · 2026-05-28 · row anchor · RelationshipsWatchlist
                // (and any external CTA) points at #person-<id> · smooth-
                // scroll lands on the right row · scroll-mt-24 honors the
                // sticky header. Matches MissionCard + GoalBoard pattern
                // from Wave AR.
                className={cn(
                  "block w-full text-left rounded-lg border p-3 transition-all hover:scale-[1.005] active:scale-[0.99] scroll-mt-24 cursor-pointer",
                  tone.bg,
                  isSelected && "ring-1 ring-[var(--gold)]/50",
                )}
                aria-expanded={isSelected}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-semibold truncate",
                          tone.text,
                        )}
                      >
                        {p.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                        {p.role}
                      </span>
                      {p.isNeglected && (
                        <Badge className="h-auto rounded px-1.5 py-0.5 bg-transparent border-amber-500/30 text-amber-300 text-[10px] font-normal uppercase tracking-wider">
                          neglected
                        </Badge>
                      )}
                      {/* wave-AB.b · per-row Edit affordance · stopPropagation
                       *  so the outer expand toggle doesn't fire on tap. */}
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`edit ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditPersonId(p.id);
                          setEditInitial({
                            name: p.name,
                            role: p.role,
                            relationship: p.relationship || "",
                            leverageNotes: p.leverageNotes,
                            birthday: null,
                            anniversary: null,
                            cadenceDays: null,
                            phone: null,
                            email: null,
                          });
                          setEditPersonOpen(true);
                          telemetry.event("editPersonOpen", { personId: p.id });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            setEditPersonId(p.id);
                            setEditInitial({
                              name: p.name,
                              role: p.role,
                              relationship: p.relationship || "",
                              leverageNotes: p.leverageNotes,
                              birthday: null,
                              anniversary: null,
                              cadenceDays: null,
                              phone: null,
                              email: null,
                            });
                            setEditPersonOpen(true);
                          }
                        }}
                        // wave-AB.d-mobile · sub-44pt text-only link was
                        // unhittable on phones · padded out to 44pt
                        // minimum + active scale tap feedback.
                        className="ml-auto inline-flex min-h-[44px] items-center px-3 -my-1 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)] active:scale-95 transition-transform cursor-pointer"
                      >
                        edit
                      </span>
                      {/* Wave AC.b · operator complaint "no where to just
                       *  delete people". Per-row inline delete · 44pt tap
                       *  target · confirm dialog protects against fat-finger.
                       *  Uses softDeletePerson · revivable. */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowDelete(p.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            handleRowDelete(p.id);
                          }
                        }}
                        aria-label={
                          confirmDeleteId === p.id
                            ? `confirm delete ${p.name}`
                            : `delete ${p.name}`
                        }
                        className={cn(
                          "inline-flex min-h-[44px] items-center px-3 -my-1 text-[11px] uppercase tracking-wider active:scale-95 transition-transform cursor-pointer disabled:opacity-50",
                          confirmDeleteId === p.id
                            ? "text-rose-300 font-semibold"
                            : "text-rose-300/70 hover:text-rose-300",
                        )}
                      >
                        {confirmDeleteId === p.id ? "sure?" : "delete"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                      {p.relationship || "no relationship notes"}
                    </p>
                    {p.leverageNotes && (
                      <p className="mt-1 text-[11px] italic text-[var(--text-tertiary)] line-clamp-1">
                        leverage: {p.leverageNotes}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      trust
                    </div>
                    <div
                      className={cn(
                        "text-lg font-mono font-bold tabular-nums",
                        tone.text,
                      )}
                    >
                      {Math.round(p.trustScore * 100)}
                    </div>
                    {/* Tier in text, not color alone (WCAG 1.4.1) — also a
                        faster at-a-glance read for the operator. */}
                    <div className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      {p.trustScore >= 0.7
                        ? "high"
                        : p.trustScore >= 0.4
                          ? "mid"
                          : "low"}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                      {relativeTime(p.daysSinceInteraction)} ·{" "}
                      {p.interactionCount}×
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {data.people.length > VISIBLE_CAP && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="text-xs text-[var(--text-tertiary)] hover:text-[var(--gold)] py-2 transition-colors"
            >
              {showAll
                ? `show fewer (cap ${VISIBLE_CAP})`
                : `show ${data.people.length - VISIBLE_CAP} more`}
            </button>
          )}
        </div>
      )}

      {/* Initial load → StandardPage `loading` slot renders <PageSkeleton>;
          the old inline "loading people…" was unreachable under the same
          `loading && !data` guard, so it was removed. */}
      {error && !data && (
        <div className="text-sm text-rose-300">
          people-intelligence unavailable · tap reload
        </div>
      )}

      {/* ─── Detail panel · bento layout ─── */}
      {selectedPersonId && (
        <div className="pt-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          {personDetail.isLoading && (
            <div className="text-sm text-[var(--text-tertiary)]">
              loading dossier…
            </div>
          )}
          {personDetail.error && (
            <div className="text-sm text-rose-300">
              {personDetail.error.message}
            </div>
          )}
          {personDetail.data === null && !personDetail.isLoading && (
            <div className="text-sm text-amber-300">
              Person not found · the profile may have been deleted. Pick another row above.
            </div>
          )}
          {personDetail.data && personDetail.data.person && (
            <DetailPanelErrorBoundary>
              <DetailPanel
                detail={personDetail.data}
                onOpenLog={(direction) => {
                  setLogModalDirection(direction);
                  setLogModalOpen(true);
                }}
                onOpenBlowUp={() => setBlowUpOpen(true)}
                onResolved={reload}
              />
            </DetailPanelErrorBoundary>
          )}

          {/* Modals */}
          {personDetail.data?.person && (
            <>
              <LogLedgerModal
                personId={personDetail.data.person.id}
                personName={personDetail.data.person.name}
                open={logModalOpen}
                onOpenChange={setLogModalOpen}
                initialDirection={logModalDirection}
              />
              <BlowUpModal
                personId={personDetail.data.person.id}
                personName={personDetail.data.person.name}
                open={blowUpOpen}
                onOpenChange={setBlowUpOpen}
              />
            </>
          )}
        </div>
      )}

      {/* ═══ Wave AB · close the collapsible "browse all" wrapper ═══════ */}
        </div>
      </details>

      {/* ═══ Wave AB.b · person CRUD drawer · mounted at page root so it
       *   floats above all content · operates in CREATE mode when
       *   editPersonId is null. The `key` prop forces a remount when
       *   the target person changes so useState initializers in the
       *   drawer body re-seed with fresh `initial` props (avoids the
       *   setState-in-effect anti-pattern). */}
      <PersonEditDrawer
        key={editPersonId ?? "new"}
        open={editPersonOpen}
        onClose={() => setEditPersonOpen(false)}
        personId={editPersonId}
        initial={editInitial}
        onSaved={() => {
          setEditPersonOpen(false);
          void reload();
        }}
      />
    </StandardPage>
  );
}

interface DetailPanelData {
  person: {
    id: string;
    name: string;
    role: string;
    status: string;
    dossierMd: string | null;
    dossierUpdatedAt: Date | string | null;
    powerBalance: number;
    powerBalanceManualLock: boolean;
    blowUpReason: string | null;
    blownUpAt: Date | string | null;
    lastArcPlan: unknown;
    metadata: unknown;
    pendingClassification: unknown;
  };
  ledger: Array<{
    id: string;
    createdAt: Date | string;
    amount: number;
    note: string;
    source: string;
  }>;
  plays: Array<{
    id: string;
    createdAt: Date | string;
    kind: string;
    output: unknown;
    outcome: string | null;
    outcomeNote: string | null;
  }>;
  applicableLawTexts: Array<{ key: string; content: string }>;
  openTasks: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: Date | string | null;
    loopKind: string;
    promiseTo: string | null;
  }>;
  xp: { total: number; count: number; byStat: Record<string, number> };
}

function DetailPanel({
  detail,
  onOpenLog,
  onOpenBlowUp,
  onResolved,
}: {
  detail: DetailPanelData;
  onOpenLog: (direction: "deposit" | "withdraw") => void;
  onOpenBlowUp: () => void;
  onResolved: () => void;
}) {
  const { person, ledger, plays, openTasks, xp } = detail;
  const blownUp = person.status === "blown_up";
  const utils = trpc.useUtils();
  const updatePowerBalance = trpc.task.updatePowerBalance.useMutation({
    onSuccess: () => {
      void utils.task.personProfile.invalidate({ personId: person.id });
    },
  });

  return (
    <div className="space-y-4">
      {/* Suggest-then-approve · the AI's proposal waits here for the
       *  operator instead of silently overwriting role/notes/trust. */}
      <PendingClassificationBanner
        personId={person.id}
        pending={person.pendingClassification}
        onResolved={onResolved}
      />

      {/* Header strip · name · earned-XP chip · status */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-serif text-2xl tracking-tight text-[var(--text-primary)]">
            {person.name}
          </h2>
          <RelationshipXpChip xp={xp} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            status
          </span>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border",
              blownUp
                ? "border-rose-500/40 text-rose-300 bg-rose-500/[0.08]"
                : person.status === "active"
                  ? "border-emerald-500/30 text-emerald-200 bg-emerald-500/[0.05]"
                  : "border-zinc-500/30 text-zinc-300 bg-zinc-500/[0.05]",
            )}
          >
            {person.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {blownUp && person.blowUpReason && (
        <div
          className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-xs text-rose-200"
        >
          <span className="uppercase tracking-wider text-[10px] mr-2">
            blow-up reason:
          </span>
          {person.blowUpReason}
        </div>
      )}

      {/* Bento grid · 3-col desktop, 1-col mobile · dossier 2/3 + sidebar 1/3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <DossierEditor
            personId={person.id}
            initialDossier={person.dossierMd}
            dossierUpdatedAt={
              person.dossierUpdatedAt
                ? typeof person.dossierUpdatedAt === "string"
                  ? person.dossierUpdatedAt
                  : person.dossierUpdatedAt.toISOString()
                : null
            }
          />
          <OpenPromisesPanel tasks={openTasks} personName={person.name} />
          <LedgerTimeline
            personId={person.id}
            entries={ledger.map((e) => ({
              id: e.id,
              createdAt: e.createdAt,
              amount: e.amount,
              note: e.note,
              source: e.source,
            }))}
          />
        </div>
        <div className="space-y-4">
          <PowerBalanceGauge
            value={person.powerBalance}
            manualLock={person.powerBalanceManualLock}
            onUpdate={async (next) => {
              await updatePowerBalance.mutateAsync({
                personId: person.id,
                powerBalance: next,
                manualLock: true,
              });
            }}
          />
          {/* Contextual Greene picks · the AI per-day ranked picks. The
           *  legacy STATIC applicableLaws list (GreeneLawSidebar) was
           *  removed — it duplicated this panel's Greene block. */}
          <ContextualGreeneSidebar key={person.id} personId={person.id} />

          {/* Quick actions */}
          <section
            className="rounded-xl border bg-[var(--bg-raised)] p-4 space-y-2"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            <h3 className="font-serif text-base tracking-tight text-[var(--text-primary)] mb-2">
              Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenLog("deposit")}
                disabled={blownUp}
              >
                + deposit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenLog("withdraw")}
                disabled={blownUp}
              >
                − withdraw
              </Button>
            </div>
            <PowerPlaysModal personId={person.id} personName={person.name} />
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={onOpenBlowUp}
              disabled={blownUp}
            >
              {blownUp ? "blown up" : "blow up"}
            </Button>
          </section>
        </div>
      </div>

      {/* ─── Deeper signals · collapsed (2026-06-01 de-bulk) ───
       *  Data-hungry / lower-frequency cards that used to form a wall of
       *  grey empty-states on every profile. Folded behind one disclosure
       *  so the panel above stays focused; they fill in as the brain
       *  accumulates enough data to make them meaningful. */}
      <details className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)]">
        <summary
          aria-label="Deeper signals"
          className="px-3 py-2.5 cursor-pointer text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] list-none"
        >
          <span aria-hidden="true">▸ </span>deeper signals
        </summary>
        <div className="border-t border-[var(--border-default)]/60 p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopicGoalOverlapCard metadata={person.metadata} />
          <PowerPlaysHistory plays={plays} personId={person.id} />
          <ArcProjection
            personId={person.id}
            initialProjection={person.lastArcPlan}
          />
          <ReciprocityCard metadata={person.metadata} />
          <ToneShiftCard metadata={person.metadata} />
          <AlphaMoments personId={person.id} />
          <SocialProof personId={person.id} />
        </div>
      </details>
    </div>
  );
}

/**
 * 2026-05-27 · Power Atlas Phase 3 polish-wave regression guard.
 *
 * The polish-wave (commits 4f03c16c → d55c83a8) added 4 new cards into
 * DetailPanel + new sub-queries inside LedgerTimeline (listAlphaMoments)
 * and PowerPlaysHistory (markPlayOutcome). If ANY of them throws during
 * mount (e.g. a tRPC procedure not yet deployed, or a JSON.stringify on
 * an exotic value, or a tag library version mismatch in prod), the React
 * tree unmounts the whole DetailPanel SILENTLY in production — leaving
 * the operator clicking rows with no panel and no console errors.
 *
 * This boundary turns that silent failure into a visible diagnostic.
 * The boundary is local (not the global one) so the people-list above
 * stays interactive even if the detail panel errors.
 */
class DetailPanelErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the prod console so the operator can copy/paste.
    console.error("[DetailPanel error]", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div
          className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] p-4 text-sm"
        >
          <div className="font-serif text-base text-rose-200 mb-1">
            Detail panel crashed
          </div>
          <p className="text-xs text-rose-200/80">
            {this.state.error.message || "Unknown render error"}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-rose-200/60">
            Pick another person or reload the page · the people list stays usable.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

function Stat({
  label,
  value,
  tint,
  onClick,
}: {
  label: string;
  value: number;
  tint: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className={cn("text-2xl font-bold font-mono tabular-nums", tint)}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
    </>
  );
  const base =
    "rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 text-center";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          base,
          "transition-all hover:border-[var(--gold)]/30 hover:scale-[1.01] active:scale-[0.99] cursor-pointer",
        )}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}
