/**
 * 03-F16: devices/queue GET marks commands "sent" and nothing ever reclaimed
 * them. An agent that crashed between the poll and the ack left the command
 * "sent" forever: never executed, never failed, invisible.
 *
 * Bounded reclaim, existing columns only: a `sent` command with no ack 1 h
 * after `sentAt` goes back to `pending` ONCE (the `error` column carries the
 * marker); unacked again 1 h after the re-send, it becomes `failed`.
 *
 * The fake store evaluates the real WHERE clauses, so a reclaim that matched
 * fresh or acked rows would show up here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
const { rows, hooks } = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  /** Set by the race test: holds each findMany until both pollers have read. */
  hooks: { afterFindMany: null as null | (() => Promise<void>) },
}));

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const v = row[k] as never;
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { lt?: Date; in?: unknown[] };
      if (c.lt !== undefined && !(v !== null && v < c.lt)) return false;
      if (c.in !== undefined && !c.in.includes(v)) return false;
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deviceCommand: {
      findMany: async ({ where, take }: { where: Row; take: number }) => {
        const out = [...rows.values()]
          .filter((r) => matches(r, where))
          .slice(0, take)
          .map((r) => ({ ...r, device: { id: r.deviceId, platform: "TUYA" } }));
        await hooks.afterFindMany?.();
        return out;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = [...rows.values()].filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  },
}));

import { GET } from "@/app/api/devices/queue/route";

const HOUR = 3_600_000;

function seed(id: string, status: string, sentAgoMs: number | null, extra: Row = {}) {
  rows.set(id, {
    id,
    deviceId: "dev1",
    command: "turn_on",
    params: null,
    status,
    sentAt: sentAgoMs === null ? null : new Date(Date.now() - sentAgoMs),
    ackedAt: null,
    error: null,
    createdAt: new Date(Date.now() - 3 * HOUR),
    ...extra,
  });
}

async function poll(): Promise<{ commands: Array<{ id: string }> }> {
  const res = await GET(new NextRequest("http://x/api/devices/queue"));
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  rows.clear();
  hooks.afterFindMany = null;
});

describe("devices/queue: a command is delivered to exactly one poller (claim-before-act)", () => {
  it("two concurrent polls that both read the same pending rows deliver each command once", async () => {
    seed("p1", "pending", null);
    seed("p2", "pending", null);
    // Both pollers finish their read before either claims: the race the old
    // "updateMany then return everything read" shape lost.
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((r) => (release = r));
    hooks.afterFindMany = async () => {
      if (++reads === 2) release();
      await bothRead;
    };

    const [a, b] = await Promise.all([poll(), poll()]);

    const delivered = [...a.commands, ...b.commands].map((c) => c.id).sort();
    expect(delivered).toEqual(["p1", "p2"]);
    expect(rows.get("p1")!.status).toBe("sent");
    expect(rows.get("p2")!.status).toBe("sent");
  });

  it("a single poll still delivers every pending command it claims", async () => {
    seed("p1", "pending", null);
    seed("p2", "pending", null);

    const out = await poll();

    expect(out.commands.map((c) => c.id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("devices/queue: a sent command with no ack is reclaimed once, then failed", () => {
  it("re-delivers a command sent 2 h ago with no ack", async () => {
    seed("c1", "sent", 2 * HOUR);

    const out = await poll();

    expect(out.commands.map((c) => c.id)).toEqual(["c1"]);
    expect(rows.get("c1")!.status).toBe("sent");
    expect((rows.get("c1")!.sentAt as Date).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("fails it when the re-send also goes unacked for an hour, and does not deliver it again", async () => {
    seed("c1", "sent", 2 * HOUR);
    await poll();
    rows.get("c1")!.sentAt = new Date(Date.now() - 2 * HOUR); // another unacked hour passes

    const out = await poll();

    expect(out.commands).toEqual([]);
    expect(rows.get("c1")!.status).toBe("failed");
    expect(String(rows.get("c1")!.error)).toMatch(/no ack/i);
  });

  it("leaves a command sent 30 min ago alone (still in flight)", async () => {
    seed("c2", "sent", 30 * 60_000);

    const out = await poll();

    expect(out.commands).toEqual([]);
    expect(rows.get("c2")!.status).toBe("sent");
  });

  it("never touches acked or failed commands", async () => {
    seed("c3", "acked", 5 * HOUR, { ackedAt: new Date() });
    seed("c4", "failed", 5 * HOUR, { error: "vendor said no" });

    await poll();

    expect(rows.get("c3")!.status).toBe("acked");
    expect(rows.get("c4")!.status).toBe("failed");
    expect(rows.get("c4")!.error).toBe("vendor said no");
  });
});
