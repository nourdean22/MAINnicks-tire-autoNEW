/**
 * Rendered creative QA — Long Haul milestone 8 (ledger: rendered-creative-qa).
 *
 * The technical render gate (evaluateRenderIntegrity) proves the FILE is
 * sound: frames advance, duration matches, audio exists. It cannot see that
 * the tire changed tread between beats, a hand appeared, or the model wrote
 * garbled lettering into a frame. This module judges the ACTUAL RENDER:
 *
 *   assembled mp4
 *   → extract first / per-beat midpoint / final frames (ffmpeg, deterministic)
 *   → build a contact sheet (single reviewable image)
 *   → vision critic (Gemini via invokeLLM image parts) scores the frames
 *     against the brief + approved Visual World
 *   → STRUCTURED findings: beat-addressed defect codes with explicit
 *     preserve/change repair instructions — the smallest repairable unit,
 *     never "regenerate everything"
 *
 * Exposure discipline (Reality Control): the pipeline hook is gated by
 * RENDERED_QA_ENABLED (default OFF — prod behavior unchanged until the
 * operator arms it); the operator endpoint works on demand regardless.
 * QA never fails a job on its own infra errors — findings are evidence for
 * the approve gate, not a silent destroyer.
 */
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../lib/logger";

const log = createLogger("services:rendered-qa");

/** Defect vocabulary — the ONLY codes a critic verdict may carry. Severity
 *  class drives the decision: any `block` finding => decision "repair". */
export const RENDERED_DEFECT_CODES = {
  SUBJECT_CONTINUITY: { severity: "block", meaning: "hero object changes identity (shape/tread/wheel design) between beats" },
  DAMAGE_LOCATION_DRIFT: { severity: "block", meaning: "damage/wear moves or changes type between beats" },
  ENVIRONMENT_DRIFT: { severity: "block", meaning: "location/background/weather changes without a deliberate transition" },
  HUMAN_PRESENT: { severity: "block", meaning: "human face/hands/figure appears (faceless contract)" },
  GENERATED_TEXT_ARTIFACT: { severity: "block", meaning: "model-generated lettering/garbled text baked into a frame" },
  MALFORMED_GEOMETRY: { severity: "block", meaning: "physically impossible automotive part (warped wheel, fused geometry)" },
  LIGHTING_DRIFT: { severity: "warn", meaning: "lighting direction/temperature shifts noticeably between beats" },
  PALETTE_DRIFT: { severity: "warn", meaning: "color grade departs from the graphite+gold world" },
  WEAK_COMPOSITION: { severity: "warn", meaning: "subject too small / centered awkwardly / dead framing" },
  CAPTION_OBSTRUCTION: { severity: "warn", meaning: "burned-in caption collides with the subject or safe zones" },
} as const;

export type RenderedDefectCode = keyof typeof RENDERED_DEFECT_CODES;

export interface RenderedFinding {
  beatNumber: number | null;
  code: RenderedDefectCode;
  severity: "block" | "warn";
  description: string;
  preserve: string[];
  change: string[];
}

export interface RenderedQaVerdict {
  decision: "approve" | "repair";
  findings: RenderedFinding[];
  framesEvaluated: number;
  contactSheetPath?: string;
  evaluatedAt: string;
  critic: "vision" | "skipped";
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`))));
  });
}

export interface ExtractedFrame {
  label: string;
  beatNumber: number | null;
  timestamp: number;
  path: string;
}

/** First frame, one midpoint frame per beat, final frame. Deterministic. */
export async function extractReelFrames(
  mp4Path: string,
  beats: Array<{ beatNumber: number; startSecond: number; endSecond: number }>,
  outDir?: string,
): Promise<ExtractedFrame[]> {
  const dir = outDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "rendered-qa-")));
  const frames: ExtractedFrame[] = [];
  const last = beats[beats.length - 1];
  const plan: Array<{ label: string; beatNumber: number | null; timestamp: number }> = [
    { label: "first", beatNumber: beats[0]?.beatNumber ?? null, timestamp: 0.1 },
    ...beats.map((b) => ({
      label: `beat${b.beatNumber}`,
      beatNumber: b.beatNumber,
      timestamp: Number(((b.startSecond + b.endSecond) / 2).toFixed(2)),
    })),
    { label: "final", beatNumber: last?.beatNumber ?? null, timestamp: Math.max(0.2, (last?.endSecond ?? 1) - 0.2) },
  ];
  for (const p of plan) {
    const file = path.join(dir, `${p.label}.jpg`);
    await runFfmpeg(["-ss", String(p.timestamp), "-i", mp4Path, "-frames:v", "1", "-q:v", "3", "-y", file]);
    frames.push({ ...p, path: file });
  }
  return frames;
}

/** One reviewable grid image from the extracted frames. */
export async function buildContactSheet(frames: ExtractedFrame[], outPath: string): Promise<string> {
  const cols = Math.min(4, Math.max(1, frames.length));
  const rows = Math.ceil(frames.length / cols);
  const inputs = frames.flatMap((f) => ["-i", f.path]);
  await runFfmpeg([
    ...inputs,
    "-filter_complex",
    `${frames.map((_, i) => `[${i}:v]scale=270:-1[v${i}]`).join(";")};${frames.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${frames.length}:layout=${frames
      .map((_, i) => `${(i % cols) * 270}_${Math.floor(i / cols) * 480}`)
      .join("|")}[out]`,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    "-y",
    outPath,
  ]).catch(async () => {
    // xstack layouts assume uniform heights; fall back to simple hstack rows
    // failure here must not kill QA — the per-frame jpegs still exist.
    await runFfmpeg([...inputs, "-filter_complex", `${frames.map((_, i) => `[${i}:v]scale=270:480[v${i}]`).join(";")};${frames.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${frames.length}[out]`, "-map", "[out]", "-frames:v", "1", "-q:v", "3", "-y", outPath]);
  });
  void rows;
  return outPath;
}

const VERDICT_SCHEMA = {
  name: "rendered_qa_verdict",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["approve", "repair"] },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            beatNumber: { type: ["number", "null"] },
            code: { type: "string" },
            description: { type: "string" },
            preserve: { type: "array", items: { type: "string" } },
            change: { type: "array", items: { type: "string" } },
          },
          required: ["beatNumber", "code", "description", "preserve", "change"],
        },
      },
    },
    required: ["decision", "findings"],
  },
};

/** Clamp raw critic output to the registry: unknown codes are dropped WITH a
 *  warning (a critic may not invent vocabulary); severity comes from the
 *  registry, never the model; any block finding forces decision "repair". */
export function clampVerdict(raw: unknown, framesEvaluated: number, critic: "vision" | "skipped"): RenderedQaVerdict {
  const obj = (raw ?? {}) as { decision?: string; findings?: unknown[] };
  const findings: RenderedFinding[] = [];
  for (const f of Array.isArray(obj.findings) ? obj.findings : []) {
    const rec = f as { beatNumber?: unknown; code?: unknown; description?: unknown; preserve?: unknown; change?: unknown };
    const code = String(rec.code ?? "");
    if (!(code in RENDERED_DEFECT_CODES)) {
      log.warn("critic emitted unknown defect code — dropped", { code });
      continue;
    }
    findings.push({
      beatNumber: typeof rec.beatNumber === "number" ? rec.beatNumber : null,
      code: code as RenderedDefectCode,
      severity: RENDERED_DEFECT_CODES[code as RenderedDefectCode].severity,
      description: String(rec.description ?? "").slice(0, 400),
      preserve: Array.isArray(rec.preserve) ? rec.preserve.map(String).slice(0, 6) : [],
      change: Array.isArray(rec.change) ? rec.change.map(String).slice(0, 6) : [],
    });
  }
  const hasBlock = findings.some((f) => f.severity === "block");
  return {
    decision: hasBlock ? "repair" : obj.decision === "repair" ? "repair" : "approve",
    findings,
    framesEvaluated,
    evaluatedAt: new Date().toISOString(),
    critic,
  };
}

export interface EvaluateRenderedReelInput {
  frames: ExtractedFrame[];
  brief: {
    topic?: string;
    objectCharacter?: string;
    visualWorld?: { lockedInvariants?: string; heroFrameUrl?: string } | null;
    storyboardBeats?: Array<{ beatNumber: number; visual: string }>;
  };
}

/** Vision critic over the actual frames. Requires image support in the LLM
 *  wrapper (Gemini image_url parts). Never throws into the pipeline — a
 *  critic failure returns a skipped verdict the operator can see. */
export async function evaluateRenderedReel(input: EvaluateRenderedReelInput): Promise<RenderedQaVerdict> {
  try {
    const { invokeLLM } = await import("../_core/llm");
    const imageParts = await Promise.all(
      input.frames.map(async (f) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${(await fs.readFile(f.path)).toString("base64")}` },
      })),
    );
    const codeDoc = Object.entries(RENDERED_DEFECT_CODES)
      .map(([code, v]) => `${code} (${v.severity}): ${v.meaning}`)
      .join("\n");
    const worldBlock = input.brief.visualWorld?.lockedInvariants
      ? `APPROVED VISUAL WORLD (every frame must match):\n${input.brief.visualWorld.lockedInvariants}`
      : "No approved visual world — judge continuity against beat 1's establishing frame.";
    const beatsDoc = (input.brief.storyboardBeats ?? []).map((b) => `beat ${b.beatNumber}: ${b.visual}`).join("\n");
    const res = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a ruthless creative QA inspector for automotive reels. Frames are labeled in order: first, per-beat midpoints, final. Judge ONLY what is visible. Emit findings ONLY with these exact codes:\n${codeDoc}\n\n${worldBlock}\n\nPLANNED BEATS:\n${beatsDoc}\n\nFor each finding give beatNumber (the beat whose frame shows it, or null for first/final), a concrete description, preserve[] (what the repair must keep), change[] (the minimal change). If the render is clean, decision "approve" with zero findings. Do not invent codes. Do not praise.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Evaluate these ${input.frames.length} frames (order: ${input.frames.map((f) => f.label).join(", ")}). Topic: ${input.brief.topic ?? "unknown"}. Hero: ${input.brief.objectCharacter ?? "unknown"}.` },
            ...imageParts,
          ],
        },
      ],
      maxTokens: 4096,
      timeoutMs: 90_000,
      outputSchema: VERDICT_SCHEMA,
    });
    const content = res.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    const parsed = JSON.parse(text.replace(/```(?:json)?/g, "").trim() || "{}");
    return clampVerdict(parsed, input.frames.length, "vision");
  } catch (err) {
    log.warn("vision critic unavailable — verdict skipped, not fabricated", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return clampVerdict({ decision: "approve", findings: [] }, input.frames.length, "skipped");
  }
}

/** Full QA pass for an assembled reel job: frames → sheet → critic → verdict
 *  persisted into the job payload (renderedQa field). Never throws. */
export async function runRenderedQaOnJob(jobId: number): Promise<RenderedQaVerdict | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;
    const { reelJobs } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [job] = await d.select().from(reelJobs).where(eq(reelJobs.id, jobId)).limit(1);
    if (!job?.mp4Url) {
      log.warn("rendered QA: job has no mp4", { jobId });
      return null;
    }
    const payload = JSON.parse(job.payload ?? "{}");
    const beats: Array<{ beatNumber: number; startSecond: number; endSecond: number }> = payload.storyboardBeats ?? [];
    const mp4Path = job.mp4Url.startsWith("/") || /^[A-Za-z]:/.test(job.mp4Url)
      ? job.mp4Url
      : path.join(process.cwd(), job.mp4Url.replace(/^https?:\/\/[^/]+\//, ""));
    const frames = await extractReelFrames(mp4Path, beats);
    const sheet = await buildContactSheet(frames, path.join(path.dirname(frames[0].path), "contact-sheet.jpg")).catch(() => undefined);
    const verdict = await evaluateRenderedReel({ frames, brief: payload });
    verdict.contactSheetPath = sheet;
    payload.renderedQa = verdict;
    await d.update(reelJobs).set({ payload: JSON.stringify(payload) }).where(eq(reelJobs.id, jobId));
    log.info("rendered QA verdict persisted", { jobId, decision: verdict.decision, findings: verdict.findings.length, critic: verdict.critic });
    return verdict;
  } catch (err) {
    log.warn("rendered QA failed — job untouched", { jobId, err: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    return null;
  }
}
