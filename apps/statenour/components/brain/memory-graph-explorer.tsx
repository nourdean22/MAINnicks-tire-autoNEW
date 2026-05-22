"use client";

/**
 * MemoryGraphExplorer — click any auto-linker chip to see the network.
 *
 * Invoked by calling `openMemoryGraph({ type, id, label })` from
 * anywhere in the app (it wires through a window event so consumers
 * don't need to thread state). Mounts once at the HQ shell level.
 *
 * The modal shows:
 *   • Root node at top (what Nour clicked)
 *   • Outgoing + incoming edges grouped by relationship
 *   • Node labels resolved from their source tables
 *   • Click any edge target to pivot the explorer to THAT node —
 *     turning the network into a walkable graph without leaving the
 *     modal. Back button pops the navigation stack.
 *   • Depth toggle (1 / 2) — 2 expands from the top-3 neighbors
 *
 * Data source: /api/brain/graph-neighborhood
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { X, ArrowLeft, Network, ArrowRightCircle, RotateCcw, Loader2 } from "lucide-react";

// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// graph-neighborhood")` onto `trpc.brain.graphNeighborhood` ·
// imperative `utils.*.fetch()` (the modal loads on each pivot/reload).
import { trpc } from "@/lib/trpc/client";
export interface GraphNode {
  type: string;
  id: string;
  label: string;
  degree: number;
}

export interface GraphEdge {
  source: { type: string; id: string };
  target: { type: string; id: string };
  relationship: string;
  strength: number;
  evidence: string | null;
}

interface GraphResponse {
  root: { type: string; id: string; label: string } | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Public API — fire an event to open the modal ──────────────────────

export const OPEN_MEMORY_GRAPH_EVENT = "nour:open-memory-graph";

export interface OpenMemoryGraphDetail {
  type: string;
  id: string;
  label?: string;
}

export function openMemoryGraph(detail: OpenMemoryGraphDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_MEMORY_GRAPH_EVENT, { detail }));
}

// ── Relationship styling ──────────────────────────────────────────────

const RELATIONSHIP_TONE: Record<string, { color: string; bg: string; glyph: string }> = {
  caused_by:     { color: "text-amber-400",      bg: "bg-amber-500/10",    glyph: "⤺" },
  causes:        { color: "text-orange-400",     bg: "bg-orange-500/10",   glyph: "→" },
  leads_to:      { color: "text-orange-400",     bg: "bg-orange-500/10",   glyph: "⇒" },
  blocks:        { color: "text-red-400",        bg: "bg-red-500/10",      glyph: "⊘" },
  supports:      { color: "text-emerald-400",    bg: "bg-emerald-500/10",  glyph: "✓" },
  contradicts:   { color: "text-red-400",        bg: "bg-red-500/10",      glyph: "✗" },
  conflicts_with:{ color: "text-red-400",        bg: "bg-red-500/10",      glyph: "⚡" },
  relates_to:    { color: "text-[var(--gold)]",  bg: "bg-[var(--gold)]/10",glyph: "↔" },
  depends_on:    { color: "text-blue-400",       bg: "bg-blue-500/10",     glyph: "⇐" },
  precedes:      { color: "text-violet-400",     bg: "bg-violet-500/10",   glyph: "≺" },
  follows:       { color: "text-violet-400",     bg: "bg-violet-500/10",   glyph: "≻" },
  // Apr 19 · brain-system relationships
  derived_from:  { color: "text-violet-400",     bg: "bg-violet-500/10",   glyph: "⬈" },
  grounded_in:   { color: "text-emerald-400",    bg: "bg-emerald-500/10",  glyph: "⚓" },
  predicts:      { color: "text-blue-400",       bg: "bg-blue-500/10",     glyph: "⟿" },
};
function tone(rel: string) {
  return (
    RELATIONSHIP_TONE[rel] ?? {
      color: "text-[var(--text-tertiary)]",
      bg: "bg-[var(--bg-raised)]",
      glyph: "—",
    }
  );
}

const TYPE_LABEL: Record<string, string> = {
  task: "task",
  commitment: "commit",
  reflection: "reflect",
  memory: "memory",
  brain_memory: "memory",
  brain_dump: "dump",
  mastery_decision: "decision",
  decision: "decision",
  prediction: "predict",
  loop: "task",
};

// ── The explorer ──────────────────────────────────────────────────────

export function MemoryGraphExplorer() {
  const utils = trpc.useUtils();
  const [stack, setStack] = useState<OpenMemoryGraphDetail[]>([]);
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depth, setDepth] = useState<1 | 2>(1);

  const current = stack[stack.length - 1] ?? null;
  const isOpen = current != null;

  // Listen for open events from anywhere in the app
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<OpenMemoryGraphDetail>).detail;
      if (!detail?.type || !detail?.id) return;
      setStack([detail]);
      setDepth(1);
    }
    window.addEventListener(OPEN_MEMORY_GRAPH_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MEMORY_GRAPH_EVENT, onOpen);
  }, []);

  // Load neighborhood whenever the top of the stack changes
  const load = useCallback(
    async (node: OpenMemoryGraphDetail, d: 1 | 2) => {
      setLoading(true);
      setError(null);
      try {
        const view = await utils.brain.graphNeighborhood.fetch({
          type: node.type,
          id: node.id,
          depth: d,
        });
        setData(view as GraphResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [utils],
  );

  useEffect(() => {
    if (!current) {
      setData(null);
      return;
    }
    void load(current, depth);
  }, [current, depth, load]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setStack([]);
        setData(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const pivot = useCallback((node: { type: string; id: string; label?: string }) => {
    setStack((prev) => [...prev, node]);
    setDepth(1);
  }, []);

  const back = useCallback(() => {
    setStack((prev) => (prev.length <= 1 ? [] : prev.slice(0, -1)));
  }, []);

  const close = useCallback(() => {
    setStack([]);
    setData(null);
  }, []);

  if (!isOpen) return null;

  // Group edges by relationship, directionally aware relative to root
  const rootKey = `${current!.type}:${current!.id}`;
  const outgoing = (data?.edges ?? []).filter(
    (e) => `${e.source.type}:${e.source.id}` === rootKey,
  );
  const incoming = (data?.edges ?? []).filter(
    (e) => `${e.target.type}:${e.target.id}` === rootKey,
  );
  const otherHops = (data?.edges ?? []).filter(
    (e) =>
      `${e.source.type}:${e.source.id}` !== rootKey &&
      `${e.target.type}:${e.target.id}` !== rootKey,
  );

  const nodeLabel = (type: string, id: string): string => {
    const n = data?.nodes.find((n) => n.type === type && n.id === id);
    return n?.label ?? `${type}:${id.slice(0, 8)}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={close}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-void)] shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_48px_rgba(253,185,19,0.2)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--border-default)] flex items-center gap-3">
          <Network size={14} className="text-[var(--gold)] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              Memory Graph · {TYPE_LABEL[current!.type] ?? current!.type}
            </p>
            <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">
              {current!.label ?? data?.root?.label ?? `${current!.type}:${current!.id.slice(0, 12)}`}
            </p>
          </div>
          {/* Depth toggle */}
          <div className="flex items-center border border-[var(--border-default)] rounded overflow-hidden shrink-0">
            {([1, 2] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={cn(
                  "px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors",
                  depth === d
                    ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
                )}
              >
                d{d}
              </button>
            ))}
          </div>
          {stack.length > 1 && (
            <button
              onClick={back}
              title="back"
              className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-raised)] transition-colors"
            >
              <ArrowLeft size={12} />
            </button>
          )}
          <button
            onClick={() => current && load(current, depth)}
            title="reload"
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--bg-raised)] transition-colors"
          >
            <RotateCcw size={12} />
          </button>
          <button
            onClick={close}
            title="close"
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <X size={12} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading && !data && (
            <div className="flex items-center gap-2 py-8 justify-center text-[11px] text-[var(--text-tertiary)]">
              <Loader2 size={12} className="animate-spin" />
              loading graph…
            </div>
          )}
          {error && (
            <div className="text-[11px] text-red-400">failed to load: {error}</div>
          )}
          {data && data.edges.length === 0 && !loading && (
            <div className="text-[11px] text-[var(--text-tertiary)] text-center py-8">
              no connections yet · auto-linker fires nightly, check back tomorrow
            </div>
          )}

          {/* Outgoing */}
          {outgoing.length > 0 && (
            <EdgeList title={`Outgoing · ${outgoing.length}`} edges={outgoing} side="target" onPivot={pivot} nodeLabel={nodeLabel} />
          )}
          {/* Incoming */}
          {incoming.length > 0 && (
            <EdgeList title={`Incoming · ${incoming.length}`} edges={incoming} side="source" onPivot={pivot} nodeLabel={nodeLabel} />
          )}
          {/* Depth-2 hops */}
          {otherHops.length > 0 && (
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-1.5">
                second-hop · {otherHops.length}
              </p>
              <div className="space-y-1">
                {otherHops.slice(0, 20).map((e) => (
                  // v10.0.48 — stable compound key. Pre-fix `key={i}`
                  // on a re-orderable list caused React to reuse DOM
                  // by index across pivot navigations, bleeding
                  // hover/focus state between distinct edges.
                  <EdgeRow
                    key={`${e.source.type}:${e.source.id}:${e.target.type}:${e.target.id}:${e.relationship}`}
                    edge={e}
                    side="target"
                    onPivot={pivot}
                    nodeLabel={nodeLabel}
                    compact
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer / nav stack crumb */}
        <div className="px-4 py-2 border-t border-[var(--border-default)] text-[9px] font-mono text-[var(--text-tertiary)] flex items-center gap-1 overflow-hidden">
          <span className="opacity-60">path:</span>
          {stack.map((s, i) => (
            <span key={i} className="truncate flex items-center gap-1">
              {i > 0 && <span className="opacity-40">→</span>}
              <span className={cn(i === stack.length - 1 && "text-[var(--gold)]")}>
                {s.label ?? `${s.type}:${s.id.slice(0, 8)}`}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EdgeList({
  title,
  edges,
  side,
  onPivot,
  nodeLabel,
}: {
  title: string;
  edges: GraphEdge[];
  side: "source" | "target";
  onPivot: (n: { type: string; id: string; label?: string }) => void;
  nodeLabel: (t: string, i: string) => string;
}) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-1.5">
        {title}
      </p>
      <div className="space-y-1">
        {edges.map((e) => (
          // v10.0.48 — stable compound key (see hop-2 list above).
          <EdgeRow
            key={`${e.source.type}:${e.source.id}:${e.target.type}:${e.target.id}:${e.relationship}`}
            edge={e}
            side={side}
            onPivot={onPivot}
            nodeLabel={nodeLabel}
          />
        ))}
      </div>
    </div>
  );
}

function EdgeRow({
  edge,
  side,
  onPivot,
  nodeLabel,
  compact,
}: {
  edge: GraphEdge;
  side: "source" | "target";
  onPivot: (n: { type: string; id: string; label?: string }) => void;
  nodeLabel: (t: string, i: string) => string;
  compact?: boolean;
}) {
  const other = side === "target" ? edge.target : edge.source;
  const t = tone(edge.relationship);
  const label = nodeLabel(other.type, other.id);
  const typeLabel = TYPE_LABEL[other.type] ?? other.type;
  return (
    <button
      onClick={() => onPivot({ type: other.type, id: other.id, label })}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded border transition-colors text-left",
        "border-[var(--border-default)] hover:border-[var(--gold)]/30 hover:bg-[var(--bg-raised)]",
      )}
      title={edge.evidence ?? undefined}
    >
      {/* Relationship glyph */}
      <span
        className={cn(
          "shrink-0 inline-flex items-center gap-0.5 text-[9px] font-mono rounded px-1 py-0 border",
          t.color,
          t.bg,
          "border-current/30",
        )}
      >
        <span>{t.glyph}</span>
        <span className="uppercase tracking-wider">{edge.relationship.replace("_", " ")}</span>
      </span>
      {/* Target type tag */}
      <span className="shrink-0 text-[8px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
        {typeLabel}
      </span>
      {/* Label */}
      <span className={cn("flex-1 truncate text-[var(--text-primary)]", compact ? "text-[11px]" : "text-[12px]")}>
        {label}
      </span>
      {/* Strength pill */}
      <span className="shrink-0 text-[8px] font-mono text-[var(--text-tertiary)] tabular-nums">
        {(edge.strength * 100).toFixed(0)}%
      </span>
      <ArrowRightCircle size={11} className="shrink-0 text-[var(--text-tertiary)]" />
    </button>
  );
}
