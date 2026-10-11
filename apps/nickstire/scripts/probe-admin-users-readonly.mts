/** READ-ONLY: which users rows are admins, and the pilot-01 job/draft state. No writes. */
const { getDbTyped } = await import("../server/db");
const d = await getDbTyped();
if (!d) { console.log("database unavailable"); process.exit(1); }
const { reelJobs, socialContentInventory } = await import("../drizzle/schema");
const { eq, sql } = await import("drizzle-orm");
const { rowsFromExecute } = await import("../server/cron/jobs/vapiCallEval");
const res = await d.execute(sql`SELECT id, openId, role, adminRole, mfaEnabled, email FROM users WHERE role = 'admin' LIMIT 10`);
const rows = rowsFromExecute(res) as Array<Record<string, unknown>>;
for (const a of rows) console.log(`user id=${a.id} openId=${String(a.openId).slice(0, 14)}(len ${String(a.openId).length}) role=${a.role} adminRole=${a.adminRole} mfa=${a.mfaEnabled} email=${String(a.email ?? "").replace(/^(..).*(@.*)$/, "$1***$2")}`);
const jobs = await d.select({ id: reelJobs.id, status: reelJobs.status, igPostId: reelJobs.igPostId, error: reelJobs.error }).from(reelJobs).where(eq(reelJobs.briefId, "pilot-01-looks-fine-look-closer"));
console.log("pilot-01 reel_jobs:", JSON.stringify(jobs));
const drafts = await d.select({ id: socialContentInventory.id, status: socialContentInventory.status, version: socialContentInventory.version }).from(socialContentInventory).where(eq(socialContentInventory.id, "pilot-01-looks-fine-look-closer"));
console.log("pilot-01 drafts:", JSON.stringify(drafts));
process.exit(0);
