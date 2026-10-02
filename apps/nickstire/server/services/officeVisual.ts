/**
 * Office "watch" — what the office camera SAW during a counter conversation.
 *
 * 2026-10-02 · the office lane only listened: Eufy motion/person events woke a bounded audio
 * capture, and nothing ever looked at the picture. The producer (camera-bridge/vision/officewake.py,
 * OFFICE_VISUAL_ENABLED) now grabs a few still frames from the Eufy bridge during each capture
 * window and posts them with the episode. This service turns those frames into ONE short visual
 * description through a vision model, and the route stores ONLY that JSON in
 * conversation_episodes.visual. The frames themselves are never stored — the same rule the
 * audio follows (raw audio stays on NicksMax, pruned; only a reference crosses).
 *
 * Operator decision (2026-10-02): visual + audio recording signs are posted throughout the shop;
 * frames may go to the operator's Ollama Cloud account. Gemini is the fallback lane only when
 * Ollama is unconfigured or fails.
 *
 * Deploy order: inert until drizzle/0140_conversation_episodes_visual.sql is applied. Both the
 * writer (the route) and the reader (lot.conversations) check information_schema first, so the
 * vision model is never spent on a result there is nowhere to keep, and no SELECT names a
 * column production lacks. `visual` is deliberately NOT declared in drizzle/schema.ts yet
 * (projection-less select().from(conversationEpisodes) reads would name it).
 */
import { sql, type SQL } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { readRows } from "../lib/dbResult";
import { describeImagesOpenAiCompatible, type VisionImage } from "./vision-analyzer";

const log = createLogger("services:officeVisual");

export const OFFICE_VISUAL_MAX_FRAMES = 6;

/** What a stored `visual` value looks like. Every field the UI reads is here. */
export interface OfficeVisual {
  status: "DONE" | "FAILED";
  /** One or two plain sentences: what was happening at the counter. */
  summary: string | null;
  /** Best estimate of distinct people visible across the frames; null when the model did not say. */
  peopleCount: number | null;
  /** Short activity labels ("customer at counter", "staff on phone", "keys handed over"). */
  activities: string[];
  /** True when a customer appears to be waiting with no staff member attending. */
  waitingUnattended: boolean | null;
  frameCount: number;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
}

const PROMPT = `You are looking at ${"{N}"} still frames, in time order, from the office camera of a small tire and auto repair shop, taken during one counter interaction.
Describe what HAPPENED, not what the room looks like. Do not guess names, ages or identities.
Reply with ONLY a JSON object, no prose around it:
{"summary": "1-2 sentences: who was at the counter and what they were doing",
 "peopleCount": <integer: distinct people seen across all frames>,
 "activities": ["short labels, e.g. customer at counter, staff on computer, paperwork signed, keys handed over, customer waiting"],
 "waitingUnattended": <true if a customer appears to be waiting with no staff attending, else false>}`;

/** First balanced {...} block in model output — models wrap JSON in fences or prose. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function failed(frameCount: number, error: string, provider: string | null = null, model: string | null = null): OfficeVisual {
  return {
    status: "FAILED", summary: null, peopleCount: null, activities: [], waitingUnattended: null,
    frameCount, provider, model, latencyMs: null, error: error.slice(0, 300),
  };
}

/** Normalize a model's JSON into an OfficeVisual. Exported for tests. */
export function parseVisualReply(text: string, meta: { frameCount: number; provider: string; model: string; latencyMs: number }): OfficeVisual {
  const obj = extractJsonObject(text);
  if (!obj) return failed(meta.frameCount, `unparseable vision reply: ${text.slice(0, 120)}`, meta.provider, meta.model);
  const summary = typeof obj.summary === "string" && obj.summary.trim() ? obj.summary.trim().slice(0, 600) : null;
  if (!summary) return failed(meta.frameCount, "vision reply had no summary", meta.provider, meta.model);
  const pc = Number(obj.peopleCount);
  const activities = Array.isArray(obj.activities)
    ? obj.activities.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim().slice(0, 80)).slice(0, 8)
    : [];
  return {
    status: "DONE",
    summary,
    peopleCount: Number.isFinite(pc) && pc >= 0 ? Math.round(pc) : null,
    activities,
    waitingUnattended: typeof obj.waitingUnattended === "boolean" ? obj.waitingUnattended : null,
    frameCount: meta.frameCount,
    provider: meta.provider,
    model: meta.model,
    latencyMs: meta.latencyMs,
    error: null,
  };
}

/**
 * Describe the frames. Never throws: a provider failure is a FAILED visual (stored, so a reader
 * can tell "the camera saw nothing" from "we could not look"), never an absent one.
 */
export async function analyzeOfficeFrames(
  images: VisionImage[],
  describe: typeof describeImagesOpenAiCompatible = describeImagesOpenAiCompatible,
): Promise<OfficeVisual> {
  const frames = images.slice(0, OFFICE_VISUAL_MAX_FRAMES);
  if (frames.length === 0) return failed(0, "no frames");
  const prompt = PROMPT.replace("{N}", String(frames.length));
  const lanes: Array<"ollama" | "gemini"> = [];
  if (process.env.OLLAMA_API_KEY) lanes.push("ollama");
  if (process.env.GEMINI_API_KEY) lanes.push("gemini");
  if (lanes.length === 0) return failed(frames.length, "no vision provider configured (OLLAMA_API_KEY / GEMINI_API_KEY)");

  const errors: string[] = [];
  for (const provider of lanes) {
    const model = provider === "ollama"
      ? process.env.OFFICE_VISUAL_OLLAMA_MODEL || process.env.PHOTO_ASSESS_OLLAMA_MODEL || undefined
      : process.env.OFFICE_VISUAL_GEMINI_MODEL || undefined;
    const r = await describe({ provider, images: frames, prompt, model, timeoutMs: 40_000, maxTokens: 500 });
    if (r.ok) {
      const v = parseVisualReply(r.text, { frameCount: frames.length, provider, model: r.model, latencyMs: r.latencyMs });
      if (v.status === "DONE") return v;
      errors.push(`${provider}: ${v.error}`);
    } else {
      errors.push(`${provider}: ${r.error}`);
    }
  }
  log.warn("office visual analysis failed on every lane", { errors });
  return failed(frames.length, errors.join(" | "));
}

let readyCache: { ok: boolean; at: number } | null = null;
const READY_TTL_MS = 10 * 60 * 1000;

/**
 * Has 0140 been applied? A positive answer is cached (a column does not un-apply); a negative
 * answer is re-checked after the TTL so applying the migration takes effect without a deploy.
 * A failed check reads as NOT ready — the safe direction for both the writer and the reader.
 */
export async function officeVisualColumnReady(
  d: { execute: (q: SQL) => Promise<unknown> },
  now = Date.now(),
): Promise<boolean> {
  if (readyCache && (readyCache.ok || now - readyCache.at < READY_TTL_MS)) return readyCache.ok;
  try {
    const [row] = readRows(await d.execute(sql`
      SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_episodes' AND COLUMN_NAME = 'visual'
    `));
    readyCache = { ok: Number(row?.n) === 1, at: now };
  } catch (err) {
    log.warn("office visual readiness check failed", { error: err instanceof Error ? err.message : String(err) });
    readyCache = { ok: false, at: now };
  }
  return readyCache.ok;
}

/** Test seam: forget the cached readiness answer. */
export function __resetOfficeVisualReadyCache(): void {
  readyCache = null;
}

/** Read a stored `visual` value back into the UI shape; null for absent/garbled values. */
export function storedVisual(raw: unknown): OfficeVisual | null {
  if (raw == null) return null;
  let v: unknown = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.status !== "DONE" && o.status !== "FAILED") return null;
  return {
    status: o.status,
    summary: typeof o.summary === "string" ? o.summary : null,
    peopleCount: typeof o.peopleCount === "number" ? o.peopleCount : null,
    activities: Array.isArray(o.activities) ? o.activities.filter((a): a is string => typeof a === "string") : [],
    waitingUnattended: typeof o.waitingUnattended === "boolean" ? o.waitingUnattended : null,
    frameCount: typeof o.frameCount === "number" ? o.frameCount : 0,
    provider: typeof o.provider === "string" ? o.provider : null,
    model: typeof o.model === "string" ? o.model : null,
    latencyMs: typeof o.latencyMs === "number" ? o.latencyMs : null,
    error: typeof o.error === "string" ? o.error : null,
  };
}
