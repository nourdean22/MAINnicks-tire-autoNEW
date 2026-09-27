import { describe, expect, it, vi } from "vitest";

const runs = new Map<string, Record<string, any>>();
let insertAttempts = 0;

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          // Force every existence check to MISS. This simulates stale readers:
          // both callers must rely on the deterministic PK upsert, not the read.
          orderBy: () => ({ limit: async () => [] }),
          // advanceContentRun's follow-up read sees the canonical row.
          limit: async () => {
            const row = runs.get("run_reel_77");
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, any>) => ({
        onDuplicateKeyUpdate: async () => {
          insertAttempts += 1;
          if (!runs.has(String(value.id))) {
            runs.set(String(value.id), { ...value, costCents: value.costCents ?? 0 });
          }
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, any>) => ({
        where: async () => {
          const row = runs.get("run_reel_77");
          if (!row) return [{ affectedRows: 0 }];
          Object.assign(row, patch);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  }),
}));

import { ensureContentRunForReelJob } from "./services/contentRun";

describe("Reel content-run parent is atomic when the existence read is stale", () => {
  it("repeated stale misses upsert the same deterministic parent instead of creating duplicates", async () => {
    runs.clear();
    insertAttempts = 0;

    const a = await ensureContentRunForReelJob({ reelJobId: 77, source: "cron", topic: "brakes" });
    const b = await ensureContentRunForReelJob({ reelJobId: 77, source: "cron", topic: "brakes" });

    expect(insertAttempts).toBe(2);
    expect(a).toBe("run_reel_77");
    expect(b).toBe("run_reel_77");
    expect([...runs.keys()]).toEqual(["run_reel_77"]);
    expect(runs.get("run_reel_77")).toMatchObject({
      reelJobId: 77,
      requestedFormat: "reel",
    });
  });
});
