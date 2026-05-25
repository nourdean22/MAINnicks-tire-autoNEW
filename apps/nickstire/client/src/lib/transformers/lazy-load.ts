/**
 * Transformers.js Lazy-Load Utility
 *
 * Category 9 of apps/nickstire/docs/eval-rubrics/huggingface-model-strategy.md.
 * Dynamically imports `@xenova/transformers` on first use · keeps the
 * main client bundle clean. The ONNX runtime + tokenizer code is ~250KB
 * gzipped, so we only pay that cost when an in-browser AI feature is
 * actually invoked.
 *
 * Each caller (language-detect, sentiment, tire-size-ocr) routes
 * through getPipeline() so we share one transformer instance across
 * all in-browser features. Models are cached in IndexedDB by the
 * library after first download · subsequent invocations are instant.
 *
 * Network behavior · models download from HuggingFace CDN
 * (`https://huggingface.co/Xenova/<model>/resolve/main/onnx/*.onnx`).
 * Service worker should cache these for offline-after-first-load
 * behavior. The browser-cache TTL is forever (immutable URLs).
 */

import type { Pipeline, PipelineType } from "@xenova/transformers";

// Module-scope cache · one pipeline per model · shared across all callers
const cache = new Map<string, Promise<Pipeline>>();

interface LazyLoadOptions {
  /** Force re-download · ignore IndexedDB cache (rare · for debugging) */
  forceFreshDownload?: boolean;
  /** Progress callback · receives { progress: 0-100, status: string } */
  onProgress?: (info: { progress: number; status: string }) => void;
}

/**
 * Load a Transformers.js pipeline. First call triggers model
 * download (~50-300MB depending on model) · subsequent calls hit
 * the in-memory cache.
 *
 * The pipeline objects from Transformers.js are reusable · we share
 * one instance per (task, model) tuple across the app.
 *
 * Example:
 *   const detector = await getPipeline(
 *     "text-classification",
 *     "Xenova/xlm-roberta-base-language-detection",
 *   );
 *   const result = await detector("Hola, ¿cómo estás?");
 *   // → [{ label: "es", score: 0.997 }]
 */
export async function getPipeline(
  task: PipelineType,
  model: string,
  options: LazyLoadOptions = {},
): Promise<Pipeline> {
  const key = `${task}:${model}`;
  if (!options.forceFreshDownload && cache.has(key)) {
    return cache.get(key)!;
  }

  // Dynamic import · pays the ~250KB tokenizer + ONNX runtime ONCE
  // across the app · all subsequent getPipeline calls reuse the
  // module-level cache here.
  const loaderPromise = (async () => {
    const { pipeline, env } = await import("@xenova/transformers");

    // Quiet Transformers.js · it logs a lot at init by default
    env.allowLocalModels = false; // we use HF CDN
    if (options.forceFreshDownload) env.useBrowserCache = false;

    return pipeline(task, model, {
      progress_callback: options.onProgress
        ? (info: { progress: number; status: string }) => options.onProgress?.(info)
        : undefined,
    });
  })();

  cache.set(key, loaderPromise);
  try {
    return await loaderPromise;
  } catch (err) {
    // Failed loads should NOT poison the cache · next call retries
    cache.delete(key);
    throw err;
  }
}

/**
 * True if Transformers.js can run in this browser. WebAssembly +
 * SharedArrayBuffer support are baseline · most evergreen browsers
 * since 2022. Safari < 16 + older Edge may fail.
 */
export function canRunTransformersJs(): boolean {
  if (typeof window === "undefined") return false; // SSR
  // WebAssembly + crypto.subtle are the hard dependencies
  return typeof WebAssembly !== "undefined" && typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

/**
 * Best-effort cleanup · ditch all cached pipelines. Useful in dev
 * for testing fresh-load paths.
 */
export function clearTransformersCache(): void {
  cache.clear();
}
