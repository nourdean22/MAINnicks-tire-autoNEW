/**
 * lib/brain/brain-graph.ts · rebuilt 2026-08-19 (Brain truth pass).
 *
 * The graph payload for /brain and the Home brain card. Three contracts,
 * each earned by a documented failure of the previous version:
 *
 * 1. DEGRADED, NEVER HUNG. The old builder was one 8-query Promise.all —
 *    the widest DB fan-out in the app — against a 10-connection pool with
 *    an untimed checkout queue, so any contention turned into a request
 *    that never settled (prod's #1 error pattern, 730/1,427 rows in 30d,
 *    is the same starvation class). Domains now load via allSettled with
 *    a per-domain deadline: a slow domain arrives MISSING AND NAMED in
 *    `degraded`, and the rest of the brain still renders.
 *
 * 2. HONEST RELATIONSHIPS ONLY. The old graph invented edges: keyword
 *    matching (`title.includes("tire")`), and a blanket "connect every
 *    orphan to an anchor" pass. Every edge now has a real source: a
 *    foreign key, a MemoryEdge row, a SemanticEdge row, a contradiction
 *    pair, a goal's own domain field, or category membership (a memory
 *    IS in its category — structural, not inferred). Unlinked nodes stay
 *    visibly unlinked; that isolation is signal, not a rendering bug.
 *
 * 3. EPISTEMIC CHROME. Memory nodes carry the commit gateway's evidence
 *    ladder (operator_stated → weak_inference), seenCount, age, TTL
 *    distance, and contradiction involvement — so the client can render
 *    trust instead of pretending a re-sighting count is a probability.
 *    (Confidence here IS `0.5 + 0.1×(sightings−1)`; weight therefore
 *    derives from seenCount and is labeled as attention, never as truth.)
 *
 * The 6 fossil "AI" anchor nodes (OLLAMA GLM-5.2, GEMINI BACKUP, …) are
 * deleted — they contradicted CURRENT-TRUTH's "never assert a model name
 * in prose" and rendered a 2026-05 snapshot as if it were the present.
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  evidenceClassForSource,
  type MemoryEvidenceClass,
} from "@/lib/brain/memory-commit-gateway";

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
  /** Commit-gateway evidence class — memory nodes only. */
  evidence?: MemoryEvidenceClass;
  /** Re-sighting count (attention, not truth) — memory nodes only. */
  seenCount?: number;
  /** Days since creation. */
  ageDays?: number;
  /** Created within the last 7 days. */
  isNew?: boolean;
  /** Days until TTL expiry (null = no TTL). Negative = past due. */
  expiresInDays?: number | null;
  /** This node is one side of an UNRESOLVED contradiction pair. */
  contradicted?: boolean;
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
  /** Where this edge came from — every edge must name its evidence. */
  origin: "fk" | "memory_edge" | "semantic" | "contradiction" | "category" | "domain";
};

export type BrainGraphPayload = {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  generatedAt: string;
  scope: "home" | "full" | "focus";
  /** Domains that failed or timed out during this build — the client
   *  must render these as DEGRADED, never as silently-absent data. */
  degraded: string[];
  /** Unresolved contradiction pairs present in this payload. */
  contradictionCount: number;
};

/** Life-domain anchors. Real, operator-defined structure — kept. The six
 *  fossil AI/UI nodes that used to live here are gone. */
const SYSTEM_ANCHORS: BrainGraphNode[] = [
  { id: "nour-os", type: "system", label: "NOUR OS", weight: 9, status: "active", href: "/system", metadata: { source: "system_seed" } },
  { id: "business", type: "business", label: "BUSINESS", weight: 8, status: "active", href: "/business", metadata: { source: "system_seed" } },
  { id: "nicks-tire", type: "business", label: "NICK'S TIRE", weight: 8, status: "active", href: "/business", metadata: { source: "system_seed" } },
  { id: "discipline", type: "system", label: "DISCIPLINE", weight: 8, status: "active", href: "/brain", metadata: { source: "system_seed" } },
  { id: "fitness", type: "system", label: "FITNESS", weight: 7, status: "active", href: "/goals", metadata: { source: "system_seed" } },
  { id: "family-vision", type: "system", label: "FAMILY VISION", weight: 7, status: "active", href: "/goals", metadata: { source: "system_seed" } },
  { id: "fertility", type: "system", label: "FERTILITY", weight: 6, status: "active", href: "/goals", metadata: { source: "system_seed" } },
  { id: "content", type: "system", label: "CONTENT", weight: 6, status: "active", href: "/content", metadata: { source: "system_seed" } },
];

/** goal.domain / mission-domain → anchor id. Only REAL domain fields feed
 *  this — the old `title.includes("tire")` keyword matching is gone. */
const DOMAIN_ANCHOR: Record<string, string> = {
  business: "business",
  finance: "business",
  fitness: "fitness",
  health: "fitness",
  family: "family-vision",
  relationships: "family-vision",
  fertility: "fertility",
  content: "content",
  personal: "discipline",
  career: "discipline",
  discipline: "discipline",
};

const DAY_MS = 86_400_000;

/** A machine key like `blindspot_domain_1712...` is chrome for a database,
 *  not a label for a human. Prefer the content when the key isn't prose. */
function humanizeMemoryLabel(key: string, content: string): string {
  const keyIsProse = /\s/.test(key) && !/^[a-z0-9_:\-.]+$/i.test(key);
  const base = keyIsProse ? key : (content.trim() || key);
  const flat = base.replace(/\s+/g, " ").trim();
  return flat.length > 72 ? flat.slice(0, 72) + "…" : flat;
}

/** Per-domain deadline: a domain that can't answer in time becomes a
 *  NAMED degraded entry instead of holding the whole brain hostage. */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

const DOMAIN_DEADLINE_MS = 8_000;

interface StoredContradictionContent {
  new_memory_id?: string;
  old_memory_id?: string;
  status?: string;
}

export async function getBrainGraph(params: {
  scope?: "home" | "full";
  focus?: string;
  depth?: number;
  limit?: number;
  minConfidence?: number;
  categories?: string[];
}): Promise<BrainGraphPayload> {
  const scope = params.scope ?? "full";
  const minConfidence = params.minConfidence ?? 0.5;
  const depth = params.depth ?? 2;
  const isHome = scope === "home";

  const counts = isHome
    ? { missions: 10, tasks: 12, goals: 8, dumps: 5, reflections: 5, decisions: 5, people: 5, memories: 8 }
    : { missions: 25, tasks: 40, goals: 15, dumps: 15, reflections: 15, decisions: 15, people: 15, memories: 30 };

  const degraded: string[] = [];

  // ── 1. Node domains · allSettled + per-domain deadline ──────────────
  const domainQueries = {
    missions: prisma.mission.findMany({
      where: { deletedAt: null, ...(isHome && { status: "ACTIVE" }) },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: counts.missions,
    }),
    tasks: prisma.task.findMany({
      where: {
        deletedAt: null,
        ...(isHome ? { status: { in: ["READY", "DOING"] } } : { status: { not: "ARCHIVED" } }),
      },
      orderBy: [{ autoPriority: "desc" }, { createdAt: "desc" }],
      take: counts.tasks,
    }),
    goals: prisma.lifeGoal.findMany({
      where: { deletedAt: null, ...(isHome && { status: "active" }) },
      orderBy: [{ progress: "asc" }, { createdAt: "desc" }],
      take: counts.goals,
    }),
    journals: prisma.brainDump.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: counts.dumps,
    }),
    reflections: prisma.reflection.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: counts.reflections,
    }),
    decisions: prisma.decisionReplay.findMany({
      orderBy: { createdAt: "desc" },
      take: counts.decisions,
    }),
    people: prisma.personProfile.findMany({
      where: { deletedAt: null, ...(isHome && { status: "active" }) },
      orderBy: { lastInteraction: "desc" },
      take: counts.people,
    }),
    memories: prisma.brainMemory.findMany({
      where: {
        deletedAt: null,
        confidence: { gte: minConfidence },
        category: {
          in: params.categories && params.categories.length > 0
            ? params.categories
            // Verified against prod 2026-08-19 — every category here has
            // rows above the confidence floor (insight 1,062 · wisdom 282
            // · blind_spot 252 · pattern 46 · strategic_plan 1 ·
            // decision_pattern 1). Two speculative additions ("belief",
            // "contradiction_flag") were removed after measuring: both
            // are ZERO rows, i.e. dead filters that only cost query width.
            : ["wisdom", "insight", "pattern", "blind_spot", "strategic_plan", "decision_pattern"],
        },
      },
      orderBy: [{ lastSeen: "desc" }, { confidence: "desc" }],
      take: counts.memories,
      select: {
        id: true,
        category: true,
        key: true,
        content: true,
        source: true,
        confidence: true,
        seenCount: true,
        lastSeen: true,
        createdAt: true,
        expiresAt: true,
      },
    }),
  } as const;

  type DomainKey = keyof typeof domainQueries;
  const domainKeys = Object.keys(domainQueries) as DomainKey[];
  const settled = await Promise.allSettled(
    // Each entry is a PrismaPromise of a DIFFERENT row type; widen to
    // unknown[] at the race boundary and narrow per-domain below.
    domainKeys.map((k) =>
      withDeadline(domainQueries[k] as unknown as Promise<unknown[]>, DOMAIN_DEADLINE_MS, k),
    ),
  );
  const domainResult = <T>(key: DomainKey): T[] => {
    const idx = domainKeys.indexOf(key);
    const r = settled[idx];
    if (r.status === "fulfilled") return r.value as T[];
    degraded.push(key);
    return [];
  };

  // Row shapes differ per domain; each mapper below reads only the
  // fields its own query selected.
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const dbMissions = domainResult<Row>("missions");
  const dbTasks = domainResult<Row>("tasks");
  const dbGoals = domainResult<Row>("goals");
  const dbDumps = domainResult<Row>("journals");
  const dbReflections = domainResult<Row>("reflections");
  const dbDecisions = domainResult<Row>("decisions");
  const dbPeople = domainResult<Row>("people");
  const dbMemories = domainResult<Row>("memories");

  const nodes: BrainGraphNode[] = [];
  const edges: BrainGraphEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: BrainGraphNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };
  const edgeKeys = new Set<string>();
  const addEdge = (e: BrainGraphEdge) => {
    const key1 = `${e.source}_${e.target}_${e.type}`;
    const key2 = `${e.target}_${e.source}_${e.type}`;
    if (!edgeKeys.has(key1) && !edgeKeys.has(key2) && e.source !== e.target) {
      edgeKeys.add(key1);
      edges.push(e);
    }
  };

  const now = Date.now();
  const ageDaysOf = (d: Date) => Math.floor((now - d.getTime()) / DAY_MS);

  // ── 2. Map database rows → nodes ────────────────────────────────────
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
      ageDays: ageDaysOf(m.createdAt),
      isNew: ageDaysOf(m.createdAt) < 7,
      metadata: {
        source: "database",
        neglectCost: m.neglectCost,
        roiScore: m.roiScore,
        priority: m.priority,
        successMetric: m.successMetric ?? null,
      },
    });
  });

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
      // Tasks live on the /missions surface — the old href was Home.
      href: `/missions`,
      ageDays: ageDaysOf(t.createdAt),
      isNew: ageDaysOf(t.createdAt) < 7,
      metadata: {
        source: "database",
        taskStatus: t.status,
        dueDate: t.dueDate?.toISOString(),
        driftRisk: t.driftRisk,
        nextPhysicalAction: t.nextPhysicalAction ?? null,
      },
    });
  });

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
      ageDays: ageDaysOf(g.createdAt),
      isNew: ageDaysOf(g.createdAt) < 7,
      metadata: {
        source: "database",
        progress: g.progress,
        domain: g.domain,
        horizon: g.horizon,
        goalWhy: g.why ?? null,
      },
    });
  });

  dbDumps.forEach((d) => {
    addNode({
      id: d.id,
      type: "journal",
      label: d.summary || `${d.date} journal`,
      weight: 4,
      status: "active",
      href: `/journal`,
      ageDays: ageDaysOf(d.createdAt),
      isNew: ageDaysOf(d.createdAt) < 7,
      metadata: { source: "database", date: d.date, moodBefore: d.moodBefore, moodAfter: d.moodAfter },
    });
  });

  dbReflections.forEach((r) => {
    addNode({
      id: r.id,
      type: "memory",
      label: humanizeMemoryLabel(r.insight, r.insight),
      weight: Math.min(8, Math.max(3, Math.floor(r.confidence * 8))),
      status: r.actionable && !r.acknowledged ? "opportunity" : "active",
      href: `/brain?tab=wisdom`,
      evidence: "supported_inference",
      ageDays: ageDaysOf(r.createdAt),
      isNew: ageDaysOf(r.createdAt) < 7,
      metadata: { source: "database", category: r.category, reflection: true },
    });
  });

  dbDecisions.forEach((dec) => {
    addNode({
      id: dec.id,
      type: "decision",
      label: dec.title,
      weight: 5,
      status: dec.reviewed ? "done" : "active",
      // The old href pointed at /decisions, which has no page — only
      // /decisions/[id] exists. That was a 404 on every decision node.
      href: `/decisions/${dec.id}`,
      ageDays: ageDaysOf(dec.createdAt),
      isNew: ageDaysOf(dec.createdAt) < 7,
      metadata: {
        source: "database",
        choiceMade: dec.choiceMade,
        outcome: dec.outcome,
        context: dec.context ?? null,
        lesson: dec.lesson ?? null,
      },
    });
  });

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
        relationship: p.relationship ?? null,
        lastInteraction: p.lastInteraction?.toISOString?.() ?? null,
      },
    });
  });

  const memoryCategories = new Set<string>();
  dbMemories.forEach((m) => {
    memoryCategories.add(m.category);
    const expiresInDays =
      m.expiresAt != null ? Math.ceil((m.expiresAt.getTime() - now) / DAY_MS) : null;
    addNode({
      id: m.id,
      type: "memory",
      label: humanizeMemoryLabel(m.key, m.content),
      // Weight = attention (re-sightings), NOT truth. Confidence here is
      // a frequency count, so sizing by it inflated re-observed
      // banalities. LOG scale, not linear: prod seenCount spans 1 →
      // 6,516 with a mean of 3.69 (measured 2026-08-19), so a linear map
      // saturated the cap at 8 sightings and rendered a 6,516-sighting
      // memory identically to an 8-sighting one. Log keeps the common
      // 1-10 range legible while still ranking the true hubs above it.
      weight: Math.min(10, 2 + Math.log2(1 + (m.seenCount ?? 1)) * 1.6),
      status: m.category === "blind_spot" ? "risk" : "active",
      // No href: a memory's destination IS the detail panel + its
      // neighborhood — the old `/brain` href was a self-referential no-op.
      evidence: evidenceClassForSource(m.source ?? ""),
      seenCount: m.seenCount ?? 1,
      ageDays: ageDaysOf(m.createdAt),
      isNew: ageDaysOf(m.createdAt) < 7,
      expiresInDays,
      metadata: {
        source: "database",
        category: m.category,
        content: m.content.slice(0, 280),
        lastSeen: m.lastSeen.toISOString(),
      },
    });
  });

  SYSTEM_ANCHORS.forEach(addNode);

  // Category hubs: membership is structural fact ("this memory IS a
  // belief"), which gives memory nodes honest grouping without a single
  // invented relationship.
  for (const cat of memoryCategories) {
    const hubId = `cat:${cat}`;
    addNode({
      id: hubId,
      type: "system",
      label: cat.replace(/_/g, " ").toUpperCase(),
      weight: 6,
      status: "active",
      metadata: { source: "category_hub", category: cat },
    });
  }
  dbMemories.forEach((m) => {
    addEdge({ source: m.id, target: `cat:${m.category}`, type: "belongs_to", weight: 0.5, origin: "category" });
  });

  // ── 3. FK edges (real references only) ──────────────────────────────
  dbTasks.forEach((t) => {
    if (t.missionId && nodeIds.has(t.missionId)) addEdge({ source: t.id, target: t.missionId, type: "belongs_to", weight: 0.8, origin: "fk" });
    if (t.goalId && nodeIds.has(t.goalId)) addEdge({ source: t.id, target: t.goalId, type: "belongs_to", weight: 0.8, origin: "fk" });
    if (t.personId && nodeIds.has(t.personId)) addEdge({ source: t.id, target: t.personId, type: "related", weight: 0.7, origin: "fk" });
    if (t.parentTaskId && nodeIds.has(t.parentTaskId)) addEdge({ source: t.id, target: t.parentTaskId, type: "depends_on", weight: 0.9, origin: "fk" });
  });
  dbMissions.forEach((m) => {
    if (m.lifeGoalId && nodeIds.has(m.lifeGoalId)) addEdge({ source: m.id, target: m.lifeGoalId, type: "belongs_to", weight: 0.9, origin: "fk" });
  });
  dbDumps.forEach((d) => {
    if (d.missionId && nodeIds.has(d.missionId)) addEdge({ source: d.id, target: d.missionId, type: "mentions", weight: 0.6, origin: "fk" });
    if (d.goalId && nodeIds.has(d.goalId)) addEdge({ source: d.id, target: d.goalId, type: "mentions", weight: 0.6, origin: "fk" });
  });
  dbReflections.forEach((r) => {
    if (r.missionId && nodeIds.has(r.missionId)) addEdge({ source: r.id, target: r.missionId, type: "related", weight: 0.7, origin: "fk" });
    if (r.goalId && nodeIds.has(r.goalId)) addEdge({ source: r.id, target: r.goalId, type: "related", weight: 0.7, origin: "fk" });
  });
  dbDecisions.forEach((dec) => {
    if (dec.missionId && nodeIds.has(dec.missionId)) addEdge({ source: dec.id, target: dec.missionId, type: "related", weight: 0.7, origin: "fk" });
    if (dec.goalId && nodeIds.has(dec.goalId)) addEdge({ source: dec.id, target: dec.goalId, type: "related", weight: 0.7, origin: "fk" });
  });

  // Domain edges from the goal's OWN domain field (real data — the old
  // keyword-matching of mission titles is gone).
  dbGoals.forEach((g) => {
    const anchor = g.domain ? DOMAIN_ANCHOR[String(g.domain).toLowerCase()] : undefined;
    if (anchor && nodeIds.has(anchor)) {
      addEdge({ source: g.id, target: anchor, type: "supports", weight: 0.7, origin: "domain" });
    }
  });

  // ── 4. Stored edges + contradictions (bounded, degraded-aware) ──────
  const currentIds = Array.from(nodeIds);
  let contradictionCount = 0;
  if (currentIds.length > 0) {
    const edgeSettled = await Promise.allSettled([
      withDeadline(
        prisma.memoryEdge.findMany({
          where: { OR: [{ sourceId: { in: currentIds } }, { targetId: { in: currentIds } }] },
          take: 2000,
        }),
        DOMAIN_DEADLINE_MS,
        "memory_edges",
      ),
      withDeadline(
        prisma.semanticEdge.findMany({
          where: {
            OR: [{ fromMemoryId: { in: currentIds } }, { toMemoryId: { in: currentIds } }],
            score: { gte: 0.6 },
          },
          take: 2000,
        }),
        DOMAIN_DEADLINE_MS,
        "semantic_edges",
      ),
      withDeadline(
        prisma.brainMemory.findMany({
          // BRAIN_CATEGORIES.CONTRADICTION, not a string literal — the
          // surfacer writes through the same constant, so a rename can
          // never silently blind this reader. Measured 2026-08-19: this
          // store is currently EMPTY in prod (0 rows), so contradiction
          // edges render zero today. That is a correct reader over an
          // empty store, not a broken one — it lights up the moment
          // surfaceContradictions() flags a pair.
          where: { category: BRAIN_CATEGORIES.CONTRADICTION, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { content: true },
        }),
        DOMAIN_DEADLINE_MS,
        "contradictions",
      ),
    ]);

    if (edgeSettled[0].status === "fulfilled") {
      edgeSettled[0].value.forEach((e) => {
        if (nodeIds.has(e.sourceId) && nodeIds.has(e.targetId)) {
          let type: BrainGraphEdge["type"] = "related";
          if (e.relationship === "blocks") type = "blocks";
          else if (e.relationship === "supports" || e.relationship === "causes" || e.relationship === "leads_to") type = "supports";
          else if (e.relationship === "contradicts") type = "contradicts";
          else if (e.relationship === "depends_on") type = "depends_on";
          addEdge({ source: e.sourceId, target: e.targetId, type, weight: e.strength, origin: "memory_edge" });
        }
      });
    } else degraded.push("memory_edges");

    if (edgeSettled[1].status === "fulfilled") {
      edgeSettled[1].value.forEach((se) => {
        if (nodeIds.has(se.fromMemoryId) && nodeIds.has(se.toMemoryId)) {
          addEdge({ source: se.fromMemoryId, target: se.toMemoryId, type: "related", weight: se.score, origin: "semantic" });
        }
      });
    } else degraded.push("semantic_edges");

    if (edgeSettled[2].status === "fulfilled") {
      const contradictedIds = new Set<string>();
      edgeSettled[2].value.forEach((row) => {
        let parsed: StoredContradictionContent = {};
        try {
          parsed = JSON.parse(row.content) as StoredContradictionContent;
        } catch {
          return; // non-JSON contradiction rows carry no pair — skip
        }
        const unresolved = !parsed.status || parsed.status === "unresolved";
        if (!unresolved || !parsed.new_memory_id || !parsed.old_memory_id) return;
        contradictionCount += 1;
        if (nodeIds.has(parsed.new_memory_id) && nodeIds.has(parsed.old_memory_id)) {
          addEdge({
            source: parsed.new_memory_id,
            target: parsed.old_memory_id,
            type: "contradicts",
            weight: 0.9,
            origin: "contradiction",
          });
          contradictedIds.add(parsed.new_memory_id);
          contradictedIds.add(parsed.old_memory_id);
        }
      });
      if (contradictedIds.size > 0) {
        nodes.forEach((n) => {
          if (contradictedIds.has(n.id)) n.contradicted = true;
        });
      }
    } else degraded.push("contradictions");
  }

  // Anchor spine — the OS relates its own domains; explicit, minimal.
  addEdge({ source: "nicks-tire", target: "business", type: "belongs_to", weight: 0.8, origin: "domain" });
  addEdge({ source: "nour-os", target: "discipline", type: "supports", weight: 0.7, origin: "domain" });

  // ── 5. Focus BFS (unchanged contract: ?focus=&depth=) ───────────────
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
        const frontier = new Set(currentQueue);
        edges.forEach((edge) => {
          let neighborId: string | null = null;
          if (frontier.has(edge.source)) neighborId = edge.target;
          else if (frontier.has(edge.target)) neighborId = edge.source;
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
        degraded,
        contradictionCount,
      };
    }
  }

  // ── 6. Home clamp ───────────────────────────────────────────────────
  if (isHome) {
    const filteredNodes = nodes
      .sort((a, b) => {
        if (a.metadata?.source === "system_seed" && b.metadata?.source !== "system_seed") return -1;
        if (a.metadata?.source !== "system_seed" && b.metadata?.source === "system_seed") return 1;
        return b.weight - a.weight;
      })
      .slice(0, 70);
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = edges.filter(
      (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target),
    );
    return {
      nodes: filteredNodes,
      edges: filteredEdges,
      generatedAt: new Date().toISOString(),
      scope: "home",
      degraded,
      contradictionCount,
    };
  }

  return {
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    scope: "full",
    degraded,
    contradictionCount,
  };
}
