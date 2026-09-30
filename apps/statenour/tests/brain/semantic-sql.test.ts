/**
 * Q-17 · semantic stage scored in Postgres — the Node side of the contract.
 *
 * The SQL itself is proven against a real pgvector in semantic-sql.pg.test.ts.
 * This file pins what Node does with the rows: which score wins, when the JSON
 * fallback is used, and that the novelty window reproduces the old in-memory
 * `accepted` list exactly (same pairs, same multiplier).
 */
import { describe, it, expect, vi } from "vitest";
import {
  noveltyWindowSims,
  scoreCandidatesInSql,
  pairKey,
  SEMANTIC_SCORE_SQL,
  NOVELTY_PAIR_SQL,
  type RawQueryClient,
} from "@/lib/brain/semantic-sql";
import { noveltyMultiplier, noveltyMultiplierFromSims } from "@/lib/brain/contextual-recall";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

describe("scoreCandidatesInSql", () => {
  it("uses the SQL score, falls back to JSON only when the vector column is empty, and skips the rest", async () => {
    const q = [1, 0, 0];
    const db: RawQueryClient = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        { id: "sql", score: 0.42, json: null },
        { id: "fallback", score: null, json: JSON.stringify([1, 1, 0]) },
        { id: "other-width", score: null, json: null },
        { id: "fallback-wrong-width", score: null, json: JSON.stringify([1, 1]) },
        { id: "corrupt", score: null, json: "{not json" },
        { id: "nan", score: Number.NaN, json: null },
      ]) as RawQueryClient["$queryRawUnsafe"],
    };
    const out = await scoreCandidatesInSql(db, q, ["sql", "fallback"]);

    expect(db.$queryRawUnsafe).toHaveBeenCalledWith(SEMANTIC_SCORE_SQL, "[1,0,0]", ["sql", "fallback"], 3);
    expect(out.scores.get("sql")).toBe(0.42);
    expect(out.scores.get("fallback")).toBeCloseTo(Math.SQRT1_2, 12);
    expect([...out.scores.keys()].sort()).toEqual(["fallback", "sql"]);
    expect([...out.sqlIds]).toEqual(["sql"]);
    expect([...out.fallbackVectors.keys()]).toEqual(["fallback"]);
    expect(out.rowsFound).toBe(6);
    expect(out.corrupted).toBe(1);
  });

  it("the statement ships no vector column back — only id, score and the fallback JSON", () => {
    const select = SEMANTIC_SCORE_SQL.slice(0, SEMANTIC_SCORE_SQL.indexOf("FROM"));
    expect(select).toMatch(/AS id/);
    expect(select).toMatch(/AS score/);
    expect(select).toMatch(/CASE WHEN ve\.embedding_vec IS NULL THEN ve\.embedding END AS json/);
    expect(select).not.toMatch(/embedding_vec_1536/);
    expect(NOVELTY_PAIR_SQL.slice(NOVELTY_PAIR_SQL.lastIndexOf("SELECT"))).not.toMatch(/\.vec\s+AS/);
  });
});

describe("noveltyWindowSims reproduces the in-memory novelty pass", () => {
  // The pre-Q-17 loop, verbatim in shape: walk the ranking, compare each vector
  // against the last 5 accepted vectors, push, cap.
  function oldPass(ranked: string[], vectors: Map<string, number[]>): Map<string, number> {
    const out = new Map<string, number>();
    const accepted: number[][] = [];
    for (const id of ranked) {
      const vec = vectors.get(id);
      out.set(id, noveltyMultiplier(vec, accepted, true));
      if (vec) {
        accepted.push(vec);
        if (accepted.length > 5) accepted.shift();
      }
    }
    return out;
  }

  it("fallback-only rows (computed in Node) give the identical multiplier for every candidate", async () => {
    const r = rng(17);
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const vectors = new Map<string, number[]>();
    // every third memory has no vector at all; they must be skipped from the window
    ids.forEach((id, i) => {
      if (i % 3 !== 2) vectors.set(id, Array.from({ length: 16 }, r));
    });
    const db: RawQueryClient = { $queryRawUnsafe: vi.fn() as RawQueryClient["$queryRawUnsafe"] };

    const { simsById, mixedPairsSkipped } = await noveltyWindowSims(
      db,
      ids,
      { sqlIds: new Set(), fallbackVectors: vectors },
      5,
      16,
    );
    const expected = oldPass(ids, vectors);
    for (const id of ids) {
      const sims = simsById.get(id);
      const got = sims ? noveltyMultiplierFromSims(sims, true) : 1.0;
      expect(got).toBeCloseTo(expected.get(id)!, 12);
    }
    expect(mixedPairsSkipped).toBe(0);
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("SQL rows: asks Postgres for exactly the windowed pairs, by rank among vector-bearing ids", async () => {
    const r = rng(5);
    const ids = ["a", "gap", "b", "c", "d", "e", "f", "g"];
    const vectors = new Map(ids.filter((id) => id !== "gap").map((id) => [id, Array.from({ length: 8 }, r)]));
    const sqlIds = new Set(vectors.keys());
    // A fake Postgres that returns EVERY earlier pair, ignoring the window —
    // so the Node side's own window is what this test pins (the real SQL
    // bounds it too; the pg test covers that half).
    const db: RawQueryClient = {
      $queryRawUnsafe: vi.fn(async (_sql: string, ordered: string[], ranks: number[]) => {
        const rows: { a: string; b: string; sim: number }[] = [];
        ordered.forEach((a, i) =>
          ordered.forEach((b, j) => {
            if (ranks[j] < ranks[i]) {
              rows.push({ a, b, sim: cosineSimilarity(vectors.get(a)!, vectors.get(b)!) });
            }
          }),
        );
        return rows;
      }) as unknown as RawQueryClient["$queryRawUnsafe"],
    };

    const { simsById } = await noveltyWindowSims(db, ids, { sqlIds, fallbackVectors: new Map() }, 5, 8);
    const call = (db.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(NOVELTY_PAIR_SQL);
    expect(call[1]).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(call[2]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(call.slice(3)).toEqual([5, 8]);

    const expected = oldPass(ids, vectors);
    for (const id of ids) {
      const sims = simsById.get(id);
      expect(sims ? noveltyMultiplierFromSims(sims, true) : 1.0).toBeCloseTo(expected.get(id)!, 12);
    }
    // "g" is 7th among vector-bearing ids: compared with ranks 2..6 only
    expect(simsById.get("g")).toHaveLength(5);
  });

  it("a pair with one side in SQL and one in JSON is skipped and counted, never guessed", async () => {
    const db: RawQueryClient = { $queryRawUnsafe: vi.fn() as RawQueryClient["$queryRawUnsafe"] };
    const { simsById, mixedPairsSkipped } = await noveltyWindowSims(
      db,
      ["s", "j"],
      { sqlIds: new Set(["s"]), fallbackVectors: new Map([["j", [1, 0]]]) },
      5,
      2,
    );
    expect(mixedPairsSkipped).toBe(1);
    expect(simsById.get("j")).toEqual([]);
    expect(noveltyMultiplierFromSims([], true)).toBe(1.0);
  });

  it("pairKey is order-independent", () => {
    expect(pairKey("x", "y")).toBe(pairKey("y", "x"));
  });
});
