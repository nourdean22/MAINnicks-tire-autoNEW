# Instagram surface audit, 2026-10-10

Three read-only passes (publish routers, reel pipeline, admin PWA pages), ponytail-audit stance:
correct, safe, holds under load, tested, fast, lean. Load assumed: one operator on a phone, one
Railway container, cron every 15 to 60 minutes, 1 to 3 reels a day at 12 to 26 credits per clip,
Meta posts that cannot be unpublished by API. Spot-checked against the code by the orchestrating
session: A1, A3, B3, B5, C1, C2 confirmed; A11 unverified (grep did not reproduce the literal).

Numbering: A = publish routers and services, B = reel pipeline and QA gates, C = admin pages.
Say "fix A1 and B3" to pick.

## Must fix

**Status 2026-10-10:** all nine fixed on branch `nickstire/instagram-audit-must-fix` (PR after #2975), each
with a test that was red first; receipts in `docs/CURRENT-TRUTH.md` and the capability ledger entry
`instagram-audit-must-fix-20261010`. B1 is unproven on a paid render until the next reel.


**A1. An armed cron can republish any inventory row with none of the reel gates**
(`server/cron/jobs/socialInventoryPublisher.ts:25-34,67,121`; feeder `server/routers/content.ts:3049`)
- What: `socialInventoryPublisher` publishes every inventory row with `status IN (approved, scheduled)`
  and `scheduledAt <= now`. Its only writer, `content.actOnInventoryItem`, has zero callers. Both
  arming flags are `true` in production.
- Problem: one call to `actOnInventoryItem({ action: "schedule", scheduledAt: <past> })` on any
  row (published, rejected, a reel) makes the cron post it: caption from `hookText + bodyText`, no
  approval check, no disclosure flag, no attempt ledger. Studio already refuses to arm this door.
- Fix: delete the cron, its scheduler and index entries, `actOnInventoryItem`, its two tests, and
  the test that pins this door as legitimate (`deferredPublishOwnership.test.ts:137-149`); drop
  `SOCIAL_INVENTORY_PUBLISH_ENABLED` from `truth_os.md`.
- If skipped: one stray admin call posts a second copy of a live reel with no ledger row.

**A2. The Queue publishes non-reel drafts with the client's caption, not the approved one**
(`server/routers/instagramAdmin.ts:1671,1849-1892,2519`; `ReelQueue.tsx:206,352`)
- What: reels get a server-built caption; posts and carousels keep `input.caption` from the client.
- Problem: a Studio V2 post approved at `ready` also appears in the Queue under "Legacy static
  drafts" and publishes from there with `hookText` only (no hashtags), while Studio's door sends
  `caption + hashtags`. The integrity hash covers the brief, not the sent caption.
- Fix: make the non-reel caption server-authoritative and refuse `seriesName === "instagram_studio_v2"`
  rows there ("publish this from Studio"). About 6 lines.
- If skipped: the same approved post publishes with two different captions depending on the screen.

**A3. Reservations count every future day as "today"** (`server/services/contentGovernor.ts:88-92`)
- What: a reel slot is refused when the day already holds `maxFeedPostsPerDay` reservations;
  "same day" is `windowStart >= dayStart` with no upper bound.
- Problem: slots reserved for Thursday and Friday both count for Wednesday; reserving Wednesday
  afterwards throws `RESERVATION_FEED_CAP`. The test mocks the rows, so it cannot see this.
- Fix: add the upper bound `lt(windowStart, next day start)` to the where clause (one line) and
  make the test fake filter by date.
- If skipped: the operator cannot fill an earlier gap once later days are booked.

**B1. A slow CLI render is declared dead on attempt 1, the money is lost, the operator is paged**
(`reelPipeline.ts:33,1299-1382,1558-1582`; `higgsfieldStudio.ts:976-985`; `shared/providerErrors.ts:146,271`)
- What: the worker wraps each Higgsfield beat in a timer and the CLI lane has its own; the CLI
  lane has no request id.
- Problem: a timeout classifies as `LOCAL_TIMEOUT_REMOTE_UNKNOWN`, terminal on attempt 1: job to
  `needs_regen`, ledger `fail()`, slot released, Telegram "PROVIDER DOWN". Killing the local CLI
  does not cancel the remote render: today both "timed out" beat-5 renders completed and billed.
- Fix: give the CLI lane a handle like the API lane: submit, persist the generation id on the beat,
  poll with `generate get <id> --json` (already allowlisted and proven by the recovery script). A
  timeout then becomes `LOCAL_TIMEOUT_REMOTE_RUNNING`: resume, no attempt consumed, no double buy.
  Until then the raised 13-minute timeouts are the guard.
- If skipped: every render over the timeout strands the other paid clips and pays for one nobody fetches.

**B2. The repair lane calls Higgsfield with none of the generation lane's protections**
(`selectiveRepair.ts:436-441` vs `reelPipeline.ts:1299-1382`)
- What: a paid re-render of one beat after QA blocks it.
- Problem: no start image (a hero-anchored job repairs text-only, so the critic blocks it again),
  no poll timeout, no request-id persist, no `withTimeout`; a submitted-then-timed-out API call
  consumes the attempt and the next pulse resubmits (paid twice).
- Fix: extract the per-beat Higgsfield block from `processNextReelJob` into one function and call
  it from both places; persist `higgsfieldRequestId` on the repair entry as the generation lane does.
- If skipped: each autonomous paid repair risks costing two clips and still holding the reel.

**B3. A repair interrupted by a redeploy re-renders forever; the ledger shows one attempt**
(`reelPipeline.ts:2037-2038`; `selectiveRepair.ts:304,328,367`)
- What: the stuck sweeper moves `repair_rendering` back to `repair_queued`, capped by `attempts >= MAX_ATTEMPTS`.
- Problem: `requestBeatRepair` sets `attempts: 0` and the repair claim never increments it, so the
  cap never trips; `reserve()` returns the same `_p1` row without a budget check. Two deploys during
  one repair window bought two renders recorded as one.
- Fix: in the claim update, `attempts: sql\`attempts + 1\`` like the generation claim. One line.
- If skipped: every deploy landing during a repair buys another clip the budget never sees.

**C1. Settings renders a failed read as "not configured"** (`client/src/pages/admin/instagram/Settings.tsx:78-125`)
- What: only `isLoading` is handled; the three reads are `dbAdminProcedure`s that throw when the DB is down.
- Problem: a TiDB blip shows three red "fix your keys" cards for a config that is fine, and the
  form seeds from blank data.
- Fix: an amber "Could not read settings, unknown not misconfigured" card with Retry on any
  `isError`, before line 79. About 6 lines.
- If skipped: an outage reads as a credential problem.

**C2. `ReelQueue.rejectDraft` has no `onError`** (`ReelQueue.tsx:187-192`)
- What: every other mutation on the page reports errors; this one only has `onSuccess`.
- Problem: a refused reject (version mismatch, "unschedule first", "resolve ambiguity first") shows
  nothing; the confirm panel closes and the draft stays as it was.
- Fix: `onError: (err) => toast.error("Reject refused", { description: err.message })`. One line.
- If skipped: the one path with a specific server message hides it.

**C3. Today says "Nothing needs you, verified" while the Board's Attention lane is non-empty**
(`Today.tsx:39` vs `PublishBoard.tsx:15`; classifier `server/routers/instagramStudio.ts:152-165`)
- What: two definitions of "needs attention" over the same table; the Board's classifier also
  flags `stalled` (a scheduled post with no pending row, or `publishing` older than 15 min).
- Problem: a stalled schedule is red on the Board and green on Today.
- Fix: have Today read `instagramStudio.board` and build its broken list from `health !== "healthy"`;
  drop the `list` query from Today. Deletes one query and one rule.
- If skipped: the screen that claims "verified" misses a known failure class.

## Should fix

A4. Ingested mp4 reels cannot be approved from the Queue: expected duration is 3 s when the brief
has no beats (`instagramAdmin.ts:1331-1341`; fix: skip the duration check when `beats.length === 0`).
A5. Studio can publish a reel with no reel gates (`instagramStudio.ts:518-568,948-980,1062-1164`;
fix: one line in `assertPublishable`: reels publish from the Reel Queue).
A6. Studio publish has no attempt ledger and a wedged `publishing` row can be re-edited into a
duplicate (`instagramStudio.ts:952,1103-1163`).
A7. Spacing check sees only the Queue's publishes (`contentGovernor.ts:918-921`).
A8. Gate tests that pass as long as the text is present (`reelPublishDoors.test.ts`,
`publishIntegrityWave.test.ts`, `trialReelAdminWiring.test.ts`, `mp4IngestDoor.test.ts`,
`feedCapDoors.test.ts`, `deferredPublishOwnership.test.ts:137-149`).
A9. Six dead procedures incl. `metaSocial.socialPost`, an ungated Meta write with no caller.
A10. The reel path has its own copy of the container poll loop that fails on a transient
status error where the shared one retries (`metaSocial.ts:1069-1108` vs `:317-362`).
B4. A verdict marked stale after a repair is never re-run and jams the daily drain
(`qualityGate.ts:163,203-205`; fix: treat stale as missing so the gate re-runs the critic; -3 lines).
B5. Ledger rows say `seedance1_5` while the shop renders and pays for `seedance_2_5`
(`reelPipeline.ts:90`; fix: read `REEL_CLIP_MODEL` like `reelClipCostUsd` does).
B6. Settlement records an estimate as a measured actual (`reelPipeline.ts:1529`; `generationLedger.ts:291`).
B7. Rendered QA writes the whole payload back after minutes of work with no compare-and-set
(`renderedQa.ts:995,1101-1103`; an operator repair request during the critic's run disappears).
B8. Dead caption-length check that would leak a governor slot if it ever fired (`reelPipeline.ts:730-745`).
C4. `getAllDrafts` has no series filter, so Studio V2 posts appear twice with two publish paths.
C5. ReelQueue shows the newest 50 rows with client-side filters; an older `needs_review` reel leaves silently.
C6. Irreversible one-tap actions on 32px buttons (second taps in ActionCenter and ReelQueue lack `min-h-11`).
C7. `applyQueueTruth` is a single destructive tap (`ActionCenter.tsx:488-495`).
C8. Studio reel wizard polls every 5 s for the length of a generation (the rate that tripped the admin lockout before).

## Nice to have

A11. Carousel preview joins slides with the literal text `\n\n` (unverified by grep; check `instagramAdmin.ts:918`).
A12. `assetPaths` parsed by hand four times with different error handling.
B9. Two ways to read `affectedRows` in the generation and assembly claims.
C9. Five status colour maps and four date formatters; one browser-local formatter disagrees with Eastern time.
C10. Board has no lane for a healthy `publishing` row, so a post in flight vanishes for up to 15 min.
C11. `?igpub=reels` is written by Action Center and never scrubbed.
C12. 41 server procedures with no client or script caller (verify against access logs before deleting;
four of them are live spend or publish doors reachable over HTTP).

Left out: 15 smaller items across the three passes.

Verdict: the main doors (Queue publish, reel cron) are well guarded. Fix A1 first (an armed bypass
with a dead feeder), then B1 to B3 together (the mechanism behind today's lost renders and double
buys), then the three honesty fixes on the pages (C1 to C3, about 25 lines).

Lean: roughly -600 lines possible (A1, A9, A10, A12, B4, B8, B9, C9, the regex test files), 0 dependencies.

Not checked: `igAutopost.ts` (calls Meta directly, outside the named scope), `adminRoutes.ts`
canaries, Inbox/Learn/PatternLab pages, live Meta behaviour, production values of
`MP4_INGEST_ENABLED` and `REEL_GATE_REQUIRE_JOB`, raw-HTTP use of the 41 uncalled procedures.
