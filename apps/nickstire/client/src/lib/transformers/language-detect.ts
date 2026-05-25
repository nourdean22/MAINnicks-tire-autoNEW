/**
 * Browser-side language detection · Spanish unlock
 *
 * Detects the language of a chat input in-browser using a 170MB
 * XLM-RoBERTa language classifier. Sub-100ms after first load (model
 * cached in IndexedDB by Transformers.js · subsequent calls hit
 * memory).
 *
 * Use case · customer types "Necesito cambiar mis llantas" in the
 * chat widget · this returns `{ language: "es", confidence: 0.99 }`
 * → widget auto-switches to Spanish-mode (prompts in Spanish, sends
 * Spanish replies via NickGPT's es path · cross-ref Cat 10 unlock).
 *
 * Falls back to "en" when not running in browser OR model fails to
 * load. Caller decides response strategy.
 */

import { canRunTransformersJs, getPipeline } from "./lazy-load";

const MODEL = "Xenova/xlm-roberta-base-language-detection";

export interface LanguageDetectResult {
  /** ISO 639-1 language code · "en" | "es" | "fr" | ... */
  language: string;
  /** 0-1 confidence */
  confidence: number;
  /** Was the model actually run (false = SSR / no support / failure) */
  modelRan: boolean;
}

interface PipelineLabel {
  label: string;
  score: number;
}

/**
 * Detect the language of `text`. Returns a default `{language: "en"}`
 * with `modelRan: false` when Transformers.js can't run (SSR, old
 * browser, model failure). Caller MUST treat low-confidence results
 * as ambiguous.
 *
 * Recommended threshold · 0.85 · below that, fall back to keyword
 * detection or operator-language preference.
 */
export async function detectLanguage(text: string): Promise<LanguageDetectResult> {
  if (!text || text.trim().length === 0) {
    return { language: "en", confidence: 0, modelRan: false };
  }
  if (!canRunTransformersJs()) {
    return { language: "en", confidence: 0, modelRan: false };
  }

  try {
    const classifier = await getPipeline("text-classification", MODEL);
    const output = (await classifier(text)) as PipelineLabel[];
    if (!Array.isArray(output) || output.length === 0) {
      return { language: "en", confidence: 0, modelRan: false };
    }
    const top = output[0];
    return {
      language: top.label || "en",
      confidence: top.score ?? 0,
      modelRan: true,
    };
  } catch (err) {
    console.warn("[language-detect] failed · falling back to en", err);
    return { language: "en", confidence: 0, modelRan: false };
  }
}

/**
 * Convenience · true if the input is confidently Spanish.
 * Threshold 0.85 by default · adjustable for the call site.
 */
export async function isSpanish(text: string, threshold: number = 0.85): Promise<boolean> {
  const result = await detectLanguage(text);
  return result.modelRan && result.language === "es" && result.confidence >= threshold;
}
