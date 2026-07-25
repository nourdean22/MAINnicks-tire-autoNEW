/**
 * Stale-'sending' recovery tests (ROS-058 close-out).
 *
 * The crash-orphan contract: a row stuck in 'sending' is either pronounced
 * failed (ancient — never zombie-sent) or re-queued (stale — the normal
 * machinery re-sends), and the boot pass recovers BEFORE the queued SELECT
 * so a flipped row rides the same rehydrate.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executed: string[] = [];
let affected: number[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      executed.push(JSON.stringify(q));
      return [{ affectedRows: affected.shift() ?? 0 }, []];
    },
  }),
  getDbTyped: async () => null,
}));

import { recoverStaleSendingRows } from "./sms";

const read = () => readFileSync(resolve(process.cwd(), "server/sms.ts"), "utf8");

beforeEach(() => {
  executed.length = 0;
  affected = [];
});

describe("recoverStaleSendingRows", () => {
  it("pronounces ancient orphans failed FIRST, then re-queues stale ones", async () => {
    affected = [2, 3];
    const out = await recoverStaleSendingRows();
    expect(out).toEqual({ failedAncient: 2, requeued: 3 });
    expect(executed).toHaveLength(2);
    expect(executed[0]).toMatch(/failed/);
    expect(executed[0]).toMatch(/48 HOUR/);
    expect(executed[1]).toMatch(/queued/);
    expect(executed[1]).toMatch(/10 MINUTE/);
  });

  it("both updates target ONLY outbound rows stuck in 'sending'", async () => {
    affected = [0, 0];
    await recoverStaleSendingRows();
    for (const q of executed) {
      expect(q).toMatch(/'sending'/);
      expect(q).toMatch(/'outbound'/);
    }
  });

  it("a clean queue recovers nothing and stays silent (transitions-only logging)", async () => {
    affected = [0, 0];
    const out = await recoverStaleSendingRows();
    expect(out).toEqual({ failedAncient: 0, requeued: 0 });
  });
});

describe("wiring pins", () => {
  it("the boot pass AWAITS recovery before the queued rehydrate SELECT", () => {
    const s = read();
    const recoveryAt = s.indexOf("await recoverStaleSendingRows()");
    const selectAt = s.indexOf('eq(smsMessages.status, "queued")');
    expect(recoveryAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(recoveryAt);
  });

  it("the timer runs recovery throttled — an orphan never waits for a restart", () => {
    const s = read();
    expect(s).toMatch(/STALE_RECOVERY_THROTTLE_MS = 5 \* 60_000/);
    expect(s).toMatch(/Date\.now\(\) - lastStaleRecoveryAt > STALE_RECOVERY_THROTTLE_MS/);
  });
});
