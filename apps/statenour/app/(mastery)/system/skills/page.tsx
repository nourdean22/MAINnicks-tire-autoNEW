"use client";

/**
 * /system/skills · v10.0.425
 *
 * Operator surface for the 1,423 skills installed locally · search,
 * filter by category, see what each does. Backed by
 * data/skills-registry.json · rebuild via:
 *
 *   pnpm tsx scripts/build-skill-registry.ts
 */

import { useEffect, useMemo, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { SortDropdown, type SortOption } from "@/components/ui/sort-dropdown";
import { FilterChipBar, ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";

interface SkillRow {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  source?: string;
  risk?: string;
  path: string;
}

interface SkillsResp {
  generatedAt?: string;
  totalSkills?: number;
  sourceRoots?: string[];
  matchCount?: number;
  sort?: string;
  skills?: SkillRow[];
  categories?: { name: string; count: number }[];
  error?: string;
  hint?: string;
}

type SortKey =
  | "name-asc"
  | "name-desc"
  | "category"
  | "risk"
  | "source"
  | "tags"
  | "relevance";

const SORT_OPTIONS: { value: SortKey; label: string; hint: string }[] = [
  { value: "name-asc", label: "name · A→Z", hint: "alphabetical" },
  { value: "name-desc", label: "name · Z→A", hint: "reverse alphabetical" },
  { value: "category", label: "category", hint: "group by category, alpha within" },
  { value: "risk", label: "risk · safe first", hint: "safe → unknown → none" },
  { value: "tags", label: "tags · most first", hint: "richer skills surface" },
  { value: "source", label: "source", hint: "alpha by source name" },
  { value: "relevance", label: "relevance", hint: "only with search · name-match > tag > description" },
];

const RISK_TONE: Record<string, string> = {
  safe: "border-emerald-500/30 text-emerald-300",
  unknown: "border-amber-500/30 text-amber-300",
  none: "border-emerald-500/30 text-emerald-300",
};

export default function SkillsPage() {
  const [data, setData] = useState<SkillsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [limit, setLimit] = useState(60);
  // v10.0.428 · sort key · auto-promotes to "relevance" the first
  // time the operator types in search, then sticks with the operator's
  // explicit choice.
  const [sort, setSort] = useState<SortKey>("name-asc");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (cat) params.set("cat", cat);
    params.set("sort", sort);
    params.set("limit", String(limit));
    (async () => {
      try {
        const r = await fetch(`/api/system/skills?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as SkillsResp;
        if (cancelled) return;
        if (json.error) {
          setError(json.error + (json.hint ? ` · ${json.hint}` : ""));
        } else {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q, cat, sort, limit]);

  // v10.0.428 · auto-flip to relevance sort the first time operator
  // starts typing in search (only if they're still on the default).
  useEffect(() => {
    if (q.trim().length > 0 && sort === "name-asc") setSort("relevance");
  }, [q, sort]);

  const topCategories = useMemo(
    () => (data?.categories ?? []).slice(0, 16),
    [data?.categories],
  );

  if (error) {
    return (
      <StandardPage eyebrow="System · Skills" title="Skill registry">
        <p className="text-sm text-rose-400">{error}</p>
      </StandardPage>
    );
  }
  if (!data) {
    return (
      <StandardPage eyebrow="System · Skills" title="Skill registry" description="Loading…">
        <p className="text-[11px] text-[var(--text-tertiary)]">loading…</p>
      </StandardPage>
    );
  }

  return (
    <StandardPage
      eyebrow="System · Skills"
      title={`${data.totalSkills?.toLocaleString() ?? 0} skills installed`}
      description={`Search + filter the local skills registry. Backed by data/skills-registry.json (regen via \`pnpm tsx scripts/build-skill-registry.ts\`). Last built ${data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"}.`}
      width="2xl"
      rhythm="loose"
    >
      {/* v10.0.436 · refactored to shared SortDropdown + FilterChipBar +
          ActiveFiltersStrip · same UX, less inline JSX, consistent
          with /tasks + /brain/wisdom. */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4 space-y-3">
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search · name, description, tags…"
            aria-label="Search skills"
            className="flex-1 min-w-0 text-[13px] px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]/40"
          />
          <SortDropdown<SortKey>
            value={sort}
            onChange={setSort}
            defaultValue="name-asc"
            options={SORT_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              hint: o.hint,
              disabled: o.value === "relevance" && q.trim().length === 0,
            }))}
            ariaLabel="Sort skills"
          />
        </div>
        <FilterChipBar<string>
          value={cat}
          onChange={setCat}
          ariaLabel="Filter by category"
          options={[
            { value: "", label: "all", count: data.totalSkills },
            ...topCategories.map((c) => ({ value: c.name, label: c.name, count: c.count })),
          ]}
        />
        <ActiveFiltersStrip
          filters={[
            ...(q.trim() ? [{ label: `search · "${q.trim().slice(0, 20)}"`, onRemove: () => setQ("") }] : []),
            ...(cat ? [{ label: `category · ${cat}`, onRemove: () => setCat("") }] : []),
            ...(sort !== "name-asc" ? [{ label: `sort · ${SORT_OPTIONS.find((o) => o.value === sort)?.label ?? sort}`, onRemove: () => setSort("name-asc") }] : []),
          ]}
          onClearAll={() => { setQ(""); setCat(""); setSort("name-asc"); }}
        />
      </div>

      {/* Match count + active sort */}
      <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
        {data.matchCount ?? 0} match{(data.matchCount ?? 0) === 1 ? "" : "es"}
        {data.matchCount && data.matchCount > limit ? ` · showing first ${limit}` : ""}
        {data.sort && data.sort !== "name-asc" ? ` · sorted by ${SORT_OPTIONS.find((o) => o.value === data.sort)?.label ?? data.sort}` : ""}
      </p>

      {/* Skill cards */}
      <ul className="space-y-2">
        {(data.skills ?? []).map((s) => (
          <li
            key={s.name}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4"
          >
            <header className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-mono">
                  {s.name}
                </h3>
                {s.category && (
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                    {s.category}
                  </span>
                )}
                {s.risk && (
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${RISK_TONE[s.risk] ?? "border-[var(--border-default)] text-[var(--text-tertiary)]"}`}
                  >
                    {s.risk}
                  </span>
                )}
              </div>
              {s.source && (
                <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
                  · {s.source}
                </span>
              )}
            </header>
            <p
              className="mt-2 text-[12px] text-[var(--text-secondary)] leading-relaxed"
              style={{ maxWidth: "70ch" }}
            >
              {s.description}
            </p>
            {s.tags && s.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.tags.slice(0, 8).map((t) => (
                  <span
                    key={t}
                    className="text-[8px] font-mono text-[var(--text-tertiary)] px-1 rounded bg-[var(--bg-base)]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      {data.matchCount && data.matchCount > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 60)}
          className="text-[10px] font-mono uppercase tracking-wider px-3 py-2 min-h-[44px] sm:min-h-0 rounded border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10"
        >
          show more →
        </button>
      )}
    </StandardPage>
  );
}
