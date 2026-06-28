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
}

let cachedBundleLocation: string | null = null;

export async function renderReelVideo({
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
