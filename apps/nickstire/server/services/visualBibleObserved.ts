/**
 * Image-derived Visual Bible (directive Part IX §34) — continuity facts
 * extracted from ACTUAL RENDERED PIXELS, not from the prompt that requested
 * them. The baseline's worst visual failure was identity drift (two gremlin
 * bodies, three lighting worlds); prompt-derived "bibles" could never catch
 * that because they describe intent, not outcome. This observes outcome.
 *
 * Contract honesty: fields the model cannot ground in the frames stay empty;
 * requestedVsObservedContradictions carries the deltas; extraction failure
 * returns null — never a fabricated bible.
 */
import { readFileSync } from "fs";
import { createLogger } from "../lib/logger";
import { invokeLLM } from "../_core/llm";

const log = createLogger("services:visual-bible-observed");

export interface ObservedVisualBible {
  sourceJobId: number;
  subject: string;
  vehicleIdentity: string | null;
  componentIdentity: string | null;
  environment: string[];
  camera: { angle: string; shotSize: string; depthOfField: string };
  lighting: { direction: string; colorTemperature: string; contrast: string };
  palette: string[];
  textSafeZones: string[];
  forbiddenChanges: string[];
  visibleDefects: string[];
  identityDriftAcrossFrames: string[];
  requestedVsObservedContradictions: string[];
  confidence: number;
  extractedAt: string;
  critic: "vision" | "skipped";
}

const PROMPT = `You are a continuity supervisor analyzing frames from ONE rendered vertical reel. Extract ONLY what is visibly true across the frames — never invent. Return STRICT JSON:
{"subject":"","vehicleIdentity":null,"componentIdentity":null,"environment":[],"camera":{"angle":"","shotSize":"","depthOfField":""},"lighting":{"direction":"","colorTemperature":"","contrast":""},"palette":[],"textSafeZones":["areas free of subject where captions can sit"],"forbiddenChanges":["facts later beats MUST keep for continuity"],"visibleDefects":["e.g. generated text artifacts, malformed parts"],"identityDriftAcrossFrames":["where the same logical subject changes identity between frames"],"confidence":0.0}
Empty string/null/[] when not grounded in the pixels. No markdown.`;

export function extractBalancedJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  let depth = 0;
  for (let i = start; start >= 0 && i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) return cleaned.slice(start, i + 1); }
  }
  return "{}";
}

/** framePaths: chronological JPEG frames from ONE render. */
export async function observeVisualBible(
  sourceJobId: number,
  framePaths: string[],
  requestedWorld?: string,
): Promise<ObservedVisualBible | null> {
  try {
    const images = framePaths.slice(0, 8).map((p) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${readFileSync(p).toString("base64")}` },
    }));
    const res: unknown = await invokeLLM({
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Frames in order. ${requestedWorld ? `The PROMPT requested: "${requestedWorld.slice(0, 400)}" — list contradictions between request and pixels.` : ""}` },
            ...images,
          ] as never,
        },
      ],
      // gemini-2.5-flash spends THINKING tokens inside this budget — 2048
      // left only ~300 visible chars (observed live: valid JSON truncated
      // mid-field). 8192 leaves room for thought + the full bible.
      maxTokens: 8192,
    } as never);
    const text = (res as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
    log.info("raw vision response", { len: text.length, head: text.slice(0, 220) });
    const parsed = JSON.parse(extractBalancedJson(text)) as Partial<ObservedVisualBible> & { confidence?: number };
    if (!parsed.subject) throw new Error("vision returned no grounded subject");
    return {
      sourceJobId,
      subject: parsed.subject ?? "",
      vehicleIdentity: parsed.vehicleIdentity ?? null,
      componentIdentity: parsed.componentIdentity ?? null,
      environment: parsed.environment ?? [],
      camera: parsed.camera ?? { angle: "", shotSize: "", depthOfField: "" },
      lighting: parsed.lighting ?? { direction: "", colorTemperature: "", contrast: "" },
      palette: parsed.palette ?? [],
      textSafeZones: parsed.textSafeZones ?? [],
      forbiddenChanges: parsed.forbiddenChanges ?? [],
      visibleDefects: parsed.visibleDefects ?? [],
      identityDriftAcrossFrames: parsed.identityDriftAcrossFrames ?? [],
      requestedVsObservedContradictions: (parsed as { requestedVsObservedContradictions?: string[] }).requestedVsObservedContradictions ?? [],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
      extractedAt: new Date().toISOString(),
      critic: "vision",
    };
  } catch (err) {
    log.warn("observed-bible extraction unavailable — null, never fabricated", {
      sourceJobId, err: err instanceof Error ? err.message.slice(0, 140) : String(err),
    });
    return null;
  }
}
