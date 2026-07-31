/**
 * watch-reel-generation.mjs · READ-ONLY watcher (2026-07-31)
 *
 * The Higgsfield re-auth is unproven until the daily generation cron fires
 * (~13:00-14:30 Eastern; timestamps in these tables are UTC — see
 * probe-cron-clock.mjs). Instead of polling by hand, this waits for a reel
 * job NEWER than the baseline and reports the verdict:
 *
 *   PASS  · job advanced past clip generation (auth held)
 *   FAIL  · job failed with "Session expired" (re-auth did not stick)
 *   OTHER · job failed for some different reason (report it verbatim)
 *
 * Exits as soon as a verdict is reachable, or when the deadline passes.
 *
 * SAFETY: SELECT statements only. Reads DATABASE_URL from apps/nickstire/.env
 * so it can run detached without an env-loading wrapper.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const ENV_PATH = "C:/Users/nourd/NOURCITY/apps/nickstire/.env";
const BASELINE_ID = Number(process.argv[2] ?? 1140001);
const POLL_MS = 10 * 60_000;          // 10 minutes
const DEADLINE_MS = 7 * 60 * 60_000;  // give up after 7h

const url = readFileSync(ENV_PATH, "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length)
  .trim()
  .replace(/^["']|["']$/g, "");
if (!url) { console.error("no DATABASE_URL in .env"); process.exit(1); }

const started = Date.now();
const et = (d = new Date()) => new Date(d.getTime() - 4 * 3600_000).toISOString().slice(11, 19);

console.log(`watching for reel_jobs.id > ${BASELINE_ID} · started ${et()} ET · deadline +7h`);

while (Date.now() - started < DEADLINE_MS) {
  const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
  const [rows] = await conn.execute(
    `SELECT id, status, source, LEFT(COALESCE(error,''),140) AS err, createdAt
       FROM reel_jobs WHERE id > ? ORDER BY id DESC LIMIT 5`,
    [BASELINE_ID],
  );
  await conn.end();

  if (rows.length) {
    console.log(`\n=== NEW JOB(S) DETECTED at ${et()} ET ===`);
    for (const r of rows) console.log(`  #${r.id} ${r.status} src=${r.source} ${r.createdAt}\n    ${r.err || "(no error)"}`);

    const settled = rows.find((r) => r.status !== "queued" && r.status !== "generating");
    if (settled) {
      const expired = /session expired/i.test(settled.err ?? "");
      const failed = settled.status === "failed";
      console.log(
        `\nVERDICT: ${failed && expired ? "FAIL · re-auth did NOT stick (Session expired again)"
          : failed ? "OTHER · failed for a different reason (see error above)"
          : `PASS · job reached '${settled.status}' — auth held`}`,
      );
      process.exit(0);
    }
    console.log("  (still in flight — continuing to watch)");
  } else {
    console.log(`  ${et()} ET · no new job yet`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

console.log(`\ndeadline reached at ${et()} ET with no new job — generation never fired.`);
process.exit(0);
