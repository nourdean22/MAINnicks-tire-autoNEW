/**
 * push-higgsfield-creds.mjs · credential sync (2026-07-31)
 *
 * Writes a FRESH local Higgsfield credentials file into the source prod
 * actually reads: the app_secret_kv row `higgsfield_credentials_json`.
 *
 * Why the row and not the Railway env var: getHiggsfieldCredentialsJson()
 * (higgsfieldStudio.ts:19-39) prefers the row OVER
 * process.env.HIGGSFIELD_CREDENTIALS_JSON, so a stale row shadows the env var
 * completely. Writing here also skips the Railway GraphQL cookie-auth dance in
 * docs/REEL-PIPELINE-HANDOFF.md:69.
 *
 * SAFETY
 *  · DRY RUN by default; --apply to write.
 *  · Refuses unless the local file parses as JSON with BOTH access_token and
 *    refresh_token — never writes garbage into the credential row.
 *  · Refuses if the local file is not NEWER than the existing row.
 *  · Prints only lengths, hashes and timestamps. NEVER token material.
 *  · Single-row upsert keyed on k='higgsfield_credentials_json'.
 */
import mysql from "mysql2/promise";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const CREDS_PATH = path.join(os.homedir(), ".config", "higgsfield", "credentials.json");
const h = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

let raw, mtime;
try {
  raw = readFileSync(CREDS_PATH, "utf8").trim();
  mtime = statSync(CREDS_PATH).mtime;
} catch {
  console.error(`no local credentials at ${CREDS_PATH} — run the Higgsfield device login first`);
  process.exit(1);
}

let parsed;
try { parsed = JSON.parse(raw); } catch { console.error("local creds file is not valid JSON — refusing"); process.exit(1); }
if (!parsed?.access_token || !parsed?.refresh_token) {
  console.error(`creds missing access_token/refresh_token (keys: ${Object.keys(parsed ?? {}).join(", ")}) — refusing`);
  process.exit(1);
}
console.log(`\nlocal creds  len=${raw.length} sha256:${h(raw)} mtime=${mtime.toISOString()}`);
console.log(`  keys: ${Object.keys(parsed).join(", ")}`);

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
// AGE IS COMPUTED SERVER-SIDE, deliberately. mysql2 parses DATETIME in the
// connection's LOCAL zone while this column stores UTC, so a returned
// `updated_at` reads ~4h AHEAD of real Eastern — far enough that a row written
// minutes ago looks like it was written in the FUTURE. Comparing that directly
// against the local file's mtime made this guard refuse a genuinely fresher
// login ("existing row is NEWER"), blocking the exact recovery it exists to
// enable — measured 2026-08-21. TIMESTAMPDIFF against UTC_TIMESTAMP() is
// evaluated by the server and cannot be skewed by the driver. Same fix, same
// reason as higgsfieldSessionLiveness (higgsfieldStudio.ts).
const [before] = await conn.execute(
  `SELECT LENGTH(v) AS len, v, updated_at,
          TIMESTAMPDIFF(SECOND, updated_at, UTC_TIMESTAMP()) AS age_seconds
     FROM app_secret_kv WHERE k = 'higgsfield_credentials_json'`,
);
if (before.length) {
  const rowAgeSec = Number(before[0].age_seconds);
  const localAgeSec = (Date.now() - mtime.getTime()) / 1000;
  console.log(`existing row len=${before[0].len} sha256:${h(before[0].v)} age=${Math.round(rowAgeSec)}s (raw updated_at=${before[0].updated_at}, driver-skewed — do not compare directly)`);
  console.log(`local creds age=${Math.round(localAgeSec)}s`);
  if (before[0].v === raw) { console.log("\nrow already holds these exact credentials — nothing to do.\n"); await conn.end(); process.exit(0); }
  // Smaller age = more recent. Unknown age is NOT treated as "row is older":
  // refusing on an unreadable comparison is the safe direction here.
  if (!Number.isFinite(rowAgeSec)) {
    console.error("\ncould not compute the stored row's age — refusing rather than guessing.\n");
    await conn.end(); process.exit(1);
  }
  if (rowAgeSec < localAgeSec) {
    console.error(`\nexisting row is NEWER than the local file (${Math.round(rowAgeSec)}s vs ${Math.round(localAgeSec)}s old) — refusing to overwrite a fresher pair.\n`);
    await conn.end(); process.exit(1);
  }
} else {
  console.log("existing row: ABSENT (will insert)");
}

if (!APPLY) {
  console.log("\nDRY RUN — would upsert app_secret_kv['higgsfield_credentials_json'].");
  console.log("  re-run with --apply to write.\n");
  await conn.end();
  process.exit(0);
}

const [res] = await conn.execute(
  `INSERT INTO app_secret_kv (k, v) VALUES ('higgsfield_credentials_json', ?)
     ON DUPLICATE KEY UPDATE v = VALUES(v)`,
  [raw],
);
console.log(`\nupsert affectedRows = ${res.affectedRows}`);

const [after] = await conn.execute(
  "SELECT LENGTH(v) AS len, v, updated_at FROM app_secret_kv WHERE k = 'higgsfield_credentials_json'",
);
console.log(`after  len=${after[0].len} sha256:${h(after[0].v)} updated_at=${after[0].updated_at}`);
console.log(`matches local file: ${after[0].v === raw}`);
await conn.end();
console.log("");
