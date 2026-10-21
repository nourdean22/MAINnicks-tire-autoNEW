/**
 * A REJECTED standby heartbeat must not write camera_health_events (job
 * 2026-10-21-shop-eyes-ears-pro, S2).
 *
 * mysql2 connects with FOUND_ROWS, so an ON DUPLICATE KEY UPDATE whose guarded SET left every
 * column unchanged still reports affectedRows 1. The route read that as "accepted" and logged a
 * transition for every refused heartbeat: production 2026-10-21 held 2529 rows in 24 h from a p2
 * standby ("UNVERIFIED_CAPABILITIES -> MEDIA_DEGRADED" every ~30 s) while p1 owned the office row,
 * and lot.health counted each one as a drop.
 *
 * The fake below applies the real authority rule (cameraProducerAuthority) to a stored row and,
 * like mysql2 with FOUND_ROWS, ALWAYS answers affectedRows 1. Only the stored row's owner and
 * sequence say whether THIS heartbeat was applied.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { producerInstanceId: string; heartbeatSeq: number; state: string; ageSeconds: number };

const h = vi.hoisted(() => ({
  row: null as Row | null,
  events: [] as Array<{ text: string; params: unknown[] }>,
  latestToState: "HEALTHY" as string | null,
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDbTyped: async () => ({ execute: (q: unknown) => fakeExecute(q) }),
}));

import type { Express, Request, Response } from "express";
import { HEARTBEAT_COLUMNS, registerCameraHeartbeatRoute } from "./cameraVisitsRoutes";
import { cameraProducerAuthority } from "./cameraProducerAuthority";
import { HEALTH_THRESHOLDS } from "../lib/cameraHealth";
import { resetStorableHeartbeatColumns } from "../lib/heartbeatStorableColumns";

function flat(q: unknown): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk((q as { queryChunks: unknown[] }).queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

async function fakeExecute(q: unknown): Promise<unknown> {
  const { text, params } = flat(q);
  if (text.includes("INFORMATION_SCHEMA.COLUMNS")) return [[], []];
  if (text.startsWith("SELECT state, producerInstanceId")) {
    const r = h.row;
    return [r ? [{ state: r.state, producerInstanceId: r.producerInstanceId, gapSeconds: r.ageSeconds, prevReceivedEpoch: Math.floor(Date.now() / 1000) - r.ageSeconds }] : [], []];
  }
  if (text.startsWith("INSERT INTO camera_runtime")) {
    const incoming = Object.fromEntries(HEARTBEAT_COLUMNS.map((c, i) => [c, params[i]])) as Record<string, unknown>;
    const applies = h.row === null || cameraProducerAuthority.heartbeatAuthorityAccepted({
      incomingId: String(incoming.producerInstanceId),
      incomingSeq: Number(incoming.heartbeatSeq),
      storedId: h.row.producerInstanceId,
      storedSeq: h.row.heartbeatSeq,
      storedAgeSeconds: h.row.ageSeconds,
    });
    if (applies) {
      h.row = { producerInstanceId: String(incoming.producerInstanceId), heartbeatSeq: Number(incoming.heartbeatSeq), state: String(incoming.state), ageSeconds: 0 };
    }
    // FOUND_ROWS: a matched-but-unchanged duplicate still counts as one affected row.
    return [{ affectedRows: 1 }, []];
  }
  if (text.includes("FROM camera_runtime WHERE camera = ? LIMIT 1")) {
    return [h.row ? [{ producerInstanceId: h.row.producerInstanceId, heartbeatSeq: h.row.heartbeatSeq }] : [], []];
  }
  if (text.startsWith("SELECT toState FROM camera_health_events")) return [h.latestToState ? [{ toState: h.latestToState }] : [], []];
  if (text.startsWith("INSERT INTO camera_health_events")) {
    h.events.push({ text, params });
    return [{ affectedRows: 1 }, []];
  }
  if (text.includes("FROM commissioning_runs")) return [[], []];
  throw new Error(`cameraHeartbeatApplied.test: unexpected query ${text.slice(0, 100)}`);
}

let handler: (req: Request, res: Response) => Promise<unknown>;
const app = { post: (_path: string, fn: typeof handler) => { handler = fn; } } as unknown as Express;
registerCameraHeartbeatRoute(app);

async function post(producerInstanceId: string, heartbeatSeq: number, extra: Record<string, unknown> = {}) {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) { status = code; return this; },
    json(b: Record<string, unknown>) { body = b; return this; },
  } as unknown as Response;
  const now = new Date().toISOString();
  await handler({
    headers: { "x-sync-key": "test-key" },
    body: { camera: "office", producerInstanceId, heartbeatSeq, observedAtEdge: now, sourceConnected: true, lastHealthyFrameAt: now, ...extra },
  } as unknown as Request, res);
  return { status, body };
}

const origKey = process.env.CAMERA_INGEST_KEY;
beforeEach(() => {
  process.env.CAMERA_INGEST_KEY = "test-key";
  resetStorableHeartbeatColumns();
  h.events = [];
  h.latestToState = "HEALTHY";
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  if (origKey === undefined) delete process.env.CAMERA_INGEST_KEY;
  else process.env.CAMERA_INGEST_KEY = origKey;
  vi.restoreAllMocks();
});

describe("camera heartbeat: only an APPLIED heartbeat writes camera_health_events", () => {
  it("p2 against a fresh p1 owner: refused, zero events; then p1 changes state: exactly one", async () => {
    h.row = { producerInstanceId: "p1-shop-office-a", heartbeatSeq: 50, state: "STORED_STATE_THAT_DIFFERS", ageSeconds: 10 };

    const standby = await post("p2-nicksmax-b", 7);
    expect(standby.status).toBe(200);
    expect(standby.body.authoritative).toBe(false);
    expect(standby.body.transition).toBeNull();
    expect(h.events).toHaveLength(0);
    expect(h.row!.producerInstanceId).toBe("p1-shop-office-a");

    // A standby whose own sequence happens to equal the stored one is still refused: applied
    // needs this producer AND this sequence, not either.
    const sameSeq = await post("p2-nicksmax-b", 50);
    expect(sameSeq.body.authoritative).toBe(false);
    expect(h.events).toHaveLength(0);

    const owner = await post("p1-shop-office-a", 51);
    expect(owner.body.authoritative).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].params).toContain("p1-shop-office-a");
  });

  it("the retro/resumption branch is gated too: a refused standby after a health-stale gap writes nothing", async () => {
    const gap = HEALTH_THRESHOLDS.staleAfterSeconds + 5;
    // The window this case lives in: stale for health, still fresh for authority.
    expect(gap).toBeLessThan(cameraProducerAuthority.staleSeconds);
    h.row = { producerInstanceId: "p1-shop-office-a", heartbeatSeq: 50, state: "HEALTHY", ageSeconds: gap };
    const standby = await post("p2-nicksmax-b", 7);
    expect(standby.body.authoritative).toBe(false);
    expect(h.events).toHaveLength(0);
  });

  it("a replayed (older) sequence from the owner itself writes nothing", async () => {
    h.row = { producerInstanceId: "p1-shop-office-a", heartbeatSeq: 50, state: "STORED_STATE_THAT_DIFFERS", ageSeconds: 10 };
    await post("p1-shop-office-a", 49);
    expect(h.events).toHaveLength(0);
  });

  it("control: a first heartbeat and a stale-owner takeover each still log their transition", async () => {
    h.row = null;
    await post("p1-shop-office-a", 1);
    expect(h.events).toHaveLength(1);
    h.row = { ...h.row!, ageSeconds: cameraProducerAuthority.staleSeconds + 1 };
    const takeover = await post("p2-nicksmax-b", 1);
    expect(takeover.body.authoritative).toBe(true);
    expect(h.events).toHaveLength(2);
  });
});
