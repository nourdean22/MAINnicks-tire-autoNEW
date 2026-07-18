import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../lib/logger";
import { ensureHiggsfieldBinary } from "./higgsfieldBinary";
import { isIP } from "node:net";

const log = createLogger("services:higgsfield-studio");

let cachedHiggsfieldCredentialsJson: string | null = null;
let credentialsLoadAttempted = false;

export function clearRuntimeHiggsfieldCache(): void {
  cachedHiggsfieldCredentialsJson = null;
  credentialsLoadAttempted = false;
}

export async function getHiggsfieldCredentialsJson(): Promise<string | null> {
  if (credentialsLoadAttempted) {
    return cachedHiggsfieldCredentialsJson || process.env.HIGGSFIELD_CREDENTIALS_JSON || null;
  }
  credentialsLoadAttempted = true;
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (d) {
      const { appSecretKv } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await d.select().from(appSecretKv).where(eq(appSecretKv.k, "higgsfield_credentials_json")).limit(1);
      if (rows.length && rows[0].v) {
        cachedHiggsfieldCredentialsJson = rows[0].v;
      }
    }
  } catch (err) {
    log.error("failed to load Higgsfield credentials from database:", err);
  }
  return cachedHiggsfieldCredentialsJson || process.env.HIGGSFIELD_CREDENTIALS_JSON || null;
}

let staleCredsSwept = false;

/**
 * Defense-in-depth: delete Higgsfield temp credential files left behind by a
 * crashed/orphaned prior run. The normal path cleans up on the spawn `close`
 * event, but a killed child (timeout, OOM, process exit) can leak the creds
 * JSON on disk. Swept once, lazily, the first time creds are used (not at
 * import time, to keep test/startup I/O out of the hot path).
 */
function sweepStaleHiggsfieldCreds(): void {
  try {
    const dir = os.tmpdir();
    const cutoff = Date.now() - 60 * 60 * 1000; // older than 1h = definitely orphaned
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith("hg-creds-") || !name.endsWith(".json")) continue;
      const fp = path.join(dir, name);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch (_) {}
    }
  } catch (_) {}
}

async function getSpawnEnv(): Promise<{ env: NodeJS.ProcessEnv; tempCredsFile: string | null }> {
  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  let tempCredsFile: string | null = null;
  const credentialsJson = await getHiggsfieldCredentialsJson();

  if (credentialsJson) {
    try {
      if (!staleCredsSwept) {
        staleCredsSwept = true;
        sweepStaleHiggsfieldCreds();
      }
      const tempDir = os.tmpdir();
      tempCredsFile = path.join(tempDir, `hg-creds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
      // mode 0o600: owner read/write only — if cleanup is ever missed, the
      // leaked credentials file is still not readable by other local users.
      fs.writeFileSync(tempCredsFile, credentialsJson, { encoding: "utf8", mode: 0o600 });
      lastWrittenCredsJson = credentialsJson;
      spawnEnv.HIGGSFIELD_CREDENTIALS_PATH = tempCredsFile;
    } catch (err) {
      log.warn("failed to write Higgsfield credentials to temp file", {
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return { env: spawnEnv, tempCredsFile };
}

function cleanupTempFile(filepath: string | null) {
  if (filepath && fs.existsSync(filepath)) {
    try {
      fs.unlinkSync(filepath);
    } catch (_) {}
  }
}

/** The exact credentials JSON most recently written to a temp file, so the
 *  post-run rotation check knows what "unchanged" looks like. */
let lastWrittenCredsJson: string | null = null;

/**
 * The Higgsfield CLI ROTATES tokens: on refresh it rewrites its credentials
 * file with a new access/refresh pair and the old refresh token is consumed.
 * Observed live 2026-07-16: prod's static HIGGSFIELD_CREDENTIALS_JSON env pair
 * died ~90 minutes after login ("Session expired") because the CLI's rotated
 * successor was written to a throwaway temp file and discarded. So before
 * deleting the temp file, persist any rotated pair to the app_secret_kv row
 * (which getHiggsfieldCredentialsJson PREFERS over the env var) and refresh
 * the in-process cache. Best-effort: failures only log — generation itself
 * already succeeded or failed on its own terms.
 */
async function persistRotatedCredentialsThenCleanup(tempCredsFile: string | null): Promise<void> {
  try {
    if (tempCredsFile && fs.existsSync(tempCredsFile)) {
      const current = fs.readFileSync(tempCredsFile, "utf8");
      if (current && current !== lastWrittenCredsJson) {
        const parsed = JSON.parse(current) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && (parsed.access_token || parsed.refresh_token)) {
          cachedHiggsfieldCredentialsJson = current;
          credentialsLoadAttempted = true;
          lastWrittenCredsJson = current;
          const { db } = await import("../lib/db-helper");
          const d = await db();
          if (d) {
            const { appSecretKv } = await import("../../drizzle/schema");
            await d
              .insert(appSecretKv)
              .values({ k: "higgsfield_credentials_json", v: current })
              .onDuplicateKeyUpdate({ set: { v: current } });
            log.info("persisted rotated Higgsfield credentials to durable store");
          }
        }
      }
    }
  } catch (err) {
    log.warn("failed to persist rotated Higgsfield credentials", {
      err: err instanceof Error ? err.message : String(err),
    });
  } finally {
    cleanupTempFile(tempCredsFile);
  }
}

function parseResultUrl(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout);
    const urls: string[] = [];
    const findUrls = (obj: any) => {
      if (!obj) return;
      if (typeof obj === "string") {
        if (obj.startsWith("http://") || obj.startsWith("https://")) {
          urls.push(obj);
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(findUrls);
      } else if (typeof obj === "object") {
        Object.values(obj).forEach(findUrls);
      }
    };
    findUrls(parsed);
    if (urls.length > 0) {
      return urls[0];
    }
    throw new Error("No URL found in Higgsfield CLI JSON response");
  } catch (err) {
    throw new Error(`Failed to parse Higgsfield output: ${err instanceof Error ? err.message : String(err)}. Raw stdout: ${stdout}`);
  }
}

/**
 * Generate a single image using gpt_image_2 model
 */
/** Portrait vs square is the CALLER's call: single-post autopost keeps 1:1
 *  (bare-string back-compat), the carousel path passes 3:4 - the closest
 *  portrait in Higgsfield aspect enums (4:5 was absent from the seedance enum
 *  and gpt_image_2 could not be probed without rotating the prod session,
 *  2026-07-16). A rejected ratio fails LOUD in the Studio rather than
 *  silently shipping square crops against a 4:5 brief. */
export async function generateCarouselSlideImage(req: string | { prompt: string; aspectRatio?: string }): Promise<string> {
  const prompt = typeof req === "string" ? req : req.prompt;
  const aspectRatio = typeof req === "string" ? "1:1" : (req.aspectRatio || "3:4");
  const binPath = await ensureHiggsfieldBinary();
  const { env, tempCredsFile } = await getSpawnEnv();

  log.info("Generating slide image via Higgsfield...", { prompt });

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      binPath,
      [
        "generate",
        "create",
        "gpt_image_2",
        "--prompt",
        prompt,
        "--aspect_ratio",
        aspectRatio,
        "--resolution",
        "2k",
        "--wait",
        "--json"
      ],
      {
        env: {
          ...env,
          HIGGSFIELD_INSTALL_METHOD: "npm",
          HIGGSFIELD_PACKAGE_MANAGER: "pnpm",
        }
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      void persistRotatedCredentialsThenCleanup(tempCredsFile);
      if (code !== 0) {
        reject(new Error(`Higgsfield CLI exited with code ${code}. Stderr: ${stderr.trim()}`));
        return;
      }
      try {
        const url = parseResultUrl(stdout);
        resolve(url);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Generate a 4-second 9:16 1080p video clip using Seedance 1.5 Pro.
 * Switched from wan2_6 (13 cr) to seedance1_5 (12 cr, better + cheaper) per the
 * production-verified reel pipeline (scratch/gen-reel1-assets.ts). 4s source
 * clips are trimmed per storyboard beat at assembly time.
 */
/** Seedance has NO negative-prompt parameter (verified via model get seedance1_5,
 *  2026-07-16) - so style exclusions are compiled into the prompt as a hard
 *  DO NOT INCLUDE section. Accepts a bare string for back-compat. */
export function combinePromptWithNegative(prompt: string, negativePrompt?: string): string {
  const neg = (negativePrompt || "").trim();
  if (!neg) return prompt;
  return prompt + String.fromCharCode(10) + "DO NOT INCLUDE: " + neg + ".";
}

/**
 * Pure CLI arg construction for a seedance1_5 clip — extracted so the
 * image-conditioning path is unit-testable without spawning the CLI.
 *
 * IMAGE CONDITIONING (milestone 6): the identity drift measured in the
 * baseline (one gremlin body per beat, three lighting worlds) is a DIRECT
 * consequence of text-only generation — each beat was an independent
 * `--prompt` call with no shared visual anchor. The Higgsfield CLI documents
 * `--start-image` for video models; passing a reference frame anchors the
 * clip's opening on a shared image so identity carries across beats.
 *
 * HONESTY: seedance1_5's per-model support for --start-image is NOT yet
 * verified end-to-end (verification requires `model get` / a paid image
 * render, and re-authing the local CLI would rotate prod's in-memory creds).
 * So this path is gated behind REEL_IMAGE_CONDITIONING (default OFF) and
 * stays text-only in prod until a paid verification run proves it. The arg
 * BUILDER is proven here; the live GENERATION is not.
 */
export function buildSeedanceArgs(prompt: string, opts: { startImageUrl?: string } = {}): string[] {
  const args = [
    "generate", "create", "seedance1_5",
    "--prompt", prompt,
    "--aspect_ratio", "9:16",
    "--duration", "4",
    "--resolution", "1080p",
  ];
  // --start-image needs an IMAGE. Reject anything that is not an image URL
  // even under the flag — a video/other URL would fail or silently degrade
  // (the bug the acceptance-campaign setup surfaced: a chained mp4 clip URL).
  if (opts.startImageUrl && process.env.REEL_IMAGE_CONDITIONING === "true" && /\.(jpe?g|png|webp)([?#]|$)/i.test(opts.startImageUrl)) {
    args.push("--start-image", opts.startImageUrl);
  }
  args.push("--wait", "--json");
  return args;
}

/**
 * The Higgsfield CLI's `--start-image` accepts a media UUID or an EXISTING FILE
 * PATH — NOT a public URL. Verified live 2026-07-18: a cloudfront hero-frame URL
 * hard-failed the CLI with *"Media \"…\" is neither a UUID nor an existing file
 * path."* Download the remote hero frame to a temp file so the CLI can read it
 * locally. Returns the temp path, or null on ANY failure — the caller falls back
 * to text-only, because a conditioning-anchor download failure must never kill
 * an otherwise-fine render.
 */
/** 20 MB. A 1080x1920 hero frame is ~1-3 MB; anything past this is not a frame. */
const START_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const START_IMAGE_MAX_REDIRECTS = 3;

/**
 * Reject anything that resolves to the deploy's own network before we fetch it.
 * The hero URL is OUR generated frame today, but it arrives via the job payload
 * — DB-held JSON that several writers touch — so it is untrusted input on the
 * path to an outbound request. Literal-IP and metadata-host checks are the cheap
 * half of SSRF defence; a DNS-rebind still needs network egress rules.
 */
/** Dotted-quad -> uint32. Only called after net.isIP() has confirmed the form. */
function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0) >>> 0;
}

/**
 * Refuse every IPv4 block that is not globally routable.
 *
 * Written as explicit CIDRs rather than string prefixes because the old
 * `/^127\./`-style tests were the defect: they matched text, so any alternate
 * encoding of the same address slipped past. These compare numbers.
 */
function assertPublicIPv4(ip: string): void {
  const n = ipv4ToInt(ip);
  const inBlock = (base: string, bits: number) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  };
  const BLOCKED: Array<[string, number, string]> = [
    ["0.0.0.0", 8, "this-network"], // covers 0.1.2.3, not just the literal 0.0.0.0
    ["10.0.0.0", 8, "private"],
    ["100.64.0.0", 10, "carrier-grade NAT"],
    ["127.0.0.0", 8, "loopback"],
    ["169.254.0.0", 16, "link-local (incl. 169.254.169.254 cloud metadata)"],
    ["172.16.0.0", 12, "private"],
    ["192.0.0.0", 24, "IETF protocol assignments"],
    ["192.0.2.0", 24, "TEST-NET-1"],
    ["192.88.99.0", 24, "6to4 relay anycast"],
    ["192.168.0.0", 16, "private"],
    ["198.18.0.0", 15, "benchmarking"],
    ["198.51.100.0", 24, "TEST-NET-2"],
    ["203.0.113.0", 24, "TEST-NET-3"],
    ["224.0.0.0", 4, "multicast"],
    ["240.0.0.0", 4, "reserved (incl. 255.255.255.255 broadcast)"],
  ];
  for (const [base, bits, label] of BLOCKED) {
    if (inBlock(base, bits)) throw new Error(`refusing non-public host ${ip} (${label})`);
  }
}

/**
 * Pull out an IPv4 address embedded in an IPv6 literal, if any.
 * Covers ::ffff:a.b.c.d and its hex form, ::ffff:0:a.b.c.d (IPv4-translated), and
 * 2002::/16 (6to4). Each of these reaches an IPv4 destination, so the IPv4 rules
 * are what must decide — a fix that special-cases only `::ffff:` is incomplete.
 */
function embeddedIPv4(ip: string): string | null {
  const hex = ip.toLowerCase();
  const dotted = hex.match(/::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const asHex = hex.match(/^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (asHex) {
    const hi = parseInt(asHex[1], 16), lo = parseInt(asHex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  const sixToFour = hex.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16), lo = parseInt(sixToFour[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  }
  return null;
}

/**
 * ALLOWLIST for IPv6: only global unicast (2000::/3) may be fetched, minus Teredo
 * (2001::/32), which tunnels to an obfuscated IPv4 endpoint.
 *
 * Allowlisting matters more than the specific exclusions — loopback (::1), the
 * unspecified address (::), unique-local (fc00::/7), link-local (fe80::/10) and
 * NAT64 (64:ff9b::/96) all fall outside 2000::/3 and are refused without needing
 * their own rule. A range nobody thought of fails closed by default.
 */
function assertPublicIPv6(ip: string): void {
  const first = ip.toLowerCase().split(":")[0];
  const head = first === "" ? 0 : parseInt(first, 16); // "::1" -> leading empty group
  if (head < 0x2000 || head > 0x3fff) {
    throw new Error(`refusing non-public host ${ip} (not global unicast 2000::/3)`);
  }
  if (/^2001:0{0,3}:/.test(ip.toLowerCase())) {
    throw new Error(`refusing non-public host ${ip} (Teredo tunnel 2001::/32)`);
  }
}

function assertFetchableImageHost(u: URL): void {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`refusing scheme ${u.protocol}`);

  // Strip one trailing FQDN-root dot BEFORE the name checks. "localhost." and
  // "metadata.google.internal." resolve perfectly well while failing an equality
  // or endsWith test — a bypass the previous string matching missed.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`refusing non-public host ${host}`);
  }

  // Classify IP literals by PARSING them, not by matching their text. The previous
  // eleven regexes tested the host string, so every IPv4-mapped IPv6 form walked
  // straight through: the URL parser rewrites ::ffff:127.0.0.1 to ::ffff:7f00:1
  // before any /^127\./ test can see it. Loopback, all RFC1918 ranges, and the
  // 169.254.169.254 metadata endpoint the old comment claimed to cover were all
  // reachable in mapped form, along with ::ffff:0:<v4>, CGNAT 100.64/10, 0.0.0.0/8
  // beyond the literal string, NAT64 and the unspecified address.
  const kind = isIP(host);
  if (kind === 4) {
    assertPublicIPv4(host);
  } else if (kind === 6) {
    const embedded = embeddedIPv4(host);
    // A tunnelled/mapped address must be judged on the IPv4 it actually reaches,
    // so ::ffff:8.8.8.8 stays allowed while ::ffff:127.0.0.1 does not.
    if (embedded) assertPublicIPv4(embedded);
    else assertPublicIPv6(host);
  }

  // NOTE, deliberately not overstated: this validates the LITERAL host. A DNS name
  // that resolves into private space is not caught here — that needs resolution-time
  // checking or network egress rules. Each redirect hop is re-validated, which
  // closes the redirect-to-private path but not DNS rebinding.
}

/** Identify by CONTENT, not by the URL's extension — the filename is attacker- or
 *  CDN-controlled and the CLI acts on the bytes. */
function sniffImageExt(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/**
 * Download a remote hero frame to a local temp file for `--start-image`.
 *
 * Hardened after the second-pass audit: the original followed redirects
 * anywhere, read the body unbounded into memory, and named the temp file from
 * the URL's extension without ever looking at the bytes. Now each redirect hop
 * is re-validated against the host rules, the read is capped at
 * START_IMAGE_MAX_BYTES, and the extension comes from the magic bytes — a
 * non-image body is refused rather than handed to the generator.
 *
 * Every failure returns null (the caller renders text-only). Conditioning is an
 * enhancement, so a bad frame must degrade the reel, never break it.
 */
export async function materializeStartImage(url: string): Promise<string | null> {
  try {
    let current = new URL(url);
    let res: Response | undefined;
    for (let hop = 0; hop <= START_IMAGE_MAX_REDIRECTS; hop++) {
      assertFetchableImageHost(current);
      res = await fetch(current, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`redirect ${res.status} without location`);
        current = new URL(loc, current); // resolved, then re-checked at the top of the next hop
        continue;
      }
      break;
    }
    if (!res) throw new Error("no response");
    if (res.status >= 300 && res.status < 400) throw new Error(`too many redirects (>${START_IMAGE_MAX_REDIRECTS})`);
    if (!res.ok) throw new Error(`fetch ${res.status}`);

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > START_IMAGE_MAX_BYTES) {
      throw new Error(`image too large (${declared} bytes declared)`);
    }
    // Read incrementally: content-length is a hint, not a guarantee, so the cap
    // has to hold against a body that just keeps coming.
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no response body");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > START_IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`image exceeded ${START_IMAGE_MAX_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    const buf = Buffer.concat(chunks);
    if (buf.byteLength === 0) throw new Error("empty image body");

    const ext = sniffImageExt(buf);
    if (!ext) throw new Error("body is not a JPEG/PNG/WebP image");

    const file = path.join(os.tmpdir(), `hf-start-${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`);
    await fs.promises.writeFile(file, buf);
    return file;
  } catch (err) {
    log.warn("start-image download refused/failed; rendering text-only", { url, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function generateReelClipVideo(req: string | { prompt: string; negativePrompt?: string; startImageUrl?: string }): Promise<string> {
  const prompt = typeof req === "string" ? req : combinePromptWithNegative(req.prompt, req.negativePrompt);
  const startImageUrl = typeof req === "string" ? undefined : req.startImageUrl;
  const binPath = await ensureHiggsfieldBinary();
  const { env, tempCredsFile } = await getSpawnEnv();

  // --start-image needs a UUID or a LOCAL FILE PATH. If conditioning is on and we
  // were handed a remote image URL, download it to a temp file first; on failure,
  // effectiveStartImage stays undefined and the clip renders text-only.
  const wantConditioning =
    !!startImageUrl &&
    process.env.REEL_IMAGE_CONDITIONING === "true" &&
    /^https?:\/\//i.test(startImageUrl) &&
    /\.(jpe?g|png|webp)([?#]|$)/i.test(startImageUrl);
  let localStartImage: string | null = null;
  let effectiveStartImage = startImageUrl;
  if (wantConditioning) {
    localStartImage = await materializeStartImage(startImageUrl!);
    effectiveStartImage = localStartImage ?? undefined;
  }
  const cleanupStartImage = () => {
    if (localStartImage) {
      const f = localStartImage;
      localStartImage = null;
      void fs.promises.unlink(f).catch(() => {});
    }
  };

  const conditioned = !!effectiveStartImage && process.env.REEL_IMAGE_CONDITIONING === "true";
  log.info("Generating Reel clip video via Higgsfield (seedance1_5)...", { prompt, imageConditioned: conditioned });

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      binPath,
      buildSeedanceArgs(prompt, { startImageUrl: effectiveStartImage }),
      {
        env: {
          ...env,
          HIGGSFIELD_INSTALL_METHOD: "npm",
          HIGGSFIELD_PACKAGE_MANAGER: "pnpm",
        }
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    // KILL the CLI child on timeout. Seedance is a single blocking call with no
    // resumable request-id (unlike Veo), so a caller that merely stops awaiting a
    // hung run leaves an ORPHAN paid job running — and a retry beside it is what
    // doubles the spend. Killing the process means any retry is a clean fresh
    // attempt, never an overlap.
    const CLI_TIMEOUT_MS = Math.max(60_000, Number(process.env.HIGGSFIELD_CLI_TIMEOUT_MS) || 6 * 60_000);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      cleanupStartImage();
      void persistRotatedCredentialsThenCleanup(tempCredsFile);
      reject(new Error(`Higgsfield CLI timed out after ${CLI_TIMEOUT_MS}ms — process killed to avoid an orphan paid job`));
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupStartImage();
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupStartImage();
      void persistRotatedCredentialsThenCleanup(tempCredsFile);
      if (code !== 0) {
        reject(new Error(`Higgsfield CLI exited with code ${code}. Stderr: ${stderr.trim()}`));
        return;
      }
      try {
        const url = parseResultUrl(stdout);
        resolve(url);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Probe Higgsfield account health via the CLI (`hf account status`). Read-only —
 * spends no credits. Surfacing this in the IG Settings panel prevents the silent
 * failure mode where STALE creds quietly kill autopost/reel generation.
 * - credsValid: the CLI session authenticated (exit 0).
 * - balanceCredits: best-effort parse of the remaining balance (the CLI's exact
 *   text isn't a stable contract, so this is regex-extracted; null if unparsed).
 */
export async function getHiggsfieldAccountHealth(): Promise<{
  credsValid: boolean;
  balanceCredits: number | null;
  raw: string;
}> {
  let binPath: string;
  try {
    binPath = await ensureHiggsfieldBinary();
  } catch (err) {
    return { credsValid: false, balanceCredits: null, raw: `binary unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  const { env, tempCredsFile } = await getSpawnEnv();

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(binPath, ["account", "status"], {
      env: { ...env, HIGGSFIELD_INSTALL_METHOD: "npm", HIGGSFIELD_PACKAGE_MANAGER: "pnpm" },
    });
    const finish = (credsValid: boolean) => {
      if (settled) return;
      settled = true;
      void persistRotatedCredentialsThenCleanup(tempCredsFile);
      const raw = `${stdout}${stderr}`.trim();
      const m = raw.match(/([\d,]+(?:\.\d+)?)\s*(?:credits?|\bcr\b)/i) || raw.match(/balance["':\s]+([\d,]+(?:\.\d+)?)/i);
      const parsed = m ? Number(m[1].replace(/,/g, "")) : NaN;
      resolve({ credsValid, balanceCredits: Number.isFinite(parsed) ? parsed : null, raw: raw.slice(0, 500) });
    };
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => finish(code === 0));
    child.on("error", () => finish(false));
    // Never hang the health panel — abort the probe after 15s.
    setTimeout(() => { try { child.kill(); } catch (_) {} finish(false); }, 15000);
  });
}

/**
 * Downloads multiple video files from URLs and stitches them using Ffmpeg
 */
export async function stitchVideos(videoUrls: string[]): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const localClips: string[] = [];
  const listFile = path.join(tempDir, `ffmpeg-concat-${Date.now()}.txt`);
  const outputFile = path.join(tempDir, `ffmpeg-out-${Date.now()}.mp4`);

  try {
    log.info(`Downloading ${videoUrls.length} clips for stitching...`);
    // Step 1: Download each clip
    for (let i = 0; i < videoUrls.length; i++) {
      const url = videoUrls[i];
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to download clip ${i + 1} from ${url}`);
      }
      const fileBuffer = Buffer.from(await res.arrayBuffer());
      const clipPath = path.join(tempDir, `clip-${Date.now()}-${i}.mp4`);
      fs.writeFileSync(clipPath, fileBuffer);
      localClips.push(clipPath);
    }

    // Step 2: Write ffmpeg concat file
    const concatLines = localClips.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");
    fs.writeFileSync(listFile, concatLines, "utf8");

    // Step 3: Run ffmpeg
    log.info("Stitching clips with ffmpeg...");
    await new Promise<void>((resolve, reject) => {
      const bin = process.env.FFMPEG_PATH || "ffmpeg";
      const child = spawn(bin, [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile.replace(/\\/g, "/"),
        "-c",
        "copy",
        "-y",
        outputFile.replace(/\\/g, "/")
      ], { shell: process.platform === "win32" && !process.env.FFMPEG_PATH });

      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}. Stderr: ${stderr}`));
        } else {
          resolve();
        }
      });
    });

    // Step 4: Read final video file
    const outputBuffer = fs.readFileSync(outputFile);
    return outputBuffer;

  } finally {
    // Step 5: Clean up all files
    cleanupTempFile(listFile);
    cleanupTempFile(outputFile);
    for (const clip of localClips) {
      cleanupTempFile(clip);
    }
  }
}
