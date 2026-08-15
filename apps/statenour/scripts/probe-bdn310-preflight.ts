#!/usr/bin/env tsx
/**
 * BDN-310 preflight — READ-ONLY. No DDL, no DML.
 *
 * prod-db-guard requires proving which database you are pointed at and
 * what state it is in BEFORE a schema change, rather than assuming.
 * apply-pending-migration.ts prints neither, so this does.
 *
 * Checks:
 *   1. the host + database actually connected to
 *   2. the table exists under the name the migration hardcodes. This
 *      check EARNED ITS KEEP: the first draft targeted "BrainMemory",
 *      but the Prisma model carries @@map("brain_memories"), so every
 *      statement would have failed against prod.
 *   3. which of the four columns already exist (idempotency check)
 *   4. whether the FK and the three indexes already exist
 *   5. row count, so the FK-validation scan's cost is known up front
 *
 * Only SELECTs against pg_catalog / information_schema.
 */

import pg from "pg";

const { Client } = pg;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const who = await client.query<{
    db: string;
    usr: string;
    srv: string;
    ver: string;
  }>(
    "SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS srv, version() AS ver",
  );
  console.log("TARGET");
  console.log(`  database : ${who.rows[0].db}`);
  console.log(`  user     : ${who.rows[0].usr}`);
  console.log(`  version  : ${who.rows[0].ver.split(",")[0]}`);

  const tbl = await client.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE 'brain_memories'",
  );
  console.log(`\nTABLE\n  match    : ${tbl.rows.map((r) => r.table_name).join(", ") || "(none)"}`);
  if (!tbl.rows.some((r) => r.table_name === "brain_memories")) {
    console.log('  ** "brain_memories" NOT found — the migration would fail.');
    await client.end();
    process.exit(1);
  }

  const cols = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='brain_memories'
        AND column_name IN ('valid_from','valid_until','last_verified_at','superseded_by_id')
      ORDER BY column_name`,
  );
  const present = cols.rows.map((r) => r.column_name);
  console.log("\nTARGET COLUMNS (expect none before the first apply)");
  for (const c of ["valid_from", "valid_until", "last_verified_at", "superseded_by_id"]) {
    console.log(`  ${present.includes(c) ? "EXISTS " : "absent "} ${c}`);
  }

  const con = await client.query<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE conname = 'brain_memories_superseded_by_id_fkey'",
  );
  console.log(`\nFK       : ${con.rowCount ? "EXISTS" : "absent"}`);

  const idx = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename='brain_memories'
        AND indexname IN ('brain_memories_active_validity_idx','brain_memories_superseded_by_id_idx','brain_memories_last_verified_at_idx')`,
  );
  console.log(`INDEXES  : ${idx.rows.map((r) => r.indexname).join(", ") || "none of the three"}`);

  const n = await client.query<{ c: string }>('SELECT count(*)::text AS c FROM "brain_memories"');
  console.log(`\nROWS     : ${n.rows[0].c} (FK validation scans this once)`);

  // pgvector sanity — the standing warning is that a careless schema op
  // drops it. Recorded BEFORE, so the after-check has something to
  // compare against.
  const vec = await client.query<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'vector'",
  );
  console.log(`PGVECTOR : ${vec.rowCount ? "installed" : "** NOT INSTALLED **"}`);

  await client.end();
}

main().catch((e) => {
  console.error("preflight failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
