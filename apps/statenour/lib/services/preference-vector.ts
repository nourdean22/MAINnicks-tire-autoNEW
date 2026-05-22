/**
 * lib/services/preference-vector.ts · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The preference-vector read/write assembly · lifted verbatim from
 * app/api/system/preference-vector/route.ts (the GET's `loadLastTuneSummary`
 * + `loadTuneTrace` + Promise.all composer, and the POST's reset/merge +
 * audit + style-cache-invalidate logic) so the legacy REST endpoint AND
 * the new `system.preferenceVector` / `system.savePreferenceVector` tRPC
 * procedures call the SAME functions · drift between consumers
 * structurally impossible.
 *
 * Both functions return EXPLICIT, shallow shapes (`PreferenceVectorView`
 * / `PreferenceVectorSaveResult`). The Prisma `BrainMemory.metadata` /
 * `AuditEvent.payload` Json columns are read internally and never leak
 * into the return type — the same TS2589-prevention discipline as
 * `TaskEventRow` in lib/trpc/routers/task.ts.
 */

import { prisma } from "@/lib/prisma";
import {
  AXES,
  DEFAULT_VECTOR,
  loadPreferenceVector,
  savePreferenceVector,
  buildSystemPromptAddendum,
  type PreferenceVector,
} from "@/lib/brain/preference-inference";
import { invalidateStyleCache } from "@/lib/ai/style-adapter";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("service/preference-vector");

/** Last weekly-tune summary · per-axis delta so the card can show drift hints. */
export interface LastTuneSummary {
  date: string;
  sampleSize: number;
  learningRate: number;
  prev: PreferenceVector;
  next: PreferenceVector;
  delta: PreferenceVector;
}

/** One point on the per-axis tune trace · the post-tune vector for that week. */
export interface TuneTracePoint {
  date: string;
  vector: PreferenceVector;
  sampleSize: number;
}

/** Shallow, explicit shape for the preference-vector GET view. */
export interface PreferenceVectorView {
  ok: true;
  axes: readonly string[];
  vector: PreferenceVector;
  addendum: string;
  addendumChars: number;
  lastTune: LastTuneSummary | null;
  trace: TuneTracePoint[];
}

/** Shallow, explicit shape for the preference-vector POST result. */
export interface PreferenceVectorSaveResult {
  ok: true;
  vector: PreferenceVector;
  addendum: string;
  addendumChars: number;
}

async function loadLastTuneSummary(): Promise<LastTuneSummary | null> {
  const row = await prisma.brainMemory
    .findFirst({
      where: { category: "preference_tune", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { key: true, metadata: true },
    })
    .catch(() => null);
  if (!row?.metadata) return null;
  const m = row.metadata as Record<string, unknown> | null;
  if (!m || typeof m !== "object") return null;
  const prev = m.prev as PreferenceVector | undefined;
  const next = m.next as PreferenceVector | undefined;
  const sampleSize = typeof m.sampleSize === "number" ? m.sampleSize : 0;
  const learningRate =
    typeof m.learningRate === "number" ? m.learningRate : 0;
  if (!prev || !next) return null;
  const delta: PreferenceVector = { ...DEFAULT_VECTOR };
  for (const axis of AXES) {
    delta[axis] = Number(((next[axis] ?? 0) - (prev[axis] ?? 0)).toFixed(3));
  }
  return { date: row.key, sampleSize, learningRate, prev, next, delta };
}

async function loadTuneTrace(limit = 12): Promise<TuneTracePoint[]> {
  const rows = await prisma.brainMemory
    .findMany({
      where: { category: "preference_tune", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { key: true, metadata: true, createdAt: true },
    })
    .catch((): never[] => []);
  const points: TuneTracePoint[] = [];
  for (const r of rows) {
    const m = r.metadata as Record<string, unknown> | null;
    if (!m || typeof m !== "object") continue;
    const next = m.next as PreferenceVector | undefined;
    if (!next) continue;
    const sampleSize = typeof m.sampleSize === "number" ? m.sampleSize : 0;
    const vector: PreferenceVector = { ...DEFAULT_VECTOR };
    for (const axis of AXES) {
      const v = next[axis];
      if (typeof v === "number" && Number.isFinite(v)) vector[axis] = v;
    }
    points.push({ date: r.key, vector, sampleSize });
  }
  // Reverse to chronological (oldest first) so the UI plots LTR.
  return points.reverse();
}

/**
 * Build the preference-vector GET view · current vector + addendum +
 * last-tune metadata + 12-week trace. The route and the tRPC
 * `system.preferenceVector` procedure both call this.
 */
export async function buildPreferenceVectorView(): Promise<PreferenceVectorView> {
  const [vec, lastTune, trace] = await Promise.all([
    loadPreferenceVector(),
    loadLastTuneSummary(),
    loadTuneTrace(12),
  ]);
  const addendum = buildSystemPromptAddendum(vec);
  return {
    ok: true,
    axes: AXES,
    vector: vec,
    addendum,
    addendumChars: addendum.length,
    lastTune,
    trace,
  };
}

/**
 * Persist a preference-vector override. `reset` zeros every axis;
 * otherwise the partial `patch` is merged over the current vector.
 * Invalidates the style-adapter cache + writes an audit event exactly
 * as the legacy POST did. The route and the tRPC
 * `system.savePreferenceVector` procedure both call this.
 */
export async function savePreferenceVectorOverride(input: {
  vector: Partial<PreferenceVector>;
  reset?: boolean;
}): Promise<PreferenceVectorSaveResult> {
  let nextVector: PreferenceVector;
  if (input.reset) {
    nextVector = { ...DEFAULT_VECTOR };
  } else {
    const current = await loadPreferenceVector();
    nextVector = { ...current };
    for (const axis of AXES) {
      const v = input.vector[axis];
      if (typeof v === "number") nextVector[axis] = v;
    }
  }

  await savePreferenceVector(nextVector);
  invalidateStyleCache();

  void prisma.auditEvent
    .create({
      data: {
        actor: "operator",
        eventType: "preference_override",
        detail: input.reset
          ? "reset to neutral · all axes zero"
          : `manual override · ${Object.keys(input.vector).join(", ")}`,
        payload: {
          reset: input.reset ?? false,
          patch: input.vector,
          nextVector,
        },
      },
    })
    .catch(() => undefined);

  log.info("preference_override", {
    reset: input.reset ?? false,
    axes: Object.keys(input.vector),
  });

  const addendum = buildSystemPromptAddendum(nextVector);
  return {
    ok: true,
    vector: nextVector,
    addendum,
    addendumChars: addendum.length,
  };
}
