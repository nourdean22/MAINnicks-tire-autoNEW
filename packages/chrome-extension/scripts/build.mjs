/**
 * scripts/build.mjs · @statenour/chrome-extension · 2026-05-23.
 *
 * Build pipeline:
 *   1. Generate PNG icons (16/32/48/128) from the shared
 *      apps/statenour/public/icon-nour.svg via sharp
 *   2. Copy everything in src/ → dist/ (plus the generated icons)
 *   3. Print install instructions
 *
 * Run: `pnpm --filter @statenour/chrome-extension build`
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..");
const SRC = join(root, "src");
const DIST = join(root, "dist");
const ICONS = join(DIST, "icons");
const STATENOUR_SVG = resolve(root, "..", "..", "apps", "statenour", "public", "icon-nour.svg");

const SIZES = [16, 32, 48, 128];

async function generateIcons() {
  if (!existsSync(STATENOUR_SVG)) {
    console.warn(`  ⚠  source SVG not found at ${STATENOUR_SVG} · skipping icon gen`);
    return;
  }
  // Sharp lives at the monorepo root via the statenour install.
  const sharp = (await import("sharp")).default;
  const svg = readFileSync(STATENOUR_SVG);
  mkdirSync(ICONS, { recursive: true });
  for (const size of SIZES) {
    const out = join(ICONS, `icon-${size}.png`);
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(out, buf);
    console.log(`  → icons/icon-${size}.png · ${buf.byteLength} bytes`);
  }
}

async function main() {
  console.log("@statenour/chrome-extension · build");
  console.log("");
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  console.log("[1/2] generate icons");
  await generateIcons();

  console.log("");
  console.log("[2/2] copy src → dist");
  cpSync(SRC, DIST, { recursive: true });
  console.log("  → src copied");

  console.log("");
  console.log("✓ build complete · dist/");
  console.log("");
  console.log("install (unpacked):");
  console.log("  1. open chrome://extensions");
  console.log("  2. toggle 'Developer mode' (top right)");
  console.log("  3. click 'Load unpacked' · select packages/chrome-extension/dist/");
  console.log("  4. open the extension options · paste a token from");
  console.log("     https://bdnick.info/system/api-tokens");
  console.log("  5. Cmd+Shift+B from anywhere · type · Cmd+Enter to save");
}

main().catch((err) => {
  console.error("build failed:", err);
  process.exit(1);
});
