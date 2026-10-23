/**
 * POST /api/brain/page-leave (2026-10-23, usage telemetry). The close/hide path cannot use a tRPC
 * mutation (the page is going away), so PageTracker sends a keepalive fetch here. Same auth as the
 * page-visit routes (requireSession); a beacon has no readable response, so success is a bare 204.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create } } }));

import { requireSession } from "@/lib/auth-guard";
import { POST } from "@/app/api/brain/page-leave/route";

const post = (body: unknown, raw = false) =>
  POST(new Request("http://localhost/api/brain/page-leave", { method: "POST", body: raw ? (body as string) : JSON.stringify(body) }));

// Braces matter: returning the mock makes vitest call it again as the test's teardown.
beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "evt" });
});

describe("POST /api/brain/page-leave", () => {
  it("stores one page_leave row and answers 204 with no body", async () => {
    const res = await post({ page: "/chat", dwellMs: 5_000, reason: "pagehide" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ eventType: "page_leave", detail: "/chat" });
  });

  it("accepts a beacon-style body (parsed from text, whatever the content type)", async () => {
    const res = await post(JSON.stringify({ page: "/", dwellMs: 1, reason: "hidden" }), true);
    expect(res.status).toBe(204);
  });

  it.each([
    ["not JSON", "{oops", true],
    ["no page", { dwellMs: 5, reason: "route" }, false],
    ["dwell not a number", { page: "/", dwellMs: "5", reason: "route" }, false],
    ["unknown reason", { page: "/", dwellMs: 5, reason: "nope" }, false],
  ])("answers 400 and stores nothing when the body is %s", async (_n, body, raw) => {
    const res = await post(body, raw as boolean);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("runs the session guard before anything else, and a refused session stores nothing", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(post({ page: "/chat", dwellMs: 5, reason: "route" })).rejects.toThrow("Unauthorized");
    expect(create).not.toHaveBeenCalled();
  });

  it("answers 5xx (not 204) when the write failed, so a dead writer is not read as stored", async () => {
    create.mockRejectedValue(new Error("db down"));
    const res = await post({ page: "/chat", dwellMs: 5, reason: "route" });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
