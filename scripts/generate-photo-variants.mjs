#!/usr/bin/env node
/**
 * wave-172 · Generate responsive photo variants for the Home grid.
 *
 * Local DOM inspection (Claude_Preview perf trace) found 5 photos on
 * Home displayed at 127×95 to 167×671 but served at 1122×1402 natural
 * resolution — 7-10× oversized. Total wasted bandwidth: ~1.5MB per
 * Home pageload, exclusively on mobile where it hurts most.
 *
 * This script reads each source webp from client/public/photos/ and
 * emits resized siblings:
 *   /photos/foo.webp           — desktop hero (1122×1402, untouched)
 *   /photos/foo-medium.webp    — medium (560px wide, ~80KB)
 *   /photos/foo-small.webp     — mobile grid (320px wide, ~30KB)
 *
 * Home.tsx will use <picture><source srcset> to let the browser pick
 * the smallest acceptable variant based on viewport.
 *
 * Run: node scripts/generate-photo-variants.mjs
 *      Commit the new files alongside the Home.tsx edits.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PHOTOS_DIR = path.join(ROOT, "client", "public", "photos");

// Pages whose Home grid is the primary use. The TARGETS list is the
// minimal set that Home.tsx actively references — generating variants
// for every photo in /photos/ would balloon the repo without need.
const TARGETS = [
  "shopfront-clear-vertical-sign-bays.webp",
  "busy-shop-action-mechanics.webp",
  "rugged-tire-tread-closeup.webp",
  "interior-service-bay-car-lift.webp",
  "undercar-brake-repair-action.webp",
];

// Skip files that already have a variant suffix
function isVariant(name) {
  return /-(small|medium)\.webp$/.test(name);
}

async function generate() {
  let totalSavedBytes = 0;
  let generated = 0;
  for (const filename of TARGETS) {
    const inputPath = path.join(PHOTOS_DIR, filename);
    try {
      await fs.access(inputPath);
    } catch {
      console.warn(`[photo-variants] skip — not found: ${filename}`);
      continue;
    }

    const base = filename.replace(/\.webp$/, "");
    const mediumPath = path.join(PHOTOS_DIR, `${base}-medium.webp`);
    const smallPath = path.join(PHOTOS_DIR, `${base}-small.webp`);

    const originalStat = await fs.stat(inputPath);

    // Medium variant — 560px wide, quality 82. Used for desktop grid
    // (where cards are ~250-280px wide, so 560 covers 2x retina).
    await sharp(inputPath)
      .resize({ width: 560, withoutEnlargement: true })
      .webp({ quality: 82, effort: 6 })
      .toFile(mediumPath);
    const mediumStat = await fs.stat(mediumPath);

    // Small variant — 320px wide, quality 78. Used for mobile grid
    // (cards ~140-170px wide; 320 covers 2x retina). Aggressive on
    // quality to maximize bandwidth savings on the slowest networks.
    await sharp(inputPath)
      .resize({ width: 320, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toFile(smallPath);
    const smallStat = await fs.stat(smallPath);

    // Bandwidth savings if a mobile visitor downloads -small instead of original.
    const mobileSaved = originalStat.size - smallStat.size;
    totalSavedBytes += mobileSaved;
    generated++;

    console.log(
      `[photo-variants] ${filename}: ` +
        `original=${(originalStat.size / 1024).toFixed(0)}KB → ` +
        `medium=${(mediumStat.size / 1024).toFixed(0)}KB, ` +
        `small=${(smallStat.size / 1024).toFixed(0)}KB ` +
        `(mobile saves ${(mobileSaved / 1024).toFixed(0)}KB)`
    );
  }
  console.log(
    `\n[photo-variants] ✓ ${generated} sources processed. ` +
      `Mobile bandwidth saved per Home load: ${(totalSavedBytes / 1024).toFixed(0)}KB ` +
      `(${(totalSavedBytes / 1024 / 1024).toFixed(2)}MB).`
  );
}

generate().catch((err) => {
  console.error("[photo-variants] FAILED:", err);
  process.exit(1);
});
