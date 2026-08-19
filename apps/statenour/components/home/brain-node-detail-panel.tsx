"use client";

/**
 * Brain node inspector · rebuilt 2026-08-19 (Brain truth pass).
 *
 * The old panel rendered ~80 lines of per-type canned prose ("why this
 * matters", "next best move", "connected leverage") that never read a
 * single field of the actual record — filler dressed as intelligence.
 * This one shows only facts the node actually carries:
 *   · the record's own content / context fields
 *   · the commit-gateway evidence class (you stated / receipt / observed /
 *     external / inferred / summary / prediction / weak) — trust, visible
 *   · attention (seen ×N · age · TTL distance) — never dressed as a %
 *   · contradiction involvement
 *   · REAL connections: in-view graph neighbors (free, from the loaded
 *     payload) + the stored MemoryEdge neighborhood via
 *     trpc.brain.graphNeighborhood — a working service that had ZERO
 *     consumers until this panel.
 *
 * Mobile: renders as a bottom sheet (the side panel was desktop-only
 * chrome on a phone screen).
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  X, MessageSquare, ArrowRight, Compass, ShieldAlert, User, Target,
  ListTodo, FileText, Settings, Sparkles, Link2, Eye, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";
import type { BrainGraphNode, BrainGraphEdge } from "@/lib/brain/brain-graph";

interface BrainNodeDetailPanelProps {
  node: BrainGraphNode;
  /** All edges currently loaded in the graph — in-view connections are
   *  derived here for free instead of refetching. */
  edges: BrainGraphEdge[];
  /** Node lookup for labeling in-view connections. */
  nodesById: Map<string, BrainGraphNode>;
  onClose: () => void;
  onFocusNode: (id: string) => void;
  onSelectNode?: (id: string) => void;
  isMobile?: boolean;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  task: ListTodo,
  goal: Target,
  mission: Sparkles,
  memory: FileText,
  journal: FileText,
  decision: ShieldAlert,
  person: User,
  system: Settings,
  business: Settings,
  project: Sparkles,
};

/** Commit-gateway class → operator-facing label. Mirrors the recall
 *  provenance vocabulary — one ladder, not a fourth taxonomy. */
const EVIDENCE_LABEL: Record<string, { text: string; cls: string }> = {
  operator_stated: { text: "you stated", cls: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10" },
  system_receipt: { text: "receipt", cls: "border-emerald-500/25 text-emerald-300/90 bg-emerald-500/5" },
  direct_observation: { text: "observed", cls: "border-cyan-500/25 text-cyan-300 bg-cyan-500/5" },
  external_source: { text: "external", cls: "border-blue-500/25 text-blue-300 bg-blue-500/5" },
  supported_inference: { text: "inferred", cls: "border-amber-500/25 text-amber-300 bg-amber-500/5" },
  generated_summary: { text: "summary", cls: "border-zinc-500/25 text-zinc-300 bg-zinc-500/5" },
  prediction: { text: "prediction", cls: "border-violet-500/25 text-violet-300 bg-violet-500/5" },
  weak_inference: { text: "weak signal", cls: "border-zinc-600/30 text-zinc-400 bg-zinc-600/10" },
};

/** graph node type → memory_edges sourceType vocabulary. Types with no
 *  presence in memory_edges skip the stored-neighborhood fetch. */
function neighborhoodType(node: BrainGraphNode): string | null {
  if (node.type === "memory") return node.metadata?.reflection ? "reflection" : "memory";
  if (node.type === "decision") return "decision";
  if (node.type === "person") return "person";
  return null;
}

/** The record's own substantive text — never invented. */
function factText(node: BrainGraphNode): string | null {
  const md = node.metadata ?? {};
  const candidates = [
    md.content,
    md.context,
    md.successMetric,
    md.nextPhysicalAction,
    md.goalWhy,
    md.relationship,
    md.lesson,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return null;
}

export function BrainNodeDetailPanel({
  node,
  edges,
  nodesById,
  onClose,
  onFocusNode,
  onSelectNode,
  isMobile = false,
}: BrainNodeDetailPanelProps) {
  const router = useRouter();
  const IconComponent = TYPE_ICONS[node.type] || FileText;

  // In-view connections — from the payload already on screen. Free.
  const inViewConnections = useMemo(() => {
    const out: Array<{ node: BrainGraphNode; type: string; origin: string }> = [];
    for (const e of edges) {
      const otherId = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
      if (!otherId) continue;
      const other = nodesById.get(otherId);
      if (other) out.push({ node: other, type: e.type, origin: e.origin });
    }
    // contradictions first, then by neighbor weight
    return out
      .sort((a, b) => (a.type === "contradicts" ? -1 : 0) - (b.type === "contradicts" ? -1 : 0) || b.node.weight - a.node.weight)
      .slice(0, 12);
  }, [edges, node.id, nodesById]);

  // Stored MemoryEdge neighborhood (typed lane) — only for types that
  // exist in memory_edges; everything else keeps the in-view list only.
  const nType = neighborhoodType(node);
  const neighborhood = trpc.brain.graphNeighborhood.useQuery(
    { type: nType ?? "memory", id: node.id, depth: 1 },
    { enabled: nType !== null, staleTime: 60_000, retry: 1 },
  );

  const evidence = node.evidence ? EVIDENCE_LABEL[node.evidence] : null;
  const fact = factText(node);

  const handleAskNick = () => {
    const promptText = `Analyze this brain node and tell me the next best move:

Node: ${node.label}
Type: ${node.type.toUpperCase()}
Status: ${node.status?.toUpperCase() || "ACTIVE"}
${node.evidence ? `Evidence class: ${node.evidence}` : ""}
${node.seenCount ? `Seen ${node.seenCount}×` : ""}
${fact ? `Content: ${fact}` : ""}
Connected in view: ${inViewConnections.map((c) => `${c.node.label} (${c.type})`).join(", ") || "nothing"}`;
    try {
      sessionStorage.setItem("chat:seed", promptText);
    } catch {
      // sessionStorage unavailable — chat still opens, unseeded
    }
    router.push("/chat");
  };

  return (
    <div
      className={cn(
        "glass-card border-(--border-default) bg-[#0A0A0A]/95 backdrop-blur-md shadow-2xl flex flex-col z-20",
        isMobile
          ? "fixed inset-x-0 bottom-0 max-h-[72vh] rounded-t-2xl rounded-b-none animate-slide-up-soft pb-[env(safe-area-inset-bottom)]"
          : "absolute right-3 top-16 bottom-3 w-80 max-w-full animate-fade-in-scale",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-(--border-default)">
        <div className="flex items-center gap-2 flex-wrap">
          <IconComponent size={14} className="text-(--gold)" />
          <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-(--text-tertiary)">
            {node.type}
          </span>
          {evidence && (
            <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-semibold font-mono uppercase tracking-wider border", evidence.cls)}>
              {evidence.text}
            </span>
          )}
          {node.contradicted && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-semibold font-mono uppercase tracking-wider border border-rose-500/30 text-rose-300 bg-rose-500/10">
              contradicted
            </span>
          )}
          {node.status && node.status !== "active" && (
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-semibold font-mono uppercase tracking-wider border",
                node.status === "risk" && "bg-rose-500/10 border-rose-500/20 text-rose-400",
                node.status === "opportunity" && "bg-(--gold)/10 border-(--gold)/20 text-(--gold)",
                node.status === "done" && "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                node.status === "stale" && "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
              )}
            >
              {node.status}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-(--text-tertiary) hover:text-(--text-primary) transition-colors p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
        <h4 className="text-sm font-semibold leading-snug text-(--text-primary)">
          {node.label}
        </h4>

        {/* Attention + time — real numbers, never percentages */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-(--text-tertiary)">
          {typeof node.seenCount === "number" && (
            <span className="inline-flex items-center gap-1"><Eye size={10} /> seen {node.seenCount}×</span>
          )}
          {typeof node.ageDays === "number" && (
            <span className="inline-flex items-center gap-1">
              <Clock size={10} />
              {node.isNew ? <span className="text-(--gold)">new · {node.ageDays}d</span> : `${node.ageDays}d old`}
            </span>
          )}
          {typeof node.expiresInDays === "number" && (
            <span className={cn(node.expiresInDays <= 7 && "text-amber-400")}>
              ttl {node.expiresInDays <= 0 ? "expired" : `${node.expiresInDays}d`}
            </span>
          )}
        </div>

        {/* The record's own content — or an honest absence */}
        {fact ? (
          <p className="text-xs text-(--text-secondary) leading-relaxed bg-black/30 p-2.5 rounded border border-(--border-default)/60 whitespace-pre-wrap">
            {fact}
          </p>
        ) : (
          <p className="text-[10px] font-mono text-(--text-tertiary) italic">
            no stored content on this node
          </p>
        )}

        {/* Connections — in view */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-(--text-tertiary) inline-flex items-center gap-1">
            <Link2 size={10} /> connected here ({inViewConnections.length})
          </span>
          {inViewConnections.length === 0 ? (
            <p className="text-[10px] font-mono text-(--text-tertiary) italic">
              unlinked in this view — isolation is signal
            </p>
          ) : (
            <ul className="space-y-1">
              {inViewConnections.map((c) => (
                <li key={`${c.node.id}-${c.type}`}>
                  <button
                    onClick={() => onSelectNode?.(c.node.id)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded border text-[10px] leading-snug transition-colors min-h-[36px]",
                      c.type === "contradicts"
                        ? "border-rose-500/30 bg-rose-500/5 text-rose-200 hover:border-rose-400/50"
                        : "border-(--border-default)/60 bg-black/20 text-(--text-secondary) hover:border-(--gold)/25",
                    )}
                  >
                    <span className="font-mono text-[8px] uppercase tracking-wider mr-1.5 opacity-70">
                      {c.type === "contradicts" ? "⚡ contradicts" : c.type.replace("_", " ")}
                    </span>
                    {c.node.label.length > 46 ? c.node.label.slice(0, 46) + "…" : c.node.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Stored neighborhood (memory_edges lane) */}
        {nType !== null && (
          <div className="space-y-1.5">
            <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-(--text-tertiary)">
              stored relationships
            </span>
            {neighborhood.isLoading ? (
              <p className="text-[10px] font-mono text-(--text-tertiary)">loading…</p>
            ) : neighborhood.isError ? (
              <p className="text-[10px] font-mono text-amber-400">
                relationship read failed — unknown, not zero
              </p>
            ) : (neighborhood.data?.nodes?.length ?? 0) === 0 ? (
              <p className="text-[10px] font-mono text-(--text-tertiary) italic">
                none recorded
              </p>
            ) : (
              <ul className="space-y-0.5">
                {neighborhood.data!.nodes.slice(0, 8).map((n) => (
                  <li key={`${n.type}:${n.id}`} className="text-[10px] text-(--text-secondary) px-2 py-1 rounded bg-black/20 border border-(--border-default)/40">
                    <span className="font-mono text-[8px] uppercase tracking-wider mr-1.5 opacity-60">{n.type}</span>
                    {n.label.length > 48 ? n.label.slice(0, 48) + "…" : n.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="pt-3 border-t border-(--border-default) flex flex-col gap-1.5">
        <button
          onClick={handleAskNick}
          className="w-full text-[10px] font-mono uppercase tracking-wider font-semibold rounded bg-(--gold) text-(--text-inverse) hover:bg-(--gold-dim) transition-colors min-h-[48px] flex items-center justify-center gap-1.5 active:scale-[0.98]"
        >
          <MessageSquare size={12} />
          ask nick about this
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onFocusNode(node.id)}
            className="text-[9px] font-mono uppercase tracking-wider rounded border border-(--border-default) bg-(--bg-elevated) text-(--text-secondary) hover:border-(--gold)/20 transition-colors min-h-[48px] flex items-center justify-center gap-1"
          >
            <Compass size={11} />
            focus graph
          </button>
          {node.href && (
            <button
              onClick={() => router.push(node.href!)}
              className="text-[9px] font-mono uppercase tracking-wider rounded border border-(--border-default) bg-(--bg-elevated) text-(--text-secondary) hover:border-(--gold)/20 transition-colors min-h-[48px] flex items-center justify-center gap-1"
            >
              open page
              <ArrowRight size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
