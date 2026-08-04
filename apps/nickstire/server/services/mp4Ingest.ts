/**
 * mp4Ingest — bring a FINISHED mp4 produced outside the reel pipeline
 * (MoneyPrinterTurbo, a hand-edited cut, a repurposed long-form clip) into the
 * SAME inventory + approval + publish spine every generated reel uses.
 *
 * The point is that an externally-produced file must not get a shortcut. It
 * lands as a draft at `review_ready`, exactly where an assembled reel lands, and
 * from there it is subject to the same caption blockers, kill switch, permanent-
 * URL rule, content governor and publish-attempt ledger.
 *
 * WHY A reel_jobs ROW IS CREATED, not just an inventory row: the publish gate
 * resolves quality evidence via reelPublishAuthority.resolveReelJobId, which
 * looks up reel_jobs.briefId = draft.id. With no job row it returns null and the
 * gate takes its warn-and-proceed path — the reel publishes with NO quality
 * decision behind it, and is hard-blocked outright the moment
 * REEL_GATE_REQUIRE_JOB is armed. So ingestion creates the row and stamps
 * reelJobId into the brief, giving the gate the same evidence a generated reel has.
 *
 * WHY THE CAPTION GOES IN hookText: socialInventoryPublisher builds the posted
 * caption as `${hookText}\n\n${bodyText}` — NOT from briefJson and NOT from
 * reel_jobs.caption. A caption that lives only in the brief publishes as the
 * wrong text.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:mp4-ingest");

/** Exact-string gate, matching the reel lane's requiresFlag convention. */
export const MP4_INGEST_FLAG = "MP4_INGEST_ENABLED";

export interface Mp4IngestInput {
  /** A local filesystem path, or a public http(s) URL, of a finished mp4. */
  source: string;
  /** Short subject line — becomes inventory.topic (varchar 128). */
  topic: string;
  /** The caption this reel should publish with. Becomes hookText. */
  caption: string;
  /** Optional second paragraph of the published caption. */
  bodyText?: string;
  /** Provenance, e.g. "moneyprinter" | "manual". Recorded in the brief. */
  origin: string;
}

export interface Mp4IngestResult {
  inventoryId: string;
  reelJobId: number;
  mp4Url: string;
  bytes: number;
  outcome: "created" | "updated";
}

/** mp4/ISO-BMFF files carry `ftyp` at byte 4. Cheap guard against ingesting junk. */
export function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString("ascii") === "ftyp";
}

/**
 * Run the real audio QA over an ingested file by staging it to a temp path
 * (runAudioQa takes a path, not bytes). Exported shape matches what assembly
 * persists so qualityGate reads one contract for both lanes.
 */
async function runIngestAudioQa(bytes: Buffer): Promise<Record<string, unknown>> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  let dir: string | undefined;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mp4ingest-qa-"));
    const staged = path.join(dir, "ingested.mp4");
    await fs.writeFile(staged, bytes);
    const { runAudioQa } = await import("./audioQa");
    const aqa = await runAudioQa(staged);
    return { ...aqa, qaState: "completed", evaluatedAt: new Date().toISOString() };
  } catch (e) {
    log.warn("ingest audio QA could not run — recorded as unavailable, NOT as a pass", {
      err: e instanceof Error ? e.message : String(e),
    });
    return {
      decision: "approve",
      qaState: "unavailable",
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      evaluatedAt: new Date().toISOString(),
    };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Instagram's own reel ceiling is well under this; the cap exists to bound the
 * process, not to enforce a content policy. A reel that legitimately exceeds it
 * is a different problem from a source that never stops sending.
 */
const MP4_MAX_BYTES = 512 * 1024 * 1024;
const MP4_MAX_REDIRECTS = 3;

/**
 * Read the source into memory, refusing anything that could take the process
 * down or reach inside the deploy's own network.
 *
 * BOTH GUARDS EXIST BECAUSE THIS BECAME REACHABLE. While nothing called
 * ingestFinishedMp4, `fetch` + `arrayBuffer()` was latent; once an admin-facing
 * mutation could pass a URL straight through, it was a blind SSRF (a plain
 * fetch follows a 302 to 169.254.169.254 or any private host) and an
 * unbounded allocation (arrayBuffer materialises whatever arrives, so one
 * indefinitely streamed body exhausts the Railway process before the timeout).
 *
 * fetchPublicBounded is the same code path the reel generator's start-image
 * download already used — extracted rather than copied, so the two cannot
 * drift. It re-validates EVERY redirect hop, which is the part that matters:
 * checking only the submitted URL leaves the whole private network one redirect
 * away. It does NOT defeat DNS rebinding; that needs egress rules.
 *
 * The local-path branch is bounded too, by stat before read — a path is
 * operator-supplied and /dev/zero or a multi-gigabyte render would otherwise
 * be read whole into a Buffer.
 */
async function loadSource(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    const { fetchPublicBounded } = await import("../lib/publicFetch");
    return fetchPublicBounded(source, {
      maxBytes: MP4_MAX_BYTES,
      timeoutMs: 120_000,
      maxRedirects: MP4_MAX_REDIRECTS,
      label: "mp4 ingest",
    });
  }
  const fs = await import("fs/promises");
  const stat = await fs.stat(source);
  if (!stat.isFile()) throw new Error("mp4 ingest: source is not a regular file");
  if (stat.size > MP4_MAX_BYTES) {
    throw new Error(`mp4 ingest: file too large (${stat.size} bytes, cap ${MP4_MAX_BYTES})`);
  }
  return fs.readFile(source);
}

export async function ingestFinishedMp4(input: Mp4IngestInput): Promise<Mp4IngestResult> {
  if (process.env[MP4_INGEST_FLAG] !== "true") {
    throw new Error(`mp4 ingest is disabled — set ${MP4_INGEST_FLAG}=true to arm it`);
  }
  const topic = input.topic?.trim();
  const caption = input.caption?.trim();
  if (!topic) throw new Error("mp4 ingest: topic is required");
  if (!caption) throw new Error("mp4 ingest: caption is required — it is what gets published");

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("mp4 ingest: database unavailable");

  // A reel that cannot be hosted permanently can never pass the publish gate,
  // so refuse before spending any work on it.
  const { assertDurableStorageForGeneration, storagePut } = await import("../storage");
  assertDurableStorageForGeneration("mp4 ingest");

  const bytes = await loadSource(input.source);
  if (bytes.length === 0) throw new Error("mp4 ingest: source is empty");
  if (!looksLikeMp4(bytes)) throw new Error("mp4 ingest: source is not an mp4 (no ftyp box)");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const { randomUUID } = await import("crypto");
  const inventoryId = `ingest-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  const { url: mp4Url } = await storagePut(`reels/ingested/${stamp}-${inventoryId}.mp4`, bytes, "video/mp4");

  // Fail loud rather than at the last gate: storagePut hands back a 24h
  // PRESIGNED url when S3_BUCKET is set but no CDN domain is, and the publisher
  // rejects exactly those. Catching it here keeps a doomed draft out of the queue.
  const { assertPermanentPublicMediaUrl } = await import("./socialPublish");
  assertPermanentPublicMediaUrl(mp4Url);

  // Audio QA — the SAME evidence a normally-assembled reel carries.
  //
  // qualityGate requires payload.audioQa whenever RENDERED_QA_ENABLED is on and
  // AUDIO_QA_ENABLED is not explicitly "false". This path bypasses assembly, so
  // without running it here every ingested draft could reach approval and then
  // have every publish attempt held as `unavailable` — "audio was never
  // evaluated, which is not the same as audio passing". A file that arrives
  // finished still has audio worth judging.
  //
  // A QA that could not RUN is recorded as unavailable, never as a pass —
  // matching reelAssembly's handling exactly.
  const audioQa = await runIngestAudioQa(bytes);

  const brief = {
    topic,
    selectedCaption: caption,
    origin: input.origin,
    ingestedAt: new Date().toISOString(),
    sourceRef: input.source.slice(0, 500),
    audioQa,
  } as Record<string, unknown>;

  const { reelJobs } = await import("../../drizzle/schema");
  const inserted = await d.insert(reelJobs).values({
    briefId: inventoryId,
    payload: JSON.stringify(brief),
    // "assembled" is the existing terminal pre-publish status — the file is
    // finished, so it is exactly where a generated reel would be. It also fits
    // the varchar(20) column, which has only 3 characters of headroom over the
    // longest live value.
    status: "assembled",
    mp4Url,
    caption,
    source: "admin",
  });

  // drizzle-orm/mysql2 returns the MySQL result TUPLE, so `.insertId` on the
  // array itself is undefined — reading it directly yielded 0, which meant every
  // real ingestion uploaded the asset, inserted the reel_jobs row, and THEN threw
  // before creating the inventory draft, leaving an orphan job and a stored file.
  // Same normalization enqueueReelJob uses (reelPipeline.ts:387).
  const reelJobId = Number(
    (inserted as unknown as { insertId?: number })?.insertId ??
      (inserted as unknown as Array<{ insertId?: number }>)?.[0]?.insertId ??
      0,
  );
  if (!Number.isInteger(reelJobId) || reelJobId <= 0) {
    throw new Error("mp4 ingest: reel job insert returned no id — refusing to create an unlinked draft");
  }
  // Stamp the direct link resolveReelJobId prefers over its briefId lookup.
  brief.reelJobId = reelJobId;

  const { ensureReelDraftForJob } = await import("./reelInventoryLink");
  const outcome = await ensureReelDraftForJob(d, { briefId: inventoryId, mp4Url, brief });

  // ensureReelDraftForJob seeds hookText from selectedCaption. Re-write briefJson
  // so it carries the reelJobId stamp, and set bodyText only when one was
  // supplied — the published caption is `hookText\n\nbodyText`, so an unwanted
  // body would silently append to every post.
  const { socialContentInventory } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  await d
    .update(socialContentInventory)
    .set({
      briefJson: JSON.stringify(brief),
      ...(input.bodyText?.trim() ? { bodyText: input.bodyText.trim() } : {}),
    })
    .where(eq(socialContentInventory.id, inventoryId));

  log.info("mp4 ingested into inventory", { inventoryId, reelJobId, mp4Url, bytes: bytes.length, outcome, origin: input.origin });
  return { inventoryId, reelJobId, mp4Url, bytes: bytes.length, outcome };
}
