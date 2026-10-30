import { describe, expect, it } from "vitest";
import { READS, guard, runReads } from "@/scripts/probe-brain-backfill-census";

describe("probe-brain-backfill-census is read-only", () => {
  it("POSITIVE CONTROL: the guard refuses a write and a stacked statement", () => {
    expect(() => guard("UPDATE brain_memories SET confidence = 1")).toThrow();
    expect(() => guard("SELECT 1; DELETE FROM brain_memories")).toThrow();
  });

  it.each(READS.map(([wave, name, sql]) => [`${wave} ${name}`, sql]))("%s passes the guard and selects no row text", (_n, sql) => {
    expect(() => guard(sql)).not.toThrow();
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
    expect(sql).not.toMatch(/SELECT[^(]*\b(content|raw_thoughts|note|dossier_md)\b[^(]*FROM/i);
  });
});

describe("the proof reads measure what the writers serve (Codex on PR 3379)", () => {
  it("the W1 gap counts only chats idle 30+ minutes, the same cutoff the distiller and the drain use", () => {
    const w1 = READS.find(([, name]) => name.startsWith("chats >=4 msgs"))![2];
    expect(w1).toContain("c.updated_at < now() - interval '30 minutes'");
  });

  it("vector reads use embedding_vec_1536, the column the recall KNN reads", () => {
    const vec = READS.filter(([, , sql]) => sql.includes("embedding_vec"));
    expect(vec.length).toBeGreaterThan(0); // POSITIVE CONTROL: the scan found the vector reads
    for (const [, , sql] of vec) expect(sql).not.toMatch(/embedding_vec IS NOT NULL/);
  });
});

describe("runReads", () => {
  const client = (failOn: string) => {
    const calls: string[] = [];
    return {
      calls,
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes(failOn)) throw new Error("canceling statement due to statement timeout");
        return { rows: [{ n: 1 }] };
      },
    };
  };

  it("a failed read is reported, the rest still run, and the run counts it as a failure", async () => {
    const c = client("trust_tier IS NULL");
    const lines: string[] = [];
    const failures = await runReads(c, (l) => lines.push(l));
    expect(failures).toBe(1);
    expect(lines.filter((l) => l.includes("\tERROR ")).length).toBe(1);
    expect(lines.length).toBe(READS.length);
    expect(c.calls.filter((s) => s === "ROLLBACK TO SAVEPOINT s")).toHaveLength(1);
  });

  it("a clean run reports zero failures", async () => {
    expect(await runReads(client("__never__"), () => {})).toBe(0);
  });
});
