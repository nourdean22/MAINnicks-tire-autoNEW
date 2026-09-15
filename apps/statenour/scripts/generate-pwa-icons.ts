/**
 * scripts/generate-pwa-icons.ts · 2026-05-23.
 *
 * Generates the PWA icon PNGs from `public/icon-nour.svg` so:
 *   · public/icon-192.png        · Android home screen + manifest fallback
 *   · public/icon-512.png        · Android splash + manifest hero
 *   · public/apple-touch-icon.png · iOS homescreen tile (180×180 · iOS-blessed size)
 *
 * Why this exists: iOS Safari strictly requires apple-touch-icon as a
 * PNG · it ignores the manifest's icons array for the homescreen
 * tile. SVG sources aren't accepted (older iOS) or are scaled
 * inconsistently. Pre-fix this whole repo shipped 0 icon PNGs and
 * the iPhone homescreen install rendered a blank or screenshot
 * thumbnail.
 *
 * Run:  pnpm tsx scripts/generate-pwa-icons.ts
 *
 * Idempotent · safe to re-run (always overwrites). Commit the
 * generated PNGs alongside source SVG.
 */

// 2026-09-15 · `sharp` is NOT a dependency of this app (this is a one-off generator; the
// PNGs it wrote on 2026-05-23 are committed). It is loaded through a const specifier so
// tsc does not try to resolve it (check:scripts saw TS2307 for four months of nobody
// noticing). Run it with the package present:
//   pnpm dlx --package=sharp --package=tsx tsx scripts/generate-pwa-icons.ts
type SharpLike = (input: Buffer, opts: { density: number }) => {
  resize(w: number, h: number, o: { fit: "contain"; background: { r: number; g: number; b: number; alpha: number } }): {
    png(o: { compressionLevel: number }): { toBuffer(): Promise<Buffer> };
  };
};
async function loadSharp(): Promise<SharpLike> {
  const specifier = "sharp";
  try {
    const mod = (await import(specifier)) as { default: SharpLike };
    return mod.default;
  } catch {
    throw new Error("sharp is not installed here — run: pnpm dlx --package=sharp --package=tsx tsx scripts/generate-pwa-icons.ts");
  }
}
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PUBLIC = resolve(process.cwd(), "public");
const SOURCE = resolve(PUBLIC, "icon-nour.svg");

interface Target {
  size: number;
  out: string;
  label: string;
}

const TARGETS: Target[] = [
  { size: 192, out: "icon-192.png", label: "Android · manifest" },
  { size: 512, out: "icon-512.png", label: "Android · splash" },
  { size: 180, out: "apple-touch-icon.png", label: "iOS · homescreen" },
];

async function main() {
  const sharp = await loadSharp();
  const svg = await readFile(SOURCE);
  console.log(`source · ${SOURCE} · ${svg.byteLength} bytes`);

  for (const t of TARGETS) {
    const png = await sharp(svg, { density: 384 })
      .resize(t.size, t.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const outPath = resolve(PUBLIC, t.out);
    await writeFile(outPath, png);
    console.log(`  → ${t.out} · ${t.size}×${t.size} · ${png.byteLength} bytes · ${t.label}`);
  }

  console.log("\ndone · commit the generated PNGs alongside the source SVG.");
}

main().catch((err) => {
  console.error("generate-pwa-icons failed:", err);
  process.exitCode = 1;
});
