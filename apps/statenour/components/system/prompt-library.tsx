"use client";

/**
 * PromptLibraryView · v10.0.307 · prompt-library inventory tab on
 * /system/prompt (absorbed from /system/prompts which is deleted).
 *
 * Operator-visible inventory of every reusable prompt template in the
 * statenour-os codebase. Reads from lib/prompts/library.ts via
 * /api/system/prompts.
 *
 * What's it for:
 *   · Catalog of system prompts (verifier, ground, suggester, role)
 *   · See where each prompt is wired (`usedBy` field)
 *   · Filter by category or tag
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { Panel } from "@/components/panel";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { cn } from "@/lib/utils/cn";
import {
  Loader2,
  ScrollText,
  ShieldCheck,
  Compass,
  Sparkles,
  Wrench,
  PenLine,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type Category =
  | "role"
  | "task"
  | "analysis"
  | "creative"
  | "transformation"
  | "verifier"
  | "ground"
  | "suggester"
  | "critic";

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: Category;
  version: string;
  added: string;
  tags: string[];
  body: string;
  variables?: string[];
  usedBy?: string;
}

interface Stats {
  total: number;
  byCategory: Record<Category, number>;
  wired: number;
  libraryOnly: number;
}

interface ApiResponse {
  data: {
    stats: Stats;
    filter: { category: Category | null; tag: string | null };
    prompts: PromptTemplate[];
  };
}

const CATEGORY_META: Record<
  Category,
  { label: string; icon: React.ComponentType<{ className?: string }>; tint: string }
> = {
  role:           { label: "Role",           icon: PenLine,     tint: "text-blue-400 border-blue-500/30" },
  task:           { label: "Task",           icon: Wrench,      tint: "text-violet-400 border-violet-500/30" },
  analysis:       { label: "Analysis",       icon: Search,      tint: "text-amber-400 border-amber-500/30" },
  creative:       { label: "Creative",       icon: Sparkles,    tint: "text-rose-400 border-rose-500/30" },
  transformation: { label: "Transform",      icon: ScrollText,  tint: "text-teal-400 border-teal-500/30" },
  verifier:       { label: "Verifier",       icon: ShieldCheck, tint: "text-emerald-400 border-emerald-500/30" },
  ground:         { label: "Ground",         icon: Compass,     tint: "text-indigo-400 border-indigo-500/30" },
  suggester:      { label: "Suggester",      icon: Sparkles,    tint: "text-yellow-400 border-yellow-500/30" },
  critic:         { label: "Critic",         icon: ShieldCheck, tint: "text-orange-400 border-orange-500/30" },
};

export function PromptLibraryView() {
  const [data, setData] = useState<ApiResponse["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | Category>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await authedFetch("/api/system/prompts");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as ApiResponse;
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.prompts;
    if (categoryFilter !== "all") {
      list = list.filter((p) => p.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [data, categoryFilter, search]);

  return (
    <div className="space-y-4">
      {/* Top stat strip */}
      {data && (
        <Panel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
            <Stat label="total" value={data.stats.total} />
            <Stat label="wired" value={data.stats.wired} tint="text-emerald-300" />
            <Stat label="library only" value={data.stats.libraryOnly} tint="text-zinc-400" />
            <Stat label="categories" value={Object.keys(data.stats.byCategory).length} />
          </div>
        </Panel>
      )}

      {/* Filter strip */}
      {data && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2 p-2">
            <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-600">
              category
            </span>
            <FilterPill
              label="all"
              active={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            />
            {(Object.keys(CATEGORY_META) as Category[]).map((c) => {
              const meta = CATEGORY_META[c];
              const count = data.stats.byCategory[c] ?? 0;
              if (count === 0) return null;
              return (
                <FilterPill
                  key={c}
                  label={`${meta.label} (${count})`}
                  active={categoryFilter === c}
                  onClick={() => setCategoryFilter(c)}
                  tint={meta.tint}
                />
              );
            })}
            <input
              type="text"
              placeholder="search id / name / tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ml-auto bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 w-56"
            />
          </div>
        </Panel>
      )}

      {/* Body */}
      {loading && (
        <Panel>
          <div className="flex items-center gap-2 p-4 text-zinc-500 text-[12px]">
            <Loader2 className="animate-spin" size={14} />
            loading registry…
          </div>
        </Panel>
      )}
      {error && (
        <Panel>
          <p className="p-3 text-rose-400 text-[12px]">failed to load: {error}</p>
        </Panel>
      )}
      {!loading && !error && data && filtered.length === 0 && (
        <Panel>
          <p className="p-4 text-zinc-500 text-[12px]">No prompts match these filters.</p>
        </Panel>
      )}

      <div className="space-y-2">
        {filtered.map((p) => (
          <PromptCard key={p.id} prompt={p} />
        ))}
      </div>

      {/* Footer hint */}
      <p className="text-center text-[9px] font-mono text-zinc-600 italic">
        v10.0.165 · listing only · edit/version/A-B test in a future ship
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      <div className={cn("text-[18px] font-bold tabular-nums", tint ?? "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  tint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border transition-all",
        active
          ? tint
            ? `${tint} bg-zinc-900/80`
            : "border-zinc-500 bg-zinc-800 text-zinc-100"
          : "border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400",
      )}
    >
      {label}
    </button>
  );
}

function PromptCard({ prompt: p }: { prompt: PromptTemplate }) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[p.category];
  const Icon = meta.icon;

  return (
    <Panel>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border",
              meta.tint,
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            {meta.label}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[12px] text-zinc-200 hover:text-amber-300 transition-colors flex items-center gap-1"
            aria-expanded={expanded}
          >
            {p.id}
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <span className="text-[10px] text-zinc-500 truncate flex-1 min-w-0">
            {p.name}
          </span>
          <span className="text-[9px] font-mono text-zinc-600">v{p.version}</span>
        </div>

        <p className="text-[11px] text-zinc-400 leading-snug">{p.description}</p>

        <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-600">
          <span>added {p.added}</span>
          {p.usedBy ? (
            <span className="text-emerald-400/80">⚙ wired · {p.usedBy}</span>
          ) : (
            <span className="text-zinc-500">library only</span>
          )}
          {p.tags.length > 0 && (
            <span className="ml-auto flex items-center gap-1">
              {p.tags.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-px rounded bg-zinc-800/60 text-zinc-400 text-[8px]"
                >
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>

        {expanded && (
          <div className="pt-2 mt-2 border-t border-zinc-800/50 space-y-2">
            {p.variables && p.variables.length > 0 && (
              <div className="text-[10px] font-mono text-amber-400/80">
                variables: {p.variables.map((v) => `{{${v}}}`).join(" · ")}
              </div>
            )}
            <pre className="text-[10px] text-zinc-300 font-mono whitespace-pre-wrap break-words bg-zinc-950/60 border border-zinc-800/40 rounded p-2 max-h-64 overflow-y-auto">
              {p.body}
            </pre>
          </div>
        )}
      </div>
    </Panel>
  );
}
