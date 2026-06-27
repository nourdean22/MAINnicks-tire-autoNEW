import { prisma } from "@/lib/prisma";

export type BrainGraphNode = {
  id: string;
  type:
    | "task"
    | "goal"
    | "mission"
    | "memory"
    | "journal"
    | "decision"
    | "person"
    | "business"
    | "project"
    | "system";
  label: string;
  weight: number;
  status?: "active" | "stale" | "done" | "risk" | "opportunity";
  href?: string;
  metadata?: Record<string, unknown>;
};

export type BrainGraphEdge = {
  source: string;
  target: string;
  type:
    | "related"
    | "supports"
    | "blocks"
    | "mentions"
    | "belongs_to"
    | "depends_on"
    | "contradicts";
  weight: number;
};

export type BrainGraphPayload = {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  generatedAt: string;
  scope: "home" | "full" | "focus";
};

const SYSTEM_ANCHORS: BrainGraphNode[] = [
  // High-level life nodes
  { id: "nour-os", type: "system", label: "NOUR OS", weight: 9, status: "active", href: "/system", metadata: { source: "system_seed", why: "Core operations portal", nextMove: "Expose bottlenecks" } },
  { id: "business", type: "business", label: "BUSINESS", weight: 8, status: "active", href: "/business", metadata: { source: "system_seed", why: "Empire lane for wealth and enterprise scaling", nextMove: "Optimize conversions" } },
  { id: "discipline", type: "system", label: "DISCIPLINE", weight: 8, status: "active", href: "/brain", metadata: { source: "system_seed", why: "Habits and self-governance foundation", nextMove: "Protect daily routines" } },
  { id: "fitness", type: "system", label: "FITNESS", weight: 7, status: "active", href: "/goals", metadata: { source: "system_seed", why: "Health and energy optimization", nextMove: "Track daily workout check-in" } },
  { id: "player-stat", type: "system", label: "PLAYER STAT", weight: 7, status: "active", href: "/scoreboard", metadata: { source: "system_seed", why: "Character stats and XP monitoring", nextMove: "Review weekly delta logs" } },
  { id: "family-vision", type: "system", label: "FAMILY VISION", weight: 7, status: "active", href: "/goals", metadata: { source: "system_seed", why: "Social and relationship legacy", nextMove: "Check family check-in cadence" } },
  { id: "fertility", type: "system", label: "FERTILITY", weight: 6, status: "active", href: "/goals", metadata: { source: "system_seed", why: "Health domain and legacy focus", nextMove: "Track bio-markers" } },
  { id: "content", type: "system", label: "CONTENT", weight: 6, status: "active", href: "/content", metadata: { source: "system_seed", why: "Audience growth and marketing asset generation", nextMove: "Schedule post creation" } },

  // Nick's business anchors
  { id: "nicks-tire", type: "business", label: "NICK'S TIRE", weight: 8, status: "active", href: "/business", metadata: { source: "system_seed", why: "Primary business operations", nextMove: "Sync CRM leads" } },

  // AI nodes
  { id: "ollama-glm", type: "system", label: "OLLAMA GLM-5.2", weight: 6, status: "active", href: "/system", metadata: { source: "system_seed", why: "Primary local reasoning engine", nextMove: "Validate health ping" } },
  { id: "gemini-backup", type: "system", label: "GEMINI BACKUP", weight: 5, status: "active", href: "/system", metadata: { source: "system_seed", why: "Fallback large-context reasoning", nextMove: "Check rate limit status" } },
  { id: "provider-hud", type: "system", label: "PROVIDER HUD", weight: 5, status: "active", href: "/system", metadata: { source: "system_seed", why: "Observability for model status and costs", nextMove: "Review latencies" } },
  { id: "chat-ui", type: "system", label: "CHAT UI", weight: 6, status: "active", href: "/chat", metadata: { source: "system_seed", why: "Active conversation operator mode", nextMove: "Open chat conversation" } },
  { id: "brain-graph", type: "system", label: "BRAIN GRAPH", weight: 6, status: "active", href: "/brain", metadata: { source: "system_seed", why: "Self-model visualization map", nextMove: "Check context coverage" } },
  { id: "homepage-cc", type: "system", label: "HOMEPAGE CC", weight: 7, status: "active", href: "/", metadata: { source: "system_seed", why: "Nour Command Center entry portal", nextMove: "Audit daily checklist" } }
];

export async function getBrainGraph(params: {
  scope?: "home" | "full";
  focus?: string;
  depth?: number;
  limit?: number;
  minConfidence?: number;
  categories?: string[];
}): Promise<BrainGraphPayload> {
  const scope = params.scope ?? "full";
  const limit = params.limit ?? (scope === "home" ? 60 : 150);
  const minConfidence = params.minConfidence ?? 0.5;
  const depth = params.depth ?? 2;

  // 1. Fetch DB elements based on scope
  const isHome = scope === "home";

  // Active/recent counts
  const counts = isHome
    ? { missions: 10, tasks: 12, goals: 8, dumps: 5, reflections: 5, decisions: 5, people: 5, memories: 8 }
    : { missions: 25, tasks: 40, goals: 15, dumps: 15, reflections: 15, decisions: 15, people: 15, memories: 30 };

  const [
    dbMissions,
    dbTasks,
    dbGoals,
    dbDumps,
    dbReflections,
    dbDecisions,
    dbPeople,
    dbMemories,
  ] = await Promise.all([
    // Missions
    prisma.mission.findMany({
      where: { deletedAt: null, ...(isHome && { status: "ACTIVE" }) },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: counts.missions,
    }),
    // Tasks
    prisma.task.findMany({
      where: {
        deletedAt: null,
        ...(isHome ? { status: { in: ["READY", "DOING"] } } : { status: { not: "ARCHIVED" } }),
      },
      orderBy: [{ autoPriority: "desc" }, { createdAt: "desc" }],
      take: counts.tasks,
    }),
    // Life Goals
    prisma.lifeGoal.findMany({
      where: { deletedAt: null, ...(isHome && { status: "active" }) },
      orderBy: [{ progress: "asc" }, { createdAt: "desc" }],
      take: counts.goals,
    }),
    // Journal Brain Dumps
    prisma.brainDump.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: counts.dumps,
    }),
    // Reflections
    prisma.reflection.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: counts.reflections,
    }),
    // Decisions (DecisionReplay has mission/goal fields)
    prisma.decisionReplay.findMany({
      orderBy: { createdAt: "desc" },
      take: counts.decisions,
    }),
    // Person Profiles
    prisma.personProfile.findMany({
      where: { deletedAt: null, ...(isHome && { status: "active" }) },
      orderBy: { lastInteraction: "desc" },
      take: counts.people,
    }),
    // Brain memories (filter by categories if present)
    prisma.brainMemory.findMany({
      where: {
        deletedAt: null,
        confidence: { gte: minConfidence },
        category: {
          in: params.categories && params.categories.length > 0
            ? params.categories
            : ["wisdom", "insight", "pattern", "blind_spot", "strategic_plan", "decision_pattern"],
        },
      },
      orderBy: [{ confidence: "desc" }, { lastSeen: "desc" }],
      take: counts.memories,
    }),
  ]);

  const nodes: BrainGraphNode[] = [];
  const edges: BrainGraphEdge[] = [];

  // Helper to add nodes with duplicate prevention
  const nodeIds = new Set<string>();
  const addNode = (n: BrainGraphNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };

  // Helper to add edges with duplicate prevention (undirected key)
  const edgeKeys = new Set<string>();
  const addEdge = (e: BrainGraphEdge) => {
    const key1 = `${e.source}_${e.target}_${e.type}`;
    const key2 = `${e.target}_${e.source}_${e.type}`;
    if (!edgeKeys.has(key1) && !edgeKeys.has(key2) && e.source !== e.target) {
      edgeKeys.add(key1);
      edges.push(e);
    }
  };

  // 2. Map Database Nodes to Graph Nodes
  // Missions -> Project / Project-Mission
  dbMissions.forEach((m) => {
    let status: BrainGraphNode["status"] = "active";
    if (m.status === "COMPLETE") status = "done";
    else if (m.status === "PAUSED") status = "stale";
    else if (m.neglectCost && m.neglectCost > 70) status = "risk";
    else if (m.roiScore && m.roiScore > 75) status = "opportunity";

    addNode({
      id: m.id,
      type: "mission",
      label: m.title,
      weight: Math.min(10, Math.max(3, m.priority || 5)),
      status,
      href: `/missions`,
      metadata: {
        source: "database",
        neglectCost: m.neglectCost,
        roiScore: m.roiScore,
        priority: m.priority,
        why: m.successMetric || "Missions drive structural progress",
        nextMove: "Review active tasks on this mission",
      },
    });
  });

  // Tasks
  dbTasks.forEach((t) => {
    let status: BrainGraphNode["status"] = "active";
    if (t.status === "DONE") status = "done";
    else if (t.status === "INBOX") status = "stale";
    else if (t.driftRisk && t.driftRisk > 70) status = "risk";

    addNode({
      id: t.id,
      type: "task",
      label: t.title,
      weight: Math.min(10, Math.max(2, t.autoPriority ?? 5)),
      status,
      href: `/`,
      metadata: {
        source: "database",
        taskStatus: t.status,
        dueDate: t.dueDate?.toISOString(),
        driftRisk: t.driftRisk,
        why: t.nextPhysicalAction || "Action item",
        nextMove: t.finishCondition || "Complete task",
      },
    });
  });

  // Life Goals
  dbGoals.forEach((g) => {
    let status: BrainGraphNode["status"] = "active";
    if (g.status === "achieved") status = "done";
    else if (g.status === "missed") status = "risk";
    else if (g.status === "paused") status = "stale";

    addNode({
      id: g.id,
      type: "goal",
      label: g.title,
      weight: Math.min(10, Math.max(4, Math.floor(g.progress / 10))),
      status,
      href: `/goals`,
      metadata: {
        source: "database",
        progress: g.progress,
        domain: g.domain,
        horizon: g.horizon,
        why: g.why || "Goal establishes standard",
        nextMove: "Analyze milestones and track progress",
      },
    });
  });

  // Journal Dumps
  dbDumps.forEach((d) => {
    addNode({
      id: d.id,
      type: "journal",
      label: d.summary || `${d.date} Journal Dump`,
      weight: 4,
      status: "active",
      href: `/journal`,
      metadata: {
        source: "database",
        date: d.date,
        moodBefore: d.moodBefore,
        moodAfter: d.moodAfter,
        why: "Operator brain dump",
        nextMove: "Check extracted task items",
      },
    });
  });

  // Reflections
  dbReflections.forEach((r) => {
    addNode({
      id: r.id,
      type: "memory",
      label: r.insight.length > 80 ? r.insight.slice(0, 80) + "..." : r.insight,
      weight: Math.min(10, Math.max(3, Math.floor(r.confidence * 10))),
      status: r.actionable && !r.acknowledged ? "opportunity" : "active",
      href: `/brain?tab=wisdom`,
      metadata: {
        source: "database",
        category: r.category,
        confidence: r.confidence,
        why: r.insight,
        nextMove: r.actionable ? "Review reflection and act" : "Maintain observation",
      },
    });
  });

  // Decisions
  dbDecisions.forEach((dec) => {
    addNode({
      id: dec.id,
      type: "decision",
      label: dec.title,
      weight: 5,
      status: dec.reviewed ? "done" : "active",
      href: `/decisions`,
      metadata: {
        source: "database",
        choiceMade: dec.choiceMade,
        outcome: dec.outcome,
        why: dec.context || "Decision context",
        nextMove: dec.lesson ? `Lesson: ${dec.lesson}` : "Track decision outcome",
      },
    });
  });

  // Person Profiles
  dbPeople.forEach((p) => {
    let status: BrainGraphNode["status"] = "active";
    if (p.trustScore < 0.4) status = "risk";
    else if (p.trustScore > 0.8) status = "opportunity";

    addNode({
      id: p.id,
      type: "person",
      label: p.name,
      weight: Math.min(10, Math.max(3, Math.floor(p.trustScore * 10))),
      status,
      href: `/people`,
      metadata: {
        source: "database",
        role: p.role,
        trustScore: p.trustScore,
        why: p.relationship || "Key relationship",
        nextMove: p.leverageNotes ? `Leverage: ${p.leverageNotes}` : "Maintain communication cadence",
      },
    });
  });

  // Brain Memories
  dbMemories.forEach((m) => {
    let status: BrainGraphNode["status"] = "active";
    if (m.category === "blind_spot") status = "risk";
    else if (m.category === "wisdom" || m.category === "insight") status = "opportunity";

    addNode({
      id: m.id,
      type: "memory",
      label: m.key.length > 80 ? m.key.slice(0, 80) + "..." : m.key,
      weight: Math.min(10, Math.max(3, Math.floor(m.confidence * 10))),
      status,
      href: `/brain`,
      metadata: {
        source: "database",
        category: m.category,
        confidence: m.confidence,
        why: m.content.slice(0, 200),
        nextMove: "Check context matches",
      },
    });
  });

  // Add system anchors
  SYSTEM_ANCHORS.forEach((anchor) => {
    addNode(anchor);
  });

  // 3. Construct Implicit Edges from DB Foreign Keys
  // Tasks -> Missions, Goals, People
  dbTasks.forEach((t) => {
    if (t.missionId && nodeIds.has(t.missionId)) {
      addEdge({ source: t.id, target: t.missionId, type: "belongs_to", weight: 0.8 });
    }
    if (t.goalId && nodeIds.has(t.goalId)) {
      addEdge({ source: t.id, target: t.goalId, type: "belongs_to", weight: 0.8 });
    }
    if (t.personId && nodeIds.has(t.personId)) {
      addEdge({ source: t.id, target: t.personId, type: "related", weight: 0.7 });
    }
    if (t.parentTaskId && nodeIds.has(t.parentTaskId)) {
      addEdge({ source: t.id, target: t.parentTaskId, type: "depends_on", weight: 0.9 });
    }
  });

  // Missions -> Goals
  dbMissions.forEach((m) => {
    if (m.lifeGoalId && nodeIds.has(m.lifeGoalId)) {
      addEdge({ source: m.id, target: m.lifeGoalId, type: "belongs_to", weight: 0.9 });
    }
  });

  // Journal Dumps -> Missions, Goals
  dbDumps.forEach((d) => {
    if (d.missionId && nodeIds.has(d.missionId)) {
      addEdge({ source: d.id, target: d.missionId, type: "mentions", weight: 0.6 });
    }
    if (d.goalId && nodeIds.has(d.goalId)) {
      addEdge({ source: d.id, target: d.goalId, type: "mentions", weight: 0.6 });
    }
  });

  // Reflections -> Missions, Goals
  dbReflections.forEach((r) => {
    if (r.missionId && nodeIds.has(r.missionId)) {
      addEdge({ source: r.id, target: r.missionId, type: "related", weight: 0.7 });
    }
    if (r.goalId && nodeIds.has(r.goalId)) {
      addEdge({ source: r.id, target: r.goalId, type: "related", weight: 0.7 });
    }
  });

  // Decisions -> Missions, Goals
  dbDecisions.forEach((dec) => {
    if (dec.missionId && nodeIds.has(dec.missionId)) {
      addEdge({ source: dec.id, target: dec.missionId, type: "related", weight: 0.7 });
    }
    if (dec.goalId && nodeIds.has(dec.goalId)) {
      addEdge({ source: dec.id, target: dec.goalId, type: "related", weight: 0.7 });
    }
  });

  // 4. Fetch DB Explicit Edges (MemoryEdge + SemanticEdge)
  const currentIds = Array.from(nodeIds);
  if (currentIds.length > 0) {
    const [dbEdges, dbSemanticEdges] = await Promise.all([
      // MemoryEdge
      prisma.memoryEdge.findMany({
        where: {
          OR: [
            { sourceId: { in: currentIds } },
            { targetId: { in: currentIds } },
          ],
        },
      }),
      // SemanticEdge
      prisma.semanticEdge.findMany({
        where: {
          OR: [
            { fromMemoryId: { in: currentIds } },
            { toMemoryId: { in: currentIds } },
          ],
          score: { gte: 0.6 },
        },
      }),
    ]);

    // Map MemoryEdge
    dbEdges.forEach((e) => {
      if (nodeIds.has(e.sourceId) && nodeIds.has(e.targetId)) {
        let type: BrainGraphEdge["type"] = "related";
        if (e.relationship === "blocks") type = "blocks";
        else if (e.relationship === "supports" || e.relationship === "causes" || e.relationship === "leads_to") type = "supports";
        else if (e.relationship === "contradicts") type = "contradicts";
        else if (e.relationship === "depends_on") type = "depends_on";

        addEdge({
          source: e.sourceId,
          target: e.targetId,
          type,
          weight: e.strength,
        });
      }
    });

    // Map SemanticEdge
    dbSemanticEdges.forEach((se) => {
      if (nodeIds.has(se.fromMemoryId) && nodeIds.has(se.toMemoryId)) {
        addEdge({
          source: se.fromMemoryId,
          target: se.toMemoryId,
          type: "related",
          weight: se.score,
        });
      }
    });
  }

  // 5. Connect Static System Anchor Seeds
  // Connect AI nodes to NOUR OS
  addEdge({ source: "ollama-glm", target: "nour-os", type: "belongs_to", weight: 0.8 });
  addEdge({ source: "gemini-backup", target: "nour-os", type: "belongs_to", weight: 0.7 });
  addEdge({ source: "provider-hud", target: "nour-os", type: "belongs_to", weight: 0.7 });
  addEdge({ source: "chat-ui", target: "nour-os", type: "belongs_to", weight: 0.8 });
  addEdge({ source: "brain-graph", target: "nour-os", type: "belongs_to", weight: 0.8 });
  addEdge({ source: "homepage-cc", target: "nour-os", type: "belongs_to", weight: 0.9 });

  // Connect NOUR OS to Discipline
  addEdge({ source: "nour-os", target: "discipline", type: "supports", weight: 0.9 });

  // Connect Business to Nick's Tire
  addEdge({ source: "nicks-tire", target: "business", type: "related", weight: 0.8 });

  // Connect live DB elements to anchors based on their domain/tags
  nodes.forEach((node) => {
    if (node.metadata?.source === "system_seed") return;

    if (node.type === "goal" && node.metadata?.domain) {
      const dom = String(node.metadata.domain).toLowerCase();
      if (dom === "fitness" || dom === "health") {
        addEdge({ source: node.id, target: "fitness", type: "supports", weight: 0.8 });
      } else if (dom === "business" || dom === "finance") {
        addEdge({ source: node.id, target: "business", type: "supports", weight: 0.8 });
      } else if (dom === "personal" || dom === "career") {
        addEdge({ source: node.id, target: "discipline", type: "supports", weight: 0.7 });
      }
    }

    if (node.type === "mission" && node.metadata?.priority) {
      // Missions match anchors based on seed classification
      const title = node.label.toLowerCase();
      if (title.includes("tire") || title.includes("shop") || title.includes("auto")) {
        addEdge({ source: node.id, target: "nicks-tire", type: "belongs_to", weight: 0.8 });
      } else if (title.includes("diet") || title.includes("gym") || title.includes("workout") || title.includes("run")) {
        addEdge({ source: node.id, target: "fitness", type: "supports", weight: 0.8 });
      } else if (title.includes("post") || title.includes("video") || title.includes("write") || title.includes("grow")) {
        addEdge({ source: node.id, target: "content", type: "supports", weight: 0.8 });
      } else {
        addEdge({ source: node.id, target: "discipline", type: "supports", weight: 0.6 });
      }
    }
  });

  // 6. BFS Neighborhood Extraction (Focus Mode)
  if (params.focus) {
    const focusNode = nodes.find((n) => n.id === params.focus);
    if (focusNode) {
      const focusNodesMap = new Map<string, BrainGraphNode>();
      const focusEdges: BrainGraphEdge[] = [];
      focusNodesMap.set(focusNode.id, focusNode);

      let currentQueue = [focusNode.id];
      const visited = new Set<string>([focusNode.id]);

      const visitedEdges = new Set<string>();
      const addFocusEdge = (e: BrainGraphEdge) => {
        const key1 = `${e.source}_${e.target}_${e.type}`;
        const key2 = `${e.target}_${e.source}_${e.type}`;
        if (!visitedEdges.has(key1) && !visitedEdges.has(key2)) {
          visitedEdges.add(key1);
          focusEdges.push(e);
        }
      };

      for (let d = 0; d < depth; d++) {
        const nextQueue: string[] = [];
        edges.forEach((edge) => {
          let neighborId: string | null = null;
          if (edge.source === currentQueue[0] || currentQueue.includes(edge.source)) {
            neighborId = edge.target;
          } else if (edge.target === currentQueue[0] || currentQueue.includes(edge.target)) {
            neighborId = edge.source;
          }

          if (neighborId) {
            const neighborNode = nodes.find((n) => n.id === neighborId);
            if (neighborNode) {
              focusNodesMap.set(neighborNode.id, neighborNode);
              addFocusEdge(edge);
              if (!visited.has(neighborId)) {
                visited.add(neighborId);
                nextQueue.push(neighborId);
              }
            }
          }
        });
        currentQueue = nextQueue;
        if (currentQueue.length === 0) break;
      }

      return {
        nodes: Array.from(focusNodesMap.values()),
        edges: focusEdges,
        generatedAt: new Date().toISOString(),
        scope: "focus",
      };
    }
  }

  // 7. Connectivity pass: ensure no nodes are floating
  // Calculate which nodes actually have edges in the final set
  const resolveConnectivity = (finalNodes: BrainGraphNode[], finalEdges: BrainGraphEdge[]) => {
    const connected = new Set<string>();
    finalEdges.forEach(e => {
      connected.add(e.source);
      connected.add(e.target);
    });

    finalNodes.forEach(node => {
      if (node.metadata?.source !== "system_seed" && !connected.has(node.id)) {
        let targetAnchor = "nour-os";
        if (node.type === "memory" || node.type === "journal" || node.type === "decision") targetAnchor = "brain-graph";
        else if (node.type === "task") targetAnchor = "discipline";
        else if (node.type === "person") targetAnchor = "family-vision";
        else if (node.type === "goal" || node.type === "mission") {
          targetAnchor = String(node.metadata?.domain).toLowerCase() === "business" ? "business" : "discipline";
        }
        
        finalEdges.push({
          source: node.id,
          target: targetAnchor,
          type: "belongs_to",
          weight: 0.3
        });
      }
    });
  };

  // If home scope, clamp nodes list to top 60-80 max
  if (isHome) {
    // Sort nodes to keep: seeds + highest-weight tasks/goals/missions
    const filteredNodes = nodes
      .sort((a, b) => {
        if (a.metadata?.source === "system_seed" && b.metadata?.source !== "system_seed") return -1;
        if (a.metadata?.source !== "system_seed" && b.metadata?.source === "system_seed") return 1;
        return b.weight - a.weight;
      })
      .slice(0, 70);

    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );

    resolveConnectivity(filteredNodes, filteredEdges);

    return {
      nodes: filteredNodes,
      edges: filteredEdges,
      generatedAt: new Date().toISOString(),
      scope: "home",
    };
  }

  resolveConnectivity(nodes, edges);

  return {
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    scope: "full",
  };
}
