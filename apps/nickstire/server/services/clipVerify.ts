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
 *     per-clip floor is REEL_CLIP_VERIFY_MIN (default 0.6, OpenReels' value).
 *   - One vision call per clip, through the same `invokeLLM` lane as the
 *     rendered critic, with a two-field schema ({ score, reason }).
 *   - A clip BELOW the floor refuses assembly with ClipMismatchRefusal, a
 *     ReelAssemblyRefusedError subclass: assemblyFailureOutcome already parks
 *     those `failed` without spending the retry budget, and the message names
 *     the beat, the score and the reason (a refusal the caller cannot type is a
 *     jam; one it cannot read is a mystery).
 *   - A critic that could not evaluate (timeout, parse failure) is recorded as
 *     `critic: "unavailable"` and assembly CONTINUES: the rendered-QA gate still
 *     holds the publish door, so an outage here must not jam the lane.
 *   - Verdicts are returned to the caller for persistence on the job payload
 *     (`clipVerify`), evidence either way.
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

export interface ClipVerifyConfig {
  enabled: boolean;
  /** 0..1; a clip scoring below this refuses assembly. */
  min: number;
}

export function clipVerifyConfig(env: NodeJS.ProcessEnv = process.env): ClipVerifyConfig {
  const raw = Number(env.REEL_CLIP_VERIFY_MIN);
  const min = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : CLIP_VERIFY_DEFAULT_MIN;
  return { enabled: env.REEL_CLIP_VERIFY_ENABLED === "true", min };
}

export interface ClipVerdict {
  beatNumber: number;
  /** 0..1 when the critic evaluated; null when it could not. */
  score: number | null;
  reason: string;
  critic: "vision" | "unavailable";
  evaluatedAt: string;
}

export interface ClipToVerify {
  beatNumber: number;
  /** Local path to the clip's bytes (assembly has already fetched them). */
  path: string;
  /** The beat's planned visual, the text the clip must show. */
  visual: string;
  durationSec?: number | null;
}

export class ClipMismatchRefusal extends ReelAssemblyRefusedError {
  constructor(public readonly verdict: ClipVerdict, public readonly min: number) {
    super(`CLIP_MISMATCH beat ${verdict.beatNumber} scored ${verdict.score?.toFixed(2)} below ${min.toFixed(2)}: ${verdict.reason}`);
    this.name = "ClipMismatchRefusal";
  }
}

/** Clamp the critic's reply into a verdict. Unknown shapes read as unavailable, never as a match. */
function judgeClipVerdict(parsed: unknown, beatNumber: number, now: Date = new Date()): ClipVerdict {
  const obj = parsed && typeof parsed === "object" ? (parsed as { score?: unknown; reason?: unknown }) : null;
  const score = obj && typeof obj.score === "number" && Number.isFinite(obj.score) ? Math.min(1, Math.max(0, obj.score)) : null;
  const reason = obj && typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim().slice(0, 400) : "";
  if (score === null) {
    return { beatNumber, score: null, reason: reason || "critic returned no numeric score", critic: "unavailable", evaluatedAt: now.toISOString() };
  }
  return { beatNumber, score, reason: reason || "no reason given", critic: "vision", evaluatedAt: now.toISOString() };
}

export type ClipJudge = (clip: ClipToVerify) => Promise<unknown>;

/**
 * Verify every clip; refuse on the first one below the floor when enabled.
 * Pure orchestration over an injected judge so the policy is unit-testable
 * without ffmpeg or a model. Disabled: returns [] and judges nothing (no spend).
 */
export async function verifyClipsBeforeAssembly(
  clips: ClipToVerify[],
  cfg: ClipVerifyConfig,
  judge: ClipJudge = visionClipJudge,
  opts: { jobId?: number; log?: (msg: string, ctx: Record<string, unknown>) => void } = {},
): Promise<ClipVerdict[]> {
  if (!cfg.enabled) return [];
  const warn = opts.log ?? ((msg, ctx) => log.warn(msg, ctx));
  const verdicts: ClipVerdict[] = [];
  for (const clip of clips) {
    let verdict: ClipVerdict;
    try {
      verdict = judgeClipVerdict(await judge(clip), clip.beatNumber);
    } catch (e) {
      verdict = { beatNumber: clip.beatNumber, score: null, reason: `critic unavailable: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400), critic: "unavailable", evaluatedAt: new Date().toISOString() };
    }
    verdicts.push(verdict);
    if (verdict.critic === "unavailable") {
      warn("clip verify unavailable (assembly continues; rendered QA still gates publish)", { jobId: opts.jobId, beat: clip.beatNumber, reason: verdict.reason });
      continue;
    }
    if ((verdict.score ?? 0) < cfg.min) throw new ClipMismatchRefusal(verdict, cfg.min);
  }
  return verdicts;
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

function runFfmpeg(args: string[]): Promise<void> {
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve, reject) => {
    const c = spawn(bin, ["-v", "error", ...args], { shell: process.platform === "win32" });
    let err = "";
    c.stderr.on("data", (d) => (err += String(d)));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(0, 300)}`))));
  });
}

/** The clip's midpoint frame as a JPEG; throws when ffmpeg produced nothing (never a blank judged as a match). */
async function extractMidFrame(clip: ClipToVerify, outDir?: string): Promise<string> {
  const dir = outDir ?? (await fs.promises.mkdtemp(path.join(os.tmpdir(), "clip-verify-")));
  const mid = Math.max(0.1, ((clip.durationSec ?? 4) / 2));
  const file = path.join(dir, `beat${clip.beatNumber}.jpg`);
  await runFfmpeg(["-ss", mid.toFixed(2), "-i", clip.path, "-frames:v", "1", "-q:v", "3", "-y", file]);
  const st = await fs.promises.stat(file).catch(() => null);
  if (!st || st.size === 0) throw new Error(`FRAME_MISSING: beat ${clip.beatNumber} at ${mid.toFixed(2)}s produced no frame`);
  return file;
}

const visionClipJudge: ClipJudge = async (clip) => {
  const frame = await extractMidFrame(clip);
  const { invokeLLM } = await import("../_core/llm");
  const image = (await fs.promises.readFile(frame)).toString("base64");
  const res = await invokeLLM({
    messages: [
      { role: "system", content: "You check ONE frame of a generated automotive reel clip against the shot it was supposed to show. Judge only what is visible. Score 1 when the subject and setting in the plan are clearly on screen, 0 when the frame shows a different subject, a different setting, or has morphed into something else. Reply with JSON only." },
      { role: "user", content: [{ type: "text", text: `Planned visual for beat ${clip.beatNumber}: ${clip.visual}` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }] },
    ],
    maxTokens: 2048,
    reasoningEffort: "low",
    timeoutMs: 60_000,
    outputSchema: CLIP_VERDICT_SCHEMA,
  });
  const content = res.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join("\n") : "";
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`clip critic returned no JSON object (${text.length} chars)`);
  return JSON.parse(cleaned.slice(start, end + 1));
};
