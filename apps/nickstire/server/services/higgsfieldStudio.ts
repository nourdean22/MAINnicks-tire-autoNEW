import { sniffImageMime } from "../lib/imageSignature";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../lib/logger";
import { ensureHiggsfieldBinary } from "./higgsfieldBinary";
import { REEL_OUTPUT_RULES } from "../../client/src/lib/facelessReelStudio";

const log = createLogger("services:higgsfield-studio");

let cachedHiggsfieldCredentialsJson: string | null = null;
let credentialsLoadAttempted = false;

export function clearRuntimeHiggsfieldCache(): void {
  cachedHiggsfieldCredentialsJson = null;
  credentialsLoadAttempted = false;
}

/**
 * How stale the keepalive's last verdict may be before it stops counting as
 * evidence. The job runs every 15 minutes, so an hour tolerates a few missed
 * ticks; past that, the KEEPALIVE ITSELF is not running and its last "healthy"
 * says nothing about now.
 */
const KEEPALIVE_FRESH_WINDOW_MS = 60 * 60 * 1000;
const KEEPALIVE_JOB = "higgsfield-session-keepalive";

/** Written into the keepalive's failure message when Higgsfield itself was down. */
export const HIGGSFIELD_VENDOR_UNAVAILABLE = "vendor unavailable";

/**
 * True when a failed `hf account status` says Higgsfield was unreachable
 * (5xx, 429, network error) rather than that the session is invalid. Only a
 * session failure means re-login; an outage clears on its own.
 */
export function isHiggsfieldVendorOutage(raw: string): boolean {
  return /HTTP (5\d\d|429)\b|\b(Service Unavailable|Bad Gateway|Gateway Time-?out|Too Many Requests)\b|\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b|socket hang up/i.test(raw);
}

/**
 * Is the stored Higgsfield session actually WORKING — as opposed to merely
 * present?
 *
 * `getHiggsfieldCredentialsJson` returns the stored blob without parsing it, so
 * an EXPIRED session is indistinguishable from a live one at every presence
 * check in this codebase. That is not a hypothetical: the session expired on
 * 2026-07-31 while `socialDeliveryIssues` kept reporting `generatorConfigured:
 * true` and reels kept failing at the CLI.
 *
 * Liveness is already measured — `higgsfield-session-keepalive` runs
 * `getHiggsfieldAccountHealth()` every 15 minutes and THROWS on an invalid
 * session, so its verdict is durably recorded in `cron_log`. This reads that row
 * instead of spawning the CLI, because callers are request-path display surfaces
 * and a per-render subprocess would be far worse than the problem.
 *
 * Returns `healthy: null` — never `false` — when the answer is not knowable:
 * no row, an unreadable DB, or a verdict too old to vouch for. Callers map that
 * to `unknown`, so a blind spot never renders as a clean bill.
 */
export async function higgsfieldSessionHealth(): Promise<{
  healthy: boolean | null;
  reason: string;
  checkedAt: Date | null;
}> {
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) return { healthy: null, reason: "database unavailable", checkedAt: null };

    const { cronLog } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await d
      .select({ status: cronLog.status, startedAt: cronLog.startedAt, errorMessage: cronLog.errorMessage })
      .from(cronLog)
      .where(eq(cronLog.jobName, KEEPALIVE_JOB))
      .orderBy(desc(cronLog.startedAt))
      .limit(1);

    const last = rows[0];
    if (!last) return { healthy: null, reason: `${KEEPALIVE_JOB} has never run`, checkedAt: null };

    const startedAt = last.startedAt instanceof Date ? last.startedAt : new Date(last.startedAt as unknown as string);
    const ageMs = Date.now() - startedAt.getTime();
    if (!Number.isFinite(ageMs) || ageMs > KEEPALIVE_FRESH_WINDOW_MS) {
      // The keepalive stopping is itself a fault, but it is a DIFFERENT fault
      // from an expired session, and reporting a stale pass as "healthy" is how
      // the 526-failure blind spot lasted four days.
      return {
        healthy: null,
        reason: `${KEEPALIVE_JOB} last ran too long ago to vouch for the session`,
        checkedAt: startedAt,
      };
    }

    if (last.status === "failed" && last.errorMessage?.includes(HIGGSFIELD_VENDOR_UNAVAILABLE)) {
      // The keepalive could not REACH Higgsfield, so it proved nothing about
      // the session. Unknown, not dead: a vendor blip must not cancel a reel
      // batch the way a revoked login does (2026-10-03, HTTP 503 at 00:50Z).
      return { healthy: null, reason: last.errorMessage.slice(0, 200), checkedAt: startedAt };
    }
    if (last.status === "failed") {
      return {
        healthy: false,
        reason: last.errorMessage?.slice(0, 200) || "keepalive reported an invalid session",
        checkedAt: startedAt,
      };
    }
    return { healthy: true, reason: "keepalive refreshed the session", checkedAt: startedAt };
  } catch (err) {
    log.warn("could not read Higgsfield keepalive history", { err: err instanceof Error ? err.message : String(err) });
    return { healthy: null, reason: "keepalive history unreadable", checkedAt: null };
  }
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

/**
 * Run an arbitrary READ-ONLY Higgsfield CLI command with correct credential
 * handling, and hand back its raw output.
 *
 * THIS EXISTS BECAUSE ROLLING YOUR OWN KILLS THE SESSION. Every CLI
 * invocation may rotate the token — the refresh token is single-use, and the
 * CLI writes its successor into whatever credentials file it was pointed at.
 * A caller that writes its own temp file, runs the CLI, and deletes the temp
 * file has just thrown away the ONLY copy of the live token, leaving
 * app_secret_kv holding a spent one. The session then reads "Session expired"
 * and needs a human device-login to recover.
 *
 * That is not hypothetical: it happened 2026-08-21 during the Higgsfield
 * stock-fallback remediation, checking `account transactions` from a
 * hand-rolled script, and cost the operator a manual re-login. It is the same
 * failure the file header records from 2026-07-16. The fix both times was the
 * same dance — getSpawnEnv() to materialise the current credential, then
 * persistRotatedCredentialsThenCleanup() to write any rotated successor BACK
 * before deleting. Both are module-private, so anyone outside this file
 * previously had to reimplement them, which is precisely how it got
 * reimplemented wrong. Use this instead.
 *
 * Read-only commands only. That is ENFORCED below, not merely documented: the
 * name is a safety claim on an exported symbol, and a claim the code does not
 * keep is worse than no claim — a future caller would reasonably trust it to
 * refuse a billable subcommand. Generation goes through generateReelClipVideo,
 * which has its own accounting, budget reservation and retry rules.
 */
const HIGGSFIELD_READ_ONLY_COMMANDS: ReadonlyArray<readonly string[]> = [
  ["account", "status"],
  ["account", "transactions"],
  ["generate", "list"],
  ["generate", "get"],
  ["model", "list"],
  ["workflow", "list"],
];

export async function runHiggsfieldCliReadOnly(
  args: string[],
  timeoutMs = 30_000,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const allowed = HIGGSFIELD_READ_ONLY_COMMANDS.some((cmd) => cmd.every((part, i) => args[i] === part));
  if (!allowed) {
    const shown = HIGGSFIELD_READ_ONLY_COMMANDS.map((c) => c.join(" ")).join(", ");
    return {
      ok: false,
      stdout: "",
      stderr: `runHiggsfieldCliReadOnly refuses "${args.join(" ")}" — allowed read-only commands are: ${shown}. Generation must go through generateReelClipVideo so it is budgeted and accounted.`,
      code: null,
    };
  }
  let binPath: string;
  try {
    binPath = await ensureHiggsfieldBinary();
  } catch (err) {
    return { ok: false, stdout: "", stderr: `binary unavailable: ${err instanceof Error ? err.message : String(err)}`, code: null };
  }
  const { env, tempCredsFile } = await getSpawnEnv();

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(binPath, args, {
      env: { ...env, HIGGSFIELD_INSTALL_METHOD: "npm", HIGGSFIELD_PACKAGE_MANAGER: "pnpm" },
    });
    // AWAITED, unlike the fire-and-forget `void` calls elsewhere in this file:
    // persisting the rotation is the entire point of this helper, so it must
    // finish before the promise resolves and the process is free to exit.
    const finish = async (code: number | null) => {
      if (settled) return;
      settled = true;
      await persistRotationBounded(tempCredsFile);
      resolve({ ok: code === 0, stdout, stderr, code });
    };
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => void finish(code));
    child.on("error", (err) => { stderr += String(err); void finish(null); });
    setTimeout(() => {
      if (settled) return;
      try { child.kill(); } catch { /* already gone */ }
      void finish(null);
    }, timeoutMs);
  });
}

/**
 * How long the rotation write may take before we give up and settle anyway.
 * The write is one indexed upsert; anything beyond this means the DB is in
 * trouble, not that the write is slow.
 */
const ROTATION_PERSIST_TIMEOUT_MS = 15_000;

/**
 * Persist the rotated credential, but never let it hang the caller.
 *
 * Awaiting the raw persist (added 2026-08-21 so short-lived scripts stop
 * discarding the rotated token) introduced a worse failure mode, caught by
 * pre-merge review: the CLI handlers `clearTimeout(timer)` BEFORE awaiting, so
 * the function's own 6-minute guard is already disarmed at that point. The
 * mysql2 pool is configured `waitForConnections: true` with no acquire or
 * query timeout, so a saturated pool makes that await block indefinitely — and
 * the generation it is blocking has already SUCCEEDED and already been paid
 * for. An unbounded await there converts a healthy paid clip into a hung job.
 *
 * Bounded instead. If the deadline is hit we log loudly and settle: losing a
 * rotation costs a re-login, while hanging the reel pipeline costs every reel
 * behind it. The persist itself never throws (it has its own try/catch), so a
 * rejection here is always the deadline.
 */
async function persistRotationBounded(tempCredsFile: string | null): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      persistRotatedCredentialsThenCleanup(tempCredsFile),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("rotation persist exceeded its deadline")), ROTATION_PERSIST_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    log.error(
      "could not persist the rotated Higgsfield credential within the deadline — settling anyway; the session may need a re-login (see docs/runbooks/higgsfield-session.md)",
      { err: err instanceof Error ? err.message : String(err) },
    );
  } finally {
    if (timer) clearTimeout(timer);
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

    child.on("close", async (code) => {
      // AWAITED — see getHiggsfieldAccountHealth's finish() for why. A caller
      // that exits right after this settles would otherwise discard the CLI's
      // rotated token and kill the session.
      await persistRotationBounded(tempCredsFile);
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

    // A spawn that never starts (ENOENT on the binary, EACCES, fork failure)
    // emits 'error', NOT 'close'. With no listener, Node throws it as an
    // unhandled 'error' event — and lib/logger.ts's uncaughtException handler
    // calls process.exit(1), so a failed carousel render would take the whole
    // Express server down with it. Both sibling spawns in this file already
    // had this listener; this one did not. Found by pre-merge review
    // 2026-08-21 (pre-existing, but in the handler block this change touched).
    child.on("error", async (err) => {
      await persistRotationBounded(tempCredsFile);
      reject(new Error(`Higgsfield CLI failed to start: ${err instanceof Error ? err.message : String(err)}`));
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
    // Derived, not a literal: this is the request that MAKES the clip whose
    // length reelAssembly then clamps to. A bare "4" here meant the documented
    // cap and the actual ask could drift apart silently.
    "--duration", String(REEL_OUTPUT_RULES.maxClipSeconds),
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
 * SSRF + size guards moved to lib/publicFetch.ts when mp4Ingest became the
 * SECOND caller that fetches an operator-supplied URL. Every rule is unchanged
 * - extracted, not rewritten - so the two callers cannot drift apart on which
 * IPv4 blocks are refused or whether each redirect hop is re-validated.
 */

/** Identify by CONTENT, not by the URL's extension — the filename is attacker- or
 *  CDN-controlled and the CLI acts on the bytes. The sniffer itself is shared
 *  with the upload routes (lib/imageSignature.ts); the CLI takes only these three. */
function sniffImageExt(buf: Buffer): "jpg" | "png" | "webp" | null {
  const mime = sniffImageMime(buf);
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : null;
}

/**
 * Download a remote hero frame to a local temp file for `--start-image`.
 *
 * Hardened after the second-pass audit: the original followed redirects
 * anywhere, read the body unbounded into memory, and named the temp file from
 * the URL's extension without ever looking at the bytes. Each redirect hop is
 * re-validated against the host rules and the read is capped at
 * START_IMAGE_MAX_BYTES — both now live in lib/publicFetch.ts, shared with
 * mp4Ingest — and the extension comes from the magic bytes, so a non-image body
 * is refused rather than handed to the generator.
 *
 * Every failure returns null (the caller renders text-only). Conditioning is an
 * enhancement, so a bad frame must degrade the reel, never break it.
 */
export async function materializeStartImage(url: string): Promise<string | null> {
  try {
    const { fetchPublicBounded } = await import("../lib/publicFetch");
    const buf = await fetchPublicBounded(url, {
      maxBytes: START_IMAGE_MAX_BYTES,
      timeoutMs: 20_000,
      maxRedirects: START_IMAGE_MAX_REDIRECTS,
      label: "start image",
    });
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

/** How the keepalive's last verdict reads. `live === null` means UNKNOWN. */
export type HiggsfieldSessionLiveness = {
  /** true = proven live, false = proven dead, null = could not tell. */
  live: boolean | null;
  /** Whether a credentials blob exists at all - PRESENCE, not liveness. */
  credsPresent: boolean;
  /** Account credit balance from the last successful keepalive, if it logged one. */
  balanceCredits: number | null;
  /** When the verdict was produced. */
  checkedAt: Date | null;
  reason: string;
};

/**
 * Older than this and the last keepalive verdict is not evidence any more. DERIVED
 * from KEEPALIVE_FRESH_WINDOW_MS above so the two operator surfaces that read the
 * same cron_log evidence cannot contradict each other (P2 review, #1668: this was
 * an independent 45 while higgsfieldSessionHealth used 60, so a 46-59 min old row
 * read "unknown" on one card and "healthy" on the other). In MINUTES because the
 * comparison is done by the DATABASE (TIMESTAMPDIFF), not from a driver-parsed
 * Date - see the query below for why that distinction is load-bearing.
 */
const KEEPALIVE_STALE_MINUTES = KEEPALIVE_FRESH_WINDOW_MS / 60_000;

/**
 * SESSION LIVENESS FOR HEALTH SURFACES, read from the keepalive's own record.
 *
 * WHY THIS EXISTS. Health cards used to report `!!getHiggsfieldCredentialsJson()` -
 * a PRESENCE check - as though it were liveness. A revoked refresh token leaves the
 * blob perfectly intact, which is exactly how a dead session read as "configured"
 * for four days (#1628). The same shape then reappeared as `dbReachable` on the API
 * key lane (P2, PR #1653): a truthy handle proving only that a value was SET.
 *
 * WHY cron_log AND NOT A LIVE CLI CALL. `higgsfieldSessionHealth()` spawns the
 * Higgsfield binary, which costs seconds - unacceptable on a page-load query, and
 * the reason the existing button is behind an explicit refresh. The keepalive
 * already performs a credit-free `hf account status` every 15 minutes and records
 * the verdict, so the evidence exists; reading it costs one indexed lookup
 * (idx_cron_job) and no vendor round-trip. It also carries the credit balance,
 * which nothing else in the app can see - the API lane has no readable balance
 * endpoint (every GET returns 405).
 *
 * THREE STATES, DELIBERATELY. A missing or STALE row is `null`, never `false`:
 * "the keepalive has not run" and "the session is dead" need opposite responses
 * from the operator, and collapsing them is the defect this whole helper exists to
 * stop repeating.
 */
export async function higgsfieldSessionLiveness(): Promise<HiggsfieldSessionLiveness> {
  const credsPresent = !!(await getHiggsfieldCredentialsJson());
  const base = { credsPresent, balanceCredits: null as number | null, checkedAt: null as Date | null };
  try {
    const { db } = await import("../lib/db-helper");
    const d = await db();
    if (!d) {
      return { ...base, live: null, reason: "no database handle - cannot read the keepalive verdict" };
    }
    const { cronLog } = await import("../../drizzle/schema");
    const { eq, desc, sql } = await import("drizzle-orm");
    // AGE IS COMPUTED BY THE DATABASE, deliberately. mysql2 parses DATETIME columns
    // in the connection's LOCAL zone, and this DB returns UTC - so a parsed
    // `startedAt` lands 4 hours in the FUTURE on an ET machine (measured
    // 2026-08-18: DB NOW() read 20:10 while true UTC was 16:10). Deriving age from
    // `Date.now() - startedAt` therefore yields a NEGATIVE number, and every stale
    // verdict up to the offset would have read as fresh - the exact opposite of what
    // this staleness guard exists to do. TIMESTAMPDIFF against UTC_TIMESTAMP() is
    // evaluated server-side and cannot be skewed by the driver.
    const rows = await d
      .select({
        status: cronLog.status,
        details: cronLog.details,
        errorMessage: cronLog.errorMessage,
        startedAt: cronLog.startedAt,
        ageMinutes: sql<number>`TIMESTAMPDIFF(MINUTE, ${cronLog.startedAt}, UTC_TIMESTAMP())`,
      })
      .from(cronLog)
      .where(eq(cronLog.jobName, "higgsfield-session-keepalive"))
      .orderBy(desc(cronLog.startedAt))
      .limit(1);
    const row = (rows as {
      status: string;
      details: string | null;
      errorMessage: string | null;
      startedAt: Date;
      ageMinutes: number | string | null;
    }[])[0];
    if (!row) {
      return { ...base, live: null, reason: "the keepalive has never recorded a run" };
    }
    const checkedAt = row.startedAt instanceof Date ? row.startedAt : new Date(row.startedAt);
    // MySQL may return the computed column as a string; Number() covers both. A null
    // or unparseable age is UNKNOWN rather than assumed-fresh, because assuming
    // fresh is how a stale verdict becomes a confident one.
    // Number(null) === 0, NOT NaN - so a null age would read as "0 minutes old",
    // i.e. maximally fresh and confident. Caught by the test for this exact case.
    const rawAge = row.ageMinutes;
    const ageMinutes = rawAge === null || rawAge === undefined || rawAge === "" ? Number.NaN : Number(rawAge);
    const ageKnown = Number.isFinite(ageMinutes);
    // The keepalive logs ", N credits" on success - the only balance this app can see.
    // 2026-08-20 · Higgsfield stock-fallback remediation: this was integer-only
    // (`\d+`), so a real decimal balance like "2388.62 credits" never matched at
    // all here and silently fell through to whatever OTHER bare integer sat
    // nearest "credits" in the details text - measured live: this read 62 while
    // `hf account status` read 2388.62, a ~38x discrepancy. Matches
    // getHiggsfieldAccountHealth's own working pattern below.
    const credits = /([\d,]+(?:\.\d+)?)\s*credits/.exec(row.details ?? "");
    const balanceCredits = credits ? Number(credits[1].replace(/,/g, "")) : null;
    if (!ageKnown || ageMinutes > KEEPALIVE_STALE_MINUTES) {
      return {
        credsPresent,
        balanceCredits,
        checkedAt,
        live: null,
        reason: ageKnown
          ? `last keepalive verdict is ${ageMinutes} min old (stale past ${KEEPALIVE_STALE_MINUTES} min) - UNKNOWN, not dead`
          : "could not compute the age of the last keepalive verdict - UNKNOWN, not dead",
      };
    }
    // A NON-FAILED ROW IS NOT PROOF OF LIFE (P1 review, #1668). The keepalive
    // handler returns NORMALLY when no credentials are stored ("no higgsfield
    // creds - skip"), and the scheduler records that as completed - so "any
    // non-failed row is live" declared a credential-LESS lane alive. live: true
    // therefore requires all three: a non-failed row, evidence the keepalive
    // actually REFRESHED a session (its success detail always starts
    // "session refreshed"), and credentials still present NOW - a blob deleted
    // after the last successful tick must not inherit that tick's verdict.
    const detail = row.details ?? "";
    if (row.status === "failed" && `${row.errorMessage ?? ""}${row.details ?? ""}`.includes(HIGGSFIELD_VENDOR_UNAVAILABLE)) {
      // Higgsfield was unreachable - the session was not tested (2026-10-03).
      return {
        credsPresent,
        balanceCredits,
        checkedAt,
        live: null,
        reason: "Higgsfield was unreachable at the last keepalive - UNKNOWN, not dead",
      };
    }
    if (row.status === "failed") {
      return {
        credsPresent,
        balanceCredits,
        checkedAt,
        live: false,
        reason: (row.details ?? row.errorMessage ?? "keepalive failed").slice(0, 200),
      };
    }
    if (/no higgsfield creds/i.test(detail)) {
      // The keepalive TESTED NOTHING - it skipped. Unknown, not alive.
      return {
        credsPresent,
        balanceCredits,
        checkedAt,
        live: null,
        reason: "keepalive skipped - no credentials were stored, so nothing was tested",
      };
    }
    if (!/session refreshed/i.test(detail)) {
      // Completed, but not a refresh receipt this helper recognises. Unknown
      // beats a confident guess about an unrecognised row shape.
      return {
        credsPresent,
        balanceCredits,
        checkedAt,
        live: null,
        reason: `keepalive ${row.status} without a refresh receipt: ${detail.slice(0, 140) || "(no detail)"}`,
      };
    }
    if (!credsPresent) {
      return {
        credsPresent,
        balanceCredits,
        checkedAt,
        live: null,
        reason: "last keepalive refreshed a session, but the credentials blob is GONE now - the verdict predates the removal",
      };
    }
    return {
      credsPresent,
      balanceCredits,
      checkedAt,
      live: true,
      reason: `keepalive ${row.status}${balanceCredits != null ? `, ${balanceCredits} credits` : ""}`,
    };
  } catch (err) {
    // A read failure is UNKNOWN. Reporting it as dead would send the operator to
    // re-login over a database blip.
    return { ...base, live: null, reason: `could not read the keepalive verdict: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function generateReelClipVideo(req: string | {
  prompt: string;
  negativePrompt?: string;
  startImageUrl?: string;
  higgsfieldPollTimeoutMs?: number;
  onHiggsfieldRequestSubmitted?: (requestId: string) => Promise<void> | void;
}): Promise<string> {
  const prompt = typeof req === "string" ? req : combinePromptWithNegative(req.prompt, req.negativePrompt);
  const startImageUrl = typeof req === "string" ? undefined : req.startImageUrl;
  const higgsfieldPollTimeoutMs = typeof req === "string" ? undefined : req.higgsfieldPollTimeoutMs;
  const onHiggsfieldRequestSubmitted = typeof req === "string" ? undefined : req.onHiggsfieldRequestSubmitted;

  // API-KEY LANE FIRST, CLI SESSION AS FALLBACK.
  //
  // ⚠️ READ THIS BEFORE PROVISIONING THE API KEYS. This comment used to say the
  // API key "never expires and has no session to revoke", and recommended
  // setting the two env vars as the escape from the "fragile" CLI lane. That
  // recommendation was a TRAP, and it nearly cost the operator money on top of a
  // subscription he already pays for. Corrected 2026-08-29 against his live
  // billing pages, not against docs:
  //
  //   HIGGSFIELD RUNS TWO SEPARATE LEDGERS WITH SEPARATE BILLING.
  //   · consumer / Ultra  — 1,934.62 credits, paid subscription, ACTIVE. This
  //     is the ledger the CLI session lane spends, and what `hf account status`
  //     reads.
  //   · Higgsfield Cloud API (this lane, Authorization: Key ID:SECRET) — ZERO
  //     credits. No payment method saved, no purchase history, 0 API calls
  //     lifetime, auto top-up disabled. cloud.higgsfield.ai is a DISTINCT PAID
  //     PRODUCT and the Ultra subscription does not fund it. Two API keys
  //     already exist on the account with 0 lifetime calls — someone walked
  //     this road before and stopped at the same wall.
  //
  // So the API lane is not the durable escape hatch; it is an unfunded lane that
  // authenticates cleanly and then fails at generation on a zero balance. The
  // "fragile" CLI session lane is THE ONLY LANE FUNDED BY THE SUBSCRIPTION, and
  // that is why reel-pipeline is staged behind the manual trigger rather than
  // moved onto API keys (cron/registry-tier-map.ts MANUAL_TRIGGER_STAGED).
  //
  // The preference order below is still correct — if Cloud API credits are ever
  // PURCHASED, setting the two env vars switches lanes with no caller change.
  // Buy the credits first; the env vars are not the fix on their own.
  //
  // Falls back to the CLI on ANY API-lane error — including a submit failure, a
  // poll failure, or a genuine generation failure reported by Higgsfield's own
  // "failed" status — rather than propagating it. This mirrors the CLI lane's
  // own tolerance for a transient (see generateReelClipVideoViaApi's poll-retry
  // comment) one level up: an API-side outage must cost one clip's extra latency
  // via the CLI, never the whole reel, exactly as an occasional CLI failure
  // already does not fail the whole pipeline (reelPipeline retries per-beat).
  // The one exception is credentials genuinely wrong (401/403 on the FIRST
  // call) — that is reported immediately rather than masked by a fallback that
  // will only fail the same way every time and burn a CLI attempt for nothing.
  const { getHiggsfieldApiCredentials, generateReelClipVideoViaApi, HiggsfieldApiSubmittedError } =
    await import("./higgsfieldApiClient");
  if (await getHiggsfieldApiCredentials()) {
    try {
      return await generateReelClipVideoViaApi(
        { prompt, startImageUrl },
        { timeoutMs: higgsfieldPollTimeoutMs, onSubmitted: onHiggsfieldRequestSubmitted },
      );
    } catch (err) {
      // THE FALLBACK IS ONLY SAFE BEFORE SUBMIT. Once a generation is submitted
      // Higgsfield may bill for it, and DoP has no resumable handle — so
      // generating the same clip again on the CLI lane pays TWICE for one beat.
      // That is the recorded history of this exact vendor ("re-submitting is
      // what doubled the paid spend on every timeout"), which is why the CLI
      // path below KILLS its child on timeout instead of abandoning it. A
      // blanket catch here would have reintroduced that bug wearing a
      // friendlier face, and the render-spend gate is what surfaced it.
      //
      // Pre-submit failures (bad key, DNS, connect timeout, a non-2xx submit)
      // spent nothing, so those DO fall through and cost only latency.
      if (err instanceof HiggsfieldApiSubmittedError) {
        log.error(
          "Higgsfield API generation was SUBMITTED then failed — NOT falling back, to avoid paying twice for one clip",
          { requestId: err.requestId, err: err.message },
        );
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Higgsfield API lane failed BEFORE submit — falling back to CLI session lane (nothing was spent)", { err: msg });
      // Falls through to the CLI path below.
    }
  }
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
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      cleanupStartImage();
      // AWAITED — a timed-out generation still rotated the token, and losing
      // that successor kills the session for everything after it.
      await persistRotationBounded(tempCredsFile);
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

    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupStartImage();
      // AWAITED — this is the reel generation path, driven by scripts that
      // exit as soon as the last beat settles. Dropping that final rotation
      // is how a batch run ends with a dead session.
      await persistRotationBounded(tempCredsFile);
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
    // AWAITED, not `void`. The rotation write is a DB round-trip; resolving
    // before it lands means a SHORT-LIVED CALLER can exit first and destroy
    // the session.
    //
    // Measured twice on 2026-08-21, both times while merely CHECKING health
    // from a script: `await getHiggsfieldAccountHealth(); process.exit(0)`
    // returns the instant resolve() fires, and process.exit does not wait for
    // pending promises — so the CLI's rotated successor was dropped on the
    // floor and app_secret_kv kept the spent token. The next keepalive tick
    // then reported "Session expired" and the operator had to device-login
    // again. The long-running server never showed this because there the
    // fire-and-forget promise always got to finish.
    //
    // A health probe must not be able to kill the thing it is probing.
    const finish = async (credsValid: boolean) => {
      if (settled) return;
      settled = true;
      await persistRotationBounded(tempCredsFile);
      const raw = `${stdout}${stderr}`.trim();
      const m = raw.match(/([\d,]+(?:\.\d+)?)\s*(?:credits?|\bcr\b)/i) || raw.match(/balance["':\s]+([\d,]+(?:\.\d+)?)/i);
      const parsed = m ? Number(m[1].replace(/,/g, "")) : NaN;
      resolve({ credsValid, balanceCredits: Number.isFinite(parsed) ? parsed : null, raw: raw.slice(0, 500) });
    };
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => void finish(code === 0));
    child.on("error", () => void finish(false));
    // Never hang the health panel — abort the probe after 15s.
    setTimeout(() => { try { child.kill(); } catch (_) {} void finish(false); }, 15000);
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
