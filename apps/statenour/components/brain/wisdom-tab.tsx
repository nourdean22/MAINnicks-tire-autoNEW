"use client";

/**
 * WisdomTab · the Wisdom section of the merged /brain surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/brain/wisdom/page.tsx — the
 * only changes are: the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /brain), the former StandardPage dynamic
 * `description` (principle/recall counts) moved into an inline subtitle, the
 * former rhythm="loose" section spacing is preserved via a `space-y-5`
 * wrapper, and the Suspense wrapper was dropped (PageTabs already mounts tab
 * content inside its own Suspense boundary, which covers useSearchParams).
 * The error/loading early-returns became fragments. All data hooks, filters,
 * topic tabs, sort, search, inline curation, and the per-origin editorial
 * layout are unchanged.
 *
 * Teaches the operator what's in Nick's wisdom layer · who carries which
 * principles · how often each fires · what tradition each comes from.
 * Pulls from trpc.brain.wisdom (server-trimmed grouping + scoring).
 *
 * URL params (now under /brain?tab=wisdom):
 *   · ?evolution=1     · shows the WisdomEvolutionPanel review surface
 *   · ?focus=<key>     · scrolls to + highlights a specific wisdom card
 */

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
// Phase UU (2026-05-19 AM) · authedFetch replaced by trpc · 3 calls
// (wisdom feed · update · curation actions) flow through typed
// procedures · `brain` is the 8th domain router.
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged, onDataChanged } from "@/lib/events/data-change";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { tagWisdomTopics, topicLabel, type WisdomTopic } from "@/lib/brain/wisdom-topic-tagger";
import { RelatedWisdomLinks } from "@/components/brain/related-wisdom-links";
import { WisdomEvolutionPanel } from "@/components/brain/wisdom-evolution-panel";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface WisdomEntry {
  id: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  origin: string;
  source: string;
  createdAt: string;
  lastSeen: string;
  ageDays: number;
  hotness: number;
}

interface WisdomPayload {
  total: number;
  totalRecalls: number;
  groupings: {
    origin: Record<string, number>;
    source: Record<string, number>;
  };
  hottest: WisdomEntry[];
  freshest: WisdomEntry[];
  entries: WisdomEntry[];
}

// ── Origin metadata · teaching intro per source ────────────────────
//
// Each origin gets a short editorial blurb. This is the "teach me
// always" half of the brief · operator should learn what each tradition
// brings to the brain just by reading the page.
const ORIGIN_META: Record<
  string,
  { label: string; tradition: string; intro: string }
> = {
  "steve-jobs": {
    label: "Steve Jobs",
    tradition: "Design + Leadership",
    intro:
      "Apple cofounder · Pixar CEO · NeXT founder. Editorial discipline applied to product · simplicity as max sophistication, focus as competitive weapon, the keynote as part of the product. Wisdom shape: principles you can act on, not abstractions.",
  },
  satori: {
    label: "Satori",
    tradition: "Psychology + Philosophy",
    intro:
      "Clinically-informed wisdom companion. Internal Family Systems, DBT, Compassion-Focused Therapy, Schema Therapy + Stoicism, Buddhism, Taoism, Sufi heart-knowing, Jungian shadow. Wisdom shape: how to meet your own internal weather.",
  },
  "greene-laws": {
    label: "Robert Greene",
    tradition: "Power + Strategy + Human Nature",
    intro:
      "Promoted from the StrategicLaw library · 189 entries spanning the 48 Laws of Power, 33 Strategies of War, Laws of Human Nature, Mastery, Art of Seduction, and the 50th Law. Each carries the law's essence and an operator-specific application. Wisdom shape: read the room, understand power, anticipate the move that hasn't been made yet.",
  },
  "warren-buffett": {
    label: "Warren Buffett",
    tradition: "Capital allocation",
    intro:
      "Berkshire Hathaway · the patient compounder. Circle of competence, margin of safety, economic moats, no called strikes in life. Wisdom shape: think in decades, not quarters; demand asymmetric upside before you swing.",
  },
  "bill-gates": {
    label: "Bill Gates",
    tradition: "Strategy at scale",
    intro:
      "Microsoft cofounder, systemic philanthropist. Distribution beats innovation, software-defined eats industries, treat each year as a chapter, intuition scales until it doesn't. Wisdom shape: solve at the system level; reserve think-week time before reactive work.",
  },
  "elon-musk": {
    label: "Elon Musk",
    tradition: "First principles + deletion",
    intro:
      "SpaceX · Tesla · the deletion-first engineer. Reason from physics + cost not analogy, make requirements less dumb, the best part is no part, idiot index, ship the v0 ugly. Wisdom shape: question the requirement before optimizing the implementation.",
  },
  distiller: {
    label: "The Distiller",
    tradition: "Cron-distilled principles",
    intro:
      "Daily AI pass over patterns + insights + confirmed predictions + reflections. Synthesizes recurring observations into WHEN/THEN/BECAUSE principles. Highest signal when Nour's pattern stream is rich · weakest when input is thin.",
  },
  consolidation: {
    label: "Consolidation",
    tradition: "Promoted patterns",
    intro:
      "Patterns that hit a confidence + repetition threshold get promoted to wisdom with a [PROVEN PATTERN] tag. The inverse of the distiller — bottom-up evidence rather than top-down synthesis.",
  },
  "chat-scrape": {
    label: "Chat scrape",
    tradition: "Raw assistant output",
    intro:
      "Recent assistant chat replies that passed an isWisdomWorthy() filter. Lower trust · the raw output isn't always principle-shaped · weighted at 0.7x in contextual recall.",
  },
  uncategorized: {
    label: "Uncategorized",
    tradition: "Mixed",
    intro:
      "Older entries without metadata.origin · pre-v10.0.353 ingestions. Useful but heterogeneous · search by content if hunting for a specific principle.",
  },
};

function fmtAge(days: number): string {
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function tone(hotness: number): string {
  if (hotness >= 0.7) return "text-amber-300";
  if (hotness >= 0.4) return "text-sky-300";
  return "text-[var(--text-tertiary)]";
}

export function WisdomTab() {
  const searchParams = useSearchParams();
  const evolutionMode = searchParams.get("evolution") === "1";
  // 2026-05-24 · Wave V P1-#5 · iOS-PWA-safe deprecation confirm.
  // Pre-fix `window.confirm()` is silently suppressed in iOS PWA
  // standalone mode (the operator's primary surface) · early-return
  // ALWAYS fired · operator hit Deprecate and nothing happened.
  // Same fix nickstire admin Wave 110-139 + statenour OVERDRIVE-1
  // applied across other pages.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  // v10.0.414 · ?focus=<wisdom-key> · scrolls to + highlights a card ·
  // wired from /brain?tab=wisdom&evolution=1 → "review →" links per low-trust row
  const focusKey = searchParams.get("focus");
  const [data, setData] = useState<WisdomPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<WisdomTopic | "all">("all");
  const [search, setSearch] = useState<string>("");
  // v10.0.430 · explicit sort key for the per-origin wisdom list ·
  // default = hotness (legacy · most-fired first). 6 modes.
  type WisdomSort = "hotness" | "confidence" | "newest" | "oldest" | "alpha-asc" | "alpha-desc";
  const [sortKey, setSortKey] = useState<WisdomSort>(() => {
    // 2026-05-24 · Wave V P1-#7 · pre-fix `localStorage.getItem` ran
    // without a try/catch · Safari private mode + iOS Lockdown Mode
    // throw `SecurityError` on storage access · the operator's whole
    // wisdom page would crash before mounting. Now: try/catch
    // matches the /journal Wave R + Wave T `resolveInitialFlags`
    // pattern · fallback returns the default sort.
    if (typeof window === "undefined") return "hotness";
    try {
      const saved = localStorage.getItem("wisdom:sortKey");
      const valid: WisdomSort[] = ["hotness", "confidence", "newest", "oldest", "alpha-asc", "alpha-desc"];
      return saved && valid.includes(saved as WisdomSort) ? (saved as WisdomSort) : "hotness";
    } catch {
      return "hotness";
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    // 2026-05-24 · Wave V P1-#7 · same Safari-private-mode guard on
    // the persistence write · acceptable degradation if storage is
    // unavailable · sortKey just resets to default next visit.
    try {
      localStorage.setItem("wisdom:sortKey", sortKey);
    } catch {
      // ignore
    }
  }, [sortKey]);
  // v10.0.383 · curation state · which entry is being edited inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");

  // Phase UU · tRPC migration · imperative-fetch via utils preserves
  // the existing useCallback shape so the page's invalidate-then-
  // reload pattern stays clean.
  const utils = trpc.useUtils();
  const updateMutation = trpc.brain.updateWisdom.useMutation();
  const actionMutation = trpc.brain.actOnWisdom.useMutation();

  const reload = useCallback(async () => {
    try {
      const view = await utils.brain.wisdom.fetch();
      setData(view as WisdomPayload);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [utils]);

  const saveEdit = useCallback(
    async (id: string) => {
      if (editDraft.trim().length < 30) {
        toast.error("Wisdom must be at least 30 characters");
        return;
      }
      const tid = toast.loading("Saving…");
      try {
        await updateMutation.mutateAsync({
          id,
          content: editDraft,
          confidence: 1.0,
        });
        toast.success("Saved", { id: tid });
        setEditingId(null);
        setEditDraft("");
        void reload();
        // v10.0.529.90 · Wave 34 · close the page-write → bus loop.
        notifyDataChanged("brain", { source: "wisdom-page", detail: "wisdom-edit", id });
      } catch (err) {
        toast.error("Save failed", { id: tid, description: (err as Error).message });
      }
    },
    [editDraft, reload, updateMutation],
  );

  const deprecateWisdom = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Deprecate this wisdom?",
        body: "Soft-deletes the row · stops appearing in recall · can be restored from /system/logs.",
        confirmLabel: "Deprecate",
        cancelLabel: "Keep",
        tone: "danger",
      });
      if (!ok) return;
      const tid = toast.loading("Deprecating…");
      try {
        await actionMutation.mutateAsync({ id, action: "deprecate" });
        toast.success("Deprecated", { id: tid });
        void reload();
        notifyDataChanged("brain", { source: "wisdom-page", detail: "wisdom-deprecate", id });
      } catch (err) {
        toast.error("Failed", { id: tid, description: (err as Error).message });
      }
    },
    [reload, actionMutation],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // v10.0.529.89 · Wave 33 · refresh when chat tools that mutate
  // BrainMemory wisdom rows fire (buildArchitectureMemory ·
  // learnCodingPreference). Pre-Wave-33 the page only reloaded on
  // operator-triggered edit/deprecate · chat-generated wisdom was
  // invisible until manual reload.
  useEffect(() => {
    return onDataChanged(["brain"], () => void reload());
  }, [reload]);

  // v10.0.414 · scroll the focused wisdom into view once the data loads
  useEffect(() => {
    if (!focusKey || !data) return;
    const el = document.getElementById(`wisdom-${focusKey}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusKey, data]);

  if (error) {
    return <p className="page-copy text-rose-300">{error}</p>;
  }

  if (!data) {
    return (
      <div className="text-[var(--text-tertiary)] text-sm">Pulling wisdom layer…</div>
    );
  }

  // Build filtered + searched entries · v10.0.395 · added topic filter
  // dimension. Origin and topic filter additively (intersection).
  // Topic is computed on-the-fly from content (matches the recall path).
  const filtered = data.entries.filter((e) => {
    if (filter !== "all" && e.origin !== filter) return false;
    if (topicFilter !== "all") {
      const topics = tagWisdomTopics(e.content);
      if (!topics.includes(topicFilter)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (!e.content.toLowerCase().includes(q) && !e.key.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Compute per-topic counts for the tab badges (using filtered-by-origin
  // pool · so when operator picks 'Greene', the topic tabs reflect Greene-
  // only counts).
  const topicCounts: Record<WisdomTopic | "all", number> = {
    all: 0, money: 0, people: 0, strategy: 0, execution: 0, ops: 0,
    brand: 0, self: 0, body: 0, time: 0, power: 0,
  };
  for (const e of data.entries) {
    if (filter !== "all" && e.origin !== filter) continue;
    topicCounts.all++;
    const topics = tagWisdomTopics(e.content);
    for (const t of topics) topicCounts[t]++;
  }

  // Wisdom of the moment · pick a hot, high-confidence one (deterministic rotation by day)
  const moment = (() => {
    const hot = data.entries.filter((e) => e.confidence >= 0.9 && e.hotness >= 0.4);
    if (hot.length === 0) return data.entries[0] ?? null;
    // Deterministic rotation: index by day-of-year so it changes daily
    const day = Math.floor(Date.now() / 86400_000);
    return hot[day % hot.length];
  })();

  // Group filtered entries by origin for the editorial layout
  const byOrigin = new Map<string, WisdomEntry[]>();
  for (const e of filtered) {
    const arr = byOrigin.get(e.origin) ?? [];
    arr.push(e);
    byOrigin.set(e.origin, arr);
  }
  // Order origins: curated first, then distiller/consolidation, then chat-scrape last
  const ORIGIN_ORDER = [
    "steve-jobs",
    "satori",
    "warren-buffett",
    "bill-gates",
    "elon-musk",
    "greene-laws",
    "distiller",
    "consolidation",
    "chat-scrape",
    "uncategorized",
  ];
  const orderedOrigins = ORIGIN_ORDER.filter((o) => byOrigin.has(o)).concat(
    Array.from(byOrigin.keys()).filter((o) => !ORIGIN_ORDER.includes(o)),
  );

  return (
    <>
      <p className="text-sm text-[var(--text-secondary)] mb-5" style={{ maxWidth: "70ch" }}>
        {data.total.toLocaleString()} principles loaded ·{" "}
        {data.totalRecalls.toLocaleString()} cumulative recalls. The layer
        Nick draws on every conversation. Curated traditions sit alongside
        cron-distilled patterns; trust-weighted in recall.
      </p>

      <div className="space-y-5">
        {/* v10.0.410 · evolution review · only when ?evolution=1 in URL ·
            surfaced from /brain insights panel link · uses the v10.0.406
            /api/brain/wisdom/evolution endpoint · operator-confirms each
            deprecate move via existing PATCH/POST routes. */}
        {evolutionMode && (
          <WisdomEvolutionPanel onChange={() => void reload()} />
        )}

        {/* ── Top-line stats ─────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total principles", value: data.total.toLocaleString() },
            { label: "Cumulative recalls", value: data.totalRecalls.toLocaleString() },
            {
              label: "Hot (≥2 fires)",
              value: data.entries.filter((e) => e.seenCount >= 2).length.toLocaleString(),
            },
            {
              label: "Origins",
              value: Object.keys(data.groupings.origin).length.toString(),
            },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]"
            >
              <p className="text-eyebrow">{k.label}</p>
              <p className="stat-number text-2xl text-[var(--text-primary)] mt-1">{k.value}</p>
            </div>
          ))}
        </div>

        {/* ── Wisdom of the moment ────────────────────────────── */}
        {moment && (
          <section className="rounded-lg border border-[var(--gold)]/25 bg-gradient-to-br from-[var(--gold-ghost)] to-transparent p-6 md:p-8">
            <p className="text-eyebrow">Wisdom of the moment</p>
            <p className="text-display-serif text-2xl md:text-3xl text-[var(--text-primary)] mt-3 leading-tight">
              {moment.content}
            </p>
            <p className="text-[11px] font-mono text-[var(--text-tertiary)] mt-4 flex items-center gap-2 flex-wrap">
              <span className="text-[var(--gold)]/80 uppercase tracking-wider">
                {ORIGIN_META[moment.origin]?.label ?? moment.origin}
              </span>
              <span>·</span>
              <span>{(moment.confidence * 100).toFixed(0)}% confidence</span>
              <span>·</span>
              <span>fired {moment.seenCount.toLocaleString()}×</span>
              <span>·</span>
              <span>seen {fmtAge(Math.round((Date.now() - new Date(moment.lastSeen).getTime()) / 86400_000))}</span>
            </p>
          </section>
        )}

        {/* ── Filter + search ──────────────────────────────── */}
        <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-eyebrow shrink-0">Filter origin:</p>
            <button
              onClick={() => setFilter("all")}
              className={`min-h-[44px] sm:min-h-0 px-3 py-2 sm:px-2 sm:py-0.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                filter === "all"
                  ? "bg-[var(--gold)]/20 text-[var(--gold)] border border-[var(--gold)]/30"
                  : "border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              all ({data.total})
            </button>
            {Object.entries(data.groupings.origin)
              .sort((a, b) => b[1] - a[1])
              .map(([origin, count]) => (
                <button
                  key={origin}
                  onClick={() => setFilter(origin)}
                  className={`min-h-[44px] sm:min-h-0 px-3 py-2 sm:px-2 sm:py-0.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                    filter === origin
                      ? "bg-[var(--gold)]/20 text-[var(--gold)] border border-[var(--gold)]/30"
                      : "border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {ORIGIN_META[origin]?.label ?? origin} ({count})
                </button>
              ))}
          </div>

          {/* v10.0.395 · TOPIC TABS · second-axis filter (B4 from enrichment memo).
              Filters additively with origin · operator can pick 'Greene + Money'
              to see all Greene laws about money. Counts respect origin filter. */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <p className="text-eyebrow shrink-0">Topic:</p>
            <button
              onClick={() => setTopicFilter("all")}
              className={`min-h-[44px] sm:min-h-0 px-3 py-2 sm:px-2 sm:py-0.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                topicFilter === "all"
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              all ({topicCounts.all})
            </button>
            {(["money", "people", "strategy", "execution", "ops", "brand", "self", "body", "time", "power"] as const).map((t) => {
              const count = topicCounts[t];
              if (count === 0) return null;
              return (
                <button
                  key={t}
                  onClick={() => setTopicFilter(t)}
                  className={`min-h-[44px] sm:min-h-0 px-3 py-2 sm:px-2 sm:py-0.5 rounded text-[11px] font-mono uppercase tracking-wider transition-colors ${
                    topicFilter === t
                      ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                      : "border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {topicLabel(t)} ({count})
                </button>
              );
            })}
          </div>

          {/* v10.0.436 · refactored to shared SortDropdown */}
          <div className="mt-3 flex gap-2 flex-wrap sm:flex-nowrap">
            <input
              type="search"
              placeholder="search wisdom by content or key…"
              aria-label="Search wisdom"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0 bg-[var(--bg-base)] border border-[var(--border-default)] rounded px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gold)]/40"
            />
            <SortDropdown<WisdomSort>
              value={sortKey}
              onChange={setSortKey}
              defaultValue="hotness"
              ariaLabel="Sort wisdom"
              options={[
                { value: "hotness", label: "hotness · default" },
                { value: "confidence", label: "confidence · highest" },
                { value: "newest", label: "added · newest" },
                { value: "oldest", label: "added · oldest" },
                { value: "alpha-asc", label: "alpha · A→Z" },
                { value: "alpha-desc", label: "alpha · Z→A" },
              ]}
            />
          </div>
          {/* v10.0.436 · active-filter strip · clear-all */}
          <ActiveFiltersStrip
            className="mt-3"
            filters={[
              ...(search.trim() ? [{ label: `search · "${search.trim().slice(0, 20)}"`, onRemove: () => setSearch("") }] : []),
              ...(filter !== "all" ? [{ label: `origin · ${filter}`, onRemove: () => setFilter("all") }] : []),
              ...(topicFilter !== "all" ? [{ label: `topic · ${topicLabel(topicFilter)}`, onRemove: () => setTopicFilter("all") }] : []),
              ...(sortKey !== "hotness" ? [{ label: `sort · ${sortKey}`, onRemove: () => setSortKey("hotness") }] : []),
            ]}
            onClearAll={() => { setSearch(""); setFilter("all"); setTopicFilter("all"); setSortKey("hotness"); }}
          />
          {filtered.length !== data.total && (
            <p className="text-[11px] text-[var(--text-tertiary)] mt-2 font-mono">
              showing {filtered.length} of {data.total}
              {topicFilter !== "all" && ` · topic: ${topicLabel(topicFilter)}`}
            </p>
          )}
        </section>

        {/* ── Origins · grouped editorial layout ──────────────── */}
        {orderedOrigins.map((origin) => {
          const meta = ORIGIN_META[origin] ?? {
            label: origin,
            tradition: "Origin",
            intro: "",
          };
          const list = byOrigin.get(origin) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={origin} className="space-y-3">
              <header className="border-b border-[var(--border-default)] pb-3">
                <p className="text-eyebrow">{meta.tradition}</p>
                <h2 className="section-title text-xl mt-1">
                  {meta.label}{" "}
                  <span className="text-[var(--text-tertiary)] font-normal text-sm normal-case tracking-normal">
                    · {list.length} principle{list.length === 1 ? "" : "s"}
                  </span>
                </h2>
                {meta.intro && (
                  <p className="section-copy text-[var(--text-secondary)] mt-2">
                    {meta.intro}
                  </p>
                )}
              </header>
              <div className="space-y-2">
                {list
                  .slice() // copy · don't mutate the byOrigin map array
                  .sort((a, b) => {
                    switch (sortKey) {
                      case "confidence":
                        return b.confidence - a.confidence;
                      case "newest":
                        return a.ageDays - b.ageDays; // smaller age = newer
                      case "oldest":
                        return b.ageDays - a.ageDays;
                      case "alpha-asc":
                        return a.content.localeCompare(b.content);
                      case "alpha-desc":
                        return b.content.localeCompare(a.content);
                      case "hotness":
                      default:
                        return b.hotness - a.hotness;
                    }
                  })
                  .map((entry) => (
                    <article
                      key={entry.id}
                      id={`wisdom-${entry.key}`}
                      className={`rounded-lg border bg-[var(--bg-raised)] p-5 group/card relative ${
                        focusKey === entry.key
                          ? "border-[var(--gold)] shadow-[0_0_20px_rgba(253,185,19,0.25)]"
                          : "border-[var(--border-default)]"
                      }`}
                    >
                      {editingId === entry.id ? (
                        <>
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            className="w-full min-h-[7em] bg-[var(--bg-base)] border border-[var(--gold)]/30 rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)] font-mono"
                            autoFocus
                          />
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => void saveEdit(entry.id)}
                              className="px-3 py-1 rounded text-[11px] font-mono uppercase tracking-wider bg-[var(--gold)]/20 text-[var(--gold)] border border-[var(--gold)]/30 hover:bg-[var(--gold)]/30 flex items-center gap-1"
                            >
                              <Check size={12} /> Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft("");
                              }}
                              className="px-3 py-1 rounded text-[11px] font-mono uppercase tracking-wider border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center gap-1"
                            >
                              <X size={12} /> Cancel
                            </button>
                            <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)]">
                              {editDraft.length} chars · min 30
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-[var(--text-primary)] text-sm leading-relaxed" style={{ maxWidth: "70ch" }}>
                            {entry.content}
                          </p>
                          <p className="mt-3 text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={tone(entry.hotness)}>
                              {entry.seenCount === 0 ? "cold · seed only" : `fired ${entry.seenCount.toLocaleString()}×`}
                            </span>
                            {/* 2026-08-19 · dropped `NN% conf`. It sat directly
                                beside "fired N×" and was the SAME number
                                restated — confidence is 0.5 + 0.1×(sightings−1),
                                not a probability. The count above is the fact. */}
                            <span>·</span>
                            <span>via {entry.source}</span>
                            <span>·</span>
                            <span>added {fmtAge(entry.ageDays)}</span>
                          </p>
                          {/* v10.0.383 · curation buttons · hover-revealed on desktop
                              v10.0.390 · ALWAYS visible on mobile (no hover state on
                              touch · operator can't curate without this) · larger
                              44px hit targets on small screens (iOS guideline) */}
                          {/* 2026-05-24 · Wave V P1-#8 · a11y · pre-fix
                              md:opacity-0 hid the curation buttons from
                              keyboard-only users · Tab navigation
                              revealed nothing on desktop until mouse-
                              hover. Now: md:focus-within:opacity-100
                              also reveals them when any child gets
                              focus · matches the WCAG 2.1.1
                              keyboard-accessible pattern. Mobile
                              (default opacity-100) unchanged. */}
                          <div className="absolute top-2 right-2 md:top-3 md:right-3 md:opacity-0 md:group-hover/card:opacity-100 md:focus-within:opacity-100 md:transition-opacity flex items-center gap-1">
                            <button
                              onClick={() => {
                                setEditingId(entry.id);
                                setEditDraft(entry.content);
                              }}
                              className="w-11 h-11 md:w-7 md:h-7 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-elevated)] active:scale-90 transition-transform"
                              title="Edit wisdom"
                              aria-label="Edit wisdom"
                            >
                              <Pencil className="w-[14px] h-[14px] md:w-3 md:h-3" />
                            </button>
                            <button
                              onClick={() => void deprecateWisdom(entry.id)}
                              className="w-11 h-11 md:w-7 md:h-7 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-rose-400 hover:bg-rose-500/10 active:scale-90 transition-transform"
                              title="Deprecate (soft-delete) · can be restored"
                              aria-label="Deprecate wisdom"
                            >
                              <Trash2 className="w-[14px] h-[14px] md:w-3 md:h-3" />
                            </button>
                          </div>
                          {/* v10.0.409 · click-to-load see-also via /api/brain/wisdom/[id]/related
                              (cosine graph · v10.0.402). Click-to-load not auto-load
                              so 991 cards don't N+1 the API. */}
                          <RelatedWisdomLinks wisdomId={entry.id} />
                        </>
                      )}
                    </article>
                  ))}
              </div>
            </section>
          );
        })}

        {/* 2026-05-24 · Wave V · iOS-PWA-safe confirm dialog mount ·
            renders null when no confirm is in-flight so this adds zero
            DOM cost in the steady state. */}
        {confirmDialog}
      </div>
    </>
  );
}
