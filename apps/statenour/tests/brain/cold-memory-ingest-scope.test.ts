/**
 * tests/brain/cold-memory-ingest-scope.test.ts (R3-14 item 2)
 *
 * R3-09 files calendar events organised by someone else under source
 * "calendar:external". The "ingest" scope in lib/brain/cold-memory.ts is an
 * exact source list that named only "calendar_cron", so those events silently
 * dropped out of searchColdMemory({ scope: "ingest" }).
 *
 * The cold-memory module and the brain tool run for real; only the vector
 * search and prisma are mocked (same harness as cold-memory-stored-tier-taint).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", () => {
  const brainMemory = {
    findMany: vi.fn(async ({ select }: { select: Record<string, boolean> }) =>
      h.rows.map((r) => Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, r[k]]))),
    ),
  };
  const generic = () => new Proxy({}, { get: () => vi.fn(async () => null) });
  return { prisma: new Proxy({}, { get: (_t, p: string) => (p === "brainMemory" ? brainMemory : generic()) }) };
});
vi.mock("@/lib/brain/embedding-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brain/embedding-utils")>()),
  semanticSearch: vi.fn(async () => h.rows.map((r) => ({ sourceId: r.id, similarity: 0.9, hybridScore: 0.9 }))),
}));

import { currentTurn, withTurnContext } from "@/lib/agent/turn-context";
import { brainTools } from "@/lib/ai/tools/brain";
import { searchColdMemory } from "@/lib/brain/cold-memory";

const row = (id: string, source: string) => ({
  id,
  category: "calendar_upcoming",
  content: "Lunch with the supplier rep, Tuesday noon",
  source,
  confidence: 0.6,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  metadata: {},
  trustTier: null,
});

beforeEach(() => {
  h.rows = [];
});

describe("cold memory ingest scope covers external calendar events", () => {
  it("an ingest-scope search returns a calendar:external row", async () => {
    h.rows = [row("ext", "calendar:external")];
    const out = await searchColdMemory("lunch", { scope: "ingest" });
    expect(out.map((m) => m.id)).toEqual(["ext"]);
  });

  it("the tool returns it AND taints the turn (the row is third-party text)", async () => {
    h.rows = [row("ext", "calendar:external")];
    const out = await withTurnContext({}, async () => {
      const res = (await (brainTools.searchColdMemory as unknown as {
        execute: (i: unknown, o: unknown) => Promise<{ count: number }>;
      }).execute({ query: "lunch", scope: "ingest", limit: 5, minScore: 0.25 }, { toolCallId: "t1", messages: [] }));
      return { count: res.count, tainted: currentTurn()?.untrustedInput === true };
    });
    expect(out.count).toBe(1);
    expect(out.tainted).toBe(true);
  });

  it("CONTROL - the operator's own calendar_cron row is still in scope", async () => {
    h.rows = [row("own", "calendar_cron")];
    const out = await searchColdMemory("lunch", { scope: "ingest" });
    expect(out.map((m) => m.id)).toEqual(["own"]);
  });

  it("CONTROL - a non-ingest source stays out of the ingest scope", async () => {
    h.rows = [row("man", "manual")];
    const out = await searchColdMemory("lunch", { scope: "ingest" });
    expect(out).toEqual([]);
  });
});
