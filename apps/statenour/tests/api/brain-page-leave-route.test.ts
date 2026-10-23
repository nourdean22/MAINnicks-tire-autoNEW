/**
 * POST /api/brain/page-leave (2026-10-23, usage telemetry). The close/hide path cannot use a tRPC
 * mutation (the page is going away), so PageTracker sends a keepalive fetch here. Same auth as the
 * page-visit routes (requireSession); a beacon has no readable response, so success is a bare 204.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create } } }));

import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
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
    ["dwell negative", { page: "/", dwellMs: -5, reason: "route" }, false],
    ["page longer than 512 characters", { page: "/" + "a".repeat(512), dwellMs: 5, reason: "route" }, false],
  ])("answers 400 and stores nothing when the body is %s", async (_n, body, raw) => {
    const res = await post(body, raw as boolean);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("answers 401 (not a 500) when there is no session, and stores nothing", async () => {
    // /api/brain is a public prefix in lib/security/route-policy.ts, so this route is the only gate.
    // A thrown ServiceError would be a 500 plus a Sentry event for every expired PWA tab.
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const res = await post({ page: "/chat", dwellMs: 5, reason: "route" });
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("any failure of the session guard is a 401 and stores nothing", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("auth backend down"));
    const res = await post({ page: "/chat", dwellMs: 5, reason: "route" });
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("the guard runs before the body is read: a malformed body without a session is 401, not 400", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const res = await post("{oops", true);
    expect(res.status).toBe(401);
  });

  it("answers 400 for a dwell of 1e999 (JSON parses it to Infinity) and for an empty page", async () => {
    const infinite = await post('{"page":"/chat","dwellMs":1e999,"reason":"route"}', true);
    const empty = await post({ page: "", dwellMs: 5, reason: "route" });
    expect(infinite.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("answers 5xx (not 204) when the write failed, so a dead writer is not read as stored", async () => {
    create.mockRejectedValue(new Error("db down"));
    const res = await post({ page: "/chat", dwellMs: 5, reason: "route" });
    expect(res.status).toBe(503);
  });
});
