"use client";

/**
 * Brain graph client · rebuilt 2026-08-19 (Brain truth pass).
 *
 * Reliability contract — the graph ALWAYS converges to one of:
 *   USEFUL · DEGRADED (named missing domains) · EMPTY · ACTIONABLE ERROR.
 * Never an indefinite spinner. The old component could hang forever and
 * made it worse by interacting:
 *   · bare fetch with no AbortController/timeout — a hung request meant a
 *     mathematically permanent spinner (setLoading(false) only in finally)
 *   · fetchGraphData's dep chain included selectedNode + searchQuery (via
 *     drawGraph → triggerAnimationLoop), so EVERY keystroke and node
 *     click re-fired the full network fetch, un-aborted — a congestion
 *     ratchet against a 10-connection pool.
 * Now: fetch fires only on [variant, focusId, localOnly]; each request
 * carries an AbortController + 12s timeout; a sequence guard drops stale
 * responses; refresh keeps the old graph on screen (shimmer, not
 * overlay); search and lenses are pure client-side filters.
 *
 * Product contract:
 *   · LENSES — one brain, several honest views (type/domain filters over
 *     the loaded payload; no refetch, no invented structure)
 *   · TRUST — evidence class → node ring opacity; contradiction → rose
 *     halo + dashed edge; NEW (<7d) → gold ring notch; the only glow is
 *     the focused node (color encodes ONE variable per channel)
 *   · MOTION only on state change: the sim settles then freezes; drag,
 *     expand and select re-heat it briefly
 *   · TOUCH — pan / tap-select / pinch-zoom. The old canvas had mouse
 *     handlers only: on the operator's iPhone the "full" graph was inert.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Compass, Expand, Maximize2, Zap, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { BrainGraphNode, BrainGraphEdge, BrainGraphPayload } from "@/lib/brain/brain-graph";
import { BrainNodeDetailPanel } from "./brain-node-detail-panel";

interface CanvasNode extends BrainGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface HomeBrainGraphProps {
  variant?: "home" | "full";
  initialFocusId?: string;
}

const TYPE_COLORS: Record<string, string> = {
  task: "#3B82F6",
  goal: "#A855F7",
  mission: "#06B6D4",
  memory: "#F59E0B",
  journal: "#10B981",
  decision: "#EF4444",
  person: "#EC4899",
  business: "#06B6D4",
  project: "#06B6D4",
  system: "#6B7280",
};

const STATUS_COLORS: Record<string, string> = {
  active: "#06B6D4",
  stale: "#909090",
  done: "#22C55E",
  risk: "#EF4444",
  opportunity: "#FDB913",
};

/** Evidence tier → node body opacity. Trust is VISIBLE: an inference can
 *  never render as solid as something the operator stated. */
const EVIDENCE_ALPHA: Record<string, number> = {
  operator_stated: 1,
  system_receipt: 0.95,
  direct_observation: 0.9,
  external_source: 0.85,
  supported_inference: 0.7,
  generated_summary: 0.55,
  prediction: 0.55,
  weak_inference: 0.45,
};

/** Lenses — client-side filters over the loaded payload. Honest views,
 *  not queries: they can only hide, never invent. */
const LENSES: Array<{ key: string; label: string; match: (n: BrainGraphNode) => boolean }> = [
  { key: "all", label: "ALL", match: () => true },
  {
    key: "business",
    label: "BUSINESS",
    match: (n) =>
      n.type === "business" ||
      n.id === "business" || n.id === "nicks-tire" ||
      String(n.metadata?.domain ?? "").toLowerCase() === "business" ||
      String(n.metadata?.domain ?? "").toLowerCase() === "finance",
  },
  { key: "people", label: "PEOPLE", match: (n) => n.type === "person" },
  { key: "goals", label: "GOALS", match: (n) => n.type === "goal" || n.type === "mission" || n.type === "task" },
  { key: "decisions", label: "DECISIONS", match: (n) => n.type === "decision" },
  { key: "mind", label: "MIND", match: (n) => n.type === "memory" || n.type === "journal" || n.metadata?.source === "category_hub" },
  { key: "recent", label: "LAST 30D", match: (n) => typeof n.ageDays === "number" && n.ageDays <= 30 },
];

type LoadState =
  | { phase: "initial" }
  | { phase: "ready"; refreshing: boolean }
  | { phase: "empty" }
  | { phase: "error"; message: string };

const FETCH_TIMEOUT_MS = 12_000;

export function HomeBrainGraph({ variant = "home", initialFocusId }: HomeBrainGraphProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [loadState, setLoadState] = useState<LoadState>({ phase: "initial" });
  const [degraded, setDegraded] = useState<string[]>([]);
  const [rawNodes, setRawNodes] = useState<BrainGraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<BrainGraphEdge[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [lens, setLens] = useState("all");
  const [localOnly, setLocalOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(initialFocusId || null);
  const [selectedNode, setSelectedNode] = useState<BrainGraphNode | null>(null);

  const simNodesRef = useRef<CanvasNode[]>([]);
  const simEdgesRef = useRef<BrainGraphEdge[]>([]);
  const animationFrameIdRef = useRef<number | null>(null);

  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<CanvasNode | null>(null);
  const hoveredNodeRef = useRef<CanvasNode | null>(null);
  const pinchDistRef = useRef<number | null>(null);
  const touchMovedRef = useRef(false);

  // Physics
  const kRepulsion = 140;
  const kAttraction = 0.045;
  const kGravity = 0.015;
  const restLength = 80;
  const damping = 0.82;
  const energyThreshold = 0.003;
  const isSimActiveRef = useRef(true);

  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  }, []);

  const nodesById = useMemo(() => {
    const m = new Map<string, BrainGraphNode>();
    rawNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [rawNodes]);

  // ── Lens + search visibility (pure client-side, no refetch) ─────────
  const visibleIds = useMemo(() => {
    const activeLens = LENSES.find((l) => l.key === lens) ?? LENSES[0];
    const ids = new Set<string>();
    rawNodes.forEach((n) => {
      if (activeLens.match(n)) ids.add(n.id);
    });
    // Lens keeps neighbors-of-matches so the view stays a graph, not
    // confetti: one hop out from every lens match.
    if (lens !== "all") {
      rawEdges.forEach((e) => {
        if (ids.has(e.source)) ids.add(e.target);
        else if (ids.has(e.target)) ids.add(e.source);
      });
    }
    return ids;
  }, [rawNodes, rawEdges, lens]);

  // ── Physics tick ────────────────────────────────────────────────────
  const physicsTick = useCallback(() => {
    const nodes = simNodesRef.current;
    const edges = simEdgesRef.current;
    if (nodes.length === 0) return 0;

    for (let i = 0; i < nodes.length; i++) {
      const nodeI = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeJ = nodes[j];
        const dx = nodeJ.x - nodeI.x;
        const dy = nodeJ.y - nodeI.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 260) {
          const force = (kRepulsion * (nodeI.weight + 2) * (nodeJ.weight + 2)) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodeI.vx -= fx;
          nodeI.vy -= fy;
          nodeJ.vx += fx;
          nodeJ.vy += fy;
        }
      }
    }

    const nodesMap = new Map<string, CanvasNode>();
    nodes.forEach((n) => nodesMap.set(n.id, n));
    edges.forEach((edge) => {
      const src = nodesMap.get(edge.source);
      const tgt = nodesMap.get(edge.target);
      if (src && tgt) {
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = kAttraction * (dist - restLength);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const srcWeight = src.metadata?.source === "system_seed" ? 0.3 : 1;
        const tgtWeight = tgt.metadata?.source === "system_seed" ? 0.3 : 1;
        src.vx += fx * srcWeight;
        src.vy += fy * srcWeight;
        tgt.vx -= fx * tgtWeight;
        tgt.vy -= fy * tgtWeight;
      }
    });

    nodes.forEach((node) => {
      const g = node.metadata?.source === "system_seed" ? kGravity * 1.5 : kGravity;
      node.vx += (0 - node.x) * g;
      node.vy += (0 - node.y) * g;
    });

    let totalVelocitySq = 0;
    nodes.forEach((node) => {
      if (node === draggedNodeRef.current) {
        node.vx = 0;
        node.vy = 0;
        return;
      }
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= damping;
      node.vy *= damping;
      totalVelocitySq += node.vx * node.vx + node.vy * node.vy;
    });

    return totalVelocitySq / nodes.length;
  }, []);

  // ── Draw ────────────────────────────────────────────────────────────
  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = simNodesRef.current;
    const edges = simEdgesRef.current;
    const pan = panRef.current;
    const zoom = zoomRef.current;
    const hovered = hoveredNodeRef.current;
    const selected = selectedNode;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    ctx.scale(dpr, dpr);
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const searchFilteredIds = new Set<string>();
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      nodes.forEach((n) => {
        if (n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)) {
          searchFilteredIds.add(n.id);
        }
      });
    }

    const activeFocusId = hovered ? hovered.id : selected ? selected.id : null;
    const focusNeighbors = new Set<string>();
    if (activeFocusId) {
      focusNeighbors.add(activeFocusId);
      edges.forEach((e) => {
        if (e.source === activeFocusId) focusNeighbors.add(e.target);
        if (e.target === activeFocusId) focusNeighbors.add(e.source);
      });
    }

    const nodeMap = new Map<string, CanvasNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    // Edges
    edges.forEach((edge) => {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) return;
      const isRelatedToFocus = activeFocusId && (edge.source === activeFocusId || edge.target === activeFocusId);
      const isSearchDimmed = searchQuery.trim() && !(searchFilteredIds.has(edge.source) || searchFilteredIds.has(edge.target));

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      if (edge.type === "contradicts") {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = isRelatedToFocus ? "rgba(244, 63, 94, 0.65)" : "rgba(244, 63, 94, 0.35)";
        ctx.lineWidth = isRelatedToFocus ? 1.5 : 1;
      } else if (isRelatedToFocus) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(253, 185, 19, 0.4)";
        ctx.lineWidth = 1.25;
      } else if (isSearchDimmed || (activeFocusId && !isRelatedToFocus)) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
        ctx.lineWidth = 0.5;
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 0.75;
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Nodes
    nodes.forEach((node) => {
      const isHovered = hovered?.id === node.id;
      const isSelected = selected?.id === node.id;
      const isNeighbor = activeFocusId && focusNeighbors.has(node.id);
      const isSearchHit = searchQuery.trim() && searchFilteredIds.has(node.id);
      const fadeOut = (activeFocusId && !isNeighbor) || (searchQuery.trim() && !isSearchHit);

      const typeColor = TYPE_COLORS[node.type] || "#FFFFFF";
      const statusColor = node.status ? STATUS_COLORS[node.status] : typeColor;
      const evidenceAlpha = node.evidence ? (EVIDENCE_ALPHA[node.evidence] ?? 0.8) : 1;

      // Focus glow — the ONLY glow on the canvas.
      if (isHovered || isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        ctx.shadowBlur = 12;
        ctx.shadowColor = statusColor;
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.fill();
        ctx.restore();
      }

      // Contradiction halo — dashed rose ring, trust made visible.
      if (node.contradicted && !fadeOut) {
        ctx.beginPath();
        ctx.setLineDash([2, 3]);
        ctx.arc(node.x, node.y, node.radius + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(244, 63, 94, 0.7)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = fadeOut ? "#030303" : "#0A0A0A";
      ctx.fill();
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.globalAlpha = fadeOut ? 1 : evidenceAlpha;
      ctx.strokeStyle = fadeOut
        ? "rgba(255, 255, 255, 0.06)"
        : isHovered || isSelected
          ? statusColor
          : `${statusColor}90`;
      ctx.stroke();

      if (!fadeOut) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // NEW notch — small gold arc, top-right. Recency, not decoration.
      if (node.isNew && !fadeOut) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 2, -Math.PI * 0.45, -Math.PI * 0.05);
        ctx.strokeStyle = "#FDB913";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      const isHub = node.weight >= 8 || node.type === "system";
      const shouldDrawLabel = isHovered || isSelected || isHub || (activeFocusId && isNeighbor) || isSearchHit;
      if (shouldDrawLabel && !isMobile) {
        ctx.font = isHovered || isSelected
          ? "700 9px Barlow Condensed, Geist, sans-serif"
          : "600 8px Barlow Condensed, Geist, sans-serif";
        ctx.fillStyle = fadeOut ? "rgba(255, 255, 255, 0.15)" : "#F0F0F0";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const labelText = node.type === "system" ? node.label.toUpperCase() : node.label;
        ctx.fillText(labelText.length > 34 ? labelText.slice(0, 34) + "…" : labelText, node.x, node.y + node.radius + 4);
      }
    });

    ctx.restore();
  }, [selectedNode, searchQuery, isMobile]);

  const triggerAnimationLoop = useCallback(() => {
    if (animationFrameIdRef.current) return;
    const runLoop = () => {
      if (!isSimActiveRef.current) {
        animationFrameIdRef.current = null;
        return;
      }
      const kineticEnergy = physicsTick();
      drawGraph();
      const isUserInteracting = isDraggingRef.current || draggedNodeRef.current;
      if (kineticEnergy < energyThreshold && !isUserInteracting) {
        isSimActiveRef.current = false;
      }
      animationFrameIdRef.current = requestAnimationFrame(runLoop);
    };
    animationFrameIdRef.current = requestAnimationFrame(runLoop);
  }, [physicsTick, drawGraph]);

  // ── Sim node sync (payload or lens change → rebuild sim sets) ───────
  const syncSimSets = useCallback(
    (nodesList: BrainGraphNode[], edgesList: BrainGraphEdge[], visible: Set<string> | null) => {
      const shownNodes = visible ? nodesList.filter((n) => visible.has(n.id)) : nodesList;
      const shownIds = new Set(shownNodes.map((n) => n.id));
      const shownEdges = edgesList.filter((e) => shownIds.has(e.source) && shownIds.has(e.target));

      const existingMap = new Map<string, CanvasNode>();
      simNodesRef.current.forEach((n) => existingMap.set(n.id, n));
      const canvas = canvasRef.current;
      const w = canvas ? canvas.width : 500;
      const h = canvas ? canvas.height : 400;

      simNodesRef.current = shownNodes.map((node) => {
        const existing = existingMap.get(node.id);
        const radius = node.type === "system" || node.weight >= 8 ? 8 : 5;
        if (existing) {
          return { ...node, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, radius };
        }
        return {
          ...node,
          x: w / 2 + (Math.random() - 0.5) * 100,
          y: h / 2 + (Math.random() - 0.5) * 100,
          vx: 0,
          vy: 0,
          radius,
        };
      });
      simEdgesRef.current = shownEdges;

      const prefersReducedMotion =
        typeof window !== "undefined"
          ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
          : false;
      if (prefersReducedMotion) {
        for (let i = 0; i < 120; i++) physicsTick();
        isSimActiveRef.current = false;
        drawGraph();
      } else {
        isSimActiveRef.current = true;
        triggerAnimationLoop();
      }
    },
    [physicsTick, drawGraph, triggerAnimationLoop],
  );

  // Re-sync sim when lens changes (client-side, zero network)
  useEffect(() => {
    if (rawNodes.length > 0) {
      syncSimSets(rawNodes, rawEdges, lens === "all" ? null : visibleIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens, visibleIds]);

  // ── Fetch — single-flight, aborted, sequence-guarded ────────────────
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchGraphData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    setLoadState((prev) =>
      prev.phase === "ready" ? { phase: "ready", refreshing: true } : { phase: "initial" },
    );

    try {
      let url = `/api/brain/graph?scope=${variant === "full" ? "full" : "home"}`;
      if (localOnly && focusId) {
        url = `/api/brain/graph?focus=${focusId}&depth=2`;
      } else if (focusId) {
        url += `&focus=${focusId}`;
      }

      const res = await fetch(url, { signal: controller.signal });
      if (seq !== requestSeqRef.current) return; // stale response — drop
      if (!res.ok) {
        throw new Error(res.status === 401 ? "session expired — reload to sign in" : `graph request failed (${res.status})`);
      }
      const json = await res.json();
      const payload = (json && json.ok && json.data ? json.data : json) as BrainGraphPayload;
      const nodesList = payload?.nodes ?? [];
      const edgesList = payload?.edges ?? [];

      setRawNodes(nodesList);
      setRawEdges(edgesList);
      setDegraded(payload?.degraded ?? []);
      setSelectedNode((prev) => (prev && !nodesList.some((n) => n.id === prev.id) ? null : prev));
      setLoadState(nodesList.length === 0 ? { phase: "empty" } : { phase: "ready", refreshing: false });
      syncSimSets(nodesList, edgesList, null);
    } catch (err) {
      if (seq !== requestSeqRef.current) return; // superseded — not an error
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const message = aborted
        ? `graph request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : "graph request failed";
      // Keep showing existing data if we have it — a failed refresh must
      // not destroy a working graph.
      setLoadState((prev) =>
        prev.phase === "ready" ? { phase: "ready", refreshing: false } : { phase: "error", message },
      );
    } finally {
      clearTimeout(timeoutId);
    }
    // NOTE deps: variant/focusId/localOnly ONLY. selectedNode and
    // searchQuery must never re-fire the network — that was the storm.
  }, [variant, localOnly, focusId, syncSimSets]);

  useEffect(() => {
    fetchGraphData();
    return () => abortRef.current?.abort();
  }, [fetchGraphData]);

  // ── Canvas sizing ───────────────────────────────────────────────────
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const logicalWidth = rect.width;
    const logicalHeight = isMobile && variant === "home" ? 220 : rect.height;
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    if (panRef.current.x === 0 && panRef.current.y === 0) {
      panRef.current = { x: logicalWidth / 2, y: logicalHeight / 2 };
    }
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  }, [isMobile, variant, triggerAnimationLoop]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, []);

  // ── Pointer helpers ─────────────────────────────────────────────────
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (screenX - rect.left - panRef.current.x) / zoomRef.current;
    const y = (screenY - rect.top - panRef.current.y) / zoomRef.current;
    return { x, y };
  }, []);

  const nodeAt = useCallback(
    (screenX: number, screenY: number, slop = 15) => {
      const p = screenToWorld(screenX, screenY);
      return simNodesRef.current.find((n) => {
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        return Math.sqrt(dx * dx + dy * dy) < n.radius + slop;
      });
    },
    [screenToWorld],
  );

  const interactionBlocked = loadState.phase === "initial" || (isMobile && variant === "home");

  // Mouse
  const handleMouseDown = (e: React.MouseEvent) => {
    if (interactionBlocked) return;
    const clickedNode = nodeAt(e.clientX, e.clientY);
    if (clickedNode) {
      draggedNodeRef.current = clickedNode;
      setSelectedNode(clickedNode);
    } else {
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (interactionBlocked) return;
    if (draggedNodeRef.current) {
      const p = screenToWorld(e.clientX, e.clientY);
      draggedNodeRef.current.x = p.x;
      draggedNodeRef.current.y = p.y;
      isSimActiveRef.current = true;
      triggerAnimationLoop();
    } else if (isDraggingRef.current) {
      panRef.current = {
        x: panRef.current.x + (e.clientX - dragStartRef.current.x),
        y: panRef.current.y + (e.clientY - dragStartRef.current.y),
      };
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      isSimActiveRef.current = true;
      triggerAnimationLoop();
    } else {
      const hoverNode = nodeAt(e.clientX, e.clientY, 8);
      if (hoverNode !== hoveredNodeRef.current) {
        hoveredNodeRef.current = hoverNode || null;
        isSimActiveRef.current = true;
        triggerAnimationLoop();
      }
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    draggedNodeRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (interactionBlocked) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    zoomRef.current = Math.min(3.0, Math.max(0.2, zoomRef.current + delta * 0.08));
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  // Touch — pan / tap-select / pinch-zoom. New: the old canvas had NO
  // touch handlers, so on the phone the full graph was frozen scenery.
  const handleTouchStart = (e: React.TouchEvent) => {
    if (interactionBlocked) return;
    touchMovedRef.current = false;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      return;
    }
    const t = e.touches[0];
    isDraggingRef.current = true;
    dragStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (interactionBlocked) return;
    if (e.touches.length === 2 && pinchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / pinchDistRef.current;
      pinchDistRef.current = dist;
      zoomRef.current = Math.min(3.0, Math.max(0.2, zoomRef.current * ratio));
      touchMovedRef.current = true;
      isSimActiveRef.current = true;
      triggerAnimationLoop();
      return;
    }
    const t = e.touches[0];
    const dx = t.clientX - dragStartRef.current.x;
    const dy = t.clientY - dragStartRef.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) touchMovedRef.current = true;
    panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    dragStartRef.current = { x: t.clientX, y: t.clientY };
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (interactionBlocked) return;
    if (pinchDistRef.current !== null && e.touches.length < 2) pinchDistRef.current = null;
    isDraggingRef.current = false;
    if (!touchMovedRef.current && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      const tapped = nodeAt(t.clientX, t.clientY, 18);
      if (tapped) {
        setSelectedNode(tapped);
        isSimActiveRef.current = true;
        triggerAnimationLoop();
      }
    }
  };

  const zoomBy = (delta: number) => {
    zoomRef.current = Math.min(3.0, Math.max(0.2, zoomRef.current + delta));
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  const zoomReset = () => {
    const canvas = canvasRef.current;
    if (canvas) panRef.current = { x: canvas.width / 2, y: canvas.height / 2 };
    zoomRef.current = 1.0;
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  const handleAskTheBrain = () => {
    if (rawNodes.length === 0) return;
    const summary = rawNodes
      .filter((n) => visibleIds.has(n.id) || lens === "all")
      .slice(0, 120)
      .map((node) => {
        const typeStr = `[${node.type.toUpperCase()}]`;
        const statusStr = node.status ? ` (${node.status.toUpperCase()})` : "";
        const ev = node.evidence ? ` <${node.evidence}>` : "";
        return `${typeStr} ${node.label}${statusStr}${ev}`;
      })
      .join("\n");
    const promptText = `Analyze this brain graph snapshot and extract extreme-leverage insights. Expose blind spots and identify the single highest-leverage move I am missing.

Graph snapshot (lens: ${lens}):
${summary}

Rules: do not hallucinate nodes not in the snapshot. Inference-class nodes (<supported_inference>, <weak_inference>) are hypotheses, not facts. Be direct.

Format:
1. Dominant Signal
2. Asymmetric Risk
3. Contrarian Arbitrage
4. Ultimate Execution`;
    try {
      sessionStorage.setItem("chat:seed", promptText);
    } catch {
      // sessionStorage unavailable — chat opens unseeded
    }
    router.push("/chat");
  };

  const showInitialSpinner = loadState.phase === "initial";
  const showRefreshChip = loadState.phase === "ready" && loadState.refreshing;

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Search + lenses + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)/70" />
          <input
            type="text"
            placeholder="Search the brain…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              isSimActiveRef.current = true;
              triggerAnimationLoop();
            }}
            className="w-full bg-(--bg-elevated) border border-(--border-default) rounded px-8 py-2.5 text-[11px] text-(--text-primary) placeholder:text-(--text-tertiary)/50 focus:border-(--gold)/40 focus:outline-none transition-colors min-h-[44px]"
          />
        </div>

        {focusId && (
          <>
            <button
              type="button"
              onClick={() => setLocalOnly(!localOnly)}
              className={cn(
                "px-3 py-2 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors inline-flex items-center gap-1.5 min-h-[44px]",
                localOnly
                  ? "bg-(--gold)/10 border-(--gold)/35 text-(--gold)"
                  : "bg-(--bg-elevated) border-(--border-default) text-(--text-secondary) hover:border-(--gold)/20",
              )}
            >
              <Compass size={12} />
              {localOnly ? "local neighborhood" : "all nodes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusId(null);
                setLocalOnly(false);
              }}
              className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider rounded border bg-(--bg-elevated) border-(--border-default) text-(--text-secondary) hover:border-(--gold)/20 min-h-[44px]"
            >
              reset focus
            </button>
          </>
        )}

        <button
          type="button"
          onClick={handleAskTheBrain}
          disabled={loadState.phase !== "ready"}
          className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider rounded border bg-(--bg-elevated) border-(--gold)/20 text-(--gold) hover:bg-(--gold)/5 min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          <Zap size={12} className="fill-(--gold)" />
          ask the brain
        </button>

        {variant === "home" && !isMobile && (
          <button
            type="button"
            onClick={() => router.push("/brain")}
            className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider rounded border bg-(--bg-elevated) border-(--border-default) text-(--text-secondary) hover:border-(--gold)/20 min-h-[44px] inline-flex items-center gap-1.5"
          >
            <Maximize2 size={11} />
            fullscreen
          </button>
        )}
      </div>

      {/* Lens chips — full variant only; a lens can only hide, never invent */}
      {variant === "full" && (
        <div className="flex flex-wrap gap-1.5">
          {LENSES.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => setLens(l.key)}
              className={cn(
                "px-3 py-2 rounded-full border text-[9px] font-mono uppercase tracking-[0.14em] transition-colors min-h-[40px]",
                lens === l.key
                  ? "bg-(--gold)/12 border-(--gold)/40 text-(--gold)"
                  : "bg-(--bg-elevated) border-(--border-default) text-(--text-tertiary) hover:text-(--text-secondary) hover:border-(--gold)/15",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className={cn(
          "relative glass-card border-(--border-default) flex-1 overflow-hidden bg-[#030303]",
          isMobile && variant === "home" ? "h-[220px] cursor-pointer" : "min-h-[360px] h-[calc(100vh-24rem)] lg:h-[calc(100vh-16rem)]",
        )}
        onClick={() => {
          if (isMobile && variant === "home") router.push("/brain");
        }}
      >
        {/* USEFUL · DEGRADED · EMPTY · ERROR — never permanent uncertainty */}
        {showInitialSpinner && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#030303]/80 z-10">
            <Loader2 size={24} className="animate-spin text-(--gold)" />
            <span className="text-[9px] font-mono uppercase tracking-wider text-(--text-tertiary)">
              loading brain · times out in {FETCH_TIMEOUT_MS / 1000}s
            </span>
          </div>
        )}

        {loadState.phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center z-10">
            <AlertTriangle size={20} className="text-rose-400" />
            <p className="text-xs text-rose-300 font-mono max-w-sm">{loadState.message}</p>
            <button
              type="button"
              onClick={() => fetchGraphData()}
              className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider rounded border border-(--gold)/30 text-(--gold) hover:bg-(--gold)/10 min-h-[48px] inline-flex items-center gap-1.5"
            >
              <RefreshCw size={12} />
              retry
            </button>
          </div>
        )}

        {loadState.phase === "empty" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center z-10">
            <p className="text-xs text-(--text-secondary) font-mono">the brain returned no nodes</p>
            <p className="text-[10px] text-(--text-tertiary) font-mono max-w-xs">
              genuinely empty — not an error. Capture memories, missions or goals and they appear here.
            </p>
          </div>
        )}

        {degraded.length > 0 && loadState.phase === "ready" && (
          <div className="absolute top-3 left-3 z-10 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-[8px] font-mono uppercase tracking-wider text-amber-300">
            degraded · missing: {degraded.join(", ")}
          </div>
        )}

        {showRefreshChip && (
          <div className="absolute top-3 right-3 z-10 px-2 py-1 rounded bg-black/60 border border-(--border-default) text-[8px] font-mono uppercase tracking-wider text-(--text-tertiary) inline-flex items-center gap-1">
            <Loader2 size={9} className="animate-spin" />
            refreshing
          </div>
        )}

        {isMobile && variant === "home" && (
          <div className="absolute top-3 left-3 z-10 px-2 py-0.5 rounded bg-black/60 border border-(--gold)/25 text-[8px] font-mono uppercase tracking-wider text-(--gold)">
            TAP TO EXPLORE FULL GRAPH
          </div>
        )}

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={cn(
            "block cursor-grab active:cursor-grabbing w-full h-full touch-none",
            isMobile && variant === "home" && "pointer-events-none",
          )}
        />

        {!isMobile && (
          <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
            <button onClick={() => zoomBy(0.2)} className="w-8 h-8 rounded bg-black/60 border border-(--border-default) hover:border-(--gold)/40 hover:text-(--gold) text-xs font-mono font-bold flex items-center justify-center" title="Zoom In">+</button>
            <button onClick={() => zoomBy(-0.2)} className="w-8 h-8 rounded bg-black/60 border border-(--border-default) hover:border-(--gold)/40 hover:text-(--gold) text-xs font-mono font-bold flex items-center justify-center" title="Zoom Out">-</button>
            <button onClick={zoomReset} className="w-8 h-8 rounded bg-black/60 border border-(--border-default) hover:border-(--gold)/40 hover:text-(--gold) text-xs flex items-center justify-center" title="Reset View"><Expand size={12} /></button>
          </div>
        )}
      </div>

      {selectedNode && (
        <BrainNodeDetailPanel
          node={selectedNode}
          edges={rawEdges}
          nodesById={nodesById}
          isMobile={isMobile}
          onClose={() => setSelectedNode(null)}
          onSelectNode={(id) => {
            const n = nodesById.get(id);
            if (n) setSelectedNode(n);
          }}
          onFocusNode={(nodeId) => {
            setFocusId(nodeId);
            setLocalOnly(true);
            setSelectedNode(null);
          }}
        />
      )}
    </div>
  );
}
