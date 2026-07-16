/**
 * Local dev/test MySQL for nickstire — no Docker, no admin, no prod.
 *
 * WHY THIS EXISTS: the repo's only configured DATABASE_URL points at production
 * TiDB. That makes anything that touches the DB (the reel pipeline, cron jobs,
 * admin mutations) unrunnable locally without editing real operator data. This
 * boots a throwaway MySQL 8 in user space (mysql-memory-server downloads a
 * binary on first run, ~150MB, cached after), applies the full Drizzle schema,
 * and hands back a DATABASE_URL you can point the app at safely.
 *
 * THE search_performance SHIM: `drizzle-kit push` aborts on stock MySQL 8 with
 * "Specified key was too long; max key length is 3072 bytes". The offender is
 * search_performance.idx_search_perf_page — an index over `page varchar(1000)`
 * = 4000 bytes under utf8mb4. Prod TiDB allows it; vanilla MySQL does not, and
 * push is sequential so every table after it never gets created (this is why a
 * naive push yields 87 of 127 tables). We pre-create that one table with a
 * prefix index `page(768)` so push finds it already present and moves on,
 * landing the full schema. A prefix index is the correct long-term fix for the
 * real schema too — filed separately; changing a prod index is its own review.
 */
import { createDB } from "mysql-memory-server";
import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NICKSTIRE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXPECTED_TABLE_COUNT = 127;

// The full column set drizzle expects for search_performance, but with the page
// index as a PREFIX (page(768)) instead of the full varchar(1000) that blows
// MySQL's 3072-byte key limit. This exact statement was verified to make push
// complete all 127 tables; push finds the table present and does not try to
// reconcile the index, so it never re-issues the oversized key. The table-count
// guard below is the drift check — if schema.ts changes search_performance's
// columns, push will ALTER and the count/behavior shifts, tripping the guard.
const SEARCH_PERFORMANCE_SHIM = `CREATE TABLE search_performance (
  id int AUTO_INCREMENT PRIMARY KEY,
  query varchar(500) NOT NULL DEFAULT '',
  page varchar(1000) NOT NULL DEFAULT '',
  clicks int NOT NULL DEFAULT 0,
  impressions int NOT NULL DEFAULT 0,
  ctr int NOT NULL DEFAULT 0,
  position int NOT NULL DEFAULT 0,
  date date NOT NULL,
  device varchar(20) NOT NULL DEFAULT 'desktop',
  country varchar(10) NOT NULL DEFAULT 'usa',
  searchType varchar(20) NOT NULL DEFAULT 'web',
  createdAt timestamp NOT NULL DEFAULT (now()),
  KEY idx_search_perf_page (page(768))
)`;

/**
 * Boot a fresh MySQL and apply the full nickstire schema.
 * Returns { url, port, stop } — always call stop() (try/finally) or the
 * child MySQL process leaks until the node process exits.
 */
export async function startDevDb({ dbName = "nickstire", applySchema = true, quiet = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(`[dev-db] ${m}`);
  const t0 = Date.now();
  log("booting MySQL (first run downloads a binary, ~150MB, cached after)...");
  const db = await createDB({ dbName, logLevel: "ERROR" });
  const url = `mysql://${db.username}@127.0.0.1:${db.port}/${db.dbName}`;
  log(`up in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${url}`);

  const stop = async () => { try { await db.stop(); } catch { /* already gone */ } };

  if (!applySchema) return { url, port: db.port, stop };

  try {
    const shimConn = await mysql.createConnection({ uri: url });
    await shimConn.query(SEARCH_PERFORMANCE_SHIM);
    await shimConn.end();

    log("applying schema (drizzle-kit push)...");
    const push = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
      cwd: NICKSTIRE_DIR,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      shell: true,
      timeout: 240000,
    });
    if (push.status !== 0) {
      throw new Error(`drizzle-kit push failed (exit ${push.status}): ${(push.stderr || push.stdout || "").slice(-400)}`);
    }

    const verifyConn = await mysql.createConnection({ uri: url });
    const [[{ n }]] = await verifyConn.query(
      "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ?", [dbName],
    );
    await verifyConn.end();
    if (n !== EXPECTED_TABLE_COUNT) {
      throw new Error(
        `schema applied ${n}/${EXPECTED_TABLE_COUNT} tables. If this dropped, the search_performance shim likely drifted from drizzle/schema.ts — reconcile SEARCH_PERFORMANCE_SHIM in scripts/lib/dev-db.mjs.`,
      );
    }
    log(`schema applied: ${n}/${EXPECTED_TABLE_COUNT} tables`);
  } catch (err) {
    await stop();
    throw err;
  }

  return { url, port: db.port, stop };
}
