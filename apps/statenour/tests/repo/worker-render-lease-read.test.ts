/**
 * The worker's render loop must read the leased item out of statenour's API envelope.
 *
 * GET /api/sync/queue/render returns `{ ok, item }`, which apiHandler wraps as
 * `{ ok, data: { ok, item }, meta }`. The loop read `body.item` (always undefined), so
 * since #300 every poll leased an approved reel and rendered nothing; after three
 * expired leases the route retired the reel as rejected (rejectedBy system:render-lease).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readApiData } from "../../../worker/src/forward";

const item = { id: "q1", content: "c", kind: "reel", sourceMetadata: null };

describe("readApiData", () => {
  it("unwraps the apiHandler envelope", () => {
    expect(readApiData({ ok: true, data: { ok: true, item }, meta: {} })).toEqual({ ok: true, item });
  });

  it("a body without an envelope is read as the data itself", () => {
    expect(readApiData({ ok: true, item })).toEqual({ ok: true, item });
  });

  it("an envelope that failed has no data", () => {
    expect(readApiData({ ok: false, error: "Unauthorized", meta: {} })).toBeUndefined();
  });

  it("garbage is undefined, never a throw", () => {
    for (const v of [null, undefined, "x", 42, []]) expect(readApiData(v)).toBeUndefined();
  });
});

describe("the render loop reads the lease through readApiData", () => {
  const src = readFileSync(resolve(__dirname, "../../../worker/src/scheduler.ts"), "utf8");

  it("does not read body.item off the raw response", () => {
    expect(src).not.toMatch(/body\.item/);
    expect(src).toMatch(/readApiData\(/);
  });
});
