/**
 * Vite plugin: inline critical CSS via Beasties (Critters fork).
 *
 * Runs after the build emits dist/public/index.html. Reads the HTML +
 * generated stylesheets, extracts the rules referenced by elements in
 * the document, inlines them in <style>, and converts the original
 * <link rel="stylesheet"> to async load (preload+onload swap).
 *
 * Lighthouse mobile flagged "Render blocking requests Est savings of
 * 510ms" — most of which is the 260KB Tailwind bundle. This drops the
 * critical-path CSS to ~5-10KB inline, eliminating the blocking
 * stylesheet from first-paint.
 *
 * Why a custom plugin (vs. a published vite-plugin-beasties):
 * - Beasties has no first-class Vite plugin; it ships as a standalone
 *   library + an HtmlWebpackPlugin add-on.
 * - We control exactly when it runs (closeBundle hook) and which files
 *   it touches (only index.html, not the per-route prerendered HTML
 *   which has the same <link> tag and gets the same treatment via the
 *   prerender pipeline reading the new index.html).
 *
 * Failure mode: if beasties throws or the inlined output is malformed,
 * we LOG the error and DO NOT modify the HTML. Build succeeds with the
 * original blocking <link>. Never break the build for this optimization.
 */

import Beasties from "beasties";
import { promises as fs } from "node:fs";
import path from "node:path";

export function criticalCss() {
  return {
    name: "critical-css-inline",
    apply: "build",
    async closeBundle() {
      const distDir = path.resolve(process.cwd(), "dist", "public");
      const htmlPath = path.join(distDir, "index.html");

      let shellHtml;
      try {
        shellHtml = await fs.readFile(htmlPath, "utf8");
      } catch {
        // No index.html — server-only build, nothing to do.
        return;
      }

      // Beasties needs rendered DOM to determine critical CSS. The Vite
      // build emits an empty `<div id="root">` shell — analyzing that
      // produces 0 critical rules. Instead, use the PRERENDERED
      // homepage (committed in /prerendered/index.html) which has the
      // full DOM. We extract critical rules against that DOM, then
      // copy the resulting <style> + non-blocking <link> back into
      // the shell index.html.
      const prerenderedHomepage = path.resolve(process.cwd(), "prerendered", "index.html");
      let analysisHtml;
      try {
        analysisHtml = await fs.readFile(prerenderedHomepage, "utf8");
      } catch {
        // No prerendered homepage available — soft-skip this build.
        // Next prerender regen + rebuild will pick up the inlining.
        console.log("[critical-css] No prerendered/index.html — skipping (run prerender first).");
        return;
      }

      try {
        const beasties = new Beasties({
          path: distDir,
          publicPath: "/",
          preload: "swap",
          pruneSource: false,
          mergeStylesheets: true,
          logLevel: "warn",
          inlineFonts: false,
          external: false,
        });

        // Process the prerendered homepage to extract critical CSS.
        const transformed = await beasties.process(analysisHtml);

        // Pull out the inlined <style> blocks Beasties produced.
        const styleBlocks = transformed.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];
        if (styleBlocks.length === 0) {
          console.warn("[critical-css] No critical CSS extracted from prerendered HTML.");
          return;
        }

        const criticalCssTotal = styleBlocks.reduce((sum, b) => sum + b.length, 0);

        // Pull out the non-blocking stylesheet preload Beasties generated
        // (it converted <link rel="stylesheet"> to <link rel="preload" onload="...">).
        const preloadMatch = transformed.match(/<link[^>]+rel=["']preload["'][^>]+as=["']style["'][^>]*onload[^>]*\/?>/);

        // Now apply both transformations to the SHELL index.html:
        // 1. Inject the <style> blocks just before </head>
        // 2. Replace the original <link rel="stylesheet" href="/assets/index-*.css">
        //    with the non-blocking version

        let updatedShell = shellHtml;

        // Replace any existing assets/index-*.css stylesheet link with the
        // non-blocking preload-onload-swap form.
        if (preloadMatch) {
          updatedShell = updatedShell.replace(
            /<link[^>]+rel=["']stylesheet["'][^>]+href=["']\/assets\/index-[^"']+\.css["'][^>]*\/?>/,
            preloadMatch[0],
          );
        }

        // Inject critical CSS blocks just before </head>.
        const styleInjection = styleBlocks.join("\n  ");
        updatedShell = updatedShell.replace("</head>", `  ${styleInjection}\n  </head>`);

        await fs.writeFile(htmlPath, updatedShell, "utf8");
        console.log(
          `[critical-css] Inlined ${(criticalCssTotal / 1024).toFixed(1)} KB of critical CSS into index.html (analyzed from prerendered/index.html)`,
        );
      } catch (err) {
        // Soft-fail: keep original HTML if extraction blows up.
        console.warn("[critical-css] Beasties failed — keeping original HTML.", err?.message || err);
      }
    },
  };
}
