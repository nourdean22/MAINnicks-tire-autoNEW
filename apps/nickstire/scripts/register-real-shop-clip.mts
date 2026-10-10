/**
 * register-real-shop-clip.mts — put a captured shop clip into the media
 * registry as `real_shop` VIDEO so a Reel beat can bind it, or (--kind still,
 * 2026-10-10) as a `real_shop` IMAGE so a pack's `heroAssetId` can anchor
 * every generated clip on a photo of the actual bay (2026-10-09,
 * docs/reels-engine-v2/13-SOURCE-AWARE-ROUTE.md "How a real beat gets its footage").
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/register-real-shop-clip.mts <file.mp4> --slug P1-nail-macro --job "puncture 2026-10-12" [--execute]
 *
 * Without --execute it probes, hashes and prints what WOULD be registered and
 * exits before opening a database or uploading anything. With --execute it
 * uploads the exact bytes (storagePut, reels/real-shop/), registers the row
 * with the probed duration, dimensions and sha256, and prints the asset id to
 * put on the beat (`"realAssetId": "ma_..."`). It refuses a file that is not
 * vertical video, has no duration, or whose checksum is already registered.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const EXECUTE = args.includes("--execute");
const slug = (opt("slug") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
const jobNote = (opt("job") ?? "").trim();
const KIND = (opt("kind") ?? "clip").trim().toLowerCase();
if (KIND !== "clip" && KIND !== "still") { console.error("--kind must be clip or still"); process.exit(2); }
if (!file || !fs.existsSync(file) || !slug) {
  console.error("usage: register-real-shop-clip.mts <file.mp4> --slug <P1-nail-macro> [--job <note>] [--execute]");
  process.exit(2);
}

const remotion = "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc";
const ffprobe = process.env.FFPROBE_PATH || (fs.existsSync(path.join(remotion, "ffprobe.exe")) ? path.join(remotion, "ffprobe.exe") : "ffprobe");

function probe(p: string): Promise<{ width: number; height: number; durationMs: number; hasAudio: boolean; codec: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", p], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const j = JSON.parse(out) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
        const v = (j.streams ?? []).find((s) => s.codec_type === "video");
        if (!v) return reject(new Error("no video stream"));
        resolve({
          width: Number(v.width), height: Number(v.height), codec: String(v.codec_name),
          durationMs: Math.round(Number(j.format?.duration ?? 0) * 1000),
          hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio"),
        });
      } catch (e) { reject(e); }
    });
  });
}

const bytes = fs.readFileSync(file);
const sha256 = createHash("sha256").update(bytes).digest("hex");

if (KIND === "still") {
  // A hero frame: JPEG/PNG/WebP, vertical, read with sharp (no ffprobe). The CLI's
  // --start-image gate keys on the URL extension, so the stored key keeps it.
  const sharp = (await import("sharp")).default;
  const m = await sharp(bytes).metadata().catch(() => null);
  const ext = m?.format === "jpeg" ? "jpg" : m?.format === "png" ? "png" : m?.format === "webp" ? "webp" : null;
  if (!m || !ext || !m.width || !m.height) { console.error("REFUSING: not a readable JPEG/PNG/WebP"); process.exit(1); }
  const stillProblems: string[] = [];
  if (m.height <= m.width) stillProblems.push(`not vertical (${m.width}x${m.height}); shoot the hero frame portrait`);
  if (m.width < 720) stillProblems.push(`too small (${m.width}px wide; 1080 wide or better)`);
  console.log(`${path.basename(file)}: still ${m.width}x${m.height} ${m.format} ${(bytes.length / 1e6).toFixed(1)} MB sha256=${sha256.slice(0, 16)}…`);
  console.log(`slug=${slug} job="${jobNote}" logicalKey=real_shop:still:${slug}`);
  if (stillProblems.length) { console.error("REFUSING:", stillProblems.join("; ")); process.exit(1); }
  if (!EXECUTE) { console.log("DRY RUN — nothing uploaded or registered. Pass --execute to register."); process.exit(0); }
  const { getDbTyped } = await import("../server/db");
  const d = await getDbTyped();
  if (!d) { console.error("database unavailable"); process.exit(1); }
  const { findByChecksum, registerAsset } = await import("../server/services/mediaRegistry");
  const dup = await findByChecksum(d, sha256);
  if (dup.length) { console.log(`already registered as ${dup.map((r) => `${r.id} (${r.rightsStatus})`).join(", ")} — nothing written`); process.exit(0); }
  const { storagePut, assertDurableStorageForGeneration } = await import("../server/storage");
  assertDurableStorageForGeneration("real_shop still registration");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const { url } = await storagePut(`reels/real-shop/${stamp}-${slug}.${ext}`, bytes, mime);
  const row = await registerAsset(d, {
    logicalKey: `real_shop:still:${slug}`, assetType: "real_shop_still", format: "image", mimeType: mime, byteSize: bytes.length,
    checksumSha256: sha256, lifecycleState: "available", runtimeUrl: url, rightsStatus: "real_shop", width: m.width, height: m.height,
    provider: "operator_capture",
    generationParams: { capturedFor: jobNote || null, sourceFile: path.basename(file), registeredBy: "scripts/register-real-shop-clip.mts --kind still" },
  });
  console.log(`registered ${row.id}: real_shop still, ${url}`);
  console.log(`put on the pack brief:  "heroAssetId": "${row.id}"`);
  process.exit(0);
}

const meta = await probe(file).catch((e: unknown) => {
  console.error(`REFUSING: not a readable video (${e instanceof Error ? e.message : String(e)})`);
  process.exit(1);
});
const problems: string[] = [];
if (!(meta.durationMs > 0)) problems.push("no duration");
if (meta.height <= meta.width) problems.push(`not vertical (${meta.width}x${meta.height})`);
if (meta.durationMs < 2000) problems.push(`too short (${(meta.durationMs / 1000).toFixed(1)} s; capture 5-8 s with handles)`);
if (bytes.length < 50_000) problems.push("file suspiciously small");
console.log(`${path.basename(file)}: ${meta.width}x${meta.height} ${meta.codec} ${(meta.durationMs / 1000).toFixed(2)} s audio=${meta.hasAudio} ${(bytes.length / 1e6).toFixed(1)} MB sha256=${sha256.slice(0, 16)}…`);
console.log(`slug=${slug} job="${jobNote}" logicalKey=real_shop:clip:${slug}`);
if (problems.length) { console.error("REFUSING:", problems.join("; ")); process.exit(1); }
if (!EXECUTE) { console.log("DRY RUN — nothing uploaded or registered. Pass --execute to register."); process.exit(0); }

const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.error("database unavailable"); process.exit(1); }
const { findByChecksum, registerAsset } = await import("../server/services/mediaRegistry");
const dup = await findByChecksum(d, sha256);
if (dup.length) { console.log(`already registered as ${dup.map((r) => `${r.id} (${r.rightsStatus})`).join(", ")} — nothing written`); process.exit(0); }

const { storagePut, assertDurableStorageForGeneration } = await import("../server/storage");
assertDurableStorageForGeneration("real_shop clip registration");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const { url } = await storagePut(`reels/real-shop/${stamp}-${slug}.mp4`, bytes, "video/mp4");
const row = await registerAsset(d, {
  logicalKey: `real_shop:clip:${slug}`,
  assetType: "real_shop_clip",
  format: "video",
  mimeType: "video/mp4",
  byteSize: bytes.length,
  checksumSha256: sha256,
  lifecycleState: "available",
  runtimeUrl: url,
  rightsStatus: "real_shop",
  width: meta.width,
  height: meta.height,
  durationMs: meta.durationMs,
  provider: "operator_capture",
  generationParams: { capturedFor: jobNote || null, sourceFile: path.basename(file), codec: meta.codec, hasAudio: meta.hasAudio, registeredBy: "scripts/register-real-shop-clip.mts" },
});
console.log(`registered ${row.id}: real_shop video, ${(meta.durationMs / 1000).toFixed(2)} s, ${url}`);
console.log(`put on the beat:  "realAssetId": "${row.id}"`);
process.exit(0);
