"use client";

/**
 * /relationships/network — Power Atlas Phase 3 network graph view.
 *
 * Renders the operator's people-graph as a simple SVG circle-pack:
 * nodes positioned on a single ring (sorted by centrality so high-
 * centrality nodes anchor consecutive sectors · prevents visual jumps
 * across reloads), edges drawn as straight lines between them. Bridge
 * nodes (top-3 by degree) get the amber accent · everyone else uses
 * the muted dark/gold palette.
 *
 * Pure SVG · no D3 / no force layout / no canvas library. ~150 LOC.
 *
 * Aesthetic matches the rest of /relationships:
 *   · 1px borders rgba(255,255,255,0.06)
 *   · monospace counts (font-mono tabular-nums)
 *   · serif page title (StandardPage handles)
 *   · NO emojis · text-only labels
 *   · quiet motion (mount fade via StandardPage)
 */

import { useMemo } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import { FreshnessChip } from "@/components/ui/freshness-chip";

interface NetworkNode {
  id: string;
  name: string;
  role: string;
  trustScore: number;
  status: string;
  centrality: number;
  isBridge: boolean;
}

interface NetworkEdge {
  source: string;
  target: string;
  weight: number;
}

interface NetworkResponse {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  generatedAt: string;
}

const SVG_SIZE = 720;
const PADDING = 60;
const RADIUS = SVG_SIZE / 2 - PADDING;
const CENTER = SVG_SIZE / 2;

interface PositionedNode extends NetworkNode {
  x: number;
  y: number;
}

function nodeRadius(n: NetworkNode): number {
  // base 6px, scales up to 14px at centrality=1
  return 6 + n.centrality * 8;
}

function nodeFill(n: NetworkNode): string {
  if (n.isBridge) return "#f59e0b"; // amber-500
  if (n.trustScore >= 0.7) return "#10b981"; // emerald-500
  if (n.trustScore >= 0.4) return "#71717a"; // zinc-500
  return "#52525b"; // zinc-600
}

export default function NetworkPage() {
  const { data, loading, error, reload } = usePollingFetch<NetworkResponse>(
    "/api/people/network",
    { intervalMs: 0 }, // no polling · operator reloads explicitly
  );

  // Position nodes on a ring sorted by centrality (highest first ·
  // stable across reloads since the API returns nodes in profile-id
  // order which is also stable).
  const positioned = useMemo<PositionedNode[]>(() => {
    if (!data?.nodes) return [];
    const sorted = [...data.nodes].sort(
      (a, b) => b.centrality - a.centrality,
    );
    return sorted.map((n, i) => {
      const angle = (i / Math.max(1, sorted.length)) * 2 * Math.PI - Math.PI / 2;
      return {
        ...n,
        x: CENTER + RADIUS * Math.cos(angle),
        y: CENTER + RADIUS * Math.sin(angle),
      };
    });
  }, [data]);

  const nodeMap = useMemo(() => {
    const m: Map<string, PositionedNode> = new Map();
    for (const n of positioned) m.set(n.id, n);
    return m;
  }, [positioned]);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      nodes: data.nodes.length,
      edges: data.edges.length,
      bridges: data.nodes.filter((n) => n.isBridge).length,
    };
  }, [data]);

  return (
    <StandardPage
      eyebrow="brain · relationships · network"
      title="network graph"
      description="Power Atlas · co-mention edges over the last 180 days · top-3 by degree flagged as bridge nodes (amber)"
      rhythm="comfortable"
      width="2xl"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt}
          source="network-analysis engine"
          onReload={reload}
        />
      }
    >
      {totals && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="people" value={totals.nodes} tint="text-[var(--text-primary)]" />
          <Stat label="connections" value={totals.edges} tint="text-emerald-300" />
          <Stat label="bridges" value={totals.bridges} tint="text-amber-300" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-4 text-sm text-red-300">
          Failed to load network · {String(error)}
        </div>
      )}

      {loading && !data && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          Loading network…
        </div>
      )}

      {data && data.nodes.length === 0 && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          No people profiles yet · the network graph builds from co-mentions in chat history.
        </div>
      )}

      {data && data.nodes.length > 0 && (
        <div
          className="rounded-xl border bg-[var(--bg-raised)] p-4"
          style={{ borderColor: "rgba(255,255,255,0.06)" }}
        >
          <svg
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-auto"
          >
            {/* Edges first so nodes render on top */}
            {data.edges.map((e, i) => {
              const a = nodeMap.get(e.source);
              const b = nodeMap.get(e.target);
              if (!a || !b) return null;
              const opacity = Math.min(0.5, 0.1 + e.weight * 0.04);
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="rgba(255,255,255,0.4)"
                  strokeOpacity={opacity}
                  strokeWidth={Math.max(0.5, Math.min(2, e.weight * 0.3))}
                />
              );
            })}

            {/* Nodes */}
            {positioned.map((n) => (
              <g key={n.id}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={nodeRadius(n)}
                  fill={nodeFill(n)}
                  fillOpacity={0.85}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="1"
                />
                <text
                  x={n.x}
                  y={n.y - nodeRadius(n) - 6}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.75)"
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                >
                  {n.name}
                </text>
              </g>
            ))}
          </svg>
          <p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            amber · top-3 bridges · emerald · trust ≥ 0.7 · grey · everyone else · edge opacity = co-mention frequency
          </p>
        </div>
      )}
    </StandardPage>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3 text-center">
      <div className={`text-2xl font-bold font-mono tabular-nums ${tint}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </div>
    </div>
  );
}
