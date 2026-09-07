-- 0118: delivery eligibility, separated from creative approval.
--
-- NOT APPLIED. Hand-applied only, on an explicit operator instruction, like
-- every migration in this directory. Written 2026-09-07 alongside the gate logic
-- it enables; the logic is inert until these columns exist, and deliberately so
-- (see ACTIVATION at the bottom).
--
-- WHY. `reel_publish_approvals` carries a rolling 72h TTL adopted from
-- `social_content_approvals`. That TTL answers "is this yes still fresh?" and it
-- is the right question for an autonomous lane where a stale approval fires with
-- nobody watching. It cannot answer "may this publish on the 14th?" — an
-- approval granted today expires four days before a slot two weeks out, so
-- scheduling ahead is structurally impossible.
--
-- Deleting the TTL would solve the wrong problem: it exists precisely because
-- this lane is unattended. So the two ideas are separated instead.
--
--   CREATIVE APPROVAL   a human read THESE caption bytes and THIS asset and
--                       said yes. Already recorded (caption_sha, video_url,
--                       approved_by).
--   DELIVERY ELIGIBILITY  that same human also authorized WHEN, as a bounded
--                       window they were shown.
--
-- When a window is present it GOVERNS and the rolling TTL does not apply: an
-- explicit "between the 12th and the 15th" is a stronger and more specific
-- authorization than a freshness default, and letting the default veto it would
-- make scheduling impossible again. When absent, behaviour is byte-identical to
-- today. Every existing row has both columns NULL, so this migration changes no
-- current decision.
--
-- A WINDOW IS NOT A SCHEDULE. It says "allowed during", never "due at". The
-- intended publish time belongs on the JOB, not the approval, because a job has
-- one intent while approvals may be superseded — hence
-- `reel_jobs.publication_intended_at`. `publication_scheduled_at` already exists
-- but is stamped at the publish CAS (dailyReelPost), so it records "publish
-- STARTED", not "intended to publish at T"; it is left alone.
--
-- WHY A DIGEST. `storagePut` writes to a deterministic key
-- (`reels/reel-<jobId>.mp4`), so a re-render or a selective beat repair produces
-- the SAME url with DIFFERENT bytes — and the gate's `videoUrl` equality check
-- passes while publishing a video nobody approved. A stable URL is not proof of
-- unchanged content. `media_assets` already records sha256 + byte size at
-- registration (reelAssembly.ts), so the value exists and only needs binding.
--
-- ALL FOUR STATEMENTS ARE ADDITIVE nullable columns. No data is moved, no
-- column is dropped, no index is rebuilt, nothing is backfilled.
--
-- SEPARATE ALTERs ON PURPOSE: TiDB requires one ALTER per operation where MySQL
-- permits a combined statement (nickstire-tidb-ddl). `IF NOT EXISTS` makes each
-- re-runnable, so a partial apply is recovered by re-running the file.

ALTER TABLE `reel_publish_approvals`
  ADD COLUMN IF NOT EXISTS `publish_window_start` timestamp NULL;

ALTER TABLE `reel_publish_approvals`
  ADD COLUMN IF NOT EXISTS `publish_window_end` timestamp NULL;

-- char(64): a hex sha256 is exactly 64 characters, matching `caption_sha` in
-- 0112. Nullable because rows written before this bind to the URL only, and the
-- gate honours them rather than bricking the queue — the same legacy tolerance
-- 0112 applied to its own null `expires_at`.
ALTER TABLE `reel_publish_approvals`
  ADD COLUMN IF NOT EXISTS `asset_sha256` char(64) NULL;

-- Scheduling INTENT, distinct from `publication_scheduled_at` (which is stamped
-- at the publish CAS and therefore means "publish started").
ALTER TABLE `reel_jobs`
  ADD COLUMN IF NOT EXISTS `publication_intended_at` timestamp NULL;

-- ─── ACTIVATION — READ BEFORE APPLYING ──────────────────────────────────────
--
-- `drizzle/schema.ts` is deliberately NOT updated in the same change, and that
-- ordering is load-bearing rather than an oversight.
--
-- `findLiveApproval` (server/services/reelApproval.ts) reads with a bare
-- `db.select().from(reelPublishApprovals)`, which enumerates every column in the
-- Drizzle definition. Adding these columns to schema.ts BEFORE the DDL is
-- applied would make that query name columns production does not have. It is
-- wrapped in a catch that returns null, and null means "not approved" — so the
-- failure would not be a visible error. It would silently HOLD EVERY REEL,
-- fail-closed and invisible.
--
-- Correct order, therefore:
--   1. apply this file (scoped runner, per prod-db-guard)
--   2. `node scripts/reconcile-migrations.mjs --strict` — zero blocking drift
--   3. THEN add the four columns to drizzle/schema.ts and map them in
--      findLiveApproval / recordReelApproval, in a follow-up PR
--
-- The gate logic in shared/reelApproval.ts already handles all four fields and
-- is fully unit-tested. Until step 3, every field arrives undefined and the gate
-- behaves exactly as it does today.
