"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.31 — structured logger for knowledge-page errors.
const log = rootLogger.withSurface("knowledge/page");
import { GlassCard } from "@/components/ui/glass-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SortDropdown } from "@/components/ui/sort-dropdown";
// v10.0.443 · FilterChipBar replaces bare-Badge category row · brings
// 44px iOS HIG tap targets + aria-checked radiogroup. The `cn` import
// was dropped at the same time (its last consumer was the old chip).
// v10.0.485 · `cn` re-added for KnowledgeRefreshPanel (migrated from /pins).
import { FilterChipBar } from "@/components/ui/filter-chip-bar";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils/cn";
import { Search, ArrowLeft, FileText, FolderOpen, Sparkles } from "lucide-react";
import { PageNick } from "@/components/ai/page-nick";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { StandardPage } from "@/components/layout/standard-page";
import { EmptyState } from "@/components/ui/empty-state";

// Phase ZZ (2026-05-19 AM) · authedFetch reads migrated to trpc · 3
// sites (list · open · search).
// Phase straggler-pages (2026-05-22) · the last call-site — the
// /api/admin/knowledge-refresh POST in KnowledgeRefreshPanel — is
// migrated onto `operator.knowledgeRefresh`. Zero use-authed-fetch
// imports remain. Legacy REST route stays mounted.
import { trpc } from "@/lib/trpc/client";
import { onDataChanged } from "@/lib/events/data-change";
interface KFile {
  name: string;
  category: string;
  path: string;
  size: number;
  modified: string;
}

interface SearchResult {
  name: string;
  category: string;
  path: string;
  match_count: number;
  matches: string[];
}

interface RefreshSubsystem {
  id: string;
  ok: boolean;
  status: number;
  durationMs: number;
  summary: string;
}

export default function KnowledgePage() {
  const [files, setFiles] = useState<KFile[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [filterCat, setFilterCat] = useState("all");
  // v10.0.440 · sort key · 5 modes
  type KnowledgeSort = "name" | "newest" | "oldest" | "largest" | "smallest";
  const [sortKey, setSortKey] = useState<KnowledgeSort>(() => {
    if (typeof window === "undefined") return "name";
    const saved = window.localStorage.getItem("knowledge:sortKey");
    const valid: KnowledgeSort[] = ["name", "newest", "oldest", "largest", "smallest"];
    return saved && valid.includes(saved as KnowledgeSort) ? (saved as KnowledgeSort) : "name";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("knowledge:sortKey", sortKey);
  }, [sortKey]);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // v10 B.1 FIND-04 · res.ok guard before .json(). Without this, an
  // API 500 would call .json() on a potentially non-JSON error body
  // (Vercel's "Internal Server Error" is plain text), throw silently
  // into .catch, and leave the page stuck in `loading=false` with
  // zero files — indistinguishable from "knowledge base is empty."
  // v10.0.31 — wrapped in useCallback so the setInterval below
  // captures a stable reference (prior plain function form was a
  // latent correctness risk: each render created a fresh closure).
  // Phase ZZ · tRPC migration · same useCallback shape preserves the
  // setInterval + event-bus refresh hooks below.
  const utils = trpc.useUtils();
  const loadFiles = useCallback(() => {
    utils.operator.knowledgeFiles
      .fetch()
      .then((d) => {
        setFiles((d.files ?? []) as typeof files);
        setCategories(d.categories ?? []);
        setFetchedAt(new Date().toISOString());
      })
      .catch((err) => {
        log.warn("loadFiles_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [utils]);

  useEffect(() => {
    loadFiles();
    const i = setInterval(loadFiles, 60000);
    return () => clearInterval(i);
  }, [loadFiles]);

  // v10.0.529.88 · Wave 32 · instant refresh when chat tool
  // syncKnowledge fires (TOOL_DOMAIN_MAP targets "knowledge"). Pre-
  // Wave-32 operator triggered a sync via chat and waited up to 60s
  // for the poll · stale Drive corpus visible the whole time.
  useEffect(() => {
    return onDataChanged(["knowledge"], () => loadFiles());
  }, [loadFiles]);

  // v10.0.31 — abort signal so user clicks (open file → search →
  // open another file) don't pile up overlapping fetches that
  // resolve out of order, leaving stale results visible alongside
  // a newly-opened file.
  const inflightRef = useRef<AbortController | null>(null);

  async function openFile(path: string) {
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const data = await utils.operator.knowledgeFile.fetch({ path });
      if (ctrl.signal.aborted) return;
      setContent(data.content ?? "");
      setSelectedFile(path);
      setResults([]);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      log.warn("openFile_failed", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function search() {
    if (!query.trim()) return;
    if (inflightRef.current) inflightRef.current.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    try {
      const data = await utils.operator.knowledgeSearch.fetch({ q: query });
      if (ctrl.signal.aborted) return;
      setResults((data.results ?? []) as typeof results);
      setSelectedFile(null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      log.warn("search_failed", {
        query: query.slice(0, 60),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const filtered = (filterCat === "all" ? files : files.filter((f) => f.category === filterCat));
  const sortedFiltered = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "newest":
        return new Date(b.modified).getTime() - new Date(a.modified).getTime();
      case "oldest":
        return new Date(a.modified).getTime() - new Date(b.modified).getTime();
      case "largest":
        return (b.size ?? 0) - (a.size ?? 0);
      case "smallest":
        return (a.size ?? 0) - (b.size ?? 0);
      case "name":
      default:
        return a.name.localeCompare(b.name);
    }
  });

  if (loading) {
    return <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="skeleton h-16 w-full" />)}</div>;
  }

  // File viewer
  if (selectedFile) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedFile(null)}>
            <ArrowLeft size={16} />
          </Button>
          <span className="text-sm text-[var(--nour-text-secondary)] truncate">{selectedFile}</span>
        </div>
        <GlassCard className="p-4">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--nour-text)]">{content}</pre>
        </GlassCard>
      </div>
    );
  }

  return (
    <StandardPage
      eyebrow="Mastery"
      title="Knowledge"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <FreshnessChip
            lastFetchedAt={fetchedAt}
            source="fs · /knowledge"
            onReload={loadFiles}
          />
          <Badge variant="outline" className="font-mono"><AnimatedCounter value={files.length} /> files</Badge>
        </div>
      }
    >
      <PageNick page="knowledge" />

      {/* Knowledge corpus refresh · migrated from /pins in v10.0.485
          (audit Wave 9 · zero shared state with pins · belongs here) */}
      <KnowledgeRefreshPanel />

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nour-text-secondary)]" />
          <Input
            placeholder="Search knowledge base..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="pl-9 bg-[var(--nour-surface)] border-[var(--nour-border)]"
          />
        </div>
        <Button onClick={search} className="bg-[var(--nour-gold)] text-[var(--text-primary)] hover:bg-[var(--nour-gold)]/90">
          Search
        </Button>
      </div>

      {/* v10.0.443 · category filters · migrated from bare Badge to
          FilterChipBar · brings 44px iOS HIG mobile tap targets +
          aria-checked radiogroup semantics + uppercase font-mono
          parity with the rest of the OS · ux-audit + mobile-design
          skills applied. */}
      <div className="flex gap-2 items-start flex-wrap">
        <FilterChipBar
          value={filterCat}
          onChange={setFilterCat}
          options={[
            { value: "all", label: "all" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          ariaLabel="Filter knowledge categories"
        />
        {/* v10.0.440 · sort dropdown · 5 modes */}
        <div className="ml-auto">
          <SortDropdown<KnowledgeSort>
            value={sortKey}
            onChange={setSortKey}
            defaultValue="name"
            ariaLabel="Sort knowledge files"
            options={[
              { value: "name", label: "name · A→Z" },
              { value: "newest", label: "modified · newest" },
              { value: "oldest", label: "modified · oldest" },
              { value: "largest", label: "size · largest" },
              { value: "smallest", label: "size · smallest" },
            ]}
          />
        </div>
      </div>

      {/* Search Results */}
      {results.length > 0 && (
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wider text-[var(--nour-text-secondary)] mb-3">
            Results (<AnimatedCounter value={results.length} />)
          </h2>
          <div className="space-y-2 stagger-in">
            {results.map((r) => (
              <GlassCard
                /* v10.0.31 — was key={i} (array index) which breaks
                   reconciliation on result reorder/partial update.
                   path is unique per result. */
                key={r.path}
                className="p-3 cursor-pointer hover:border-[var(--nour-gold)] transition-colors glow-on-hover"
                onClick={() => openFile(r.path)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={12} className="text-[var(--nour-text-secondary)]" />
                  <span className="text-sm font-medium">{r.name}</span>
                  <Badge variant="outline" className="text-[10px] h-4">{r.category}</Badge>
                  <span className="text-[10px] text-[var(--nour-text-secondary)] ml-auto"><AnimatedCounter value={r.match_count} /> matches</span>
                </div>
                {r.matches[0] && (
                  <p className="text-xs text-[var(--nour-text-secondary)] line-clamp-2 font-mono">{r.matches[0]}</p>
                )}
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {/* File Grid */}
      {results.length === 0 && (
        <section>
          {sortedFiltered.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={filterCat === "all" ? "No knowledge files yet" : `No files in "${filterCat}"`}
              why={filterCat === "all" ? "The corpus is empty or hasn't synced yet." : "No files match this category filter."}
              unlock={filterCat === "all" ? "Run a corpus refresh above, or sync your sources." : "Clear the filter to see all files."}
            />
          ) : (
          <div className="grid grid-cols-1 gap-2 stagger-in">
            {sortedFiltered.map((f) => (
              <GlassCard
                key={f.path}
                className="p-3 cursor-pointer hover:border-[var(--nour-text-secondary)] transition-colors glow-on-hover"
                onClick={() => openFile(f.path)}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen size={12} className="text-[var(--nour-text-secondary)] shrink-0" />
                  <span className="text-sm truncate flex-1">{f.name}</span>
                  <Badge variant="outline" className="text-[10px] h-4 shrink-0">{f.category}</Badge>
                  <span className="text-[10px] text-[var(--nour-text-secondary)] font-mono shrink-0">{(f.size / 1024).toFixed(1)}K</span>
                </div>
              </GlassCard>
            ))}
          </div>
          )}
        </section>
      )}
    </StandardPage>
  );
}

function KnowledgeRefreshPanel() {
  const [results, setResults] = useState<RefreshSubsystem[] | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Phase straggler-pages · the knowledge-corpus refresh is a tRPC
  // mutation now · `isPending` replaces the page-local `refreshing`
  // flag. The procedure rejects (BAD_REQUEST / INTERNAL_SERVER_ERROR)
  // on the no-targets / env-missing cases · the catch surfaces the
  // sanitized message, same as the old `res.ok` guard.
  const refreshMutation = trpc.operator.knowledgeRefresh.useMutation();
  const refreshing = refreshMutation.isPending;

  const runRefresh = async () => {
    setRefreshError(null);
    try {
      const json = await refreshMutation.mutateAsync();
      setResults(json.results);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-white flex items-center gap-1">
          <Sparkles className="h-4 w-4" /> Knowledge corpus refresh
        </h2>
        <button
          onClick={runRefresh}
          disabled={refreshing}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium transition",
            refreshing
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15",
          )}
        >
          {refreshing ? "refreshing…" : "refresh now"}
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 mb-2">
        Pulls fresh data from all sources (Industry RSS, ALG, Insights, Gmail, Calendar, Drive, Knowledge sync, Embeddings) and hot-flushes the prompt cache. ~60s total.
      </p>
      {refreshError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-300 mb-2">
          {refreshError}
        </div>
      )}
      {results && (
        <div className="space-y-1">
          {results.map((r) => (
            <div
              key={r.id}
              className={cn(
                "flex items-center justify-between rounded-md border px-2 py-1 text-xs",
                r.ok
                  ? "border-emerald-500/20 bg-emerald-500/[0.03] text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/[0.05] text-rose-200",
              )}
            >
              <span className="font-mono">{r.id}</span>
              <span className="text-[10px] opacity-75 truncate max-w-[55%]">{r.summary}</span>
              <span className="text-[10px] tabular-nums opacity-50">{r.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
