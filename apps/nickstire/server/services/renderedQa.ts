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
import { NOIR_PALETTE, BRAND_BIBLE_VERSION } from "../../shared/brandBible";
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
  // Distinct from HUMAN_PRESENT on purpose. A stray human is a faceless-contract
  // breach; the NARRATOR acquiring a body is a BRAND breach — NICK-01 is defined
  // as a gold scanning beam and an icy-blue reticle, light and motion only. The
  // repair differs too: HUMAN_PRESENT means remove the person, this means recast
  // the presence as light. Design-level QA catches this in the prompt; this
  // catches the render deciding to draw a figure anyway.
  NARRATOR_EMBODIED: { severity: "block", meaning: "the narrator presence is drawn as a body/figure/uniform instead of light and motion" },
  GENERATED_TEXT_ARTIFACT: { severity: "block", meaning: "model-generated lettering/garbled text baked into a frame" },
  MALFORMED_GEOMETRY: { severity: "block", meaning: "physically impossible automotive part (warped wheel, fused geometry)" },
  LIGHTING_DRIFT: { severity: "warn", meaning: "lighting direction/temperature shifts noticeably between beats" },
  PALETTE_DRIFT: { severity: "warn", meaning: "color grade departs from the graphite+gold world" },
  WEAK_COMPOSITION: { severity: "warn", meaning: "subject too small / centered awkwardly / dead framing" },
  CAPTION_OBSTRUCTION: { severity: "warn", meaning: "burned-in caption collides with the subject or safe zones" },
} as const;

/** Palette comes from the VERSIONED bible, not a hardcoded phrase. The critic
 *  prompt used to say "the graphite+gold world", which drifts the moment the
 *  bible changes and leaves the pixel judge grading against a different spec
 *  than the generator was given. */
const BRAND_PALETTE_PROMPT = Object.values(NOIR_PALETTE).map((c) => c.prompt).join(", ") + ` (${BRAND_BIBLE_VERSION})`;

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
  /**
   * Whether the critic ACTUALLY evaluated. A provider outage/timeout/parse
   * failure yields "unavailable" — a NON-evaluation whose decision/findings are
   * shaped like a clean pass and must NEVER be read as an approval. Only
   * "completed" may satisfy a publish gate (audit: skipped-as-approved).
   */
  qaState: "completed" | "unavailable";
  /** Findings the critic emitted with an out-of-registry code (dropped from
   *  `findings`). >0 means the evidence is INCOMPLETE — never a clean pass. */
  droppedUnknownCodes?: number;
  /** Set by selectiveRepair when the media is re-rendered — the verdict no
   *  longer describes the current mp4. */
  staleAfterRepair?: boolean;
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
  let droppedUnknownCodes = 0;
  for (const f of Array.isArray(obj.findings) ? obj.findings : []) {
    const rec = f as { beatNumber?: unknown; code?: unknown; description?: unknown; preserve?: unknown; change?: unknown };
    const code = String(rec.code ?? "");
    if (!(code in RENDERED_DEFECT_CODES)) {
      // Dropped from `findings` (severity is registry-owned), but COUNTED — a
      // dropped serious defect must not silently become a clean pass.
      droppedUnknownCodes++;
      log.warn("critic emitted unknown defect code — dropped from findings, counted as incomplete evidence", { code });
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
    // A skipped critic did not evaluate anything — mark it explicitly so no
    // consumer can mistake its approve-shaped payload for a real pass.
    qaState: critic === "skipped" ? "unavailable" : "completed",
    droppedUnknownCodes,
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
          content: `You are a ruthless creative QA inspector for automotive reels. Frames are labeled in order: first, per-beat midpoints, final. Judge ONLY what is visible. Emit findings ONLY with these exact codes:\n${codeDoc}\n\n${worldBlock}\n\nPLANNED BEATS:\n${beatsDoc}\n\nCALIBRATION (from a real miss — the first live verdict approved frames a human immediately rejected):\n- GENERATED_TEXT_ARTIFACT: the ONLY legitimate text is the deterministic caption overlay — UPPERCASE gold letters on a solid black box, plus a gold "SAVE THIS" style pill. ANY other lettering is a defect: fake UI status bars, watermark-like strings, gibberish signage, pseudo-HUD readouts, misspelled screen text on devices (e.g. a tester showing "Vbort"), license-plate-like smears. Inspect frame edges and any screens/devices CLOSELY.\n- IDENTITY DRIFT: if the same logical object (a battery, a car, a tool) changes design, brand, color, or shape between beats, flag it — "similar object" is not "same object".\n- NARRATOR_EMBODIED: the narrator (NICK-01) is a gold scanning beam and an icy-blue reticle — LIGHT AND MOTION ONLY. If any frame draws it as a figure, silhouette, uniform, visor, or any body, that is a defect even when no face is visible. A body-shaped presence is not an acceptable narrator here.\n- PALETTE: the world is ${BRAND_PALETTE_PROMPT}. Judge PALETTE_DRIFT against THAT list, not against a generic "cinematic" look.\nFor each finding give beatNumber (the beat whose frame shows it, or null for first/final), a concrete description, preserve[] (what the repair must keep), change[] (the minimal change). If the render is clean, decision "approve" with zero findings. Do not invent codes. Do not praise. A miss is worse than a false alarm: when unsure whether lettering is the caption overlay, flag it.`,
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
    // Gemini-flash wraps/pads JSON unpredictably (prose before, trailing junk
    // after — both observed live on the 660002 retrigger). Extract the first
    // BALANCED object; a truncated object still fails parse and stays an
    // honest "skipped", never a fabricated verdict.
    const cleaned = text.replace(/```(?:json)?/g, "").trim();
    const start = cleaned.indexOf("{");
    let depth = 0;
    let end = -1;
    for (let i = start; start >= 0 && i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : "{}");
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
    // Resolving the master to a LOCAL path was safe only while data/generated was
    // the store. Since durable object storage landed the bytes may live solely in
    // the bucket, and ffmpeg would spawn against a path that was never written —
    // extraction throws, the verdict comes back unavailable, and (post wave H)
    // that is a permanent publish HOLD. So: use the local file when it really
    // exists, otherwise FETCH the master and work on a temp copy.
    const localGuess = job.mp4Url.startsWith("/") || /^[A-Za-z]:/.test(job.mp4Url)
      ? job.mp4Url
      : path.join(process.cwd(), "data", job.mp4Url.replace(/^https?:\/\/[^/]+\//, ""));

    let mp4Path = localGuess;
    let tempMp4: string | null = null;
    const localExists = await fs.access(localGuess).then(() => true).catch(() => false);
    if (!localExists) {
      const src = job.mp4Url;
      if (!/^https?:\/\//i.test(src)) throw new Error(`master not on disk and mp4Url is not fetchable: ${src}`);
      const res = await fetch(src, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`could not fetch master for QA: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.byteLength) throw new Error("fetched master was empty");
      tempMp4 = path.join(os.tmpdir(), `qa-${jobId}-${Date.now()}.mp4`);
      await fs.writeFile(tempMp4, buf);
      mp4Path = tempMp4;
      log.info("rendered QA: master fetched from object storage for analysis", { jobId, bytes: buf.byteLength });
    }

    let frames;
    try {
      frames = await extractReelFrames(mp4Path, beats);
    } finally {
      // The frames are already written elsewhere by extractReelFrames; the temp
      // master itself is large and must not accumulate in tmp across runs.
      if (tempMp4) void fs.unlink(tempMp4).catch(() => {});
    }
    // The contact sheet is the EVIDENCE behind a decision that gates a publish,
    // so it has to outlive the decision. It used to be written beside the
    // extracted frames — a scratch directory — while contactSheetPath was
    // persisted on the job forever: the moment temp was swept, the audit trail
    // pointed at a file that no longer existed and nobody could review why a
    // reel was approved or held. Writing it beside the mp4 gives it the same
    // lifecycle as the asset it describes (and it is servable, since
    // data/generated is what /generated/* maps to).
    // The contact sheet is the EVIDENCE behind a decision that gates a publish, so
    // it must outlive the decision. Writing it beside mp4Path was right when that
    // was the durable master; now mp4Path may be a TEMP copy fetched for analysis,
    // so it is built locally and then pushed through the same durable store the
    // master uses. contactSheetPath holds the resulting stable URL.
    const sheet = await (async () => {
      try {
        const localSheet = path.join(os.tmpdir(), `reel-${jobId}-contact-sheet.jpg`);
        await buildContactSheet(frames, localSheet);
        const bytes = await fs.readFile(localSheet);
        void fs.unlink(localSheet).catch(() => {});
        const { storagePut } = await import("../storage");
        const put = await storagePut(`qa/reel-${jobId}-contact-sheet.jpg`, bytes, "image/jpeg");
        return put.url;
      } catch (err) {
        log.warn("contact sheet unavailable — verdict still stands on the frames", {
          jobId, err: err instanceof Error ? err.message.slice(0, 140) : String(err),
        });
        return undefined;
      }
    })();
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
