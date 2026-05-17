/**
 * GET / POST /api/system/preference-vector · v10.0.529.33
 *
 * Arc B Feature 1 · operator-facing visibility + manual override for
 * the 8-axis preference vector. GET returns the current vector +
 * addendum + last-tune metadata. POST takes a full or partial vector
 * and saves · the cron-driven weekly tune continues to operate on top
 * of operator overrides (each tune applies a small delta · operator
 * overrides win at the moment of override but drift can re-shape the
 * vector unless the operator overrides again).
 *
 * Power+control alignment · the operator wants every dial exposed.
 * The vector is one of the only fully-inferred, fully-automated
 * pieces of operator state · this surface makes it visible AND
 * overridable. Resets are atomic · "reset to neutral" zeros every axis.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import {
  AXES,
  DEFAULT_VECTOR,
  loadPreferenceVector,
  savePreferenceVector,
  buildSystemPromptAddendum,
  type PreferenceVector,
} from "@/lib/brain/preference-inference";
// v10.0.529.34 · Arc B F7 · invalidate the style-adapter cache so
// the operator's override propagates to non-chat surfaces on the
// next AI call, not 5 minutes later.
import { invalidateStyleCache } from "@/lib/ai/style-adapter";

const log = rootLogger.withSurface("api/system/preference-vector");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

// v10.0.529.33 · partial-vector accepts any subset of axes · the
// operator can override one axis (e.g. directness +0.8) without
// touching the others. Missing axes are merged from current.
const overrideSchema = z.object({
  vector: z
    .object({
      density: z.number().finite().min(-1).max(1).optional(),
      creativity: z.number().finite().min(-1).max(1).optional(),
      skepticism: z.number().finite().min(-1).max(1).optional(),
      directness: z.number().finite().min(-1).max(1).optional(),
      humor: z.number().finite().min(-1).max(1).optional(),
      jargon: z.number().finite().min(-1).max(1).optional(),
      structure: z.number().finite().min(-1).max(1).optional(),
      urgency: z.number().finite().min(-1).max(1).optional(),
    })
    .strict(),
  reset: z.boolean().optional(),
});

interface LastTuneSummary {
  date: string;
  sampleSize: number;
  learningRate: number;
  prev: PreferenceVector;
  next: PreferenceVector;
  /** Per-axis delta · next − prev · so the UI can show "+0.04 density · -0.01 humor · …" */
  delta: PreferenceVector;
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
  const sampleSize =
    typeof m.sampleSize === "number" ? m.sampleSize : 0;
  const learningRate =
    typeof m.learningRate === "number" ? m.learningRate : 0;
  if (!prev || !next) return null;
  const delta: PreferenceVector = { ...DEFAULT_VECTOR };
  for (const axis of AXES) {
    delta[axis] = Number(((next[axis] ?? 0) - (prev[axis] ?? 0)).toFixed(3));
  }
  return {
    date: row.key,
    sampleSize,
    learningRate,
    prev,
    next,
    delta,
  };
}

// v10.0.529.39 · per-axis tune trace · returns the last 12 weekly tunes
// in chronological order (oldest first · so the UI plots left-to-right).
// Each entry has date + the post-tune vector (we use `next`, the value
// AFTER that week's tune landed). Skips rows with corrupted metadata
// rather than throwing.
interface TuneTracePoint {
  date: string;
  vector: PreferenceVector;
  sampleSize: number;
}

async function loadTuneTrace(limit: number = 12): Promise<TuneTracePoint[]> {
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
    const sampleSize =
      typeof m.sampleSize === "number" ? m.sampleSize : 0;
    // Normalize the vector through AXES so missing keys default to 0
    // and we always return exactly 8 numbers per point.
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

export async function GET(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [vec, lastTune, trace] = await Promise.all([
    loadPreferenceVector(),
    loadLastTuneSummary(),
    loadTuneTrace(12),
  ]);

  const addendum = buildSystemPromptAddendum(vec);

  return NextResponse.json({
    ok: true,
    axes: AXES,
    vector: vec,
    addendum,
    addendumChars: addendum.length,
    lastTune,
    trace,
  });
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof overrideSchema>;
  try {
    const json = await req.json();
    const parsed = overrideSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Reset → zero every axis · ignores any partial values in body.vector
  // when reset=true · the operator's intent is "start over."
  let nextVector: PreferenceVector;
  if (body.reset) {
    nextVector = { ...DEFAULT_VECTOR };
  } else {
    const current = await loadPreferenceVector();
    nextVector = { ...current };
    for (const axis of AXES) {
      const v = body.vector[axis];
      if (typeof v === "number") {
        nextVector[axis] = v;
      }
    }
  }

  await savePreferenceVector(nextVector);
  // v10.0.529.34 · clear the style-adapter cache so non-chat AI
  // surfaces (reflect-pushback · coach-goal · teach · etc) pick
  // up the override on the next call rather than waiting up to 5
  // minutes for the cache TTL to expire.
  invalidateStyleCache();

  // Audit · operator overrides should be traceable so the weekly tune
  // can later detect "override drift" (operator manually pushed an axis
  // away from where feedback was driving it · signal worth noticing).
  void prisma.auditEvent
    .create({
      data: {
        actor: "operator",
        eventType: "preference_override",
        detail: body.reset
          ? "reset to neutral · all axes zero"
          : `manual override · ${Object.keys(body.vector).join(", ")}`,
        payload: {
          reset: body.reset ?? false,
          patch: body.vector,
          nextVector,
        },
      },
    })
    .catch(() => undefined);

  log.info("preference_override", {
    reset: body.reset ?? false,
    axes: Object.keys(body.vector),
  });

  const addendum = buildSystemPromptAddendum(nextVector);

  return NextResponse.json({
    ok: true,
    vector: nextVector,
    addendum,
    addendumChars: addendum.length,
  });
}
