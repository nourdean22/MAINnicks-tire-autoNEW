/**
 * POST /api/outcomes/rate · audit 2026-10-10 (06-F8). A failed write must not be
 * reported as "already rated": the service worker would tell the operator their
 * verdict exists when nothing was stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordOutcomeResult } = vi.hoisted(() => ({ recordOutcomeResult: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn(async () => undefined) }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordOutcomeResult }));

import { POST } from "@/app/api/outcomes/rate/route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/outcomes/rate", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => recordOutcomeResult.mockReset());

describe("/api/outcomes/rate · tri-state", () => {
  it("recorded → ok, recorded", async () => {
    recordOutcomeResult.mockResolvedValue("recorded");
    const res = await post({ id: "r1", useful: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: true, alreadyRated: false });
  });

  it("already → ok, alreadyRated", async () => {
    recordOutcomeResult.mockResolvedValue("already");
    expect(await (await post({ id: "r1", useful: false })).json()).toEqual({ ok: true, recorded: false, alreadyRated: true });
  });

  it("failed → 503, never alreadyRated", async () => {
    recordOutcomeResult.mockResolvedValue("failed");
    const res = await post({ id: "r1", useful: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, recorded: false, alreadyRated: false, error: "could not record" });
  });
});
