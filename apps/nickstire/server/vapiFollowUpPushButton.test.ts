/**
 * The admin panel's PUSH FOLLOW-UP ASSISTANT button calls
 * `vapi.updateFollowUpAssistant` with NO assistant id, so the server's own pin
 * (VAPI_FOLLOWUP_ASSISTANT_ID) must decide which assistant is patched — the same
 * rule `updateAssistant` already follows for the receptionist. Before
 * 2026-09-23 the id was required, no UI called the procedure, and the
 * follow-up prompt only reached Vapi through a terminal script.
 *
 * `fetch` is stubbed: the test reads which URL the push would PATCH, and nothing
 * reaches Vapi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function adminContext() {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

const calls: Array<{ url: string; method?: string }> = [];

describe("PUSH FOLLOW-UP ASSISTANT · the server's pin decides the target", () => {
  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(JSON.stringify({ id: "asst_canary" }), { status: 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const push = async (input?: { assistantId?: string }) => {
    const { appRouter } = await import("./routers");
    return appRouter.createCaller(adminContext()).vapi.updateFollowUpAssistant(input);
  };

  it("with no id, PATCHes the pinned follow-up assistant", async () => {
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    const res = await push();
    expect(res.success).toBe(true);
    const patch = calls.filter((c) => c.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(patch[0]!.url).toMatch(/\/assistant\/asst_canary$/);
  });

  it("with no id and no pin, refuses and calls nothing", async () => {
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "");
    const res = await push();
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/VAPI_FOLLOWUP_ASSISTANT_ID/);
    expect(calls).toHaveLength(0);
  });

  it("an explicit id still wins over the pin", async () => {
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    await push({ assistantId: "asst_other" });
    expect(calls.filter((c) => c.method === "PATCH")[0]!.url).toMatch(/\/assistant\/asst_other$/);
  });
});
