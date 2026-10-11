/**
 * 07-X4 · the two retired-stub POSTs (notifications, habits) relied on the proxy session gate alone.
 * check:get-auth scans read handlers only, so this pins the mutating half by behaviour: with the
 * session guard rejecting, each POST answers 401 and its body never runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

// No DB: the request log is fire-and-forget telemetry, so a create that resolves keeps the handler path clean.
vi.mock("@/lib/prisma", () => ({
  prisma: { apiRequestLog: { create: vi.fn().mockResolvedValue({}) } },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn(() => 0),
}));

const post = (body: unknown) =>
  new Request("http://localhost/api/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = { params: Promise.resolve({}) };

describe("owner-gated retired POST stubs (07-X4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset drains a rejection a red run left unconsumed; clearAllMocks does not.
    vi.mocked(requireSession).mockReset().mockResolvedValue({ id: "operator-1", email: "nick@example.com", role: "operator" } as never);
  });

  it.each([
    ["notifications", () => import("@/app/api/notifications/route")],
    ["habits", () => import("@/app/api/habits/route")],
  ])("POST /api/%s is 401 without a session", async (_name, load) => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const { POST } = await load();
    const res = await POST(post({ channel: "x", recipient: "y", body: "z" }), ctx);
    expect(res.status).toBe(401);
    expect(vi.mocked(requireSession)).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["notifications", () => import("@/app/api/notifications/route")],
    ["habits", () => import("@/app/api/habits/route")],
  ])("CONTROL: POST /api/%s still answers 200 with a session", async (_name, load) => {
    const { POST } = await load();
    const res = await POST(post({ channel: "x", recipient: "y", body: "z" }), ctx);
    expect(res.status).toBe(200);
  });
});
