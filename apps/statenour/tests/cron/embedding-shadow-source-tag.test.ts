/**
 * tests/cron/embedding-shadow-source-tag.test.ts · truth sweep 2026-10-23, acceptance 4.
 *
 * A sweep over eleven source tables that throws one driver message ("operator does not exist",
 * "canceling statement due to statement timeout") does not say WHICH table. The cron's failure
 * reason is now that message, so the source type rides in front of it. Behaviour is unchanged: the
 * same queries run in the same order, the same error is thrown, only its text gains a prefix.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { sweepEmbeddingShadow } from "@/lib/db/embedding-shadow";

const source = { sourceType: "probe_src", table: "probe_tbl" } as never;

function fakePrisma(failOn: (sql: string) => boolean) {
  return {
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (failOn(sql)) throw new Error("operator does not exist: integer = text");
      if (/information_schema\.tables/.test(sql)) return [{ n: 1 }];
      return [{ n: 0 }];
    }),
    $executeRawUnsafe: vi.fn(async () => 0),
  } as never;
}

describe("sweepEmbeddingShadow · names the source that threw", () => {
  it("a count query that throws is prefixed with its source type", async () => {
    await expect(
      sweepEmbeddingShadow({ prisma: fakePrisma((sql) => /COUNT\(\*\)::int AS n\s+FROM vector_embeddings/.test(sql)), sources: [source] }),
    ).rejects.toThrow(/^probe_src: operator does not exist: integer = text$/);
  });

  it("a table-existence read that throws is prefixed too", async () => {
    await expect(
      sweepEmbeddingShadow({ prisma: fakePrisma((sql) => /information_schema\.tables/.test(sql)), sources: [source] }),
    ).rejects.toThrow(/^probe_src: operator does not exist/);
  });

  it("control: a sweep that works returns its report unchanged", async () => {
    const report = await sweepEmbeddingShadow({ prisma: fakePrisma(() => false), sources: [source] });
    expect(report.refused).toBe(false);
    expect(report.sources.map((s) => s.sourceType)).toEqual(["probe_src"]);
  });
});
