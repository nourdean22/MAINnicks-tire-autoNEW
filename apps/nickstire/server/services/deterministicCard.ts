/**
 * Deterministic card lane (2026-10-09). A beat declared `deterministic` is
 * DRAWN, never imagined: an SVG with the beat's label lines and an
 * "Illustration" badge, rasterised by sharp (already a dependency, used by
 * renderedPixelStats and the upload path), then moved through the SAME free
 * ffmpeg lane every template_stock beat uses (templateStockStudio.buildBeatClipArgs
 * + runFfmpeg), so there is one local renderer, not two. Zero model calls,
 * zero network before the re-host.
 *
 * What it does not do, on purpose: parse a diagram out of prose. The lines it
 * draws are the beat's explicit `cardLines`, or the capitalised labels the
 * proof packs write after "labels" in the visual ("labels PLUG and INSIDE
 * PATCH"), or none. A card with no lines is a labelled illustrative hold with
 * the beat's caption burned over it by assembly, which is honest; a card that
 * guessed a cross-section would not be.
 */
import { createHash } from "crypto";
import { createLogger } from "../lib/logger";
import type { ShotLineage } from "../../shared/reelSourceProfile";
import { CARD_CLIP_MAX_SECONDS } from "./reelAssembly";

const log = createLogger("services:deterministic-card");

export const CARD_RENDERER_ID = "svg_card_v1";
const FRAME_W = 1080;
const FRAME_H = 1920;
const BRAND_GOLD = "#FDB913";
const BRAND_DARK = "#0A0A0A";
const MAX_LINES = 4;
const MAX_LINE_CHARS = 24;

export interface CardSpec {
  lines: string[];
  badge: string;
}

/** Explicit `cardLines` win; else the capitalised labels after "label(s)" in the visual; else none. */
export function cardSpecFromBeat(beat: { visual?: string | null; cardLines?: string[] | null }): CardSpec {
  const explicit = (beat.cardLines ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (explicit.length) return { lines: explicit.slice(0, MAX_LINES).map(clipLine), badge: "Illustration" };
  const visual = String(beat.visual ?? "");
  const m = visual.match(/\blabels?\s+([A-Z][A-Z0-9 /'-]+(?:\s*(?:,|and|&)\s*[A-Z][A-Z0-9 /'-]+)*)/);
  if (!m) return { lines: [], badge: "Illustration" };
  const lines = m[1]
    .split(/\s*(?:,|\band\b|&)\s*/)
    .map((s) => s.trim().replace(/[.;:]+$/, ""))
    .filter((s) => s.length >= 2 && s.length <= 40 && /^[A-Z0-9 /'-]+$/.test(s));
  return { lines: lines.slice(0, MAX_LINES).map(clipLine), badge: "Illustration" };
}

function clipLine(s: string): string {
  return s.length <= MAX_LINE_CHARS ? s : `${s.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Pure SVG. Lines sit in the upper-middle band (0.26h–0.48h) so assembly's
 * beat caption at 0.55h never collides with them; the badge sits at 0.14h,
 * inside the top safe zone. Brand gold rule under the lines; nothing else.
 */
export function buildCardSvg(spec: CardSpec): string {
  const lineH = 118;
  const fontSize = 84;
  const startY = Math.round(FRAME_H * 0.30);
  const lines = spec.lines.map((l, i) =>
    `<text x="${FRAME_W / 2}" y="${startY + i * lineH}" text-anchor="middle" font-family="Arial, Helvetica, 'DejaVu Sans', sans-serif" font-weight="700" font-size="${fontSize}" fill="#FFFFFF">${esc(l)}</text>`,
  );
  const ruleY = startY + Math.max(spec.lines.length, 1) * lineH - 40;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_W}" height="${FRAME_H}" viewBox="0 0 ${FRAME_W} ${FRAME_H}">`,
    `<rect width="${FRAME_W}" height="${FRAME_H}" fill="${BRAND_DARK}"/>`,
    `<rect x="${FRAME_W / 2 - 150}" y="${Math.round(FRAME_H * 0.13)}" width="300" height="64" rx="32" fill="none" stroke="${BRAND_GOLD}" stroke-width="4"/>`,
    `<text x="${FRAME_W / 2}" y="${Math.round(FRAME_H * 0.13) + 44}" text-anchor="middle" font-family="Arial, Helvetica, 'DejaVu Sans', sans-serif" font-size="34" fill="${BRAND_GOLD}">${esc(spec.badge)}</text>`,
    ...lines,
    `<rect x="${FRAME_W / 2 - 220}" y="${ruleY}" width="440" height="8" fill="${BRAND_GOLD}"/>`,
    `</svg>`,
  ].join("");
}

/** Lineage row for a rendered card. */
export function lineageForCard(beatNumber: number, sha256: string, onScreenSec: number, now: () => string = () => new Date().toISOString(), url?: string): ShotLineage {
  return {
    beatNumber,
    source: "deterministic",
    origin: "local_card",
    sha256,
    ...(url ? { url } : {}),
    renderer: CARD_RENDERER_ID,
    sourceDurationSec: Number(onScreenSec.toFixed(2)),
    trimInSec: 0,
    trimOutSec: Number(onScreenSec.toFixed(2)),
    onScreenSec: Number(onScreenSec.toFixed(2)),
    // The card drifts (zoompan) rather than freezing, so the motion check sees frames that differ.
    stillHold: false,
    boundAt: now(),
  };
}

/**
 * Render one card beat and re-host it. Returns the public URL and the sha256
 * of the exact mp4 bytes. Throws on any failure — the caller holds the job
 * with needs_deterministic_render; nothing silently degrades to a gradient.
 */
export async function renderDeterministicCardClip(input: {
  beatNumber: number;
  seconds: number;
  spec: CardSpec;
}): Promise<{ url: string; sha256: string; bytes: number; seconds: number }> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const sharp = (await import("sharp")).default;
  const { buildBeatClipArgs, runFfmpeg } = await import("./templateStockStudio");

  const seconds = Math.max(1, Math.min(CARD_CLIP_MAX_SECONDS, Number(input.seconds.toFixed(2))));
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `reelcard-${input.beatNumber}-`));
  try {
    const png = await sharp(Buffer.from(buildCardSvg(input.spec))).png().toBuffer();
    await fs.writeFile(path.join(workDir, "card.png"), png);
    const outFile = `card-${input.beatNumber}.mp4`;
    await runFfmpeg(
      buildBeatClipArgs({ seconds, beatNumber: input.beatNumber, backgroundFile: "card.png", outFile, motion: "drift_up" }),
      workDir,
    );
    const mp4 = await fs.readFile(path.join(workDir, outFile));
    if (mp4.length === 0) throw new Error("deterministic card: ffmpeg produced an empty file");
    const sha256 = createHash("sha256").update(mp4).digest("hex");
    const { storagePut } = await import("../storage");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { url } = await storagePut(`reels/deterministic-card/${stamp}-beat-${input.beatNumber}.mp4`, mp4, "video/mp4");
    log.info("deterministic card rendered", { beat: input.beatNumber, seconds, lines: input.spec.lines.length, bytes: mp4.length, sha256: sha256.slice(0, 12), url });
    return { url, sha256, bytes: mp4.length, seconds };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
