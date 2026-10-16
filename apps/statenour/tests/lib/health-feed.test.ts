/**
 * UI v3 W1a review round 2, item 7: /api/health answers 503 when the system is merely degraded, and the
 * old apiFetch path turned that into a failed read ("State unknown" for a reachable, degraded system).
 * readHealthFeed parses the body whatever the HTTP status, and reports a real failure only when there is
 * no usable body.
 */
import { describe, expect, it } from "vitest";
import { readHealthFeed } from "@/lib/state/health-feed";

const res = (status: number, body: unknown, json = true) =>
  ({ ok: status < 400, status, json: async () => { if (!json) throw new Error("not json"); return body; } }) as unknown as Response;

describe("readHealthFeed", () => {
  it("a 503 with a status body is a degraded reading, not a failed read", async () => {
    expect(await readHealthFeed(async () => res(503, { status: "degraded", alerts: { value: { unresolved: 2 } } }))).toEqual({
      status: "degraded",
      alerts: { value: { unresolved: 2 } },
    });
  });

  it("a 200 body comes back as is, unwrapped from an envelope when there is one", async () => {
    expect(await readHealthFeed(async () => res(200, { status: "healthy" }))).toEqual({ status: "healthy" });
    expect(await readHealthFeed(async () => res(200, { ok: true, meta: {}, data: { status: "healthy" } }))).toEqual({ status: "healthy" });
  });

  it("a network error, a non-JSON body, or a body without a status is a failed read (null)", async () => {
    expect(await readHealthFeed(async () => { throw new Error("offline"); })).toBeNull();
    expect(await readHealthFeed(async () => res(503, null, false))).toBeNull();
    expect(await readHealthFeed(async () => res(500, { error: "boom" }))).toBeNull();
  });
});
