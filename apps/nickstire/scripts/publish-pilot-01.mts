/**
 * publish-pilot-01.mts (2026-10-09) — publish the operator-approved pilot Reel #1
 * through the EXISTING doors, in order:
 *   reel_jobs row (assembled, external master)  → contentAdmin.reconcileAssembledReel
 *   → instagramAdmin.approveDraft (hash-bound approval)  → instagramAdmin.publishPost
 *   (claim audit, disclosure gate, kill switch, idempotent CAS, receipts) → Instagram.
 *
 * Nothing here reaches a database unless `--execute` is passed; the dry run
 * prints the exact caption, the claim-safety verdict and the disclosure flag
 * and exits. Idempotent: a second run finds the job/draft and refuses to
 * duplicate a live post.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/publish-pilot-01.mts --execute
 */
const EXECUTE = process.argv.includes("--execute");
// Quiet captions (operator, 2026-10-09): the disclosure stays — Meta's is_ai_generated flag
// and the burned-in badge are untouched — but the caption carries it as one short closing
// clause instead of a full sentence block. Pass --loud to keep the manifest wording.
const QUIET = !process.argv.includes("--loud");
const QUIET_DISCLOSURE: Record<string, string> = { "01": "Illustrated, not filmed.", "02": "Illustrated, not filmed.", "03": "Illustrated, not filmed." };
const PLATFORMS: ("instagram" | "facebook")[] = process.argv.includes("--facebook") ? ["instagram", "facebook"] : ["instagram"];

// approveDraft's validateFinalMedia probes the master with ffprobe. This machine
// has no ffprobe on PATH; the one that ships with @remotion/compositor does the
// format/stream read fine (used for the sha256/duration check above). Point the
// env at it when nothing else is configured.
{
  const fs = await import("fs");
  const path = await import("path");
  const candidates = [
    "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc",
  ];
  const dir = candidates.find((c) => fs.existsSync(path.join(c, "ffprobe.exe")));
  if (dir) {
    process.env.FFPROBE_PATH ||= path.join(dir, "ffprobe.exe");
    process.env.FFMPEG_PATH ||= path.join(dir, "ffmpeg.exe");
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
    console.log(`ffprobe: ${process.env.FFPROBE_PATH}`);
  }
}

const REEL_ID = (process.argv.find((a) => a.startsWith("--reel=")) ?? "--reel=01").slice(7);
const MANIFEST_PATH = "C:/Users/nourd/Downloads/Nicks_Pilot_Review_Manifest.json";

// The operator's review manifest is the source for the asset, its sha256 and the
// approved caption; nothing here is typed by hand. Planned beats describe what
// each rendered master ACTUALLY shows (frames sampled 2026-10-09), so the critic
// judges the video on its merits, never against a plan that never existed.
const PLANNED: Record<string, { briefId: string; topic: string; keyword: string; mechanicTruth: string; beats: Array<[string, string, string]> }> = {
  "01": {
    briefId: "pilot-01-looks-fine-look-closer", topic: "Tread comparison: looks fine from a distance, look closer", keyword: "TREAD",
    mechanicTruth: "A tire can look fine from a distance; tread, pressure and visible damage need a close inspection. No measured comparison is claimed.",
    beats: [
      ["AI ILLUSTRATIVE: one held shot of a clean, new-looking tire on a parked car in a shop, low angle; hook card 'Looks fine. Look closer.'", "LOOKS FINE. LOOK CLOSER.", "hook"],
      ["AI ILLUSTRATIVE: the same held shot of the same clean tire; caption changes to 'Up close? A different story.' (no closer view is shown)", "UP CLOSE? A DIFFERENT STORY.", "caption change on the same shot"],
      ["AI ILLUSTRATIVE: the same held shot, no caption, then the dark end card 'Need tires? Come see Nick's.'", "NEED TIRES? COME SEE NICK'S.", "end card"],
    ],
  },
  "02": {
    briefId: "pilot-02-nail-is-a-clue", topic: "Puncture inspection: a nail is a clue, not the whole story", keyword: "NAIL",
    mechanicTruth: "A puncture-repair decision needs the tire off the wheel and an inside inspection; location, size, internal condition and manufacturer guidance all matter. Illustration, not a customer tire.",
    beats: [
      ["AI ILLUSTRATIVE macro: a nail head seated in wet tread with soap bubbles around it, shop lights behind; hook card 'A nail is a clue. Not the whole story.'", "A NAIL IS A CLUE. NOT THE WHOLE STORY.", "hook: the evidence"],
      ["AI ILLUSTRATIVE macro: the same held nail-and-bubbles shot; caption 'Nail in your tire?'", "NAIL IN YOUR TIRE?", "caption change on the same shot"],
      ["AI ILLUSTRATIVE macro: the same held shot; caption 'before a repair decision.'; then the dark end cards 'The outside cannot answer for the inside.' and 'Got a nail? Let's inspect it.'", "BEFORE A REPAIR DECISION.", "end cards"],
    ],
  },
  "03": {
    briefId: "pilot-03-only-at-highway-speed", topic: "Highway-speed vibration: a clue, not a diagnosis", keyword: "SHAKE",
    mechanicTruth: "Shaking at highway speed does not identify a single cause: balance, tire condition, wheel problems and steering or suspension issues can all be involved; an inspection narrows it down. No real case, machine test or reading is shown.",
    beats: [
      ["AI ILLUSTRATIVE: one held shot of a wheel and tire mounted on a balancer in a shop bay, no readout shown; hook card 'Only at highway speed? That is a clue.'", "ONLY AT HIGHWAY SPEED? THAT IS A CLUE.", "hook"],
      ["AI ILLUSTRATIVE: the same held balancer shot; caption 'Shaking at highway speed?'", "SHAKING AT HIGHWAY SPEED?", "caption change on the same shot"],
      ["AI ILLUSTRATIVE: the same held shot; caption 'can also be involved.'; then the dark end card 'Find the cause. Not a guess.'", "FIND THE CAUSE. NOT A GUESS.", "end card"],
    ],
  },
};
const plan = PLANNED[REEL_ID];
if (!plan) { console.error(`unknown --reel=${REEL_ID}`); process.exit(2); }
const manifest = JSON.parse((await import("fs")).readFileSync(MANIFEST_PATH, "utf8")) as { reels: Array<Record<string, unknown>> };
const reel = manifest.reels.find((r) => r.id === REEL_ID);
if (!reel) { console.error(`manifest has no reel ${REEL_ID}`); process.exit(2); }
const TEXT_SURFACES: Record<string, string[]> = {
  "01": [
    "NICK'S | TREAD / A CLOSER LOOK",
    "Looks fine. Look closer.",
    "Your tires can look fine from here.",
    "Up close? A different story.",
    "AI illustration | Not a customer case",
    "Need tires? Come see Nick's.",
    "17625 Euclid Ave | Cleveland",
    "nickstire.org",
    "NICK'S TIRE & AUTO"
  ],
  "02": [
    "NICK'S | PATCH OR REPLACE?",
    "A nail is a clue. Not the whole story.",
    "Nail in your tire?",
    "The outside cannot tell the whole story.",
    "The tire needs an inside inspection",
    "before a repair decision.",
    "AI illustration | Not a customer case",
    "The outside cannot answer for the inside.",
    "Got a nail? Let's inspect it.",
    "17625 Euclid Ave | Cleveland",
    "nickstire.org",
    "NICK'S TIRE & AUTO"
  ],
  "03": [
    "NICK'S | THE VIBRATION QUESTION",
    "Only at highway speed? That is a clue.",
    "Shaking at highway speed?",
    "can also be involved.",
    "AI illustration | Not a customer case",
    "Find the cause. Not a guess.",
    "17625 Euclid Ave | Cleveland",
    "nickstire.org",
    "NICK'S TIRE & AUTO"
  ]
};
const BRIEF_ID = plan.briefId;
const VIDEO_URL = String(reel.video_url);
const VIDEO_SHA256 = String(reel.sha256);
const HIGGSFIELD_MEDIA_ID = String(reel.media_id);
const captionLines = String(reel.caption).split("\n");
const HASHTAGS = captionLines[captionLines.length - 1].trim().split(/\s+/).filter((h) => h.startsWith("#"));
const LOUD_SELECTED = captionLines.slice(0, -1).join("\n").trim();
// Quiet: drop the manifest's full disclosure paragraph (it starts "AI-generated") and close
// with one short clause. The is_ai_generated flag and the burned-in badge still go out.
const SELECTED_CAPTION = QUIET
  ? LOUD_SELECTED.split(/\n\n+/).filter((para) => !/^AI-generated/i.test(para.trim())).join("\n\n") + "\n\n" + (QUIET_DISCLOSURE[REEL_ID] ?? "Illustrated, not filmed.")
  : LOUD_SELECTED;
const FULL_CAPTION = `${SELECTED_CAPTION}\n\n${HASHTAGS.join(" ")}`;
if (!QUIET && FULL_CAPTION !== String(reel.caption).trim()) { console.error("caption split does not round-trip the manifest caption — refusing"); process.exit(2); }

// 15 s master: three 4 s beats + the 3 s end hold = 15 s, which is what approveDraft's
// validateFinalMedia expects (beats + 3).
const BRIEF = {
  id: BRIEF_ID,
  topic: plan.topic,
  campaignKeyword: plan.keyword,
  archetype: "object_confession",
  objectCharacter: "plain_part",
  mechanicTruth: plan.mechanicTruth,
  selectedCaption: SELECTED_CAPTION,
  hashtags: HASHTAGS,
  voiceoverScript: "",
  storyboardBeats: plan.beats.map(([visual, onScreenText, purpose], i) => ({
    beatNumber: i + 1, startSecond: i * 4, endSecond: (i + 1) * 4, visual, motion: "held shot as rendered by Higgsfield, reviewed from sampled frames", onScreenText, purpose,
    audioCue: "as rendered", safeZoneNotes: "reviewed on a phone", source: "ai_illustrative",
  })),
  ask: { kind: "visit" },
  externalMaster: {
    producedBy: "Higgsfield (operator session, 2026-10-09)",
    mediaId: HIGGSFIELD_MEDIA_ID,
    sha256: VIDEO_SHA256,
    manifest: `Nicks_Pilot_Review_Manifest.json (reel ${REEL_ID}, credits ${String(reel.credits)})`,
    textSurfaces: TEXT_SURFACES[REEL_ID] ?? [],
    approval: REEL_ID === "01"
      ? "explicit operator approval in chat, 2026-10-09 (Nicks_Pilot_01_Publication_Request.json)"
      : "operator approval in chat, 2026-10-09 (this run)",
  },
  shotLineage: [1, 2, 3].map((n) => ({ beatNumber: n, source: "ai_illustrative", origin: "provider", provider: "higgsfield", sha256: VIDEO_SHA256, url: VIDEO_URL })),
};

async function main() {
  const { captionClaimBlockers } = await import("../server/services/socialPublish");
  const { shouldDiscloseAi, publishDisclosureProblem } = await import("../shared/reelDisclosure");
  const blockers = captionClaimBlockers(FULL_CAPTION);
  const willDiscloseAi = shouldDiscloseAi(JSON.stringify([VIDEO_URL]), process.env.REEL_VIDEO_PROVIDER ?? "higgsfield", { shotLineage: BRIEF.shotLineage });
  const disclosureProblem = publishDisclosureProblem({ jobId: BRIEF_ID, caption: FULL_CAPTION, onScreenText: BRIEF.storyboardBeats.map((b) => b.onScreenText).join(" "), willDiscloseAi });
  console.log(`caption (${FULL_CAPTION.length} chars):\n${FULL_CAPTION}\n`);
  console.log(`claim-safety blockers: ${blockers.length ? JSON.stringify(blockers) : "none"}`);
  console.log(`is_ai_generated to send: ${willDiscloseAi}; disclosure gate: ${disclosureProblem ?? "ok"}`);
  console.log(`platforms: ${PLATFORMS.join(",")}`);
  if (blockers.length || disclosureProblem || !willDiscloseAi) {
    console.log("REFUSING: fix the caption/disclosure first.");
    process.exit(2);
  }
  if (!EXECUTE) {
    console.log("\nDRY RUN — no database opened, nothing written, nothing published. Pass --execute to publish.");
    process.exit(0);
  }

  const { getDbTyped } = await import("../server/db");
  const d = await getDbTyped();
  if (!d) { console.error("database unavailable"); process.exit(1); }
  const { reelJobs, socialContentInventory } = await import("../drizzle/schema");
  const { eq, desc } = await import("drizzle-orm");
  const { queueStateForReelStatus } = await import("../shared/reelQueue");

  // 1. reel_jobs row — reuse if it already exists (idempotent).
  let [job] = await d.select().from(reelJobs).where(eq(reelJobs.briefId, BRIEF_ID)).orderBy(desc(reelJobs.id)).limit(1);
  if (job) {
    console.log(`reel_jobs #${job.id} already exists: status=${job.status} igPostId=${job.igPostId ?? "-"}`);
    if (["posted", "published", "publishing", "publish_ambiguous"].includes(String(job.status))) {
      console.log("Already published or in flight — refusing to duplicate."); process.exit(0);
    }
  } else {
    await d.insert(reelJobs).values({
      briefId: BRIEF_ID,
      payload: JSON.stringify(BRIEF),
      status: "assembled",
      queueState: queueStateForReelStatus("assembled"),
      clipUrlsJson: JSON.stringify([VIDEO_URL]),
      mp4Url: VIDEO_URL,
      caption: FULL_CAPTION,
      attempts: 0,
      productionReadyAt: new Date(),
    });
    [job] = await d.select().from(reelJobs).where(eq(reelJobs.briefId, BRIEF_ID)).orderBy(desc(reelJobs.id)).limit(1);
    console.log(`reel_jobs #${job.id} inserted (assembled, external master)`);
  }

  // The doors run as the OWNER's real identity (users.id = 1, adminRole owner):
  // requireAdminIdentity reads the admin security state by ctx.user.openId and
  // refuses every mutation when that read fails, so a synthetic user cannot act.
  const { users } = await import("../drizzle/schema");
  const [owner] = await d.select({ id: users.id, openId: users.openId, role: users.role, email: users.email, name: users.name }).from(users).where(eq(users.id, 1)).limit(1);
  if (!owner || owner.role !== "admin") { console.error("owner user (id 1) is not an admin row — refusing"); process.exit(1); }
  console.log(`acting as users.id=${owner.id} (${owner.role}), approval recorded under that identity`);
  const { appRouter } = await import("../server/routers");
  const caller = appRouter.createCaller({
    req: {} as never, res: {} as never,
    user: { id: owner.id, openId: owner.openId, role: owner.role, email: owner.email, name: owner.name ?? "Nour", isGuest: false } as never,
  } as never);

  // 2. Stage the draft from the assembled job.
  const [draft0] = await d.select({ status: socialContentInventory.status, version: socialContentInventory.version }).from(socialContentInventory).where(eq(socialContentInventory.id, BRIEF_ID)).limit(1);
  if (!draft0) {
    const staged = await caller.contentAdmin.reconcileAssembledReel({ jobId: job.id });
    console.log("reconcileAssembledReel:", JSON.stringify(staged));
  } else {
    console.log(`draft ${BRIEF_ID} exists: status=${draft0.status} v${draft0.version}`);
  }

  // 3. Hash-bound approval (review_ready -> ready), skipped if already ready.
  const [draft1] = await d.select({ status: socialContentInventory.status, version: socialContentInventory.version }).from(socialContentInventory).where(eq(socialContentInventory.id, BRIEF_ID)).limit(1);
  if (draft1.status === "review_ready") {
    const approved = await caller.instagramAdmin.approveDraft({ id: BRIEF_ID, expectedVersion: draft1.version });
    console.log("approveDraft:", JSON.stringify(approved));
  } else if (["published", "published_partial", "publishing"].includes(draft1.status)) {
    console.log(`draft is ${draft1.status} — refusing to duplicate.`); process.exit(0);
  }

  // 4. Publish through the door (claim audit, disclosure, kill switch, CAS, receipts).
  const result = await caller.instagramAdmin.publishPost({
    inventoryId: BRIEF_ID, platforms: PLATFORMS, caption: FULL_CAPTION, videoUrl: VIDEO_URL, isAiGenerated: true,
  });
  console.log("publishPost:", JSON.stringify(result, null, 2));

  const [after] = await d.select({ id: reelJobs.id, status: reelJobs.status, igPostId: reelJobs.igPostId }).from(reelJobs).where(eq(reelJobs.id, job.id)).limit(1);
  console.log("reel_jobs after:", JSON.stringify(after));
  process.exit(0);
}

main().catch((err) => { console.error("FAILED:", err instanceof Error ? `${err.message}\n${err.stack?.slice(0, 1200)}` : err); process.exit(1); });
