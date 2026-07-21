import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiHandler } from "@/lib/utils/http";
import { requireSession, requireCronAuth, requireSyncAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

/**
 * truth-substrate audit P0 (#9) · route-security CONTRACT test.
 *
 * The whole vitest suite globally mocks @/lib/auth-guard so every guard SUCCEEDS
 * (tests/setup/auth-guard-mock.ts) — convenient for business-logic tests, but it
 * means NO route test can ever observe a 401, and the ~158 auth:"owner" routes /
 * 37 crons had zero negative-auth coverage. apiHandler is the single enforcement
 * chokepoint; this test overrides the global mock so a guard THROWS, then asserts
 * the mechanism actually returns 401 (and that auth:"none" skips the guard).
 */

const req = (method = "GET") => new Request("http://localhost/api/test", { method });
const okHandler = async () => ({ ok: true });

async function statusOf(res: Response | unknown): Promise<number> {
  return (res as Response).status;
}

describe("apiHandler auth enforcement (audit #9)", () => {
  beforeEach(() => {
    // Reset call history (the global mock is process-wide and accumulates across
    // tests), then restore the "authenticated" default the global mock provides.
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue({
      id: "operator-1",
      email: "nick@example.com",
      role: "operator",
    } as never);
    vi.mocked(requireCronAuth).mockReturnValue(undefined as never);
    vi.mocked(requireSyncAuth).mockReturnValue(undefined as never);
  });

  it("owner route → 401 when requireSession throws (the negative-auth path)", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const route = apiHandler(okHandler, { auth: "owner" });
    const res = await route(req(), { params: Promise.resolve({}) });
    expect(await statusOf(res)).toBe(401);
  });

  it("owner route → 200 when the session is valid", async () => {
    const route = apiHandler(okHandler, { auth: "owner" });
    const res = await route(req(), { params: Promise.resolve({}) });
    expect(await statusOf(res)).toBe(200);
    expect(vi.mocked(requireSession)).toHaveBeenCalledTimes(1);
  });

  it("cron route → 401 when requireCronAuth throws (bad/missing CRON_SECRET)", async () => {
    vi.mocked(requireCronAuth).mockImplementationOnce(() => {
      throw new ServiceError("Unauthorized", 401);
    });
    const route = apiHandler(okHandler, { auth: "cron" });
    const res = await route(req("POST"), { params: Promise.resolve({}) });
    expect(await statusOf(res)).toBe(401);
  });

  it("sync route → 401 when requireSyncAuth throws (bad/missing sync key)", async () => {
    vi.mocked(requireSyncAuth).mockImplementationOnce(() => {
      throw new ServiceError("Unauthorized", 401);
    });
    const route = apiHandler(okHandler, { auth: "sync" });
    const res = await route(req("POST"), { params: Promise.resolve({}) });
    expect(await statusOf(res)).toBe(401);
  });

  it("auth:\"none\" route NEVER invokes the session guard (public-by-design)", async () => {
    // Even if requireSession would throw, a none-auth route must not call it.
    vi.mocked(requireSession).mockRejectedValue(new ServiceError("Unauthorized", 401));
    const route = apiHandler(okHandler, { auth: "none" });
    const res = await route(req(), { params: Promise.resolve({}) });
    expect(await statusOf(res)).toBe(200);
    expect(vi.mocked(requireSession)).not.toHaveBeenCalled();
  });

  it("owner-guard rejection surfaces the guard's status code, not a generic 500", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Forbidden", 403));
    const route = apiHandler(okHandler, { auth: "owner" });
    const res = await route(req(), { params: Promise.resolve({}) });
    expect(await statusOf(res)).toBe(403);
  });
});
