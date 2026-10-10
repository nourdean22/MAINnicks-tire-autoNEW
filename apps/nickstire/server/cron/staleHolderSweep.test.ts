/**
 * Stale-holder lock sweep (2026-10-10).
 *
 * Two prompt-evolution runs died when a deploy replaced the container mid-run
 * and their cron locks stayed held for the full TTL. Pins: the sweep deletes
 * only live locks whose holder is ANOTHER replica, never ours; it does
 * nothing without a replica id (local); a DB error logs and does nothing;
 * the scheduler arms it at startup; the timer never keeps the process alive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sliceBlock } from "../testUtils/sourceBlock";

vi.mock("../lib/logger", () => {
  const l: Record<string, unknown> = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  l.child = () => l;
  return { createLogger: () => l };
});

import { releaseLocksOfDeadHolders, scheduleStaleHolderSweep, STALE_HOLDER_SWEEP_DELAY_MS } from "./index";

/** A db whose execute answers the SELECT with `rows` and records every statement's text + params. */
function fakeDb(rows: Array<{ name: string; holder: string }>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db = {
    execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
      const chunks = (q?.queryChunks ?? []) as unknown[];
      // drizzle: a StringChunk carries `value: string[]`; a bound value is a Param (`value`) or the raw primitive.
      const isText = (c: unknown): c is { value: string[] } => !!c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value);
      const text = chunks.map((c) => (isText(c) ? c.value.join("") : "?")).join("");
      const params = chunks.filter((c) => !isText(c)).map((c) => (c && typeof c === "object" && "value" in (c as object) ? (c as { value: unknown }).value : c));
      calls.push({ text, params });
      return text.includes("SELECT") ? [rows] : [{ affectedRows: 1 }];
    }),
  };
  return { db: db as never, calls };
}

describe("releaseLocksOfDeadHolders", () => {
  it("deletes live locks held by other replicas, by name and holder, and reports them", async () => {
    const { db, calls } = fakeDb([
      { name: "prompt-evolution-weekly", holder: "e857eb33-57ca-4045-8eb8-565d811bac28:30" },
      { name: "reel-pipeline", holder: "de2d56f5-9782-43ba-ae52-a3eb7636d150:30" },
    ]);
    const r = await releaseLocksOfDeadHolders({ replicaId: "11111111-2222-4333-8444-555555555555", db });
    expect(r.released).toEqual([
      { name: "prompt-evolution-weekly", holder: "e857eb33-57ca-4045-8eb8-565d811bac28:30" },
      { name: "reel-pipeline", holder: "de2d56f5-9782-43ba-ae52-a3eb7636d150:30" },
    ]);
    // The SELECT excludes our own replica and dead (already expired) rows.
    expect(calls[0].text).toContain("locked_until > NOW()");
    expect(calls[0].text).toContain("holder NOT LIKE");
    expect(calls[0].params).toEqual(["11111111-2222-4333-8444-555555555555:%"]);
    // One DELETE per row, pinned to name AND holder so a lock re-taken by us in between is never deleted.
    expect(calls.slice(1).map((c) => c.text)).toEqual([
      "DELETE FROM cron_locks WHERE name = ? AND holder = ?",
      "DELETE FROM cron_locks WHERE name = ? AND holder = ?",
    ]);
    expect(calls[1].params).toEqual(["prompt-evolution-weekly", "e857eb33-57ca-4045-8eb8-565d811bac28:30"]);
  });

  it("nothing to release is a quiet no-op; no replica id (local) never queries; a DB error logs and does nothing", async () => {
    const clean = fakeDb([]);
    expect((await releaseLocksOfDeadHolders({ replicaId: "r1", db: clean.db })).released).toEqual([]);
    expect(clean.calls).toHaveLength(1);

    const local = fakeDb([{ name: "x", holder: "other:1" }]);
    expect((await releaseLocksOfDeadHolders({ replicaId: undefined, db: local.db })).released).toEqual([]);
    expect(local.calls).toHaveLength(0);

    const broken = { execute: vi.fn(async () => { throw new Error("db down (test)"); }) } as never;
    await expect(releaseLocksOfDeadHolders({ replicaId: "r1", db: broken })).resolves.toEqual({ released: [] });
  });

  it("the scheduler arms the sweep at startup with an unref'd timer, two minutes after boot", () => {
    const src = readFileSync(resolve(__dirname, "scheduler.ts"), "utf8");
    const block = sliceBlock(src, "export function startTieredScheduler(): void {", "for (const tier of tiers)", { label: "scheduler.ts startTieredScheduler" });
    expect(block).toContain("scheduleStaleHolderSweep()");
    expect(STALE_HOLDER_SWEEP_DELAY_MS).toBe(120_000);

    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "setTimeout");
      scheduleStaleHolderSweep(5_000);
      scheduleStaleHolderSweep(5_000); // armed once per process
      const armed = spy.mock.calls.filter((c) => c[1] === 5_000);
      expect(armed).toHaveLength(1);
      const handle = spy.mock.results[spy.mock.results.length - 1]?.value as { hasRef?: () => boolean } | undefined;
      if (handle && typeof handle.hasRef === "function") expect(handle.hasRef()).toBe(false);
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
