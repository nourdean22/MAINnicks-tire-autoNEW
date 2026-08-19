/**
 * Ghost Nick — shadow predictor. Apr 19.
 *
 * The bet: Nour's moves are statistically predictable in the short
 * term. Ghost Nick looks at his last 20 DONE tasks + active skill
 * signatures + time-of-day bucket, then predicts the next 3 things
 * real Nick is about to do. Renders on HQ as a strip. Every time
 * a predicted task actually gets checked off, accuracy climbs. When
 * he does something Ghost didn't predict, we log that as "drift."
 *
 * Storage:
 *   BrainMemory category="ghost_prediction" key="current"
 *     { predictions: [{task_id?, title, confidence, signals[]}], predicted_at, horizon_hours }
 *   BrainMemory category="ghost_accuracy" key="rolling"
 *     { hits, misses, surprises, evaluated_at }
 *
 * Compute strategy (cheap, deterministic, no AI call):
 *   1. Load last 20 DONE tasks → derive dominant signature
 *      (context + effort + domain).
 *   2. Today-of-week + hour-bucket bias: which signatures tend to
 *      close NOW vs. other times?
 *   3. READY/NEXT tasks matching dominant signature are ranked by:
 *      - autoPriority (higher = hotter — canonical polarity)
 *      - whether an active skill matches them
 *      - freshness of lastTouchedAt
 *   4. Top 3 come back with a confidence score 0-1.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { loadActiveSkills } from "./skill-extractor";

export interface GhostPrediction {
  task_id: string | null;
  title: string;
  confidence: number;                // 0-1
  signals: string[];                 // what drove the pick
  matched_skills: string[];          // active skill keys that match
  dismissed?: boolean;               // Nour clicked "not going to do this"
}

export interface GhostPredictionBundle {
  predictions: GhostPrediction[];
  predicted_at: string;              // ISO
  horizon_hours: number;             // how far out we claim to see
  context_signature: string;         // the dominant sig we projected from
}

export interface GhostAccuracy {
  hits: number;                      // predicted + done in window
  misses: number;                    // predicted but not done
  surprises: number;                 // done but not predicted
  evaluated_at: string;
  last_check_at: string;
}

const HORIZON_HOURS = 6;

// ── Compute ──────────────────────────────────────────────────────────

function hourBucket(d = new Date()): "morning" | "afternoon" | "evening" | "night" {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

async function dominantSignature(): Promise<{ signature: string; evidence: string[] } | null> {
  const since = new Date(Date.now() - 14 * 86400_000);
  const now = new Date();
  const bucket = hourBucket(now);
  const dow = now.getDay();

  const tasks = await prisma.task.findMany({
    where: { status: "DONE", updatedAt: { gte: since }, deletedAt: null },
    select: {
      context: true,
      effort: true,
      autoPriority: true,
      updatedAt: true,
      mission: { select: { domain: true } },
    },
    take: 100,
    orderBy: { updatedAt: "desc" },
  });

  if (tasks.length < 5) return null;

  // Filter to same bucket + day-of-week bias (loose: same or adjacent bucket)
  const filtered = tasks.filter((t) => {
    const hb = hourBucket(new Date(t.updatedAt));
    return hb === bucket || t.updatedAt.getDay() === dow;
  });
  const pool = filtered.length >= 5 ? filtered : tasks;

  const counts = new Map<string, number>();
  for (const t of pool) {
    const p = t.autoPriority ?? 50;
    const band = p >= 80 ? "crit" : p >= 60 ? "high" : p >= 40 ? "med" : "low";
    const dom = t.mission?.domain ?? "general";
    const sig = `ctx:${t.context}|eff:${t.effort}|p:${band}|dom:${dom}`;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 2) return null;

  const [signature, n] = top;
  return {
    signature,
    evidence: [
      `${n}/${pool.length} recent closes fit`,
      `${bucket} bucket · ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow]}`,
    ],
  };
}

function parseSignature(signature: string): {
  context: string;
  effort: string;
  band: string;
  domain: string;
} {
  const [ctxPart, effPart, pPart, domPart] = signature.split("|");
  return {
    context: ctxPart.replace("ctx:", ""),
    effort: effPart.replace("eff:", ""),
    band: pPart.replace("p:", ""),
    domain: domPart.replace("dom:", ""),
  };
}

/**
 * Pull the current prediction bundle. Recomputes if older than 3h
 * or missing entirely.
 */
export async function getGhostPredictions(force = false): Promise<GhostPredictionBundle | null> {
  if (!force) {
    const existing = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key: "current" } },
        select: { content: true, updatedAt: true },
      })
      .catch(() => null);
    if (existing) {
      try {
        const parsed = JSON.parse(existing.content) as GhostPredictionBundle;
        const ageH = (Date.now() - new Date(parsed.predicted_at).getTime()) / 3600_000;
        if (ageH < 3) return parsed;
      } catch (err) {
        // fall through
        logError("brain.ghost-nick", err, { fn: "getGhostPredictions" }, "warn");
      }
    }
  }
  return computeGhostPredictions();
}

export async function computeGhostPredictions(): Promise<GhostPredictionBundle | null> {
  const sig = await dominantSignature();
  if (!sig) return null;
  const { signature, evidence } = sig;
  const { context, effort, band, domain } = parseSignature(signature);

  // Candidate task pool: READY or DOING tasks matching context
  // (same effort band ideal, but relaxed if nothing matches)
  const candidates = await prisma.task.findMany({
    where: {
      status: { in: ["READY", "DOING"] },
      context: context as any,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      effort: true,
      autoPriority: true,
      status: true,
      lastTouchedAt: true,
      mission: { select: { domain: true } },
    },
    take: 40,
    orderBy: [{ autoPriority: { sort: "desc", nulls: "last" } }, { lastTouchedAt: "desc" }],
  });

  if (candidates.length === 0) {
    return {
      predictions: [],
      predicted_at: new Date().toISOString(),
      horizon_hours: HORIZON_HOURS,
      context_signature: signature,
    };
  }

  // E6 perf · hoist the active-skill fetch ONCE outside the candidate
  // loop. matchSkillsForTask() internally calls loadActiveSkills() on
  // every invocation, so the old per-candidate call meant up to 40
  // sequential DB reads of the same skill set. Load once, match in
  // memory below (replicating matchSkillsForTask's ≥3-of-4 signal
  // overlap exactly so the result is unchanged).
  const activeSkills = await loadActiveSkills().catch(
    (): Awaited<ReturnType<typeof loadActiveSkills>> => [],
  );

  const scored: Array<GhostPrediction & { raw: number }> = [];
  for (const c of candidates as Array<typeof candidates[number] & { mission?: { domain: string } | null }>) {
    const p = c.autoPriority ?? 50;
    const cBand = p >= 80 ? "crit" : p >= 60 ? "high" : p >= 40 ? "med" : "low";
    const cDom = c.mission?.domain ?? "general";

    // Scoring: matching signature wins; doing > ready; priority higher = hotter
    let score = 0;
    const signals: string[] = [];
    if (c.effort === effort) { score += 2; signals.push(`effort:${effort}`); }
    if (cBand === band) { score += 2; signals.push(`priority:${band}`); }
    if (cDom === domain) { score += 1.5; signals.push(`domain:${domain}`); }
    if (c.status === "DOING") { score += 3; signals.push("already DOING"); }
    if (c.status === "READY") { score += 1.5; signals.push("queued READY"); }
    score += Math.max(0, p / 25); // hotter priority = higher score

    // Skill match = extra signal. In-memory match against the hoisted
    // active-skill list (was a per-candidate matchSkillsForTask DB call).
    // Mirrors matchSkillsForTask exactly: same 4 task signals, ≥3 overlap.
    const matchContext = (c.effort ? context : "DESK").toLowerCase();
    const taskSignals = new Set([
      `context:${matchContext}`,
      `effort:${c.effort}`,
      `priority:${cBand}`,
      `domain:${cDom.toLowerCase()}`,
    ]);
    const matched: string[] = [];
    for (const skill of activeSkills) {
      let overlap = 0;
      for (const s of skill.trigger_signals) {
        if (taskSignals.has(s.toLowerCase())) overlap++;
      }
      if (overlap >= 3) matched.push(skill.key);
    }
    if (matched.length > 0) {
      score += 1.5;
      signals.push(`matches ${matched.length} skill${matched.length > 1 ? "s" : ""}`);
    }

    scored.push({
      task_id: c.id,
      title: c.title,
      confidence: 0, // fill below
      signals,
      matched_skills: matched,
      raw: score,
    });
  }

  // Honor persistent 24h dismissals — if Nour dismissed a task by id
  // OR by title, suppress it from ranking entirely.
  const dismissals = await loadActiveDismissals();
  const surviving = dismissals.size > 0
    ? scored.filter((p) => {
        const idKey = p.task_id?.toLowerCase();
        const titleKey = p.title.toLowerCase();
        return !dismissals.has(idKey ?? "") && !dismissals.has(titleKey);
      })
    : scored;

  surviving.sort((a, b) => b.raw - a.raw);
  const top3 = surviving.slice(0, 3);
  const maxScore = Math.max(1, top3[0]?.raw ?? 1);
  for (const p of top3) {
    p.confidence = Math.min(0.95, Math.max(0.25, p.raw / (maxScore * 1.1)));
  }

  const bundle: GhostPredictionBundle = {
    predictions: top3.map(({ raw: _raw, ...rest }) => rest),
    predicted_at: new Date().toISOString(),
    horizon_hours: HORIZON_HOURS,
    context_signature: signature,
  };

  // Persist with signature-level evidence for debugging
  const payload = JSON.stringify({ ...bundle, signature_evidence: evidence });
  await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key: "current" } },
    create: {
      category: BRAIN_CATEGORIES.GHOST_PREDICTION,
      key: "current",
      content: payload,
      confidence: 0.6,
      source: "ghost_nick",
    },
    update: { content: payload, lastSeen: new Date() },
  });

  return bundle;
}

// ── Accuracy tracking ─────────────────────────────────────────────────

/**
 * Called whenever a task hits DONE. Checks if that task was a Ghost
 * prediction. If yes → hit. If not → counts as surprise (but only if
 * there WAS an active prediction window).
 */
export interface GhostMatchResult {
  /** True if this task was on the current prediction list. */
  predicted: boolean;
  /** Current rolling accuracy snapshot after this update. */
  accuracy: GhostAccuracy;
}

/**
 * v10.0.529.79 · Wave 23 · return type bumped from void → GhostMatchResult|null
 * so callers (e.g. auto-learn) can surface "Ghost predicted this · 67%
 * accuracy" in the toast. Existing callers using `.catch(() => {})`
 * still work — they just don't read the resolved value.
 */
export async function recordGhostOutcome(
  taskId: string,
  taskTitle: string,
): Promise<GhostMatchResult | null> {
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key: "current" } },
      select: { content: true },
    })
    .catch(() => null);
  if (!row) return null;

  let bundle: GhostPredictionBundle;
  try {
    bundle = JSON.parse(row.content);
  } catch {
    return null;
  }

  // Only evaluate if prediction is recent enough (within horizon)
  const ageH = (Date.now() - new Date(bundle.predicted_at).getTime()) / 3600_000;
  if (ageH > bundle.horizon_hours) return null;

  const hit = bundle.predictions.some(
    (p) => p.task_id === taskId || p.title.toLowerCase() === taskTitle.toLowerCase(),
  );

  const accRow = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.GHOST_ACCURACY, key: "rolling" } },
      select: { content: true },
    })
    .catch(() => null);
  let acc: GhostAccuracy = accRow
    ? (() => {
        try {
          return JSON.parse(accRow.content) as GhostAccuracy;
        } catch {
          return { hits: 0, misses: 0, surprises: 0, evaluated_at: new Date().toISOString(), last_check_at: new Date().toISOString() };
        }
      })()
    : { hits: 0, misses: 0, surprises: 0, evaluated_at: new Date().toISOString(), last_check_at: new Date().toISOString() };

  if (hit) acc.hits++;
  else acc.surprises++;
  acc.last_check_at = new Date().toISOString();

  const payload = JSON.stringify(acc);
  await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.GHOST_ACCURACY, key: "rolling" } },
    create: {
      category: BRAIN_CATEGORIES.GHOST_ACCURACY,
      key: "rolling",
      content: payload,
      confidence: 0.7,
      source: "ghost_nick",
    },
    update: { content: payload, lastSeen: new Date() },
  });

  return { predicted: hit, accuracy: acc };
}

// ── Persistent dismissal store (24h TTL) ────────────────────────────
// Key shape: dismiss:<sha1(idOrTitle)>. Content: { taskIdOrTitle,
// dismissed_at, expires_at }. Survives bundle recomputes so the same
// task doesn't keep reappearing within 24h of being dismissed.
import { createHash } from "node:crypto";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
function dismissKey(idOrTitle: string): string {
  return "dismiss:" + createHash("sha1").update(idOrTitle.toLowerCase()).digest("hex").slice(0, 12);
}

async function loadActiveDismissals(): Promise<Set<string>> {
  const since = new Date(Date.now() - 24 * 3600_000);
  // v10.0.46 — added `deletedAt: null`. Pre-fix a manually soft-
  // deleted dismissal got un-dismissed on the next ghost-nick run,
  // re-surfacing predictions Nour explicitly cleared.
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: BRAIN_CATEGORIES.GHOST_PREDICTION,
        key: { startsWith: "dismiss:" },
        lastSeen: { gte: since },
        deletedAt: null,
      },
      select: { content: true },
      take: 100,
    })
    .catch(() => []);
  const out = new Set<string>();
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as { taskIdOrTitle: string };
      out.add(parsed.taskIdOrTitle.toLowerCase());
    } catch (err) {
      // skip
      logError("brain.ghost-nick", err, { fn: "loadActiveDismissals" }, "warn");
    }
  }
  return out;
}

/**
 * Mark a specific prediction as dismissed. Persists into BOTH the
 * current bundle AND a separate dismiss row with 24h TTL so the same
 * task doesn't re-surface after recompute.
 */
export async function dismissPrediction(taskIdOrTitle: string): Promise<GhostPredictionBundle | null> {
  // 1. Persist dismissal row (survives recomputes)
  const key = dismissKey(taskIdOrTitle);
  const now = new Date();
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key } },
      create: {
        category: BRAIN_CATEGORIES.GHOST_PREDICTION,
        key,
        content: JSON.stringify({
          taskIdOrTitle,
          dismissed_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        }),
        confidence: 0.3,
        source: "ghost_dismissal",
      },
      update: {
        content: JSON.stringify({
          taskIdOrTitle,
          dismissed_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        }),
        lastSeen: now,
      },
    })
    .catch(() => {});

  // 2026-05-23 · Wave D · ghost-accuracy was a precision-only metric.
  // The `misses` field existed on the GhostAccuracy interface but
  // was NEVER incremented anywhere — the metric could only go UP.
  // Dismissal of a prediction IS the operator's "this was wrong" vote ·
  // increment misses so the accuracy denominator reflects all evaluated
  // predictions, not just successes. Best-effort · independent from
  // the dismissal-row persistence above.
  void (async () => {
    try {
      const accRow = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.GHOST_ACCURACY, key: "rolling" } },
        select: { content: true },
      });
      const baseAcc: GhostAccuracy = accRow
        ? (() => {
            try {
              return JSON.parse(accRow.content) as GhostAccuracy;
            } catch {
              return { hits: 0, misses: 0, surprises: 0, evaluated_at: now.toISOString(), last_check_at: now.toISOString() };
            }
          })()
        : { hits: 0, misses: 0, surprises: 0, evaluated_at: now.toISOString(), last_check_at: now.toISOString() };
      baseAcc.misses += 1;
      baseAcc.last_check_at = now.toISOString();
      await prisma.brainMemory.upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.GHOST_ACCURACY, key: "rolling" } },
        create: {
          category: BRAIN_CATEGORIES.GHOST_ACCURACY,
          key: "rolling",
          content: JSON.stringify(baseAcc),
          confidence: 0.7,
          source: "ghost_dismissal",
        },
        update: { content: JSON.stringify(baseAcc), lastSeen: now },
      });
    } catch (err) {
      // Telemetry must not block UI dismissal.
      logError("brain.ghost-nick", err, { fn: "dismissPrediction" }, "warn");
    }
  })();

  // 2. Also flip the flag inside the current bundle for immediate UI
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key: "current" } },
      select: { content: true },
    })
    .catch(() => null);
  if (!row) return null;
  try {
    const bundle = JSON.parse(row.content) as GhostPredictionBundle;
    let touched = false;
    for (const p of bundle.predictions) {
      if (p.task_id === taskIdOrTitle || p.title === taskIdOrTitle) {
        p.dismissed = true;
        touched = true;
      }
    }
    if (touched) {
      await prisma.brainMemory.update({
        where: { category_key: { category: BRAIN_CATEGORIES.GHOST_PREDICTION, key: "current" } },
        data: { content: JSON.stringify(bundle), lastSeen: now },
      });
    }
    return bundle;
  } catch {
    return null;
  }
}

export async function loadGhostAccuracy(): Promise<GhostAccuracy | null> {
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.GHOST_ACCURACY, key: "rolling" } },
      select: { content: true },
    })
    .catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.content) as GhostAccuracy;
  } catch {
    return null;
  }
}

/**
 * Chat-turn context block: short "Ghost thinks X" line for the system
 * prompt when predictions are fresh + confident.
 */
export async function buildGhostContextBlock(): Promise<string> {
  const bundle = await getGhostPredictions().catch((): GhostPredictionBundle | null => null);
  if (!bundle || bundle.predictions.length === 0) return "";
  const lines: string[] = ["## Ghost Nick's next-move read"];
  const acc = await loadGhostAccuracy().catch((): GhostAccuracy | null => null);
  // 2026-05-23 · Wave D · accuracy now factors in misses (dismissals)
  // alongside hits and surprises. Pre-fix the denominator was
  // hits+surprises only · misses field was never incremented · the
  // metric could only go UP. Now: precision-recall blend ·
  // hits / (hits + misses + surprises). Surprises stay in the
  // denominator because they're predictions we should have made.
  if (acc && acc.hits + acc.misses + acc.surprises >= 3) {
    const total = acc.hits + acc.misses + acc.surprises;
    const accPct = Math.round((acc.hits / total) * 100);
    lines.push(`_running accuracy ${acc.hits}/${total} (${accPct}%)_`);
  }
  for (const p of bundle.predictions) {
    if (p.dismissed) continue;
    const pct = Math.round(p.confidence * 100);
    lines.push(`- (${pct}%) ${p.title}${p.matched_skills.length > 0 ? " · matches a skill" : ""}`);
  }
  return lines.join("\n");
}
