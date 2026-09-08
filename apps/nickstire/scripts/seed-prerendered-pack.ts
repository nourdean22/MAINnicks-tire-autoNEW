/**
 * Seed an approved rotation pack as the cron's OWN daily job, with clips that
 * already exist, so nothing is regenerated.
 *
 * WHY THIS SHAPE. The daily cron looks its job up by `briefId = autopost-<date>`
 * and ADOPTS an existing row (dailyReelPost.ts: `if (!job) job = todaysJob`);
 * the generation stage RESUMES per beat, skipping any index whose clip already
 * exists (reelPipeline.ts ~:893). So a job enqueued through the real
 * `enqueueReelJob` — every preflight, the episode contract, the governor
 * reservation — with `clipUrlsJson` pre-loaded is rendered by the pipeline
 * exactly as if it had generated the clips itself, minus the credits.
 *
 * NOT A BYPASS. Nothing here writes a status, skips a gate, or touches the
 * rotation cursor. The cursor advances through the normal publish path because
 * the payload carries `approvedPackSlug`, which is why packs must be seeded IN
 * ROTATION ORDER. The governor caps enqueues at maxFeedPostsPerDay (2); a third
 * seed in one day throws GovernorDenial by design.
 *
 * DRY RUN BY DEFAULT: without --execute this process builds and preflights every
 * brief and EXITS BEFORE OPENING A DATABASE CONNECTION.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/seed-prerendered-pack.ts \
 *       --map <pack-clips.final.json> --date 2026-09-08 --slug 2026-08-17-balance-vs-alignment [--execute]
 */
import { readFileSync } from "node:fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const execute = process.argv.includes("--execute");
// --allow-generate: seed WITHOUT clips. The in-container generation stage then
// renders every beat on the live session, inside the ledger's daily budget
// (policy.limits.maxGenerationCostPerDayUsd) — the governed way to spend credits.
const allowGenerate = process.argv.includes("--allow-generate");
const mapPath = arg("--map");
const date = arg("--date");
const slug = arg("--slug");
if ((!mapPath && !allowGenerate) || !date || !slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: (--map <json> | --allow-generate) --date YYYY-MM-DD --slug <pack-slug> [--execute]");
  process.exit(2);
}

async function main() {
  let urls: string[] = [];
  if (!allowGenerate) {
    const map = JSON.parse(readFileSync(mapPath!, "utf8")) as Record<string, { urls: (string | null)[]; complete: boolean }>;
    const entry = map[slug];
    if (!entry) throw new Error(`no clips mapped for ${slug}`);
    if (!entry.complete) throw new Error(`${slug} is not complete — refusing to seed a job that would still generate (pass --allow-generate to intend that)`);
    urls = entry.urls as string[];
    if (!urls.every((u) => /^https:\/\/.+\.mp4$/.test(u))) throw new Error("every clip must be an https .mp4 URL");
  }

  const { APPROVED_REEL_PACKS, loadApprovedProductionPack, buildBriefFromApprovedProductionPack } = await import(
    "../server/services/approvedReelPackRotation"
  );
  const pack = APPROVED_REEL_PACKS.find((p) => p.slug === slug);
  if (!pack) throw new Error(`${slug} is not in APPROVED_REEL_PACK_SLUGS`);
  const snapshot = loadApprovedProductionPack(slug);
  if (!snapshot) throw new Error(`no brief.json snapshot for ${slug}`);

  const briefId = `autopost-${date}`;
  const brief = buildBriefFromApprovedProductionPack(pack, snapshot, briefId) as Record<string, any> | null;
  if (!brief) throw new Error(`builder returned null for ${slug}`);
  // Exactly what the cron stamps after building (dailyReelPost.ts:636-641 and
  // :569): the slug the publish path advances the cursor on, the IMMUTABLE
  // snapshot the episode contract verifies claims against, and the slot.
  const { productionSlotForHour } = await import("../shared/reelQueue");
  brief.id = briefId;
  brief.approvedPackSlug = slug;
  brief.approvedProductionPack = snapshot;
  brief.productionSlot = productionSlotForHour(14);

  const beats = (brief.storyboardBeats ?? []) as unknown[];
  if (!allowGenerate && beats.length !== urls.length) {
    throw new Error(`${slug}: brief has ${beats.length} beats but ${urls.length} clips mapped — refusing`);
  }

  // The same gates the cron runs, evaluated here so a dry run is informative.
  const { runReelPreflight } = await import("../client/src/lib/facelessReelStudio");
  const pre = runReelPreflight(brief as never) as { ok?: boolean; blocks?: unknown[]; blockers?: unknown[] };
  const blocks = (pre.blocks ?? pre.blockers ?? []) as unknown[];
  console.log(`[${slug}] briefId=${briefId} beats=${beats.length} clips=${urls.length} preflight blocks=${blocks.length}`);
  if (blocks.length) {
    console.log(JSON.stringify(blocks, null, 1));
    throw new Error("preflight blocks — not seeding");
  }
  // The claim packet the contract preflight will judge — built the same way the
  // cron builds it, and printed so a dry run shows the evidence state.
  const { buildClaimsFromBrief } = await import("../server/services/episodeClaims");
  const claimPacket = await buildClaimsFromBrief(brief as never);
  console.log(
    `claims=${claimPacket.claims.length} evidence=${claimPacket.evidence.length} ` +
      `entailment=${JSON.stringify(claimPacket.evidence.map((e: { entailment?: string }) => e.entailment))} rejected=${JSON.stringify(claimPacket.rejected)}`,
  );
  console.log("caption:", String(brief.selectedCaption ?? "").slice(0, 140));
  console.log("clips:");
  urls.forEach((u, i) => console.log(`  beat ${i + 1}: ${u.slice(-60)}`));

  if (!execute) {
    console.log("\nDRY RUN — no database connection was opened for writes. Pass --execute to enqueue.");
    return;
  }

  // ── writes begin here ──
  const { enqueueReelJob } = await import("../server/services/reelPipeline");
  // DUE-AT = the briefId's date at the 14:00 America/New_York production hour.
  // NOT reelPublicationIntentFor(n): its first argument is a SLOT INDEX in a
  // two-slots-per-day plan, not a day offset — passing "days" there put
  // 2026-09-13 at slot 5 = 09-10 20:00Z and the governor correctly refused it
  // as a same-CTA repeat. The reservation window is built from this value.
  const etOffset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "GMT-4";
  const offsetHours = Number(etOffset.replace("GMT", "")) || -4;
  const publicationIntendedAt = new Date(Date.parse(`${date}T14:00:00Z`) - offsetHours * 3600_000);
  console.log(`intended: ${publicationIntendedAt.toISOString()} (14:00 ET on ${date})`);
  const { jobId } = await enqueueReelJob(brief as never, "admin", {
    objective: "DISCOVERY",
    disclosureMode: "visibly_animated",
    ctaType: (brief.ctaType as "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" | undefined) ?? "NONE",
    productionSlot: productionSlotForHour(14),
    publicationIntendedAt,
    approvedProductionPack: snapshot,
    claims: claimPacket.claims,
    evidence: claimPacket.evidence,
  } as never);
  console.log(`enqueued jobId=${jobId} (status queued, through the real gates)`);
  if (allowGenerate) {
    console.log(`no clips attached — the in-container generation stage will render all ${beats.length} beats inside the daily budget`);
    process.exit(0);
  }

  const { getDb } = await import("../server/db");
  const d = await getDb();
  if (!d) throw new Error("db unavailable after enqueue — job exists WITHOUT clips; generation would spend. Attach clips by hand: jobId " + jobId);
  const { reelJobs } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  await d.update(reelJobs).set({ clipUrlsJson: JSON.stringify(urls), updatedAt: new Date() }).where(eq(reelJobs.id, jobId));
  console.log(`attached ${urls.length} existing clips to job ${jobId} — the gen stage will skip every beat and hand it to assembly`);
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
