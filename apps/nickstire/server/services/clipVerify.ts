/**
 * Per-clip verification BEFORE assembly (2026-10-16, GitHub scout item 3).
 *
 * Mechanism taken from tsensei/OpenReels (vision-verify each shot against its
 * scene, reject below a confidence floor, before the expensive stage). Here the
 * expensive stage is everything after assembly: the 3-vote rendered QA, the
 * repair loop and the operator's attention. Cron reels were passing rendered QA
 * 0/4 on ENVIRONMENT_DRIFT and SUBJECT_CONTINUITY (2026-10-16): a clip that
 * morphs away from its beat is cheaper to catch while it is still one clip.
 *
 * Posture, stated so nobody widens it by accident:
 *   - Flag-gated, default OFF (REEL_CLIP_VERIFY_ENABLED="true" arms it); the
 *     per-clip floor is REEL_CLIP_VERIFY_MIN (default 0.6, OpenReels' value; a
 *     blank value is absent, never a zero floor).
 *   - One vision call per clip, through the same `invokeLLM` lane as the
 *     rendered critic, with a two-field schema ({ score, reason }).
 *   - Contrastive (2026-10-17, deep scout #5), FLAG-GATED, default OFF
 *     (REEL_CLIP_VERIFY_CONTRAST="true" arms it; off is byte-for-byte the
 *     single-frame score-only check). Near-duplicate sibling beats (job
 *     2100002: two macro shots of the same end-link bushing) can make a fair
 *     sibling pick park a good reel, so it stays off until measured. When
 *     armed and the brief has other beats, the judge sees a first/mid/last contact sheet and must PICK which of up
 *     to three shuffled descriptions (its beat plus two siblings) it shows, and
 *     say whether the subject changes across the tiles. A sibling pick or a
 *     subject change refuses with the same ClipMismatchRefusal; the verdict
 *     records `pick` and `subjectChanges`. A one-beat brief keeps the
 *     single-frame score-only check.
 *   - A clip BELOW the floor refuses assembly with ClipMismatchRefusal, a
 *     ReelAssemblyRefusedError subclass: assemblyFailureOutcome already parks
 *     those `failed` without spending the retry budget, and the message names
 *     the beat, the score and the reason (a refusal the caller cannot type is a
 *     jam; one it cannot read is a mystery).
 *   - A critic that could not evaluate (timeout, parse failure) is recorded as
 *     `critic: "unavailable"` and assembly CONTINUES: the rendered-QA gate still
 *     holds the publish door, so an outage here must not jam the lane.
 *   - Every verdict is handed to `onVerdict` the moment it exists (the pipeline
 *     persists it as `payload.clipVerify` with a compare-and-swap), and a prior
 *     vision verdict for a beat is REUSED on an assembly retry, so an unrelated
 *     ffmpeg or storage failure never buys the same vision call twice (Codex
 *     review of #3086).
 *   - Frames go into the caller's work directory (assembly removes it in its
 *     `finally`); without one the judge removes its own temp dir. ffmpeg is
 *     killed after FFMPEG_TIMEOUT_MS so a pathological clip cannot wedge the
 *     worker before the model's own timeout.
 *
 * Follow-up, not in this change: routing a refused beat into the repair lane
 * instead of parking the job.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { ReelAssemblyRefusedError } from "./reelContentRefusal";
import { createLogger } from "../lib/logger";

const log = createLogger("services:clip-verify");

const CLIP_VERIFY_DEFAULT_MIN = 0.6;
const FFMPEG_TIMEOUT_MS = 30_000;
const PERSIST_ATTEMPTS = 3;

export interface ClipVerifyConfig {
  enabled: boolean;
  /** 0..1; a clip scoring below this refuses assembly. */
  min: number;
  /** REEL_CLIP_VERIFY_CONTRAST="true": contact sheet + contrastive pick. Off (default): the single-frame score-only check, siblings ignored. */
  contrast?: boolean;
}

export function clipVerifyConfig(env: NodeJS.ProcessEnv = process.env): ClipVerifyConfig {
  // A present-but-blank value is absent: Number("") is 0, which would silently
  // turn the floor off while the flag says the guard is on.
  const rawStr = (env.REEL_CLIP_VERIFY_MIN ?? "").trim();
  const raw = rawStr === "" ? Number.NaN : Number(rawStr);
  const min = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : CLIP_VERIFY_DEFAULT_MIN;
  return { enabled: env.REEL_CLIP_VERIFY_ENABLED === "true", min, contrast: env.REEL_CLIP_VERIFY_CONTRAST === "true" };
}

export interface ClipVerdict {
  beatNumber: number;
  /** 0..1 when the critic evaluated; null when it could not. */
  score: number | null;
  reason: string;
  critic: "vision" | "unavailable";
  evaluatedAt: string;
  /** Contrastive check (2026-10-17): the beat number whose description the judge picked. Absent on a one-beat brief and on older verdicts. */
  pick?: number;
  /** Contrastive check: the judge saw the subject change across the first/mid/last tiles. Absent as above. */
  subjectChanges?: boolean;
}

export interface ClipToVerify {
  beatNumber: number;
  /** Local path to the clip's bytes (assembly has already fetched them). */
  path: string;
  /** The beat's planned visual, the text the clip must show. */
  visual: string;
  durationSec?: number | null;
  /** Where the contact sheet is written; the caller owns and removes it. Absent: the judge uses and removes its own temp dir. */
  workDir?: string;
  /** Up to two other beats of the same brief (pickSiblingBeats): the confusable alternatives. None = today's score-only check. */
  siblings?: Array<{ beatNumber: number; visual: string }>;
  /** Set by the verifier for the judge only: the shuffled descriptions to pick from, by index. */
  candidates?: string[];
}

/** Why a vision verdict refuses, or null when it passes. Pick and subjectChanges decide only when present (older verdicts are score-only). */
function refusalCause(v: ClipVerdict, min: number): string | null {
  if (v.pick !== undefined && v.pick !== v.beatNumber) return `shows beat ${v.pick}'s visual, not its own (scored ${v.score?.toFixed(2)})`;
  if (v.subjectChanges === true) return `subject changes across first/mid/last (scored ${v.score?.toFixed(2)})`;
  if ((v.score ?? 0) < min) return `scored ${v.score?.toFixed(2)} below ${min.toFixed(2)}`;
  return null;
}

export class ClipMismatchRefusal extends ReelAssemblyRefusedError {
  constructor(public readonly verdict: ClipVerdict, public readonly min: number) {
    super(`CLIP_MISMATCH beat ${verdict.beatNumber} ${refusalCause(verdict, min) ?? `scored ${verdict.score?.toFixed(2)} below ${min.toFixed(2)}`}: ${verdict.reason}`);
    this.name = "ClipMismatchRefusal";
  }
}

/**
 * Clamp the critic's reply into a verdict. Unknown shapes read as unavailable, never as a match.
 * With `candidateBeats` (contrastive), a pick that is not an index into them, or a non-boolean
 * subjectChanges, is left off the verdict: that dimension falls back to the score-only check,
 * so a malformed reply is never weaker than the pre-contrastive gate.
 */
function judgeClipVerdict(parsed: unknown, beatNumber: number, candidateBeats?: number[], now: Date = new Date()): ClipVerdict {
  const obj = parsed && typeof parsed === "object" ? (parsed as { score?: unknown; reason?: unknown; pick?: unknown; subjectChanges?: unknown }) : null;
  const score = obj && typeof obj.score === "number" && Number.isFinite(obj.score) ? Math.min(1, Math.max(0, obj.score)) : null;
  const reason = obj && typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim().slice(0, 400) : "";
  if (score === null) {
    return { beatNumber, score: null, reason: reason || "critic returned no numeric score", critic: "unavailable", evaluatedAt: now.toISOString() };
  }
  const verdict: ClipVerdict = { beatNumber, score, reason: reason || "no reason given", critic: "vision", evaluatedAt: now.toISOString() };
  if (!candidateBeats) return verdict;
  const pick = obj!.pick;
  if (typeof pick === "number" && Number.isInteger(pick) && pick >= 0 && pick < candidateBeats.length) verdict.pick = candidateBeats[pick];
  if (typeof obj!.subjectChanges === "boolean") verdict.subjectChanges = obj!.subjectChanges;
  return verdict;
}

/**
 * The confusable alternatives for one beat: the nearest other beats (by position) whose
 * visual is non-empty and differs from this beat's, at most two. Pure.
 */
export function pickSiblingBeats(beats: Array<{ beatNumber: number; visual: string }>, beatNumber: number): Array<{ beatNumber: number; visual: string }> {
  const at = beats.findIndex((b) => b.beatNumber === beatNumber);
  if (at < 0) return [];
  const own = beats[at].visual.trim();
  return beats
    .map((b, i) => ({ b, d: Math.abs(i - at), i }))
    .filter(({ b, i }) => i !== at && b.visual.trim() !== "" && b.visual.trim() !== own)
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .slice(0, 2)
    .map(({ b }) => ({ beatNumber: b.beatNumber, visual: b.visual }));
}

/** The clip's own beat plus its siblings, Fisher-Yates shuffled so the right answer has no fixed slot. */
function contrastCandidates(clip: ClipToVerify, rng: () => number): { texts: string[]; beats: number[] } | null {
  if (!clip.siblings?.length) return null;
  const all = [{ beatNumber: clip.beatNumber, visual: clip.visual }, ...clip.siblings];
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return { texts: all.map((c) => c.visual), beats: all.map((c) => c.beatNumber) };
}

export type ClipJudge = (clip: ClipToVerify) => Promise<unknown>;

interface VerifyOptions {
  jobId?: number;
  log?: (msg: string, ctx: Record<string, unknown>) => void;
  /** Verdicts already on the job (an earlier assembly attempt); a vision verdict for a beat is reused, not re-bought. */
  prior?: ClipVerdict[] | null;
  /** Called with each verdict as soon as it exists, BEFORE a refusal is thrown; the pipeline persists here. */
  onVerdict?: (verdict: ClipVerdict) => Promise<void>;
  /** Candidate shuffle source (tests pin it); Math.random by default. */
  rng?: () => number;
}

/**
 * Verify every clip; refuse on the first one below the floor when enabled.
 * Pure orchestration over an injected judge so the policy is unit-testable
 * without ffmpeg or a model. Disabled: returns [] and judges nothing (no spend).
 */
export async function verifyClipsBeforeAssembly(
  clips: ClipToVerify[],
  cfg: ClipVerifyConfig,
  judge: ClipJudge = visionClipJudge,
  opts: VerifyOptions = {},
): Promise<ClipVerdict[]> {
  if (!cfg.enabled) return [];
  const warn = opts.log ?? ((msg, ctx) => log.warn(msg, ctx));
  const prior = new Map((opts.prior ?? []).filter((v) => v && v.critic === "vision").map((v) => [v.beatNumber, v]));
  const verdicts: ClipVerdict[] = [];
  for (const clip of clips) {
    let verdict: ClipVerdict;
    const reused = prior.get(clip.beatNumber);
    if (reused) {
      verdict = reused;
    } else {
      try {
        // Contrast off: the judge gets exactly today's clip (siblings ride along unused), so today's request.
        const cands = cfg.contrast === true ? contrastCandidates(clip, opts.rng ?? Math.random) : null;
        verdict = judgeClipVerdict(await judge(cands ? { ...clip, candidates: cands.texts } : clip), clip.beatNumber, cands?.beats);
      } catch (e) {
        verdict = { beatNumber: clip.beatNumber, score: null, reason: `critic unavailable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400), critic: "unavailable", evaluatedAt: new Date().toISOString() };
      }
      if (opts.onVerdict) {
        // Persistence is evidence, never a gate: a failed write is logged and the verdict still counts.
        await opts.onVerdict(verdict).catch((e) => warn("clip verdict persistence failed", { jobId: opts.jobId, beat: clip.beatNumber, e: e instanceof Error ? e.message : String(e) }));
      }
    }
    verdicts.push(verdict);
    if (verdict.critic === "unavailable") {
      warn("clip verify unavailable (assembly continues; rendered QA still gates publish)", { jobId: opts.jobId, beat: clip.beatNumber, reason: verdict.reason });
      continue;
    }
    if (refusalCause(verdict, cfg.min)) throw new ClipMismatchRefusal(verdict, cfg.min);
  }
  return verdicts;
}

// ─── Persistence: merge verdicts into payload.clipVerify with a compare-and-swap ─

interface PayloadStore {
  /** The row's payload text, or null when the row is gone. */
  read: () => Promise<string | null>;
  /** Write `next` only if the row still holds `expected`; returns rows affected (0 = someone else wrote first). */
  swap: (expected: string, next: string) => Promise<number>;
}

/**
 * Merge verdicts by beat into `payload.clipVerify.verdicts`, pinned to the exact
 * payload text that was read (claim-before-act): the rendered-QA writer, the
 * audio-QA writer and admin actions all read-modify-write this column, so an
 * unguarded update here could erase their fields, or theirs could erase ours.
 * Returns true when the write landed, false after PERSIST_ATTEMPTS losses or a
 * missing row. Pure over the store so the race is unit-testable.
 */
export async function mergeClipVerdictsIntoPayload(store: PayloadStore, verdicts: ClipVerdict[], now: Date = new Date()): Promise<boolean> {
  if (!verdicts.length) return true;
  for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
    const current = await store.read();
    if (current === null) return false;
    let payload: { clipVerify?: { verdicts?: ClipVerdict[]; recordedAt?: string } };
    try {
      payload = JSON.parse(current || "{}") ?? {};
    } catch {
      payload = {};
    }
    const byBeat = new Map((payload.clipVerify?.verdicts ?? []).map((v) => [v.beatNumber, v]));
    for (const v of verdicts) byBeat.set(v.beatNumber, v);
    payload.clipVerify = { verdicts: [...byBeat.values()].sort((a, b) => a.beatNumber - b.beatNumber), recordedAt: now.toISOString() };
    if ((await store.swap(current, JSON.stringify(payload))) === 1) return true;
  }
  return false;
}

/** The drizzle-backed store for one reel_jobs row. */
async function reelJobPayloadStore(d: NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>, jobId: number): Promise<PayloadStore> {
  const { reelJobs } = await import("../../drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  return {
    read: async () => {
      const [row] = await d.select({ payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
      return row ? (row.payload ?? "") : null;
    },
    swap: async (expected, next) => {
      const res = await d.update(reelJobs).set({ payload: next }).where(and(eq(reelJobs.id, jobId), eq(reelJobs.payload, expected)));
      return (res[0] as unknown as { affectedRows?: number })?.affectedRows ?? 0;
    },
  };
}

/** Persist verdicts on a reel job's payload; best effort, logged, never throws. */
export async function persistClipVerdicts(d: NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>, jobId: number, verdicts: ClipVerdict[]): Promise<void> {
  try {
    const ok = await mergeClipVerdictsIntoPayload(await reelJobPayloadStore(d, jobId), verdicts);
    if (!ok) log.warn("clip verdicts not persisted (row missing or lost the swap 3 times)", { jobId, beats: verdicts.map((v) => v.beatNumber) });
  } catch (e) {
    log.warn("clip verdict persistence failed", { jobId, e: e instanceof Error ? e.message : String(e) });
  }
}

// ─── The real judge: one midpoint frame, one vision call ─────────────────────

const CLIP_VERDICT_SCHEMA = {
  name: "clip_verdict",
  schema: {
    type: "object",
    properties: {
      score: { type: "number", description: "0..1: how well the frame shows the planned visual (1 = clearly this subject in this setting, 0 = a different subject or setting)" },
      reason: { type: "string", description: "one sentence naming what matched or what drifted" },
    },
    required: ["score", "reason"],
    additionalProperties: false,
  },
} as const;

/** Contrastive schema: today's two fields plus the pick (an index into the listed descriptions) and subjectChanges. */
const CLIP_CONTRAST_SCHEMA = {
  name: "clip_contrast_verdict",
  schema: {
    type: "object",
    properties: {
      score: { type: "number", description: "0..1: how clearly the sheet shows the description you picked (1 = clearly that subject in that setting, 0 = none of them)" },
      reason: { type: "string", description: "one sentence naming what matched or what drifted" },
      pick: { type: "integer", description: "the index of the description the three frames show" },
      subjectChanges: { type: "boolean", description: "true when the main subject or setting is not the same thing in all three frames (it morphs, swaps or drifts)" },
    },
    required: ["score", "reason", "pick", "subjectChanges"],
    additionalProperties: false,
  },
} as const;

/**
 * The vision request for one clip, pure. With candidates (contrastive): a first/mid/last contact
 * sheet, the shuffled descriptions by index, and the planned one NOT named, so the pick is a real
 * test. Without (one-beat brief): today's single-frame, planned-visual, {score, reason} request.
 */
function clipJudgeRequest(clip: ClipToVerify, imageB64: string) {
  const image = { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${imageB64}` } };
  if (!clip.candidates?.length) {
    return {
      messages: [
        { role: "system" as const, content: "You check ONE frame of a generated automotive reel clip against the shot it was supposed to show. Judge only what is visible. Score 1 when the subject and setting in the plan are clearly on screen, 0 when the frame shows a different subject, a different setting, or has morphed into something else. Reply with JSON only." },
        { role: "user" as const, content: [{ type: "text" as const, text: `Planned visual for beat ${clip.beatNumber}: ${clip.visual}` }, image] },
      ],
      outputSchema: CLIP_VERDICT_SCHEMA,
    };
  }
  return {
    messages: [
      { role: "system" as const, content: "You check a contact sheet of ONE generated automotive reel clip: its first, middle and last frame, left to right. Judge only what is visible. Pick the ONE numbered shot description the clip shows, score 0..1 how clearly it shows that description, and say whether the main subject or setting changes across the three frames (a car that becomes another car, a bay that becomes a street). Reply with JSON only." },
      { role: "user" as const, content: [{ type: "text" as const, text: `Shot descriptions:\n${clip.candidates.map((c, i) => `${i}: ${c}`).join("\n")}` }, image] },
    ],
    outputSchema: CLIP_CONTRAST_SCHEMA,
  };
}

function runFfmpeg(args: string[], timeoutMs = FFMPEG_TIMEOUT_MS): Promise<void> {
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve, reject) => {
    const c = spawn(bin, ["-v", "error", ...args], { shell: process.platform === "win32" });
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      c.kill("SIGKILL");
    }, timeoutMs);
    c.stderr.on("data", (d) => (err += String(d)));
    c.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    c.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`ffmpeg killed after ${timeoutMs} ms (frame extraction hung)`));
      else if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(0, 300)}`));
    });
  });
}

/** The clip's midpoint frame as a JPEG in `dir`; throws when ffmpeg produced nothing (never a blank judged as a match). */
async function extractMidFrame(clip: ClipToVerify, dir: string): Promise<string> {
  const mid = Math.max(0.1, ((clip.durationSec ?? 4) / 2));
  const file = path.join(dir, `verify-beat${clip.beatNumber}.jpg`);
  await runFfmpeg(["-ss", mid.toFixed(2), "-i", clip.path, "-frames:v", "1", "-q:v", "3", "-y", file]);
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || st.size === 0) throw new Error(`FRAME_MISSING: beat ${clip.beatNumber} at ${mid.toFixed(2)}s produced no frame`);
  return file;
}

/**
 * ffmpeg args for the contact sheet: the first, middle and last frame of the clip, each scaled
 * to 360 px wide and stacked side by side into ONE jpeg. Pure. Drift happens across time, which
 * one midpoint frame cannot see (rendered QA failed 0/4 on ENVIRONMENT_DRIFT, 2026-10-16).
 */
function contactSheetArgs(clip: ClipToVerify, file: string): string[] {
  const dur = clip.durationSec && clip.durationSec > 0 ? clip.durationSec : 4;
  const times = [Math.min(0.1, dur / 4), dur / 2, Math.max(0.1, dur - 0.15)];
  return [
    ...times.flatMap((t) => ["-ss", t.toFixed(2), "-i", clip.path]),
    "-filter_complex",
    "[0:v]scale=360:-2[a];[1:v]scale=360:-2[b];[2:v]scale=360:-2[c];[a][b][c]hstack=inputs=3",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    file,
  ];
}

/** The clip's contact sheet as a JPEG in `dir`; throws when ffmpeg produced nothing (never a blank judged as a match). */
async function extractContactSheet(clip: ClipToVerify, dir: string): Promise<string> {
  const file = path.join(dir, `verify-beat${clip.beatNumber}-sheet.jpg`);
  await runFfmpeg(contactSheetArgs(clip, file));
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || st.size === 0) throw new Error(`FRAME_MISSING: beat ${clip.beatNumber} contact sheet produced no image`);
  return file;
}

const visionClipJudge: ClipJudge = async (clip) => {
  const ownDir = clip.workDir ? null : await fs.promises.mkdtemp(path.join(os.tmpdir(), "clip-verify-"));
  try {
    const dir = clip.workDir ?? ownDir!;
    const frame = clip.candidates?.length ? await extractContactSheet(clip, dir) : await extractMidFrame(clip, dir);
    const { invokeLLM } = await import("../_core/llm");
    const image = (await fs.promises.readFile(frame)).toString("base64");
    const res = await invokeLLM({
      ...clipJudgeRequest(clip, image),
      maxTokens: 2048,
      reasoningEffort: "low",
      timeoutMs: 60_000,
    });
    const content = res.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join("\n") : "";
    const cleaned = text.replace(/```(?:json)?/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`clip critic returned no JSON object (${text.length} chars)`);
    return JSON.parse(cleaned.slice(start, end + 1));
  } finally {
    if (ownDir) await fs.promises.rm(ownDir, { recursive: true, force: true }).catch(() => {});
  }
};
