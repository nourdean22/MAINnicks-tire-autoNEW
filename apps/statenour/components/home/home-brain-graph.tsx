"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Compass, Expand, Maximize2, Zap, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BrainGraphNode, BrainGraphEdge, BrainGraphPayload } from "@/lib/brain/brain-graph";
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
  task: "#3B82F6",       // blue
  goal: "#A855F7",       // purple
  mission: "#06B6D4",    // cyan
  memory: "#F59E0B",     // orange/gold
  journal: "#10B981",    // emerald
  decision: "#EF4444",   // red
  person: "#EC4899",     // pink
  business: "#06B6D4",   // cyan
  project: "#06B6D4",    // cyan
  system: "#6B7280"      // gray
};

const STATUS_COLORS: Record<string, string> = {
  active: "#06B6D4",      // cyan
  stale: "#909090",       // gray
  done: "#22C55E",        // green
  risk: "#EF4444",        // red
  opportunity: "#FDB913"  // gold
};

export function HomeBrainGraph({ variant = "home", initialFocusId }: HomeBrainGraphProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Graph state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawNodes, setRawNodes] = useState<BrainGraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<BrainGraphEdge[]>([]);

  // Interactive state
  const [searchQuery, setSearchQuery] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(initialFocusId || null);
  const [selectedNode, setSelectedNode] = useState<BrainGraphNode | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Graph simulation variables
  const simNodesRef = useRef<CanvasNode[]>([]);
  const simEdgesRef = useRef<BrainGraphEdge[]>([]);
  const animationFrameIdRef = useRef<number | null>(null);
  
  // Transform states
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<CanvasNode | null>(null);
  const hoveredNodeRef = useRef<CanvasNode | null>(null);

  // Physics params
  const kRepulsion = 140;
  const kAttraction = 0.045;
  const kGravity = 0.015;
  const restLength = 80;
  const damping = 0.82;
  const energyThreshold = 0.003;

  // Track active state to put simulation to sleep
  const isSimActiveRef = useRef(true);

  // Handle mobile preview sizing
  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  }, []);

  // Physics Ticks
  const physicsTick = useCallback(() => {
    const nodes = simNodesRef.current;
    const edges = simEdgesRef.current;
    if (nodes.length === 0) return 0;

    // Center is (0, 0) because we translate the canvas to panRef
    const centerX = 0;
    const centerY = 0;

    // 1. Repulsion between all node pairs
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

    // 2. Attraction along edges
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

    // 3. Gravity pulling toward center
    nodes.forEach((node) => {
      if (node.metadata?.source === "system_seed") {
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * kGravity * 1.5;
        node.vy += dy * kGravity * 1.5;
      } else {
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx += dx * kGravity;
        node.vy += dy * kGravity;
      }
    });

    // 4. Update coordinates & compute total kinetic energy
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

  // Draw Routine
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

    // Clear background
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // High-DPI Support (devicePixelRatio capped at 2)
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    ctx.scale(dpr, dpr);

    // Apply pan & zoom
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Filter node IDs that match query
    const searchFilteredIds = new Set<string>();
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      nodes.forEach((n) => {
        if (n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q)) {
          searchFilteredIds.add(n.id);
        }
      });
    }

    // Determine neighbor nodes if one is hovered/selected
    const activeFocusId = hovered ? hovered.id : (selected ? selected.id : null);
    const focusNeighbors = new Set<string>();
    if (activeFocusId) {
      focusNeighbors.add(activeFocusId);
      edges.forEach((e) => {
        if (e.source === activeFocusId) focusNeighbors.add(e.target);
        if (e.target === activeFocusId) focusNeighbors.add(e.source);
      });
    }

    // 1. Draw Edges
    edges.forEach((edge) => {
      const src = nodes.find((n) => n.id === edge.source);
      const tgt = nodes.find((n) => n.id === edge.target);
      if (!src || !tgt) return;

      const isRelatedToFocus = activeFocusId && (edge.source === activeFocusId || edge.target === activeFocusId);
      const isSearchFiltered = searchQuery.trim() && (searchFilteredIds.has(edge.source) || searchFilteredIds.has(edge.target));

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isRelatedToFocus) {
        ctx.strokeStyle = edge.type === "contradicts" ? "rgba(239, 68, 68, 0.4)" : "rgba(253, 185, 19, 0.4)";
        ctx.lineWidth = 1.25;
      } else if (searchQuery.trim() && !isSearchFiltered) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.015)";
        ctx.lineWidth = 0.5;
      } else if (activeFocusId && !isRelatedToFocus) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
        ctx.lineWidth = 0.5;
      } else {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 0.75;
      }

      if (edge.type === "contradicts") {
        ctx.setLineDash([2, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    });

    ctx.setLineDash([]);

    // 2. Draw Nodes
    nodes.forEach((node) => {
      const isHovered = hovered && hovered.id === node.id;
      const isSelected = selected && selected.id === node.id;
      const isNeighbor = activeFocusId && focusNeighbors.has(node.id);
      const isSearchHit = searchQuery.trim() && searchFilteredIds.has(node.id);
      
      const fadeOut = (activeFocusId && !isNeighbor) || (searchQuery.trim() && !isSearchHit);
      
      const typeColor = TYPE_COLORS[node.type] || "#FFFFFF";
      const statusColor = node.status ? STATUS_COLORS[node.status] : typeColor;

      if (isHovered || isSelected || isSearchHit) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
        ctx.shadowBlur = 12;
        ctx.shadowColor = statusColor;
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = fadeOut ? "#030303" : "#0A0A0A";
      ctx.fill();

      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = fadeOut 
        ? "rgba(255, 255, 255, 0.06)" 
        : (isHovered || isSelected ? statusColor : `${statusColor}90`);
      ctx.stroke();

      if (!fadeOut) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();
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
        
        const labelText = node.label.toUpperCase();
        ctx.fillText(labelText, node.x, node.y + node.radius + 4);
      }
    });

    ctx.restore();
  }, [selectedNode, searchQuery, isMobile]);

  // Main animation / update loop
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

  // Fetch graph data
  const fetchGraphData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/brain/graph?scope=${variant === "full" ? "full" : "home"}`;
      if (localOnly && focusId) {
        url = `/api/brain/graph?focus=${focusId}&depth=2`;
      } else if (focusId) {
        url += `&focus=${focusId}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Failed to fetch graph data");
      }
      const json = await res.json();
      
      // Unwrap the apiHandler envelope if present, otherwise fallback to root object
      const payload = (json && json.ok && json.data ? json.data : json) as BrainGraphPayload;
      
      const nodesList = payload?.nodes ?? [];
      const edgesList = payload?.edges ?? [];
      
      setRawNodes(nodesList);
      setRawEdges(edgesList);

      const existingMap = new Map<string, CanvasNode>();
      simNodesRef.current.forEach((n) => existingMap.set(n.id, n));

      const newSimNodes = nodesList.map((node) => {
        const existing = existingMap.get(node.id);
        const radius = node.type === "system" || node.weight >= 8 ? 8 : 5;
        if (existing) {
          return {
            ...node,
            x: existing.x,
            y: existing.y,
            vx: existing.vx,
            vy: existing.vy,
            radius,
          };
        } else {
          const canvas = canvasRef.current;
          const w = canvas ? canvas.width : 500;
          const h = canvas ? canvas.height : 400;
          return {
            ...node,
            x: w / 2 + (Math.random() - 0.5) * 100,
            y: h / 2 + (Math.random() - 0.5) * 100,
            vx: 0,
            vy: 0,
            radius,
          };
        }
      });

      simNodesRef.current = newSimNodes;
      simEdgesRef.current = edgesList;

      if (selectedNode && !nodesList.some((n) => n.id === selectedNode.id)) {
        setSelectedNode(null);
      }

      // Check prefers-reduced-motion
      const prefersReducedMotion = typeof window !== "undefined" 
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches 
        : false;

      if (prefersReducedMotion) {
        // Pre-settle simulation synchronously to avoid active frame rendering animation loop
        for (let i = 0; i < 120; i++) {
          physicsTick();
        }
        isSimActiveRef.current = false;
        drawGraph();
      } else {
        isSimActiveRef.current = true;
        triggerAnimationLoop();
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [variant, localOnly, focusId, physicsTick, drawGraph, triggerAnimationLoop, selectedNode]);

  useEffect(() => {
    fetchGraphData();
  }, [fetchGraphData]);

  // Sync size of canvas to container
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

    // Center the graph on resize
    if (panRef.current.x === 0 && panRef.current.y === 0) {
      panRef.current = { x: logicalWidth / 2, y: logicalHeight / 2 };
    }

    // Check prefers-reduced-motion
    const prefersReducedMotion = typeof window !== "undefined" 
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches 
      : false;

    if (prefersReducedMotion) {
      isSimActiveRef.current = false;
      drawGraph();
    } else {
      isSimActiveRef.current = true;
      triggerAnimationLoop();
    }
  }, [isMobile, variant, drawGraph, triggerAnimationLoop]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    const prefersReducedMotion = typeof window !== "undefined" 
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches 
      : false;

    if (!prefersReducedMotion) {
      triggerAnimationLoop();
    }
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [triggerAnimationLoop]);

  // Screen-to-World coordinates helper
  const screenToWorld = useCallback((screenX: number, screenY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Account for pan and zoom
    const x = (screenX - rect.left - panRef.current.x) / zoomRef.current;
    const y = (screenY - rect.top - panRef.current.y) / zoomRef.current;
    return { x, y };
  }, []);

  // Canvas Event Listeners
  const handleMouseDown = (e: React.MouseEvent) => {
    if (loading || isMobile && variant === "home") return;
    const mousePos = screenToWorld(e.clientX, e.clientY);
    
    // Find if clicked node
    const clickRadius = 15;
    const clickedNode = simNodesRef.current.find((n) => {
      const dx = n.x - mousePos.x;
      const dy = n.y - mousePos.y;
      return Math.sqrt(dx * dx + dy * dy) < (n.radius + clickRadius);
    });

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
    if (loading || isMobile && variant === "home") return;

    if (draggedNodeRef.current) {
      const mousePos = screenToWorld(e.clientX, e.clientY);
      draggedNodeRef.current.x = mousePos.x;
      draggedNodeRef.current.y = mousePos.y;
      isSimActiveRef.current = true;
      triggerAnimationLoop();
    } else if (isDraggingRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      panRef.current = {
        x: panRef.current.x + dx,
        y: panRef.current.y + dy,
      };
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      isSimActiveRef.current = true;
      triggerAnimationLoop();
    } else {
      // Hover detection
      const mousePos = screenToWorld(e.clientX, e.clientY);
      const hoverNode = simNodesRef.current.find((n) => {
        const dx = n.x - mousePos.x;
        const dy = n.y - mousePos.y;
        return Math.sqrt(dx * dx + dy * dy) < (n.radius + 8);
      });

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
    if (loading || isMobile && variant === "home") return;
    e.preventDefault();

    const zoomIntensity = 0.08;
    const oldZoom = zoomRef.current;
    
    // Zoom boundary
    const delta = e.deltaY < 0 ? 1 : -1;
    const newZoom = Math.min(3.0, Math.max(0.2, oldZoom + delta * zoomIntensity));
    
    zoomRef.current = newZoom;
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  // Zoom Actions
  const zoomIn = () => {
    zoomRef.current = Math.min(3.0, zoomRef.current + 0.2);
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  const zoomOut = () => {
    zoomRef.current = Math.max(0.2, zoomRef.current - 0.2);
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  const zoomReset = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      panRef.current = { x: canvas.width / 2, y: canvas.height / 2 };
    }
    zoomRef.current = 1.0;
    isSimActiveRef.current = true;
    triggerAnimationLoop();
  };

  // Ask The Brain
  const handleAskTheBrain = () => {
    if (rawNodes.length === 0) return;

    // Create a textual summary of current graph node state
    const summary = rawNodes
      .map((node) => {
        const typeStr = `[${node.type.toUpperCase()}]`;
        const statusStr = node.status ? ` (${node.status.toUpperCase()})` : "";
        const why = node.metadata?.why ? ` - ${node.metadata.why}` : "";
        return `${typeStr} ${node.label}${statusStr}${why}`;
      })
      .join("\n");

    const promptText = `Read this brain graph snapshot and tell me what the system is telling me.

Return:
1. Strongest signal
2. Biggest risk
3. Stale area
4. Highest-leverage next move
5. One action I should take today

Graph snapshot:
${summary}`;

    try {
      sessionStorage.setItem("chat:seed", promptText);
    } catch (e) {
      // Graceful fallback
    }
    router.push("/chat");
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Search & Actions Panel */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)/70" />
          <input
            type="text"
            placeholder="Search brain nodes..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              isSimActiveRef.current = true;
              triggerAnimationLoop();
            }}
            className="w-full bg-(--bg-elevated) border border-(--border-default) rounded px-8 py-2 text-[11px] text-(--text-primary) placeholder:text-(--text-tertiary)/50 focus:border-(--gold)/40 focus:outline-none transition-colors"
          />
        </div>

        {/* Toggles */}
        {focusId && (
          <button
            type="button"
            onClick={() => {
              setLocalOnly(!localOnly);
            }}
            className={cn(
              "px-3 py-2 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors inline-flex items-center gap-1.5 min-h-[44px]",
              localOnly
                ? "bg-(--gold)/10 border-(--gold)/35 text-(--gold)"
                : "bg-(--bg-elevated) border-(--border-default) text-(--text-secondary) hover:border-(--gold)/20"
            )}
          >
            <Compass size={12} />
            {localOnly ? "local neighborhood" : "all nodes"}
          </button>
        )}

        {/* Focus Reset */}
        {focusId && (
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
        )}

        <button
          type="button"
          onClick={handleAskTheBrain}
          disabled={loading || rawNodes.length === 0}
          className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider rounded border bg-(--bg-elevated) border-(--gold)/20 text-(--gold) hover:bg-(--gold)/5 min-h-[44px] inline-flex items-center gap-1.5"
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

      {/* Canvas container block */}
      <div 
        ref={containerRef}
        className={cn(
          "relative glass-card border-(--border-default) flex-1 overflow-hidden bg-[#030303]",
          isMobile && variant === "home" ? "h-[220px] cursor-pointer" : "min-h-[360px] h-[calc(100vh-22rem)] lg:h-[calc(100vh-14rem)]"
        )}
        onClick={() => {
          if (isMobile && variant === "home") {
            router.push("/brain");
          }
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#030303]/80 z-10">
            <Loader2 size={24} className="animate-spin text-(--gold)" />
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center z-10">
            <p className="text-xs text-red-400 font-mono">ERROR: {error}</p>
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
          className={cn(
            "block cursor-grab active:cursor-grabbing w-full h-full",
            isMobile && variant === "home" && "pointer-events-none"
          )}
        />

        {/* Canvas floating Controls */}
        {!isMobile && (
          <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
            <button
              onClick={zoomIn}
              className="w-8 h-8 rounded bg-black/60 border border-(--border-default) hover:border-(--gold)/40 hover:text-(--gold) text-xs font-mono font-bold flex items-center justify-center"
              title="Zoom In"
            >
              +
            </button>
            <button
              onClick={zoomOut}
              className="w-8 h-8 rounded bg-black/60 border border-(--border-default) hover:border-(--gold)/40 hover:text-(--gold) text-xs font-mono font-bold flex items-center justify-center"
              title="Zoom Out"
            >
              -
            </button>
            <button
              onClick={zoomReset}
              className="w-8 h-8 rounded bg-black/60 border border-(--border-default) hover:border-(--gold)/40 hover:text-(--gold) text-xs flex items-center justify-center"
              title="Reset View"
            >
              <Expand size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Selected Node Details Side Pane */}
      {selectedNode && (
        <BrainNodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
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
