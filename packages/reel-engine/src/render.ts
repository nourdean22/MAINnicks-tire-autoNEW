import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RenderReelOptions {
  template: "review" | "alert";
  data: Record<string, any>;
  outputPath: string;
  /** Wall-clock cap for the whole bundle+render pipeline. Defaults to REEL_RENDER_TIMEOUT_MS env or 10 minutes. */
  timeoutMs?: number;
}

let cachedBundleLocation: string | null = null;

const DEFAULT_RENDER_TIMEOUT_MS = 10 * 60 * 1000;

// The worker's video cron holds an isRendering mutex for the lifetime of this
// promise — without a wall-clock bound, one hung Chromium render (e.g. a
// stalled remote font fetch) disables the reel pipeline until process restart.
// A timeout rejection unblocks the caller; the underlying render process may
// keep running until it exits on its own or the worker restarts.
function withWallClockTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[Reel Engine] ${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export async function renderReelVideo(options: RenderReelOptions): Promise<void> {
  const timeoutMs =
    options.timeoutMs ??
    (Number(process.env.REEL_RENDER_TIMEOUT_MS) > 0
      ? Number(process.env.REEL_RENDER_TIMEOUT_MS)
      : DEFAULT_RENDER_TIMEOUT_MS);
  return withWallClockTimeout(doRenderReelVideo(options), timeoutMs, `render (${options.template})`);
}

async function doRenderReelVideo({
  template,
  data,
  outputPath,
}: RenderReelOptions): Promise<void> {
  console.log(`[Reel Engine] Bundling composition entry point...`);
  // Find entry point path relative to this file
  const entryPoint = path.resolve(__dirname, "entry.js"); // Compiled JS in dist/ or entry.ts in ts-node
  
  // Fallback to ts file if bundling in-dev directly from source using tsx/ts-node
  const resolvedEntryPoint = entryPoint.endsWith(".js") && !fs.existsSync(entryPoint)
    ? path.resolve(__dirname, "entry.ts")
    : entryPoint;

  console.log(`[Reel Engine] Resolving entryPoint at: ${resolvedEntryPoint}`);

  // Create webpack bundle or reuse cache
  if (!cachedBundleLocation) {
    console.log(`[Reel Engine] Webpack bundle cache miss. Compiling...`);
    cachedBundleLocation = await bundle({
      entryPoint: resolvedEntryPoint,
    });
  } else {
    console.log(`[Reel Engine] Webpack bundle cache hit. Reusing: ${cachedBundleLocation}`);
  }

  const compositionId = template === "review" ? "ReviewVideoReel" : "ServiceAlertReel";
  console.log(`[Reel Engine] Selecting composition: ${compositionId}`);

  // Select composition and pass dynamic inputs
  const composition = await selectComposition({
    serveUrl: cachedBundleLocation,
    id: compositionId,
    inputProps: data,
  });

  console.log(`[Reel Engine] Compiling video output to: ${outputPath}...`);
  // Render media
  await renderMedia({
    composition,
    serveUrl: cachedBundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: data,
  });

  console.log(`[Reel Engine] Render complete: ${outputPath}`);
}
