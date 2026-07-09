/**
 * Skill Extractor — watches Nour's completed actions and surfaces
 * RECURRING PATTERNS as skill candidates. Apr 18.
 *
 * The bet: reusable behavioral skills live in the data already —
 * completed tasks, decisions, reflections. Nobody has distilled them
 * into "when X happens, Nour does Y" recipes. This does.
 *
 * Flow:
 *   1. Nightly, scan the last 30d of DONE tasks + graded decisions +
 *      actionable reflections.
 *   2. Cluster rows by a compact feature signature (context + effort
 *      + priority band + domain). Clusters with ≥3 members and a
 *      coherent outcome shape produce a skill candidate.
 *   3. Each candidate lands as BrainMemory (category="skill_pending",
 *      deterministic key = hash of trigger+action). Idempotent:
 *      re-extraction bumps seenCount but never dupes.
 *   4. Nour's curation lives in /settings — he promotes candidates
 *      to active skills or drops them. Review is the learning loop.
 *   5. Active skills reinforce on every DONE that matches their
 *      trigger. After 5+ matches at success_rate ≥ 0.7, the skill is
 *      "ready to graduate" — silent-track mode, no more nudging.
 *
 * Storage: everything as BrainMemory so it inherits confidence/decay
 * + retention + vector-search-for-free. No schema change.
 */

import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export type SkillTier = "tiny" | "tactical" | "strategic";
export type SkillPolarity = "do" | "avoid";

/**
 * Canonical skill shape. Stored as JSON string in BrainMemory.content.
 * Deterministic key = sha1(trigger + primary action) so re-extraction
 * is idempotent and graduation state survives regeneration.
 */
export interface Skill {
  trigger: string;                   // human-readable trigger phrase
  trigger_signals: string[];         // machine-matchable: ["context:DESK", "effort:H1"]
  action_sequence: string[];         // ordered steps Nour tends to take
  action_verb: string | null;        // dominant verb extracted from titles
  keywords: string[];                // lightweight tokens for relevance ranking
  tier: SkillTier;
  polarity: SkillPolarity;
  times_fired: number;
  times_succeeded: number;
  times_failed: number;              // from PROMISE break + unmet commits
  success_rate: number;              // 0-1
  last_fired: string | null;         // ISO
  graduated: boolean;                // true = silent-track
  manually_reviewed: boolean;
  review_note: string | null;
  source_evidence: Array<{ type: string; id: string }>; // task/decision/reflection ids
  created_at: string;
  updated_at: string;
}

/**
 * Deterministic key builder. Same trigger + action = same key,
 * so re-extraction is safe.
 */
export function buildSkillKey(trigger: string, primaryAction: string): string {
  const normalized =
    trigger.toLowerCase().replace(/\s+/g, " ").trim() +
    "::" +
    primaryAction.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Cluster DONE tasks from the last N days into feature-signature
 * groups. Returns {key, members[]} — members are the raw task rows
 * so the caller can decide whether the cluster is skill-worthy.
 */
async function clusterRecentTasks(days = 30): Promise<
  Array<{
    signature: string;
    members: Array<{
      id: string;
      title: string;
      context: string;
      effort: string;
      autoPriority: number | null;
      autoPriorityExplanation: string | null;
      missionDomain: string | null;
      actualMinutes: number;
      updatedAt: Date;
    }>;
  }>
> {
  const since = new Date(Date.now() - days * 86400_000);
  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: since }, deletedAt: null },
    select: {
      id: true,
      title: true,
      context: true,
      effort: true,
      autoPriority: true,
      autoPriorityExplanation: true,
      actualMinutes: true,
      updatedAt: true,
      mission: { select: { domain: true } },
    },
    take: 500,
  });

  const groups = new Map<string, typeof tasks[number][]>();
  for (const t of tasks) {
    // Priority band: critical (<20) / high (20-39) / med (40-59) / low (≥60)
    const p = t.autoPriority ?? 50;
    const band = p < 20 ? "crit" : p < 40 ? "high" : p < 60 ? "med" : "low";
    const domain = t.mission?.domain ?? "general";
    const signature = `ctx:${t.context}|eff:${t.effort}|p:${band}|dom:${domain}`;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature)!.push(t);
  }

  return Array.from(groups.entries())
    .filter(([, members]) => members.length >= 3)
    .map(([signature, members]) => ({
      signature,
      members: members.map((m) => ({
        id: m.id,
        title: m.title,
        context: m.context,
        effort: m.effort,
        autoPriority: m.autoPriority,
        autoPriorityExplanation: m.autoPriorityExplanation,
        missionDomain: m.mission?.domain ?? null,
        actualMinutes: m.actualMinutes,
        updatedAt: m.updatedAt,
      })),
    }));
}

// Stopwords for verb + keyword extraction. Kept tight — we want verbs.
const VERB_STOPWORDS = new Set([
  "the", "a", "an", "to", "for", "of", "and", "or", "at", "on", "in",
  "with", "by", "from", "as", "is", "are", "was", "be", "my", "our",
]);
// Keyword stopwords are broader — we strip articles, prepositions, fillers.
const KEYWORD_STOPWORDS = new Set([
  ...VERB_STOPWORDS,
  "task", "tasks", "thing", "things", "stuff", "this", "that", "these",
  "those", "just", "about", "some", "any", "need", "get", "make", "do",
  "todo", "did", "done", "had", "has", "have", "will", "would", "should",
  "can", "could", "might", "may", "also", "too", "very", "really", "only",
  "more", "most", "one", "two", "three",
]);

function extractKeywords(texts: string[], max = 6): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const raw of t.toLowerCase().split(/\W+/)) {
      const w = raw.trim();
      if (w.length < 4) continue;
      if (KEYWORD_STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * Turn a cluster into a skill candidate. The shape is heuristic —
 * trigger is a human-readable sentence Nour can recognize, action is
 * the dominant verb extracted from task titles.
 *
 * `polarity` defaults to "do" (DONE-task clusters = things Nour does
 * reliably). The broken-promise extractor re-uses this with "avoid"
 * and an inverted action ("don't commit to X in Y context").
 */
function clusterToSkill(
  cluster: {
    signature: string;
    members: Array<{
      id: string;
      title: string;
      context: string;
      effort: string;
      autoPriorityExplanation: string | null;
      missionDomain: string | null;
      updatedAt: Date;
    }>;
  },
  opts: { polarity?: SkillPolarity; evidenceType?: string } = {},
): Skill | null {
  const { signature, members } = cluster;
  const polarity = opts.polarity ?? "do";
  const evidenceType = opts.evidenceType ?? "task";

  // Extract dominant verb from titles (first word, lowercased, filtered)
  const verbCounts = new Map<string, number>();
  for (const m of members) {
    const first = m.title.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first && first.length >= 3 && !VERB_STOPWORDS.has(first)) {
      verbCounts.set(first, (verbCounts.get(first) ?? 0) + 1);
    }
  }
  const dominantVerb = Array.from(verbCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!dominantVerb || dominantVerb[1] < 2) return null;
  const [verb, verbCount] = dominantVerb;

  const [ctxPart, effPart, pPart, domPart] = signature.split("|");
  const context = ctxPart.replace("ctx:", "").toLowerCase();
  const effort = effPart.replace("eff:", "");
  const priorityBand = pPart.replace("p:", "");
  const domain = domPart.replace("dom:", "");

  const priorityWord =
    priorityBand === "crit" ? "critical"
    : priorityBand === "high" ? "high-priority"
    : priorityBand === "med" ? "medium-priority"
    : "low-priority";

  // Verb-first trigger sentences (more natural than schema dump):
  //   "do" → "you <verb> a <priority> <domain> <effort> in <context> context"
  //   "avoid" → "avoid committing to <verb>-style <priority> <domain> work"
  const trigger = polarity === "do"
    ? `you ${verb} a ${priorityWord} ${domain} ${effort} in ${context} context`
    : `you over-commit to ${verb}-style ${priorityWord} ${domain} work and break it`;

  // Tier from effort
  const tier: SkillTier =
    effort === "M5" || effort === "M15" ? "tiny"
    : effort === "M30" || effort === "H1" ? "tactical"
    : "strategic";

  const keywords = extractKeywords(members.map((m) => m.title));
  const sourceEvidence = members.slice(0, 8).map((m) => ({ type: evidenceType, id: m.id }));
  const lastFired = members.reduce(
    (latest, m) => (m.updatedAt > latest ? m.updatedAt : latest),
    members[0].updatedAt,
  );
  const now = new Date().toISOString();

  const actionLabel = polarity === "do"
    ? `${verb} (${verbCount}/${members.length} times)`
    : `avoid ${verb}-style commitments at this band`;

  return {
    trigger,
    trigger_signals: [
      `context:${context}`,
      `effort:${effort}`,
      `priority:${priorityBand}`,
      `domain:${domain}`,
    ],
    action_sequence: [actionLabel],
    action_verb: verb,
    keywords,
    tier,
    polarity,
    times_fired: members.length,
    times_succeeded: polarity === "do" ? members.length : 0,
    times_failed: polarity === "do" ? 0 : members.length,
    success_rate: polarity === "do" ? 1.0 : 0.0,
    last_fired: lastFired.toISOString(),
    graduated: false,
    manually_reviewed: false,
    review_note: null,
    source_evidence: sourceEvidence,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Mirror of clusterRecentTasks but over broken PROMISE commitments.
 * We approximate signals from the commitment row's domain + description
 * so the output lines up with task clusters for ranking.
 */
async function clusterBrokenPromises(days = 30): Promise<
  Array<{
    signature: string;
    members: Array<{
      id: string;
      title: string;
      context: string;
      effort: string;
      autoPriority: number | null;
      autoPriorityExplanation: string | null;
      missionDomain: string | null;
      actualMinutes: number;
      updatedAt: Date;
    }>;
  }>
> {
  const since = new Date(Date.now() - days * 86400_000);
  const broken = await prisma.commitment.findMany({
    where: {
      status: { in: ["broken", "missed", "overdue"] },
      updatedAt: { gte: since },
      deletedAt: null,
    },
    take: 200,
  });

  const groups = new Map<string, any[]>();
  for (const c of broken) {
    const domain = c.domain ?? "general";
    const signature = `ctx:PERSONAL|eff:H1|p:high|dom:${domain}`;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature)!.push({
      id: String(c.id),
      title: c.description.slice(0, 120),
      context: "PERSONAL",
      effort: "H1",
      autoPriority: 30,
      autoPriorityExplanation: null,
      missionDomain: domain,
      actualMinutes: 0,
      updatedAt: c.updatedAt,
    });
  }

  return Array.from(groups.entries())
    .filter(([, members]) => members.length >= 3)
    .map(([signature, members]) => ({ signature, members }));
}

/**
 * Mirror over actionable Reflection rows. A reflection with actionable=
 * true is essentially Nour pre-distilling a skill for himself — we
 * surface those as candidates too, tagged differently in evidence.
 */
async function clusterActionableReflections(days = 60): Promise<
  Array<{
    signature: string;
    members: Array<{
      id: string;
      title: string;
      context: string;
      effort: string;
      autoPriority: number | null;
      autoPriorityExplanation: string | null;
      missionDomain: string | null;
      actualMinutes: number;
      updatedAt: Date;
    }>;
  }>
> {
  const since = new Date(Date.now() - days * 86400_000);
  const refs = await prisma.reflection.findMany({
    where: { actionable: true, createdAt: { gte: since }, deletedAt: null },
    select: {
      id: true,
      insight: true,
      category: true,
      confidence: true,
      createdAt: true,
    },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  const groups = new Map<string, any[]>();
  for (const r of refs) {
    // Each reflection category acts as its own bucket. Priority derived
    // from confidence — high-confidence reflections count as skill-
    // worthy insights, low-confidence ones stay noise.
    if (r.confidence < 0.6) continue;
    const signature = `ctx:DESK|eff:H1|p:high|dom:${r.category}`;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature)!.push({
      id: r.id,
      title: r.insight.slice(0, 120),
      context: "DESK",
      effort: "H1",
      autoPriority: 30,
      autoPriorityExplanation: null,
      missionDomain: r.category,
      actualMinutes: 0,
      updatedAt: r.createdAt,
    });
  }

  return Array.from(groups.entries())
    .filter(([, members]) => members.length >= 3)
    .map(([signature, members]) => ({ signature, members }));
}

/**
 * Write a single skill candidate to BrainMemory with dedup + merge.
 * Returns the merge status so the caller can count "new" vs "updated".
 */
async function persistCandidate(skill: Skill): Promise<"new" | "updated" | "skipped"> {
  const key = buildSkillKey(skill.trigger, skill.action_sequence[0]);

  // Never overwrite a promoted active skill
  const activeExists = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key } },
      select: { id: true },
    })
    .catch((err) => {
      logError("brain.skill-extractor", err, { fn: "persistCandidate.findActive" });
      return null;
    });
  if (activeExists) return "skipped";

  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.SKILL_PENDING, key } },
      select: { id: true, content: true },
    })
    .catch((err) => {
      logError("brain.skill-extractor", err, { fn: "persistCandidate.findPending" });
      return null;
    });

  if (existing) {
    try {
      const prev = JSON.parse(existing.content) as Skill;
      const merged: Skill = {
        ...prev,
        times_fired: skill.times_fired,
        times_succeeded: skill.times_succeeded,
        times_failed: skill.times_failed,
        success_rate: skill.success_rate,
        last_fired: skill.last_fired,
        source_evidence: skill.source_evidence,
        keywords: skill.keywords,
        action_verb: skill.action_verb,
        updated_at: skill.updated_at,
      };
      await prisma.brainMemory.update({
        where: { category_key: { category: BRAIN_CATEGORIES.SKILL_PENDING, key } },
        data: {
          content: JSON.stringify(merged),
          lastSeen: new Date(),
          seenCount: { increment: 1 },
        },
      });
      return "updated";
    } catch (err) {
      logError("brain.skill-extractor", err, { fn: "persistCandidate.updatePending" });
      return "skipped";
    }
  }
  await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.SKILL_PENDING,
      key,
      content: JSON.stringify(skill),
      confidence: 0.5,
      source: "skill_extractor",
    },
  });
  return "new";
}

/**
 * All three sources: DONE task clusters ("do"), broken promises
 * ("avoid"), and actionable reflections ("do", reflection-sourced).
 * Returns per-source counts so the cron can emit a meaningful
 * brain_insight.
 */
export async function extractSkillsFromTasks(): Promise<{
  clustersFound: number;
  candidatesWritten: number;
  candidatesSkipped: number;
  newCandidates: number;
  bySource: { tasks: number; promises: number; reflections: number };
}> {
  const [taskClusters, promiseClusters, reflectionClusters] = await Promise.all([
    clusterRecentTasks(30),
    clusterBrokenPromises(30),
    clusterActionableReflections(60),
  ]);

  let written = 0;
  let skipped = 0;
  let newOnes = 0;
  const bySource = { tasks: 0, promises: 0, reflections: 0 };

  const pipeline: Array<{
    clusters: typeof taskClusters;
    polarity: SkillPolarity;
    evidenceType: string;
    bucket: keyof typeof bySource;
  }> = [
    { clusters: taskClusters, polarity: "do", evidenceType: "task", bucket: "tasks" },
    { clusters: promiseClusters, polarity: "avoid", evidenceType: "commitment", bucket: "promises" },
    { clusters: reflectionClusters, polarity: "do", evidenceType: "reflection", bucket: "reflections" },
  ];

  for (const { clusters, polarity, evidenceType, bucket } of pipeline) {
    for (const cluster of clusters) {
      const skill = clusterToSkill(cluster, { polarity, evidenceType });
      if (!skill) {
        skipped++;
        continue;
      }
      const result = await persistCandidate(skill);
      if (result === "new") {
        written++;
        newOnes++;
        bySource[bucket]++;
      } else if (result === "updated") {
        written++;
      } else {
        skipped++;
      }
    }
  }

  return {
    clustersFound: taskClusters.length + promiseClusters.length + reflectionClusters.length,
    candidatesWritten: written,
    candidatesSkipped: skipped,
    newCandidates: newOnes,
    bySource,
  };
}

// ── Reader helpers ────────────────────────────────────────────────────

export interface StoredSkill extends Skill {
  dbId: string;
  key: string;
  pending: boolean;
}

// Phase BB · type-position carve-out · inline string matches
// BRAIN_CATEGORIES.SKILL value · cannot use namespace ref in type
// context. Callers pass BRAIN_CATEGORIES.SKILL at the call site.
async function loadCategory(category: "skill" | "skill_pending"): Promise<StoredSkill[]> {
  // v10.0.46 — added `deletedAt: null`. `loadCategory` feeds
  // `buildSkillsContextBlock()` which injects into the system
  // prompt; deleted/graduated skills were appearing as live guidance.
  const rows = await prisma.brainMemory.findMany({
    where: { category, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, key: true, content: true },
  });
  const out: StoredSkill[] = [];
  let malformedCount = 0;
  const malformedErrors: unknown[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as Skill;
      out.push({ ...parsed, dbId: r.id, key: r.key, pending: category === "skill_pending" });
    } catch (err) {
      // malformed row — skip
      malformedCount++;
      malformedErrors.push(err);
    }
  }
  if (malformedCount > 0) {
    logError("brain.skill-extractor", new Error(`${malformedCount} malformed rows skipped`), { fn: "loadCategory", category, errors: malformedErrors.map(String) });
  }
  return out;
}

export async function loadActiveSkills(): Promise<StoredSkill[]> {
  return loadCategory("skill");
}
export async function loadPendingSkills(): Promise<StoredSkill[]> {
  return loadCategory("skill_pending");
}

/**
 * Curation action: promote candidate → active skill (copy row, delete
 * pending). Returns the promoted skill or null if not found.
 */
export async function promoteSkill(key: string, note?: string): Promise<StoredSkill | null> {
  const pending = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.SKILL_PENDING, key } },
    select: { content: true },
  });
  if (!pending) return null;

  let skill: Skill;
  try {
    skill = JSON.parse(pending.content);
  } catch (err) {
    logError("brain.skill-extractor", err, { fn: "promoteSkill.parse" });
    return null;
  }

  const promoted: Skill = {
    ...skill,
    manually_reviewed: true,
    review_note: note ?? skill.review_note,
    updated_at: new Date().toISOString(),
  };

  const created = await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key } },
    create: {
      category: BRAIN_CATEGORIES.SKILL,
      key,
      content: JSON.stringify(promoted),
      confidence: 0.7,
      source: "skill_curator",
    },
    update: {
      content: JSON.stringify(promoted),
      confidence: 0.7,
      lastSeen: new Date(),
    },
    select: { id: true, key: true },
  });

  // Remove the pending row so it doesn't keep appearing as a candidate
  await prisma.brainMemory
    .delete({ where: { category_key: { category: BRAIN_CATEGORIES.SKILL_PENDING, key } } })
    .catch((err) => {
      logError("brain.skill-extractor", err, { fn: "promoteSkill.deletePending" });
    });

  return { ...promoted, dbId: created.id, key: created.key, pending: false };
}

/** Drop a pending candidate. */
export async function dropSkill(
  key: string,
  kind: "skill" | "skill_pending" = "skill_pending",
): Promise<boolean> {
  const deleted = await prisma.brainMemory
    .delete({ where: { category_key: { category: kind, key } } })
    .catch((err) => {
      logError("brain.skill-extractor", err, { fn: "dropSkill" });
      return null;
    });
  return !!deleted;
}

/** Flip graduated flag on an active skill. */
export async function setGraduated(key: string, graduated: boolean): Promise<StoredSkill | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key } },
    select: { id: true, content: true },
  });
  if (!row) return null;
  try {
    const prev = JSON.parse(row.content) as Skill;
    const next: Skill = { ...prev, graduated, updated_at: new Date().toISOString() };
    await prisma.brainMemory.update({
      where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key } },
      data: { content: JSON.stringify(next), lastSeen: new Date() },
    });
    return { ...next, dbId: row.id, key, pending: false };
  } catch (err) {
    logError("brain.skill-extractor", err, { fn: "setGraduated" });
    return null;
  }
}

/** Reinforce an active skill after a matching success OR failure.
 *  Called from /api/tasks/[id]/check DONE path (success=true) and
 *  the PROMISE-break path (success=false). When the skill crosses
 *  the graduation threshold (≥5 fires, ≥0.7 rate, not-yet-graduated),
 *  emits a brain_insight AuditEvent so the bottom ticker rotates a
 *  "Skill X is ready to graduate" nudge. Only fires ONCE per skill
 *  per crossing — tracked via the `graduation_ready_at` marker on
 *  the row content so re-fires don't spam. */
export async function reinforceSkill(key: string, succeeded: boolean): Promise<StoredSkill | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key } },
    select: { id: true, content: true },
  });
  if (!row) return null;
  try {
    const prev = JSON.parse(row.content) as Skill & { graduation_ready_at?: string | null };
    const times_fired = prev.times_fired + 1;
    const times_succeeded = prev.times_succeeded + (succeeded ? 1 : 0);
    const times_failed = (prev.times_failed ?? 0) + (succeeded ? 0 : 1);
    const success_rate = times_fired > 0 ? times_succeeded / times_fired : 0;
    const next: Skill & { graduation_ready_at?: string | null } = {
      ...prev,
      times_fired,
      times_succeeded,
      times_failed,
      success_rate,
      last_fired: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // ── Graduation threshold nudge ──
    const readyThresholdCrossed =
      !prev.graduated &&
      !prev.graduation_ready_at &&
      times_fired >= 5 &&
      success_rate >= 0.7;
    if (readyThresholdCrossed) {
      next.graduation_ready_at = new Date().toISOString();
      // Fire-and-forget insight so the ticker picks it up today
      void prisma.auditEvent
        .create({
          data: {
            actor: "skill_extractor",
            eventType: "brain_insight",
            detail: `Skill ready to graduate: "${prev.trigger}" (${times_succeeded}/${times_fired}, ${Math.round(success_rate * 100)}%)`,
            payload: { skillKey: key, times_fired, success_rate },
          },
        })
        .catch((err) => {
          logError("brain.skill-extractor", err, { fn: "reinforceSkill.auditEvent" });
        });
    }

    // Confidence tracks success_rate — but only once we have ≥3 fires
    // to avoid wild swings on a fresh skill.
    const confidence = times_fired >= 3 ? Math.max(0.2, Math.min(0.95, success_rate * 0.95)) : 0.7;

    await prisma.brainMemory.update({
      where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key } },
      data: {
        content: JSON.stringify(next),
        confidence,
        lastSeen: new Date(),
        seenCount: { increment: 1 },
      },
    });
    return { ...next, dbId: row.id, key, pending: false };
  } catch (err) {
    logError("brain.skill-extractor", err, { fn: "reinforceSkill.parse" });
    return null;
  }
}

/**
 * v10.0.529.106 · Wave 60 · SKILL → WISDOM auto-promotion pipeline.
 *
 * Pre-Wave-60 skills that crossed the graduation threshold (≥5 fires
 * at ≥0.7 success rate) sat in graduation-ready limbo forever. They
 * never got promoted to the wisdom corpus, and the BrainMemory
 * promoteToWisdom() function never received `skill` rows as input
 * (it scanned by confidence + seenCount, but the skill category was
 * excluded from category weights).
 *
 * This function closes the last mile: it finds skills that have been
 * stable for 30+ days (graduation_ready_at set, no times_failed
 * increment in the past 30 days), generates a wisdom row from the
 * skill's trigger+action_verb shape, and marks the skill as
 * `promoted_to_wisdom_at` so it doesn't get re-promoted on the next
 * cron tick.
 *
 * Designed to be called from the mega-evening cron path (idempotent
 * per skill key · safe to run nightly). Returns the count of new
 * wisdoms minted this run for logging.
 */
export async function autoPromoteStableSkillsToWisdom(): Promise<{
  promoted: number;
  skipped: number;
  promotedKeys: string[];
}> {
  const STABILITY_WINDOW_MS = 30 * 24 * 3600_000; // 30 days
  const now = Date.now();

  // Pull all graduation-ready skill rows. The marker lives in the
  // content JSON · scan all `skill` rows then filter.
  const candidates = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.SKILL, deletedAt: null },
    select: { id: true, key: true, content: true, updatedAt: true },
    take: 500,
  }).catch((err) => {
    logError("brain.skill-extractor", err, { fn: "autoPromoteStableSkillsToWisdom.findMany" });
    return [];
  });

  let promoted = 0;
  let skipped = 0;
  const promotedKeys: string[] = [];

  for (const row of candidates) {
    let skill: Skill & {
      graduation_ready_at?: string | null;
      promoted_to_wisdom_at?: string | null;
      last_failed_at?: string | null;
    };
    try {
      skill = JSON.parse(row.content) as Skill & {
        graduation_ready_at?: string | null;
        promoted_to_wisdom_at?: string | null;
        last_failed_at?: string | null;
      };
    } catch (err) {
      skipped++;
      logError("brain.skill-extractor", err, { fn: "autoPromoteStableSkillsToWisdom.parse" });
      continue;
    }

    // Skip skills that haven't crossed the graduation threshold or
      // have already been promoted in a prior run.
      if (!skill.graduation_ready_at || skill.promoted_to_wisdom_at) {
        skipped++;
        continue;
      }

      // Stability check 1: graduated at least 30 days ago.
      const graduatedAtMs = new Date(skill.graduation_ready_at).getTime();
      if (now - graduatedAtMs < STABILITY_WINDOW_MS) {
        skipped++;
        continue;
      }

      // Stability check 2: no failures in the last 30 days. We don't
      // have a perfect "last_failed_at" field today · approximate by
      // checking that times_failed hasn't ticked above some threshold
      // since graduation. If skill has > 20% failure rate, skip.
      if ((skill.times_failed ?? 0) > 0 && skill.success_rate < 0.7) {
        skipped++;
        continue;
      }

      // Synthesize the wisdom row content from the skill shape.
      // Keep it action-shaped (the wisdom corpus convention).
      const wisdomText = `${skill.trigger}: ${skill.action_verb ?? "act on it"}. ` +
        `(graduated from skill after ${skill.times_fired} successful applications)`;
      const wisdomKey = `from_skill_${row.key}`;

      // Avoid double-promotion: idempotent via skip-if-exists.
      const existing = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.WISDOM, key: wisdomKey } },
        select: { id: true },
      }).catch((err) => {
        logError("brain.skill-extractor", err, { fn: "autoPromoteStableSkillsToWisdom.findExisting" });
        return null;
      });
      if (existing) {
        // Mark the skill as already promoted so we skip next time.
        skill.promoted_to_wisdom_at = new Date().toISOString();
        await prisma.brainMemory.update({
          where: { id: row.id },
          data: { content: JSON.stringify(skill) },
        }).catch((err) => {
          logError("brain.skill-extractor", err, { fn: "autoPromoteStableSkillsToWisdom.markPromoted" });
        });
        skipped++;
        continue;
      }

      // Mint the wisdom row · operator-trusted source (this is an
      // outcome-proven skill, not an LLM-inferred wisdom).
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.WISDOM,
          key: wisdomKey,
          content: wisdomText,
          source: "skill_graduation",
          confidence: Math.max(0.7, skill.success_rate),
          seenCount: skill.times_fired,
          metadata: {
            originSkillKey: row.key,
            originTimesFired: skill.times_fired,
            originSuccessRate: skill.success_rate,
            graduatedAt: skill.graduation_ready_at,
            promotedAt: new Date().toISOString(),
          } as never,
        },
      });

      // Mark the skill so we don't re-promote.
      skill.promoted_to_wisdom_at = new Date().toISOString();
      await prisma.brainMemory.update({
        where: { id: row.id },
        data: { content: JSON.stringify(skill) },
      });

      promoted++;
      promotedKeys.push(row.key);
  }

  return { promoted, skipped, promotedKeys };
}

/**
 * For a task about to be marked DONE, find active skills whose
 * trigger_signals match its feature shape. Returns matching skill
 * keys so the caller can call reinforceSkill() on each.
 */
export async function matchSkillsForTask(task: {
  context: string;
  effort: string;
  autoPriority: number | null;
  missionDomain?: string | null;
}): Promise<string[]> {
  const active = await loadActiveSkills();
  if (active.length === 0) return [];

  const p = task.autoPriority ?? 50;
  const band = p < 20 ? "crit" : p < 40 ? "high" : p < 60 ? "med" : "low";
  const taskSignals = new Set([
    `context:${task.context.toLowerCase()}`,
    `effort:${task.effort}`,
    `priority:${band}`,
    `domain:${(task.missionDomain ?? "general").toLowerCase()}`,
  ]);

  const matches: string[] = [];
  for (const skill of active) {
    const skillSignals = new Set(skill.trigger_signals.map((s) => s.toLowerCase()));
    // Match if ≥ 3 of 4 signals overlap
    let overlap = 0;
    for (const s of skillSignals) {
      if (taskSignals.has(s)) overlap++;
    }
    if (overlap >= 3) matches.push(skill.key);
  }
  return matches;
}

/**
 * Rank active skills against a query text by lightweight keyword
 * overlap + verb-in-query bonus. Used by the chat injector so the
 * most situationally relevant skills surface first (instead of the
 * top-N by times_fired, which never shifts with context).
 */
export function rankSkillsByRelevance(skills: StoredSkill[], query: string, limit = 8): StoredSkill[] {
  const q = query.toLowerCase();
  const qTokens = new Set(q.split(/\W+/).filter((w) => w.length >= 4));

  const scored = skills.map((s) => {
    let score = 0;
    // Keyword overlap
    for (const kw of s.keywords ?? []) {
      if (qTokens.has(kw)) score += 2;
      else if (q.includes(kw)) score += 1;
    }
    // Verb hit
    if (s.action_verb && q.includes(s.action_verb)) score += 3;
    // Trigger mention
    const triggerTokens = s.trigger.toLowerCase().split(/\W+/);
    for (const tok of triggerTokens) {
      if (tok.length >= 5 && qTokens.has(tok)) score += 1;
    }
    // Baseline — high-times_fired skills stay in rotation even on cold query
    score += Math.min(3, s.times_fired * 0.25);
    return { s, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}

/**
 * For the system prompt: render active skills Nour might invoke in
 * this context. When `query` is supplied, ranks by relevance; without
 * it, falls back to most-reinforced-first. Graduated skills are
 * always excluded (silent-track).
 */
export async function buildSkillsContextBlock(query?: string): Promise<string> {
  const skills = await loadActiveSkills();
  if (skills.length === 0) return "";

  const live = skills.filter((s) => !s.graduated);
  if (live.length === 0) return "";

  const surfaced = query && query.trim().length > 0
    ? rankSkillsByRelevance(live, query, 8)
    : [...live].sort((a, b) => b.times_fired - a.times_fired).slice(0, 10);

  const lines: string[] = [];
  lines.push(
    `## Nour's skills (${skills.length} active · ${skills.filter((s) => s.graduated).length} graduated)`,
  );
  lines.push("Proven operating patterns — reference or suggest these when the situation matches.");
  for (const s of surfaced) {
    const rate = Math.round(s.success_rate * 100);
    const action = s.action_sequence[0] ?? "(no action)";
    const polMark = s.polarity === "avoid" ? "⛔" : "→";
    lines.push(
      `- when ${s.trigger} ${polMark} ${action} (${s.times_succeeded}/${s.times_fired}, ${rate}%)`,
    );
  }
  return lines.join("\n");
}

/**
 * Curation action: inline edit a pending or active skill's trigger
 * and/or action text. Preserves counts + graduation state; updates
 * only the surfaces Nour can refine.
 */
export async function editSkill(
  key: string,
  kind: "skill" | "skill_pending",
  updates: { trigger?: string; action?: string; reviewNote?: string },
): Promise<StoredSkill | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: kind, key } },
    select: { id: true, content: true },
  });
  if (!row) return null;
  try {
    const prev = JSON.parse(row.content) as Skill;
    const next: Skill = {
      ...prev,
      trigger: updates.trigger?.trim() || prev.trigger,
      action_sequence: updates.action?.trim()
        ? [updates.action.trim(), ...prev.action_sequence.slice(1)]
        : prev.action_sequence,
      review_note: updates.reviewNote ?? prev.review_note,
      manually_reviewed: true,
      updated_at: new Date().toISOString(),
    };
    await prisma.brainMemory.update({
      where: { category_key: { category: kind, key } },
      data: { content: JSON.stringify(next), lastSeen: new Date() },
    });
    return { ...next, dbId: row.id, key, pending: kind === "skill_pending" };
  } catch {
    return null;
  }
}
