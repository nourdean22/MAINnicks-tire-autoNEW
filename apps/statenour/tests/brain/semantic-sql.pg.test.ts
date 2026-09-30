/**
 * Q-17 · the queue's acceptance, against a REAL pgvector: scoring the
 * semantic stage in SQL must reproduce the old Node path to 1e-6.
 *
 * Runs only when SEMANTIC_SQL_PG_URL points at a throwaway Postgres with the
 * `vector` extension available (never a production URL — the test creates and
 * drops its own schema). Skipped otherwise, and says so: a skipped run is NOT
 * evidence. Local receipt in the Q-17 PR body; to rerun:
 *   SEMANTIC_SQL_PG_URL=postgres://postgres@localhost:55432/postgres \
 *     pnpm exec vitest run tests/brain/semantic-sql.pg.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  noveltyWindowSims,
  scoreCandidatesInSql,
  SEMANTIC_SCORE_SQL,
  type RawQueryClient,
} from "@/lib/brain/semantic-sql";
import { noveltyMultiplier, noveltyMultiplierFromSims } from "@/lib/brain/contextual-recall";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";

const URL = process.env.SEMANTIC_SQL_PG_URL;
const DIM = 1024;
const TOL = 1e-6;

function rng(seed: number) {
  let s = seed;
  return () => {
    // sum of 4 uniforms ≈ gaussian, enough spread for realistic cosines
    let t = 0;
    for (let i = 0; i < 4; i++) {
      s = (s * 1664525 + 1013904223) % 4294967296;
      t += s / 4294967296 - 0.5;
    }
    return t;
  };
}
const lit = (v: number[]) => `[${v.join(",")}]`;

describe.skipIf(!URL)("semantic stage in SQL == the old Node path (real pgvector)", () => {
  const client = new Client({ connectionString: URL });
  const schema = `q17_${process.pid}`;
  const db: RawQueryClient = {
    $queryRawUnsafe: async <T>(sql: string, ...values: unknown[]) =>
      (await client.query(sql, values)).rows as T,
  };
  const r = rng(2026);
  const query = Array.from({ length: DIM }, r);
  const ids: string[] = [];
  const jsonVecs = new Map<string, number[]>(); // what the OLD path would have parsed

  beforeAll(async () => {
    await client.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await client.query(`CREATE TABLE vector_embeddings (
      "sourceType" text NOT NULL, "sourceId" text NOT NULL, embedding text NOT NULL,
      embedding_vec vector, "createdAt" timestamptz NOT NULL DEFAULT now())`);

    const insert = (id: string, v: number[], withVec = true, createdAt = "2026-09-01") =>
      client.query(
        `INSERT INTO vector_embeddings ("sourceType","sourceId",embedding,embedding_vec,"createdAt")
         VALUES ('brain_memory',$1,$2,$3::vector,$4)`,
        [id, JSON.stringify(v), withVec ? lit(v) : null, createdAt],
      );

    for (let i = 0; i < 300; i++) {
      const id = `m${i}`;
      // mix in the query at varying strength so scores span a real range
      const w = (i % 10) / 10;
      const v = Array.from({ length: DIM }, (_, k) => r() + w * query[k]);
      await insert(id, v);
      ids.push(id);
      jsonVecs.set(id, v);
    }
    // a row with only the JSON column (never migrated) → fallback path
    const legacy = Array.from({ length: DIM }, r);
    await insert("legacy-json-only", legacy, false);
    ids.push("legacy-json-only");
    jsonVecs.set("legacy-json-only", legacy);
    // other width → skipped by both paths
    await insert("width-768", Array.from({ length: 768 }, r));
    ids.push("width-768");
    // zero vector → old cosine 0, raw pgvector NaN
    await insert("zero", new Array(DIM).fill(0));
    ids.push("zero");
    jsonVecs.set("zero", new Array(DIM).fill(0));
    // duplicate: an older, different vector for m0 — the NEWEST must win
    await insert("m0", Array.from({ length: DIM }, r), true, "2025-01-01");
    // a different source type with the same id must never leak in
    await client.query(
      `INSERT INTO vector_embeddings ("sourceType","sourceId",embedding,embedding_vec)
       VALUES ('chat','m1','[]',$1::vector)`,
      [lit(Array.from({ length: DIM }, r))],
    );
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  });

  it("POSITIVE CONTROL: raw pgvector really returns NaN for a zero vector (the guard is load-bearing)", async () => {
    const { rows } = await client.query(`SELECT ($1::vector <=> $2::vector)::float8 AS d`, [
      lit(new Array(DIM).fill(0)),
      lit(query),
    ]);
    expect(Number.isNaN(Number(rows[0].d))).toBe(true);
  });

  it("every score matches the Node cosine over the JSON column to 1e-6", async () => {
    const out = await scoreCandidatesInSql(db, query, ids);
    let maxDiff = 0;
    for (const [id, v] of jsonVecs) {
      const expected = cosineSimilarity(query, v);
      const got = out.scores.get(id);
      expect(got, id).toBeDefined();
      maxDiff = Math.max(maxDiff, Math.abs(got! - expected));
    }
    expect(maxDiff).toBeLessThan(TOL);
    expect(out.scores.has("width-768")).toBe(false);
    expect(out.scores.get("zero")).toBe(0);
    expect(out.sqlIds.has("legacy-json-only")).toBe(false);
    expect(out.fallbackVectors.has("legacy-json-only")).toBe(true);
    expect(out.sqlIds.size).toBe(301); // 300 + zero; m1's 'chat' row did not leak
    expect(out.rowsFound).toBe(303);
  });

  it("the novelty multipliers match the old in-memory pass to 1e-6 on a shuffled ranking", async () => {
    const semantic = await scoreCandidatesInSql(db, query, ids);
    const ranked = [...ids].sort((a, b) => (semantic.scores.get(b) ?? -1) - (semantic.scores.get(a) ?? -1));
    // the old pass held every vector (all rows had JSON); legacy is the only
    // JSON-fallback row, so pairs touching it are the documented mixed skip —
    // compare the old pass on the SQL-scored rows alone.
    const sqlRanked = ranked.filter((id) => semantic.sqlIds.has(id));
    const { simsById, mixedPairsSkipped } = await noveltyWindowSims(
      db,
      sqlRanked,
      { sqlIds: semantic.sqlIds, fallbackVectors: new Map() },
      5,
      DIM,
    );
    expect(mixedPairsSkipped).toBe(0);

    const accepted: number[][] = [];
    let maxDiff = 0;
    for (const id of sqlRanked) {
      const vec = jsonVecs.get(id)!;
      const expected = noveltyMultiplier(vec, accepted, true);
      const got = noveltyMultiplierFromSims(simsById.get(id) ?? [], true);
      maxDiff = Math.max(maxDiff, Math.abs(got - expected));
      accepted.push(vec);
      if (accepted.length > 5) accepted.shift();
    }
    expect(maxDiff).toBeLessThan(TOL);
  });

  it("a duplicate embedding row resolves to the newest one, deterministically", async () => {
    const { rows } = await client.query(SEMANTIC_SCORE_SQL, [lit(query), ["m0"], DIM]);
    expect(rows).toHaveLength(1);
    expect(Math.abs(Number(rows[0].score) - cosineSimilarity(query, jsonVecs.get("m0")!))).toBeLessThan(TOL);
  });
});
