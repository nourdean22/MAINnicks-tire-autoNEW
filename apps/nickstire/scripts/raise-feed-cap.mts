/**
 * Publish an autonomy policy version that raises the feed cap to the schema
 * ceiling and removes the spacing constraint.
 *
 * WHY THIS EXISTS
 * The active policy (v7) was never a business decision. Provenance from
 * `autonomy_policy_versions`:
 *
 *   v2  operator-session  2026-07-17 16:37  cap 2  spacing 3h  "initial baseline"
 *   v3  cc2-verify        2026-07-18 07:17  cap 3  spacing 3h  "...(temporary)"
 *   v4  cc2-verify        2026-07-18 07:23  cap 3  spacing 0   "...(temp)"
 *   v5  cc2-verify        2026-07-18 07:28  cap 2  spacing 3h  "...(temp)"
 *   v6  cc2-verify        2026-07-18 07:41  cap 3  spacing 0   "...(temp)"
 *   v7  cc2-verify        2026-07-18 07:57  cap 2  spacing 3h  "...(temp)"
 *
 * An agent session toggled the cap five times in forty minutes while testing
 * the governor, labelled EVERY write temporary, and the last one stayed. It has
 * governed the account since. A temporary write with no expiry is a permanent
 * write.
 *
 * WHAT THIS CHANGES — exactly two numbers
 *   limits.maxFeedPostsPerDay      2  -> 20   (the schema ceiling: bounded(0,20))
 *   limits.minimumFeedSpacingHours 3  -> 0
 *
 * Everything else — emergencyControls, formatPermissions, minimumScores, every
 * other limit — is carried across from the active policy untouched. Operator
 * authorized 2026-07-27.
 *
 * The cap stops being a content-strategy dial and becomes purely a runaway
 * brake: at 20 it can never block real output (measured: 3 feed posts/day), but
 * an unattended generator still stops instead of posting without bound.
 *
 * REVERSIBLE: policy versions are append-only. Publishing another version
 * supersedes this one; nothing is overwritten or lost.
 *
 * Run from apps/nickstire:  pnpm exec tsx scripts/raise-feed-cap.mts [--apply]
 * Without --apply it prints the diff and writes nothing.
 */
import { getActivePolicy, publishPolicyVersion } from "../server/services/autonomyControl";
import { getDb } from "../server/db";
import { desc } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

/**
 * NEAR-MISS THAT PUT THIS BLOCK HERE.
 *
 * The first dry run printed "active policy v1" while storage held v7.
 * `getActivePolicy()` falls back to DEFAULT_AUTONOMY_POLICY when `getDb()`
 * returns null — and that path logs NOTHING, so the fallback is invisible.
 * server/db.ts reads process.env.DATABASE_URL directly and nothing in a bare
 * `tsx script.mts` invocation loads .env, so the script had no database.
 *
 * With --apply, that would have published v8 = DEFAULT + two edits, silently
 * discarding whatever v7 actually contains (formatPermissions, minimumScores,
 * every other limit).
 *
 * The "verified: no other field differs" check below could not have caught it:
 * it compares `next` against `before`, and `before` was already the wrong
 * baseline. A diff guard proves nothing when the baseline is unverified.
 *
 * So: prove the DB is real, and prove the policy we loaded IS the newest stored
 * one, before touching anything.
 */
const db = await getDb();
if (!db) {
  console.error("REFUSING: no database connection. getActivePolicy() would silently return the DEFAULT");
  console.error("policy and this script would overwrite the live one. Run with env loaded:");
  console.error("  pnpm exec tsx --env-file=.env scripts/raise-feed-cap.mts");
  process.exit(1);
}

const { autonomyPolicyVersions } = await import("../drizzle/schema");
const [newest] = await db
  .select({ version: autonomyPolicyVersions.version })
  .from(autonomyPolicyVersions)
  .orderBy(desc(autonomyPolicyVersions.version))
  .limit(1);

const before = await getActivePolicy();
if (!newest) {
  console.error("REFUSING: no policy versions in storage — nothing to base an edit on.");
  process.exit(1);
}
if (before.version !== newest.version) {
  console.error(`REFUSING: getActivePolicy() returned v${before.version} but storage's newest is v${newest.version}.`);
  console.error("The live policy did not load (bad env, or it failed STRICT validation — see logs).");
  console.error("Publishing now would replace the stored policy with a fallback. Aborting.");
  process.exit(1);
}
console.log(`storage newest = v${newest.version}, loaded = v${before.version} — match confirmed`);
console.log(`active policy v${before.version}`);
console.log("  limits BEFORE:", JSON.stringify(before.limits));
console.log("  emergencyControls (carried across untouched):", JSON.stringify(before.emergencyControls));

const next = {
  ...before,
  limits: { ...before.limits, maxFeedPostsPerDay: 20, minimumFeedSpacingHours: 0 },
};

console.log("\nwould change EXACTLY two fields:");
console.log(`  maxFeedPostsPerDay      ${before.limits.maxFeedPostsPerDay} -> ${next.limits.maxFeedPostsPerDay}`);
console.log(`  minimumFeedSpacingHours ${before.limits.minimumFeedSpacingHours} -> ${next.limits.minimumFeedSpacingHours}`);

// Prove nothing else moved before writing anything.
const untouched = JSON.stringify({ ...before, limits: null, version: null });
const untouchedNext = JSON.stringify({ ...next, limits: null, version: null });
if (untouched !== untouchedNext) {
  console.error("\nREFUSING: something outside `limits` differs. Aborting.");
  process.exit(1);
}
const changedLimitKeys = Object.keys(next.limits).filter(
  (k) => (next.limits as Record<string, number>)[k] !== (before.limits as Record<string, number>)[k],
);
if (changedLimitKeys.join(",") !== "maxFeedPostsPerDay,minimumFeedSpacingHours") {
  console.error(`\nREFUSING: unexpected limit changes [${changedLimitKeys.join(", ")}]. Aborting.`);
  process.exit(1);
}
console.log("  verified: no other field differs");

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply.");
  process.exit(0);
}

const { version } = await publishPolicyVersion(
  next,
  "operator-authorized 2026-07-27: feed cap 2->20, spacing 3h->0. v7 was leftover 'temp' state from the cc2-verify session (2026-07-18), never a business decision. The cap is now a runaway brake, not a content dial.",
  "operator-authorized",
);
console.log(`\npublished v${version}`);

const after = await getActivePolicy();
console.log("  limits AFTER:", JSON.stringify(after.limits));
console.log("  emergencyControls AFTER:", JSON.stringify(after.emergencyControls));
process.exit(0);
