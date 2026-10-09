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
import { parseReelJobPayload, renderedQaRunsSoFar } from "../../shared/reelJobPayload";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../lib/logger";
import type { PixelStats } from "./renderedPixelStats";

/**
 * What a vision critic is told the hero is (2026-10-08): the brief's persona
 * key, or for a pack Reel (plain_part) no persona at all. Every pack Reel used
 * to reach the critic as "Hero: rust_creeping_villain". Not "the part in beat
 * 1": a few packs open on a scene (a dashboard, a highway through the
 * windshield), so the subject is whatever the planned beats show.
 */
export function heroForCritic(key: string | null | undefined): string {
  if (key === "plain_part") return "no persona; the subject is what the planned beats show";
  return key || "unknown";
}

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
  BEAT_SEMANTIC_MISMATCH: { severity: "block", meaning: "frame shows a different mechanical subject/action than the planned beat or on-screen claim" },
  MECHANICAL_MISREPRESENTATION: { severity: "block", meaning: "frame depicts automotive anatomy, damage, diagnosis, or repair in a materially misleading way" },
  MALFORMED_GEOMETRY: { severity: "block", meaning: "physically impossible automotive part (warped wheel, fused geometry)" },
  LIGHTING_DRIFT: { severity: "warn", meaning: "lighting direction/temperature shifts noticeably between beats" },
  PALETTE_DRIFT: { severity: "warn", meaning: "color grade departs from the world THIS reel declared (see the PALETTE line in the prompt)" },
  // -- Craft codes. All warn, and deliberately unable to spend money. -------
  // Every code above asks "is this broken?". None asks "does this look made?".
  // A reel can pass every block gate - right object, no lettering, no hands -
  // and still be the waxy, weightless, could-be-any-shop footage that earns
  // 0.00 saves. These give the critic that vocabulary. They are warns because
  // they are judgements of taste, and CRAFT_CODES below stops taste alone from
  // ordering a paid regeneration.
  PLASTIC_AI_LOOK: { severity: "warn", meaning: "over-smoothed waxy surfaces, absent microtexture, one uniform sheen on what should be rubber/rust/metal - reads as generated" },
  IMPOSSIBLE_PHYSICALITY: { severity: "warn", meaning: "reflections, shadows or contact points that cannot happen: floating objects, shadowless subjects, reflected detail with no source" },
  GENERIC_STOCK_LOOK: { severity: "warn", meaning: "competent and completely anonymous - could be any shop in any city, carries no specific vehicle, damage or place" },
  WEAK_COMPOSITION: { severity: "warn", meaning: "subject too small / centered awkwardly / dead framing" },
  CAPTION_OBSTRUCTION: { severity: "warn", meaning: "burned-in caption collides with the subject or safe zones" },
  // MEASURED, never judged: services/flashRisk.ts counts general flashes over
  // the whole master at 15 fps. A still frame cannot show flashing, so the
  // vision critic is never offered this code (DETERMINISTIC_CODES below).
  PHOTOSENSITIVE_FLASH: { severity: "block", meaning: "more than three general flashes in a one-second window (WCAG 2.2 SC 2.3.1) - a seizure risk" },
} as const;

/** Codes set by a deterministic check, not the critic: never listed in the
 *  critic's prompt, and dropped if a critic emits one anyway. */
const DETERMINISTIC_CODES = new Set<string>(["PHOTOSENSITIVE_FLASH"]);

/** Palette comes from the VERSIONED bible, not a hardcoded phrase. The critic
 *  prompt used to say "the graphite+gold world", which drifts the moment the
 *  bible changes and leaves the pixel judge grading against a different spec
 *  than the generator was given. */
/**
 * Craft findings describe how a render FEELS. They are recorded, persisted and
 * countable, and they never order a paid repair by themselves.
 *
 * clampVerdict already refuses to let the model set SEVERITY - that comes from
 * the registry. It does NOT own the top-level decision field, which is what
 * actually spends: a "repair" routes through repairRouter to a paid beat
 * regeneration under autonomousRepair.paidBeatRegeneration. Handing a
 * subjective "this looks AI-made" judgement that lever would let taste burn the
 * daily generation budget, and a critic having a strict day would quietly dark
 * the lane - the failure mode that made rotation deadlocks so expensive before.
 *
 * So craft evidence is gathered first and gated later, once there is data on
 * how often it fires and whether it agrees with a human. Blocks are unaffected.
 */
const CRAFT_CODES = new Set<RenderedDefectCode>(["PLASTIC_AI_LOOK", "IMPOSSIBLE_PHYSICALITY", "GENERIC_STOCK_LOOK"]);

/** The brand palette, still used as the FALLBACK when a reel declares no
 *  motion lens or declares one with no entry in LENS_PALETTES. */
const BRAND_PALETTE_PROMPT = Object.values(NOIR_PALETTE).map((c) => c.prompt).join(", ") + ` (${BRAND_BIBLE_VERSION})`;

export type RenderedDefectCode = keyof typeof RENDERED_DEFECT_CODES;

export interface RenderedFinding {
  beatNumber: number | null;
  code: RenderedDefectCode;
  severity: "block" | "warn";
  description: string;
  preserve: string[];
  change: string[];
  /** Critic's own confidence 0–1 (PROMPT-PACK §13). Undefined when the model
   *  omitted it — an older verdict, or a model that ignored the schema. Drives
   *  escalation (a low-confidence warn on the hero beat earns a second lens)
   *  and scales a warn's craft deduction. Never drives severity. */
  confidence?: number;
}

// ─── Craft score (README §H2) ──────────────────────────────────────
//
// Thirteen dimensions, weights summing to 100. The score is a PURE FOLD over
// the findings the critic already emits plus the deterministic pixel flags —
// no second model call, no averaging across lenses. A block empties the
// dimension(s) its code speaks to; a warn takes half, scaled by the critic's
// confidence; a pixel flag takes the fraction named in PIXEL_FLAG_DEDUCTIONS.
// Dimensions no instrument can see from still frames (audio) are listed in
// `unobserved` rather than silently scored full — a 100 with `unobserved:
// ["audio"]` is an honest 93-of-93, not a false green.

const CRAFT_WEIGHTS = {
  openingComposition: 12,
  mechanicalAccuracy: 12,
  subjectRealism: 10,
  plausibility: 8,
  continuity: 8,
  cinematography: 8,
  pacing: 8,
  motion: 7,
  typography: 7,
  audio: 7,
  brand: 5,
  nonGeneric: 4,
  noArtifacts: 4,
} as const;

export type CraftDimension = keyof typeof CRAFT_WEIGHTS;

export interface CraftScore {
  /** 0–100, sum of the dimension scores. */
  total: number;
  dimensions: Record<CraftDimension, number>;
  weights: Record<CraftDimension, number>;
  /** Dimensions nothing in this pass could observe. Scored at full weight
   *  but named, so a reader never mistakes "unseen" for "excellent". */
  unobserved: CraftDimension[];
}

/** Which craft dimensions each defect code is evidence AGAINST. */
const CODE_DIMENSIONS: Record<RenderedDefectCode, CraftDimension[]> = {
  SUBJECT_CONTINUITY: ["continuity"],
  DAMAGE_LOCATION_DRIFT: ["continuity", "mechanicalAccuracy"],
  ENVIRONMENT_DRIFT: ["continuity"],
  HUMAN_PRESENT: ["brand"],
  NARRATOR_EMBODIED: ["brand"],
  GENERATED_TEXT_ARTIFACT: ["noArtifacts", "typography"],
  BEAT_SEMANTIC_MISMATCH: ["mechanicalAccuracy"],
  MECHANICAL_MISREPRESENTATION: ["mechanicalAccuracy"],
  MALFORMED_GEOMETRY: ["plausibility", "noArtifacts"],
  LIGHTING_DRIFT: ["continuity", "cinematography"],
  PALETTE_DRIFT: ["brand", "continuity"],
  PLASTIC_AI_LOOK: ["subjectRealism"],
  IMPOSSIBLE_PHYSICALITY: ["plausibility"],
  GENERIC_STOCK_LOOK: ["nonGeneric"],
  WEAK_COMPOSITION: ["cinematography"],
  CAPTION_OBSTRUCTION: ["typography"],
  PHOTOSENSITIVE_FLASH: ["motion"],
};

/** Fraction of a dimension's weight each pixel flag removes. Hypotheses, like
 *  the thresholds that produce the flags (renderedPixelStats header). */
const PIXEL_FLAG_DEDUCTIONS: Record<string, Array<[CraftDimension, number]>> = {
  BLACK_FRAME: [["continuity", 0.5]],
  SOFT_FRAME: [["cinematography", 0.25], ["subjectRealism", 0.25]],
  DUP_FRAME: [["motion", 0.5], ["pacing", 0.25]],
  CAPTION_BOX_BUSY: [["typography", 0.5]],
};

/** The hero beat is beat 1; `null` is the first/final frame, which the prompt
 *  tells the critic to use for anything it cannot pin to a beat. */
const isHeroBeat = (beatNumber: number | null) => beatNumber === 1 || beatNumber === null;

export function craftScore(findings: RenderedFinding[], pixelStats?: PixelStats | null): CraftScore {
  const dimensions = { ...CRAFT_WEIGHTS } as Record<CraftDimension, number>;
  const deduct = (dim: CraftDimension, fraction: number) => {
    dimensions[dim] = Math.max(0, dimensions[dim] - CRAFT_WEIGHTS[dim] * fraction);
  };
  for (const f of findings) {
    const conf = typeof f.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : 1;
    const fraction = f.severity === "block" ? 1 : 0.5 * conf;
    const dims = [...CODE_DIMENSIONS[f.code]];
    // A weak frame where the thumb stops is the opening, not just cinematography.
    if (f.code === "WEAK_COMPOSITION" && isHeroBeat(f.beatNumber)) dims.push("openingComposition");
    for (const dim of dims) deduct(dim, fraction);
  }
  if (pixelStats && !pixelStats.skipped) {
    for (const flag of pixelStats.flags) {
      const [code, label] = flag.split(":");
      // A black OPENING frame is a failed hook, not a continuity nit.
      if (code === "BLACK_FRAME" && label === "first") { deduct("openingComposition", 1); continue; }
      for (const [dim, fraction] of PIXEL_FLAG_DEDUCTIONS[code] ?? []) deduct(dim, fraction);
    }
  }
  const rounded = Object.fromEntries(
    (Object.keys(CRAFT_WEIGHTS) as CraftDimension[]).map((k) => [k, Number(dimensions[k].toFixed(1))]),
  ) as Record<CraftDimension, number>;
  const total = Number(Object.values(rounded).reduce((a, b) => a + b, 0).toFixed(1));
  return { total, dimensions: rounded, weights: { ...CRAFT_WEIGHTS }, unobserved: ["audio"] };
}

// ─── Adaptive specialist escalation (README §L.2) ─────────────────
//
// At most ONE specialist lens per reel, chosen deterministically from the
// general critic's findings: a craft warn, or any warn on the hero beat the
// critic was not sure about (confidence < 0.7). Blocks do not escalate — a
// block already orders the repair, and a second opinion cannot un-spend it.
// Geometry → automotive, opening → editorial, text → typography, plastic or
// generic → brand, framing/faceless → composition. Running the lens is a
// separate, flag-gated step in criticPanel.escalateIfNeeded.

export type EscalationLens = "none" | "automotive" | "editorial" | "typography" | "brand" | "composition";

const ESCALATION_PRIORITY: Exclude<EscalationLens, "none">[] = ["automotive", "editorial", "typography", "brand", "composition"];

function lensForFinding(f: RenderedFinding): Exclude<EscalationLens, "none"> | null {
  switch (f.code) {
    case "MALFORMED_GEOMETRY":
    case "DAMAGE_LOCATION_DRIFT":
    case "IMPOSSIBLE_PHYSICALITY":
      return "automotive";
    case "WEAK_COMPOSITION":
      return isHeroBeat(f.beatNumber) ? "editorial" : "composition";
    case "GENERATED_TEXT_ARTIFACT":
    case "CAPTION_OBSTRUCTION":
      return "typography";
    case "PLASTIC_AI_LOOK":
    case "GENERIC_STOCK_LOOK":
    case "PALETTE_DRIFT":
      return "brand";
    case "HUMAN_PRESENT":
    case "NARRATOR_EMBODIED":
      return "composition";
    default:
      return null;
  }
}

function chooseEscalation(findings: RenderedFinding[]): EscalationLens {
  const candidates = new Set<Exclude<EscalationLens, "none">>();
  for (const f of findings) {
    if (f.severity !== "warn") continue;
    const uncertainHero = isHeroBeat(f.beatNumber) && typeof f.confidence === "number" && f.confidence < 0.7;
    if (!CRAFT_CODES.has(f.code) && !uncertainHero) continue;
    const lens = lensForFinding(f);
    if (lens) candidates.add(lens);
  }
  return ESCALATION_PRIORITY.find((l) => candidates.has(l)) ?? "none";
}

export interface RenderedQaVerdict {
  decision: "approve" | "repair";
  /** True when the critic asked for a repair on craft grounds alone and it was
   *  declined. Makes the downgrade countable instead of invisible. */
  craftOnlyRepairDeclined?: boolean;
  findings: RenderedFinding[];
  framesEvaluated: number;
  contactSheetPath?: string;
  /** Whole-master flash measurement (services/flashRisk.ts); `unmeasured` when the scan could not run. */
  flash?: import("./flashRisk").FlashRisk | { unmeasured: string };
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
  /** README §H2 craft score. Absent on a skipped verdict — an unevaluated
   *  reel has no craft, and a default would read as one. */
  craftScore?: CraftScore;
  /** The one specialist lens this verdict asks for (README §L.2), or "none". */
  escalate?: EscalationLens;
  /** Deterministic pre-flags the critic was shown (renderedPixelStats). */
  pixelStats?: PixelStats;
  /** Vision calls spent on this verdict: 1 for the general critic, +1 when a
   *  specialist lens ran. Logged per reel; the budget test pins it. */
  visionCalls?: number;
  /** Present when escalateIfNeeded ran a lens and merged it in. */
  specialist?: {
    lens: Exclude<EscalationLens, "none">;
    /** "skipped" means the lens call failed — the general verdict stands alone. */
    critic: "vision" | "skipped";
    findingsAdded: number;
  };
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
  // CLAMP TO THE RENDERED DURATION. Beat times come from the BRIEF, which may
  // declare up to REEL_OUTPUT_RULES.maxSeconds (35); the RENDER is
  // beats × maxClipSeconds (4) + the SAVE freeze (3) — 22–27 s. Live 2026-09-08,
  // job 1890001: beat 5's declared midpoint (~25 s) lay past a 22 s master, so
  // ffmpeg wrote nothing, the critic opened a file that did not exist (ENOENT
  // beat5.jpg), the verdict was recorded "skipped", and the publish door held a
  // reel with zero findings. A frame request past the end is not a critic
  // outage; it is a planning error, and it is caught here as one.
  const durationSec = await probeDurationSec(mp4Path);
  const clampTs = (t: number) => (durationSec > 0 ? Math.min(Math.max(0.1, t), Math.max(0.1, durationSec - 0.15)) : t);
  const plan: Array<{ label: string; beatNumber: number | null; timestamp: number }> = [
    { label: "first", beatNumber: beats[0]?.beatNumber ?? null, timestamp: 0.1 },
    ...beats.map((b) => ({
      label: `beat${b.beatNumber}`,
      beatNumber: b.beatNumber,
      timestamp: Number(((b.startSecond + b.endSecond) / 2).toFixed(2)),
    })),
    { label: "final", beatNumber: last?.beatNumber ?? null, timestamp: Math.max(0.2, (last?.endSecond ?? 1) - 0.2) },
  ];
  for (const raw of plan) {
    const p = { ...raw, timestamp: clampTs(raw.timestamp) };
    const file = path.join(dir, `${p.label}.jpg`);
    // `-strict unofficial`: JPEG is a full-range format, and newer ffmpeg's
    // mjpeg encoder REFUSES a limited-range (tv, plain yuv420p) source unless
    // told to — "Non full-range YUV is non-standard, set strict_std_compliance
    // to at most unofficial". The assembled masters are ordinary limited-range
    // H.264, so on 2026-09-08 every frame extraction in the container died with
    // exit 234, rendered QA reported "unavailable", and the publish door held
    // the reel — a tool-version quirk masquerading as missing quality evidence.
    // Older ffmpeg (the Windows dev build) accepts it silently, which is why a
    // local run cannot reproduce the failure. This is the remedy ffmpeg itself
    // names; it relaxes only that range check.
    await runFfmpeg(["-ss", String(p.timestamp), "-i", mp4Path, "-frames:v", "1", "-q:v", "3", "-strict", "unofficial", "-y", file]);
    // ffmpeg exits 0 with NO output when -ss is past the end. Refuse by name
    // rather than let the critic discover it as ENOENT and report "skipped".
    const st = await fs.stat(file).catch(() => null);
    if (!st || st.size === 0) {
      throw new Error(`FRAME_MISSING: ${p.label} at ${p.timestamp}s produced no frame (master ${durationSec.toFixed(2)}s)`);
    }
    frames.push({ ...p, path: file });
  }
  return frames;
}

/** Container duration via ffprobe; 0 when unreadable (clamping then no-ops). */
async function probeDurationSec(file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", () => resolve(0));
    child.on("close", () => { const n = Number(out.trim()); resolve(Number.isFinite(n) && n > 0 ? n : 0); });
  });
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
    await runFfmpeg([...inputs, "-filter_complex", `${frames.map((_, i) => `[${i}:v]scale=270:480[v${i}]`).join(";")};${frames.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${frames.length}[out]`, "-map", "[out]", "-frames:v", "1", "-q:v", "3", "-strict", "unofficial", "-y", outPath]);
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
            confidence: { type: ["number", "null"] },
          },
          required: ["beatNumber", "code", "description", "preserve", "change", "confidence"],
        },
      },
    },
    required: ["decision", "findings"],
  },
};

/** Clamp raw critic output to the registry: unknown codes are dropped WITH a
 *  warning (a critic may not invent vocabulary); severity comes from the
 *  registry, never the model; any block finding forces decision "repair". */
export function clampVerdict(
  raw: unknown,
  framesEvaluated: number,
  critic: "vision" | "skipped",
  pixelStats?: PixelStats | null,
): RenderedQaVerdict {
  const obj = (raw ?? {}) as { decision?: string; findings?: unknown[] };
  const findings: RenderedFinding[] = [];
  let droppedUnknownCodes = 0;
  for (const f of Array.isArray(obj.findings) ? obj.findings : []) {
    const rec = f as { beatNumber?: unknown; code?: unknown; description?: unknown; preserve?: unknown; change?: unknown; confidence?: unknown };
    const code = String(rec.code ?? "");
    if (!(code in RENDERED_DEFECT_CODES) || DETERMINISTIC_CODES.has(code)) {
      // Dropped from `findings` (severity is registry-owned), but COUNTED — a
      // dropped serious defect must not silently become a clean pass.
      droppedUnknownCodes++;
      log.warn("critic emitted unknown defect code — dropped from findings, counted as incomplete evidence", { code });
      continue;
    }
    const confidence = typeof rec.confidence === "number" && Number.isFinite(rec.confidence)
      ? Math.min(1, Math.max(0, rec.confidence))
      : undefined;
    findings.push({
      beatNumber: typeof rec.beatNumber === "number" ? rec.beatNumber : null,
      code: code as RenderedDefectCode,
      severity: RENDERED_DEFECT_CODES[code as RenderedDefectCode].severity,
      description: String(rec.description ?? "").slice(0, 400),
      preserve: Array.isArray(rec.preserve) ? rec.preserve.map(String).slice(0, 6) : [],
      change: Array.isArray(rec.change) ? rec.change.map(String).slice(0, 6) : [],
      ...(confidence === undefined ? {} : { confidence }),
    });
  }
  const hasBlock = findings.some((f) => f.severity === "block");
  // A repair the model asked for on craft grounds ALONE is recorded and then
  // declined - see CRAFT_CODES. A zero-finding repair is left alone, because
  // that is a critic saying something is wrong it had no code for, which is
  // real signal rather than taste.
  const craftOnlyRepairDeclined =
    !hasBlock &&
    obj.decision === "repair" &&
    findings.length > 0 &&
    findings.every((f) => CRAFT_CODES.has(f.code));
  if (craftOnlyRepairDeclined) {
    log.info("craft-only repair declined - findings kept as evidence, no paid regeneration ordered", {
      codes: findings.map((f) => f.code),
    });
  }
  return {
    decision: hasBlock ? "repair" : obj.decision === "repair" && !craftOnlyRepairDeclined ? "repair" : "approve",
    craftOnlyRepairDeclined,
    findings,
    framesEvaluated,
    evaluatedAt: new Date().toISOString(),
    critic,
    // A skipped critic did not evaluate anything — mark it explicitly so no
    // consumer can mistake its approve-shaped payload for a real pass.
    qaState: critic === "skipped" ? "unavailable" : "completed",
    droppedUnknownCodes,
    // No craft score on a non-evaluation: an unseen reel has no craft, and a
    // 100 here would be the exact false green qaState exists to prevent.
    ...(critic === "vision" ? { craftScore: craftScore(findings, pixelStats) } : {}),
    escalate: critic === "vision" ? chooseEscalation(findings) : "none",
    ...(pixelStats ? { pixelStats } : {}),
    visionCalls: critic === "vision" ? 1 : 0,
  };
}

export interface EvaluateRenderedReelInput {
  frames: ExtractedFrame[];
  brief: {
    topic?: string;
    objectCharacter?: string;
    visualWorld?: { lockedInvariants?: string; heroFrameUrl?: string } | null;
    /** Drives which palette PALETTE_DRIFT is judged against. Present on the
     *  persisted job payload (reelPipeline stores the whole brief), and
     *  optional here so an older payload degrades to the brand palette. */
    motionLens?: string;
    storyboardBeats?: Array<{ beatNumber: number; visual: string }>;
  };
  /** Deterministic pre-flags from renderedPixelStats; shown to the critic as
   *  PIXEL_STATS and folded into the craft score. Optional so the operator
   *  endpoint and older callers keep working without them. */
  pixelStats?: PixelStats | null;
}

/**
 * THE vision wrapper — one Gemini call over the extracted frames with a given
 * system prompt, returning the first balanced JSON object the model produced
 * (or throwing). Shared by the general critic below and by every specialist
 * lens in criticPanel, so a lens cannot drift onto a different model, timeout
 * or parser than the critic it is second-guessing.
 *
 * Gemini-flash wraps/pads JSON unpredictably (prose before, trailing junk
 * after — both observed live on the 660002 retrigger). Extract the first
 * BALANCED object; a truncated object still fails parse and stays an honest
 * throw for the caller to turn into "skipped", never a fabricated verdict.
 */
export async function callVisionCritic(input: { frames: ExtractedFrame[]; system: string; user: string }): Promise<unknown> {
  const { invokeLLM } = await import("../_core/llm");
  const imageParts = await Promise.all(
    input.frames.map(async (f) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${(await fs.readFile(f.path)).toString("base64")}` },
    })),
  );
  const res = await invokeLLM({
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: [{ type: "text", text: input.user }, ...imageParts] },
    ],
    // The vision lane (Gemini 2.5 Flash via the reroute) spends its thinking
    // out of this budget. At 4096 with unbounded thinking the verdict was cut
    // off mid-finding — finish_reason=length, 573 chars, job 2040001,
    // 2026-10-08 15:31Z — which the gate rightly holds as a non-evaluation.
    // The cap is "medium" (8,192 thinking tokens on 2.5), above the ~3.9k it
    // spent before the cut (inferred: 4,096 less ~150 visible tokens), and
    // not "low": a thinking cap set too low fails
    // OPEN (an approve from a critic that barely looked); a budget set too
    // small fails CLOSED (a truncated verdict, held). 16,384 leaves ~8k for
    // the JSON, and 8k thinking fits well inside the 90 s timeout.
    maxTokens: 16_384,
    reasoningEffort: "medium",
    timeoutMs: 90_000,
    outputSchema: VERDICT_SCHEMA,
  });
  const content = res.choices?.[0]?.message?.content;
  // The wrapper types content as string | parts[]; a parts reply used to read
  // as "" here and surface as "no complete JSON object" with nothing to go on.
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? String((p as { text?: unknown }).text ?? "") : "")).join("\n")
      : "";
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  let depth = 0;
  let end = -1;
  for (let i = start; start >= 0 && i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  // No complete object: a reply cut at the token cap, an empty or blocked one,
  // or prose. This used to parse "{}", which clamps to an approve with a full
  // craft score; the throw keeps the promise above, and the caller records a
  // skipped verdict that the publish gate refuses (2026-10-01, review of #2865).
  if (start < 0 || end <= start) {
    // Name the shape of the failure: the finish reason and the head of the
    // reply. 2026-10-08 (job 2040001) logged only the sentence, so whether the
    // model was cut at the cap, blocked, or answered in prose was unknowable.
    const finish = res.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`vision critic returned no complete JSON object (finish_reason=${finish}, ${text.length} chars: ${JSON.stringify(text.slice(0, 120))})`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** The planned-beats block, shared with the specialist lenses. */
export function beatsDocFor(brief: EvaluateRenderedReelInput["brief"]): string {
  return (brief.storyboardBeats ?? []).map((b) => `beat ${b.beatNumber}: ${b.visual}`).join("\n");
}

/** Vision critic over the actual frames. Requires image support in the LLM
 *  wrapper (Gemini image_url parts). Never throws into the pipeline — a
 *  critic failure returns a skipped verdict the operator can see. */
export async function evaluateRenderedReel(input: EvaluateRenderedReelInput): Promise<RenderedQaVerdict> {
  try {
    const codeDoc = Object.entries(RENDERED_DEFECT_CODES)
      .filter(([code]) => !DETERMINISTIC_CODES.has(code))
      .map(([code, v]) => `${code} (${v.severity}): ${v.meaning}`)
      .join("\n");
    // Pre-flags are shown even when they could not be computed — "unavailable"
    // is itself information, and a silent omission would let the critic assume
    // every frame passed the $0 checks.
    const pixelBlock = await (async () => {
      try {
        const { formatPixelStatsForPrompt } = await import("./renderedPixelStats");
        return formatPixelStatsForPrompt(input.pixelStats);
      } catch {
        return "PIXEL_STATS: unavailable (formatter failed to load).";
      }
    })();
    const worldBlock = input.brief.visualWorld?.lockedInvariants
      ? `APPROVED VISUAL WORLD (every frame must match):\n${input.brief.visualWorld.lockedInvariants}`
      : "No approved visual world — judge continuity against beat 1's establishing frame.";
    // The generator stopped painting every reel graphite+gold: LENS_PALETTES
    // gives each motion lens the world its own grammar asks for (xray_cutaway a
    // cool schematic field, tilt_shift_miniature bright daylight). Judging all
    // fourteen against one fixed brand palette would report PALETTE_DRIFT on
    // every correctly-rendered non-noir world - the critic has to grade against
    // the spec the generator was actually handed.
    const reelPaletteSpec = await (async () => {
      if (!input.brief.motionLens) return BRAND_PALETTE_PROMPT;
      try {
        const { LENS_PALETTES, BRAND_ACCENT_RULE } = await import("../../client/src/lib/facelessReelStudio");
        const lens = (LENS_PALETTES as Record<string, string | undefined>)[input.brief.motionLens];
        return lens ? `${lens} Brand accent rule: ${BRAND_ACCENT_RULE}` : BRAND_PALETTE_PROMPT;
      } catch {
        // Degrade to the brand palette rather than skip QA over a palette lookup.
        return BRAND_PALETTE_PROMPT;
      }
    })();
    const beatsDoc = beatsDocFor(input.brief);
    const parsed = await callVisionCritic({
      frames: input.frames,
      system: `You are a ruthless creative QA inspector for automotive reels. Frames are labeled in order: first, per-beat midpoints, final. Judge ONLY what is visible. Emit findings ONLY with these exact codes:\n${codeDoc}\n\n${worldBlock}\n\nPLANNED BEATS:\n${beatsDoc}\n\n${pixelBlock}\n\nCALIBRATION (from a real miss — the first live verdict approved frames a human immediately rejected):\n- GENERATED_TEXT_ARTIFACT: the ONLY legitimate text is the deterministic caption overlay — UPPERCASE gold letters on a solid black box, plus a gold "SAVE THIS" style pill. ANY other lettering is a defect: fake UI status bars, watermark-like strings, gibberish signage, pseudo-HUD readouts, misspelled screen text on devices (e.g. a tester showing "Vbort"), license-plate-like smears. Inspect frame edges and any screens/devices CLOSELY.\n- BEAT_SEMANTIC_MISMATCH: compare EACH labeled frame against its planned beat and burned-in claim. If the beat says belts/hoses and the frame shows a spare tire, or the beat says pressure gauge and the frame shows an unrelated wheel, BLOCK it. A beautiful frame of the wrong thing is still wrong.\n- MECHANICAL_MISREPRESENTATION: block only concrete automotive falsehoods visible in the frame — anatomy, damage, diagnosis, or repair that would teach a viewer the wrong thing even if the geometry looks plausible. Examples: a tire repair cross-section that depicts the plug/patch path incorrectly, a "brake line" that is visibly a frame rail, or an impossible belt routing presented as instructional. Do not use this for mere stylistic ambiguity.\n- IDENTITY DRIFT: if the same logical object (a battery, a car, a tool) changes design, brand, color, or shape between beats, flag it — "similar object" is not "same object".\n- NARRATOR_EMBODIED: the narrator (NICK-01) is a gold scanning beam and an icy-blue reticle — LIGHT AND MOTION ONLY. If any frame draws it as a figure, silhouette, uniform, visor, or any body, that is a defect even when no face is visible. A body-shaped presence is not an acceptable narrator here.\n- PALETTE: the world for THIS reel is ${reelPaletteSpec}. Judge PALETTE_DRIFT against THAT, not against a generic "cinematic" look and not against any other reel. Each reel declares its own world, so a bright daylight world is not drift.\n- CRAFT (record these when you see them; they are evidence, and not grounds for "repair" on their own): PLASTIC_AI_LOOK - rubber, rust and brake dust must read as those materials rather than as smooth tinted plastic, so look for absent pore, grain and scratch detail, and for one uniform sheen across surfaces that should differ. IMPOSSIBLE_PHYSICALITY - every object needs a contact shadow, every reflection needs a visible source, and tread blocks, lug nuts and bolt patterns must stay countable and consistent between beats. GENERIC_STOCK_LOOK - ask whether this frame could be any shop in any city, and if nothing in it is specific to this vehicle, this damage or this place, say so.\nFor each finding give beatNumber (the beat whose frame shows it, or null for first/final), a concrete description, preserve[] (what the repair must keep), change[] (the minimal change). If the render is clean, decision "approve" with zero findings. Do not invent codes. Do not praise. A miss is worse than a false alarm: when unsure whether lettering is the caption overlay, flag it. For EVERY finding also give confidence (0-1): how sure you are the defect is real from the pixels you were shown. The deterministic PIXEL_STATS pre-flags above are not findings; confirm them with your own eyes or say nothing.`,
      user: `Evaluate these ${input.frames.length} frames (order: ${input.frames.map((f) => f.label).join(", ")}). Topic: ${input.brief.topic ?? "unknown"}. Hero: ${heroForCritic(input.brief.objectCharacter)}.`,
    });
    // The schema requires approve or repair. A reply without one (a bare "{}")
    // is not a verdict; clampVerdict would read it as an approve.
    const decision = (parsed as { decision?: unknown } | null)?.decision;
    if (decision !== "approve" && decision !== "repair") throw new Error("vision critic reply has no approve/repair decision");
    return clampVerdict(parsed, input.frames.length, "vision", input.pixelStats);
  } catch (err) {
    log.warn("vision critic unavailable — verdict skipped, not fabricated", {
      err: err instanceof Error ? err.message.slice(0, 400) : String(err),
    });
    return clampVerdict({ decision: "approve", findings: [] }, input.frames.length, "skipped", input.pixelStats);
  }
}

export interface RunRenderedQaOptions {
  /** Run the $0 deterministic pixel checks and show them to the critic.
   *  Default ON — they never throw and cost nothing. */
  pixelStats?: boolean;
  /** Run at most one specialist lens when the general critic asks for one
   *  (README §L.2). Default = `RENDERED_QA_SPECIALIST === "true"`, i.e. OFF;
   *  the pipeline passes it explicitly so the gate is visible at the call site. */
  specialist?: boolean;
}

/** Full QA pass for an assembled reel job: frames → pixel stats → sheet →
 *  critic (→ ≤1 specialist lens) → verdict persisted into the job payload
 *  (renderedQa field). Never throws. */
export async function runRenderedQaOnJob(jobId: number, opts: RunRenderedQaOptions = {}): Promise<RenderedQaVerdict | null> {
  const wantPixelStats = opts.pixelStats ?? true;
  const wantSpecialist = opts.specialist ?? process.env.RENDERED_QA_SPECIALIST === "true";
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
    // The canonical typed view of reel_jobs.payload — the same object is
    // written back below with `renderedQa` set, so the field is declared on
    // the view rather than cast in here.
    const payload = parseReelJobPayload(job.payload);
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
    // Flashing lives BETWEEN the sampled frames, so it is measured on the
    // master itself while it is still on disk. A scan that cannot run is not a
    // pass: it is recorded as unmeasured on the verdict.
    let flash: RenderedQaVerdict["flash"];
    try {
      frames = await extractReelFrames(mp4Path, beats);
      flash = await import("./flashRisk")
        .then((m) => m.scanFlashRisk(mp4Path))
        .catch((err: unknown) => ({ unmeasured: err instanceof Error ? err.message.slice(0, 160) : String(err) }));
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
    // $0 pre-flags over the frames already on disk. A failure here is a
    // weaker prompt, never a lost verdict — the module resolves to skipped on
    // its own errors, and a load failure (native sharp) is caught here.
    const pixelStats: PixelStats | null = wantPixelStats
      ? await import("./renderedPixelStats")
          .then((m) => m.computeRenderedPixelStats(frames))
          .catch((err: unknown): PixelStats => ({ skipped: true, reason: `pixel stats failed to load: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` }))
      : null;
    let verdict = await evaluateRenderedReel({ frames, brief: payload, pixelStats });
    if (wantSpecialist) {
      try {
        const { escalateIfNeeded } = await import("./criticPanel");
        verdict = await escalateIfNeeded(verdict, frames, { brief: payload }, { enabled: true });
      } catch (err) {
        log.warn("specialist escalation failed — general verdict stands", { jobId, err: err instanceof Error ? err.message.slice(0, 160) : String(err) });
      }
    }
    verdict.contactSheetPath = sheet;
    verdict.flash = flash;
    if (flash && "fail" in flash && flash.fail) {
      verdict.findings.push({
        beatNumber: null,
        code: "PHOTOSENSITIVE_FLASH",
        severity: "block",
        description: `${flash.maxFlashesPerSecond} general flashes inside one second starting at ${flash.worstWindowStartSec?.toFixed(1)}s (limit 3)`,
        preserve: ["every beat's content"],
        change: ["replace strobe or flash transitions near that time with a cut or a slower fade"],
      });
      verdict.decision = "repair";
    }
    // Every persisted verdict, skipped ones included, counts against the
    // gate's re-run budget — by the one rule the gate reads with, taken
    // BEFORE this verdict replaces the previous one.
    const runsBefore = renderedQaRunsSoFar(payload);
    payload.renderedQa = verdict;
    payload.renderedQaAttempts = runsBefore + 1;
    await d.update(reelJobs).set({ payload: JSON.stringify(payload) }).where(eq(reelJobs.id, jobId));
    log.info("rendered QA verdict persisted", {
      jobId,
      attempt: payload.renderedQaAttempts,
      decision: verdict.decision,
      findings: verdict.findings.length,
      critic: verdict.critic,
      visionCalls: verdict.visionCalls ?? 0,
      escalate: verdict.escalate ?? "none",
      specialistLens: verdict.specialist?.lens ?? null,
      craftTotal: verdict.craftScore?.total ?? null,
      pixelFlags: pixelStats && !pixelStats.skipped ? pixelStats.flags : null,
    });
    return verdict;
  } catch (err) {
    log.warn("rendered QA failed — job untouched", { jobId, err: err instanceof Error ? err.message.slice(0, 160) : String(err) });
    return null;
  }
}
