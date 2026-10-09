/**
 * The Creative Assistant's angleBank reader, against a faked database
 * (2026-10-08). Until now only its pure half (shared/angleBank.ts) was tested;
 * the reader itself — which statuses it counts, how it reads the operator's
 * slate, what a corrupt payload or a missing database does — was typecheck-only.
 * It is driven through the public entry, buildCreativeAssistant with its real
 * default readers, and asserted on the query the driver would see and on the
 * Sources line the operator reads.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A006's pack. A004's brake pack left the rotation on 2026-10-08 (its beats name no
// object), so a slate of it would read as unreadable, not as a two-pack slate.
const NO_START = "2026-08-19-wont-start-battery-starter-alternator";
const POTHOLE = "2026-08-17-pothole-damage";

const state = vi.hoisted(() => ({
  dbAvailable: true,
  reelRows: [] as Array<{ payload: string | null }>,
  slateRows: [] as Array<{ key: string; value: string; updatedAt: Date | null; updatedBy: string | null }>,
  /** The bound values of each reel_jobs WHERE the angle-bank query sends. */
  reelWhereParams: [] as unknown[][],
}));

/** Collect the bound parameter values of a drizzle SQL object, in order. */
function boundParams(node: unknown, out: unknown[] = []): unknown[] {
  if (node && typeof node === "object") {
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (Array.isArray(chunks)) { for (const c of chunks) boundParams(c, out); return out; }
    if ("value" in (node as object) && !Array.isArray((node as { value?: unknown }).value)) { out.push((node as { value: unknown }).value); return out; }
    if (Array.isArray((node as { value?: unknown }).value)) return out; // a raw SQL string chunk
    if ("name" in (node as object) && "table" in (node as object)) return out; // a column
  }
  if (Array.isArray(node)) { for (const n of node) boundParams(n, out); return out; }
  if (typeof node !== "object") out.push(node);
  return out;
}

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const chain = (rows: () => unknown[], onWhere?: (w: unknown) => void) => {
    const q: Record<string, unknown> = {};
    const done = () => Promise.resolve(rows());
    q.where = (w: unknown) => { onWhere?.(w); return q; };
    q.orderBy = () => q;
    q.limit = () => done();
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej);
    return q;
  };
  const fake = {
    select: () => ({
      from: (t: Record<string, unknown>) => {
        if ("payload" in t && "mp4Url" in t) return chain(() => state.reelRows, (w) => state.reelWhereParams.push(boundParams(w)));
        if ("key" in t && "value" in t && "updatedBy" in t) return chain(() => state.slateRows);
        return chain(() => []);
      },
    }),
  };
  return { ...actual, getDb: async () => (state.dbAvailable ? fake : null), getDbTyped: async () => (state.dbAvailable ? fake : null) };
});

import { ACTIVE_REEL_SLATE_CURSOR_KEY, ACTIVE_REEL_SLATE_KEY } from "./approvedReelPackRotation";
import { buildCreativeAssistant } from "./creativeAssistant";

const slate = (slugs: unknown, cursor?: string) => [
  { key: ACTIVE_REEL_SLATE_KEY, value: typeof slugs === "string" ? slugs : JSON.stringify({ slugs }), updatedAt: null, updatedBy: "owner" },
  ...(cursor === undefined ? [] : [{ key: ACTIVE_REEL_SLATE_CURSOR_KEY, value: cursor, updatedAt: null, updatedBy: "owner" }]),
];
const sources = async () => (await buildCreativeAssistant(undefined, new Date("2026-10-08T20:00:00Z"))).inputs.angleBank;

// The readers import ../db concurrently; resolve the async mock factory once first, or the
// first test's parallel imports can race it and reach the real module (seen: one getDb call
// for five readers, all "no database").
beforeAll(async () => { await import("../db"); });

beforeEach(() => {
  state.dbAvailable = true;
  state.reelRows = [];
  state.slateRows = [];
  state.reelWhereParams = [];
});

describe("Creative Assistant → Sources → angleBank, read from the database", () => {
  it("counts packs from Reels in EITHER live status, and asks for exactly those two", async () => {
    state.reelRows = [
      { payload: JSON.stringify({ approvedPackSlug: NO_START }) },
      { payload: JSON.stringify({ approvedPackSlug: POTHOLE }) },
      { payload: JSON.stringify({ approvedPackSlug: NO_START }) }, // the same pack twice is one pack
      { payload: "{corrupt" }, // unreadable payload: not evidence either way
      { payload: null },
    ];
    const line = await sources();
    expect(line).toMatch(/^20 production-ready angles of 100: 20 with a pack, 12 in rotation, 2 published; held out of the rotation: proof-01-uneven-wear, /);
    expect(state.reelWhereParams).toContainEqual(["posted", "published"]);
  });

  it("an operator slate narrows 'in rotation' to its packs", async () => {
    state.slateRows = slate([NO_START, POTHOLE], "0");
    expect(await sources()).toContain("2 in rotation (active slate of 2), 0 published");
  });

  it("a slate whose cursor has passed its last pack is named as used up", async () => {
    state.slateRows = slate([NO_START, POTHOLE], "2");
    expect(await sources()).toContain("2 in rotation (active slate of 2, used up, so the lane holds)");
  });

  it("an unreadable slate counts nothing in rotation and says the lane holds", async () => {
    state.slateRows = slate("{not json");
    expect(await sources()).toContain("0 in rotation (the active slate is unreadable, so the lane holds)");
  });

  it("no database is an error input, never a line of zeros", async () => {
    state.dbAvailable = false;
    expect(await sources()).toBe("error: no database");
  });
});
