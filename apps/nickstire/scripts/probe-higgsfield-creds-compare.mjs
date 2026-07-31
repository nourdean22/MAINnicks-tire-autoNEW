/**
 * probe-higgsfield-creds-compare.mjs · READ-ONLY (2026-07-31)
 *
 * Before clearing the app_secret_kv row so "the env var takes over", answer
 * the question that decides whether that helps at all:
 *
 *   Is the Railway HIGGSFIELD_CREDENTIALS_JSON any FRESHER than the DB row?
 *
 * Both are 182 chars, which hints they may be the same value. If so, clearing
 * the row is a no-op — prod would fall back to identical, equally-expired
 * credentials. Worse: higgsfieldStudio.ts:106 says the env pair is the STATIC
 * one that dies ~90 min after login, and the DB row exists precisely to hold
 * the ROTATED successor. That makes the row the fresher source, and deleting
 * it a downgrade.
 *
 * Compares by SHA-256 and structure only. NEVER prints token material.
 *
 * SAFETY: SELECT only. No mutations. Pass the env value via HF_ENV_CREDS.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const h = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const describe = (label, raw) => {
  if (!raw) { console.log(`  ${label.padEnd(18)} ABSENT`); return null; }
  console.log(`  ${label.padEnd(18)} len=${raw.length}  sha256:${h(raw)}`);
  try {
    const o = JSON.parse(raw);
    console.log(`  ${"".padEnd(18)} keys: ${Object.keys(o).join(", ")}`);
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== "string") { console.log(`  ${"".padEnd(18)}   ${k}: (${typeof v})`); continue; }
      // If it's a JWT, decode ONLY the exp claim — never the payload contents.
      const parts = v.split(".");
      if (parts.length === 3) {
        try {
          const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
          const exp = p.exp ? new Date(p.exp * 1000).toISOString() : "(no exp)";
          const expired = p.exp ? (p.exp * 1000 < Date.now() ? " ← EXPIRED" : " ← still valid") : "";
          console.log(`  ${"".padEnd(18)}   ${k}: JWT exp=${exp}${expired}`);
        } catch { console.log(`  ${"".padEnd(18)}   ${k}: JWT (exp unreadable), len ${v.length}`); }
      } else {
        console.log(`  ${"".padEnd(18)}   ${k}: opaque, len ${v.length}`);
      }
    }
  } catch { console.log(`  ${"".padEnd(18)} (not JSON)`); }
  return raw;
};

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const [rows] = await conn.execute(
  "SELECT v, updated_at FROM app_secret_kv WHERE k = 'higgsfield_credentials_json'",
);
await conn.end();

console.log("\n=== DB row (app_secret_kv · WINS over env) ===");
const dbVal = describe("db_row", rows[0]?.v ?? null);
if (rows[0]) console.log(`  ${"".padEnd(18)} updated_at ${rows[0].updated_at}`);

console.log("\n=== Railway env HIGGSFIELD_CREDENTIALS_JSON (fallback) ===");
const envVal = describe("railway_env", process.env.HF_ENV_CREDS ?? null);

console.log("\n=== verdict ===");
if (!dbVal || !envVal) {
  console.log("  cannot compare — one source missing");
} else if (dbVal === envVal) {
  console.log("  IDENTICAL. Clearing the row is a NO-OP: prod falls back to the same");
  console.log("  expired credentials. Deleting it gains nothing and loses the rotation slot.");
} else {
  console.log("  DIFFERENT values. The DB row holds the ROTATED successor (see");
  console.log("  higgsfieldStudio.ts:106) and is therefore the FRESHER of the two —");
  console.log("  clearing it would fall back to the older static pair.");
}
console.log("");
