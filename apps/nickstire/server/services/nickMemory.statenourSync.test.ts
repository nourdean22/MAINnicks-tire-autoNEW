/**
 * Wave 4 (job 2026-10-18-bdnick-prune): syncMemoriesToStatenour posts the memory count and
 * types to bdnick.info, never the memory text, which names customers ("FULL CONVERSION:
 * Customer ...", "VIP customers: ..."). StateNour's insights receiver falls back to the title
 * when detail is absent (apps/statenour/app/api/sync/nour-os/route.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ROWS = [
  { id: 1, value: JSON.stringify({ type: "pattern", content: "FULL CONVERSION: Customer \"Sam Hill\" completed full journey", confidence: 0.9 }) },
  { id: 2, value: JSON.stringify({ type: "insight", content: "VIP customers (3+ visits in 60d): Jane Roe (4 visits, $900), call 2165550101", confidence: 0.8 }) },
];

/** recall() reads shop_settings through db-helper; the chain ends in .limit(). */
vi.mock("../lib/db-helper", () => {
  const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => ROWS };
  return { db: async () => ({ select: () => chain }) };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("syncMemoriesToStatenour", () => {
  it("posts the count and the type breakdown, not one word of memory text", async () => {
    vi.stubEnv("STATENOUR_SYNC_KEY", "test-key");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(String(init.body));
      return new Response("{}", { status: 200 });
    }));
    const { syncMemoriesToStatenour } = await import("./nickMemory");
    expect(await syncMemoriesToStatenour()).toBe(2);
    expect(bodies).toHaveLength(1);
    for (const id of ["Sam Hill", "Jane Roe", "2165550101", "FULL CONVERSION"]) expect(bodies[0]).not.toContain(id);
    const sent = JSON.parse(bodies[0]);
    expect(sent.module).toBe("insights");
    expect(sent.data).not.toHaveProperty("detail");
    expect(sent.data).toMatchObject({ insightType: "nick_memories", metadata: { memoryCount: 2 } });
  });
});
