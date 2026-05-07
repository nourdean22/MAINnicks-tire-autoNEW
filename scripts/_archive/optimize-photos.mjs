#!/usr/bin/env node
/**
 * One-time photo optimization script.
 *
 * Generates: smaller (75-90% size reduction) webp + mobile variants
 * for the 7 large hero/storefront photos that Lighthouse flagged
 * as "Improve image delivery" (329 KiB savings).
 *
 * For each input:
 *   - Re-encodes the desktop variant at q=85 (typical 50-60% size cut)
 *   - Generates a -mobile.webp at 768px width @ q=82 (additional 70%+ cut)
 *
 * The desktop variant overwrites the original (same filename so no
 * code refs need to change). Mobile variants are NEW filenames that
 * get wired up via <picture> elements in the consumer pages.
 *
 * Usage: node scripts/optimize-photos.mjs
 *        node scripts/optimize-photos.mjs --dry-run
 */

import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

const PUBLIC_DIR = path.join(process.cwd(), "client", "public");

// Photos to optimize. Keys are the source filename in /public.
// `mobileMaxWidth` triggers mobile-variant generation (skipped if undefined).
const TARGETS = [
  { name: "storefront-day.webp",         mobileMaxWidth: 768, desktopMaxWidth: 1600 },
  { name: "storefront-bmw.webp",         mobileMaxWidth: 768, desktopMaxWidth: 1600 },
  { name: "storefront-snow.webp",        mobileMaxWidth: 768, desktopMaxWidth: 1600 },
  { name: "mechanic-bay.webp",           mobileMaxWidth: 768, desktopMaxWidth: 1600 },
  { name: "every-make-bmw.webp",         mobileMaxWidth: 768, desktopMaxWidth: 1600 },
  { name: "cybertruck-front-tech.webp",  mobileMaxWidth: 768, desktopMaxWidth: 1600 },
  { name: "services-panoramic.webp",     mobileMaxWidth: 768, desktopMaxWidth: 1800 },
  // hero-cybertruck already has a -mobile.webp so just re-encode the desktop
  { name: "hero-cybertruck.webp",                              desktopMaxWidth: 1800 },
];

const DRY_RUN = process.argv.includes("--dry-run");

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

function mobileFilename(name) {
  return name.replace(/(\.\w+)$/, "-mobile$1");
}

async function statSize(p) {
  try {
    const s = await fs.stat(p);
    return s.size;
  } catch {
    return 0;
  }
}

async function optimize() {
  let totalBefore = 0;
  let totalAfter = 0;
  let totalMobile = 0;

  for (const target of TARGETS) {
    const inPath = path.join(PUBLIC_DIR, target.name);
    const beforeSize = await statSize(inPath);
    if (!beforeSize) {
      console.log(`SKIP   ${target.name} (not found)`);
      continue;
    }
    totalBefore += beforeSize;

    // Read source as buffer once, transform N times
    const buf = await fs.readFile(inPath);
    const meta = await sharp(buf).metadata();
    const sourceWidth = meta.width || 0;

    // ── Desktop re-encode: shrink to desktopMaxWidth if larger, q=85 ──
    const desktopBuf = await sharp(buf)
      .resize({
        width: Math.min(sourceWidth, target.desktopMaxWidth),
        withoutEnlargement: true,
      })
      .webp({ quality: 85, effort: 6 })
      .toBuffer();

    // Only overwrite if the new encoding is meaningfully smaller (>5% cut).
    // Some sources are already optimally compressed — re-encoding at q=85
    // can add bytes (every-make-bmw, cybertruck-front-tech). Skip those.
    const wouldShrink = desktopBuf.length < beforeSize * 0.95;
    if (DRY_RUN) {
      console.log(`(dry) ${target.name}  ${fmt(beforeSize)} → ${fmt(desktopBuf.length)}  ${meta.width}x${meta.height} ${wouldShrink ? "" : "[KEEP ORIGINAL]"}`);
    } else if (wouldShrink) {
      await fs.writeFile(inPath, desktopBuf);
      console.log(`DONE   ${target.name.padEnd(30)} ${fmt(beforeSize)} → ${fmt(desktopBuf.length)}  (${Math.round((1 - desktopBuf.length / beforeSize) * 100)}% off)`);
    } else {
      console.log(`KEEP   ${target.name.padEnd(30)} ${fmt(beforeSize)} (already optimal — re-encode would inflate)`);
    }
    totalAfter += wouldShrink ? desktopBuf.length : beforeSize;

    // ── Mobile variant ──
    if (target.mobileMaxWidth) {
      const mobileBuf = await sharp(buf)
        .resize({
          width: target.mobileMaxWidth,
          withoutEnlargement: true,
        })
        .webp({ quality: 82, effort: 6 })
        .toBuffer();

      const mobilePath = path.join(PUBLIC_DIR, mobileFilename(target.name));
      if (DRY_RUN) {
        console.log(`(dry) → ${mobileFilename(target.name)}  ${fmt(mobileBuf.length)}`);
      } else {
        await fs.writeFile(mobilePath, mobileBuf);
        console.log(`       └─ ${mobileFilename(target.name).padEnd(30)} ${fmt(mobileBuf.length)}  (mobile variant)`);
      }
      totalMobile += mobileBuf.length;
    }
  }

  console.log("\n──────────────────────────────────────");
  console.log(`Desktop totals:  ${fmt(totalBefore)} → ${fmt(totalAfter)}  (saved ${fmt(totalBefore - totalAfter)})`);
  if (totalMobile) {
    console.log(`Mobile variants: ${fmt(totalMobile)} total (NEW files)`);
    console.log(`Mobile downloads vs old desktop: saves ${fmt(totalBefore - totalMobile)} per first-paint`);
  }
}

optimize().catch((err) => {
  console.error("optimize-photos failed:", err);
  process.exitCode = 1;
});
