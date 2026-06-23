import { describe, expect, it, afterEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  processNextReelJob,
  processNextAssemblyJob,
  recoverStuckReelJobs,
  withTimeout,
} from "./services/reelPipeline";

function ctx(role: "admin" | "user" | null): TrpcContext {
  return {
    user:
      role === null
        ? null
        : {
            id: role === "admin" ? 1 : 2,
            openId: `${role}-user`,
            email: `${role}@nickstire.com`,
            name: `${role} User`,
            loginMethod: "manus",
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("reel pipeline — enqueue proc auth", () => {
  it("contentAdmin.enqueueReelJob is registered", () => {
    expect(appRouter._def.procedures["contentAdmin.enqueueReelJob"]).toBeDefined();
  });

  it("rejects non-admin callers with FORBIDDEN (before any DB write)", async () => {
    const caller = appRouter.createCaller(ctx("user"));
    await expect(caller.contentAdmin.enqueueReelJob({ brief: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("reel pipeline — generation kill switch", () => {
  const orig = process.env.REEL_GENERATION_ENABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.REEL_GENERATION_ENABLED;
    else process.env.REEL_GENERATION_ENABLED = orig;
  });

  it("processNextReelJob is a no-op unless REEL_GENERATION_ENABLED === 'true' (no DB or Higgsfield touched)", async () => {
    delete process.env.REEL_GENERATION_ENABLED;
    await expect(processNextReelJob()).resolves.toEqual({ processed: false });
    // Any value other than the exact string "true" must also stay off.
    process.env.REEL_GENERATION_ENABLED = "1";
    await expect(processNextReelJob()).resolves.toEqual({ processed: false });
  });

  it("processNextAssemblyJob shares the same kill switch (no ffmpeg/DB touched when off)", async () => {
    delete process.env.REEL_GENERATION_ENABLED;
    await expect(processNextAssemblyJob()).resolves.toEqual({ processed: false });
    process.env.REEL_GENERATION_ENABLED = "1";
    await expect(processNextAssemblyJob()).resolves.toEqual({ processed: false });
  });

  it("recoverStuckReelJobs shares the same kill switch (no DB touched when off)", async () => {
    delete process.env.REEL_GENERATION_ENABLED;
    await expect(recoverStuckReelJobs()).resolves.toEqual({ recovered: 0 });
    process.env.REEL_GENERATION_ENABLED = "1";
    await expect(recoverStuckReelJobs()).resolves.toEqual({ recovered: 0 });
  });
});

describe("reel pipeline — withTimeout", () => {
  it("resolves a promise that settles before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "fast")).resolves.toBe("ok");
  });

  it("rejects with a labeled timeout when the promise outlives the deadline", async () => {
    const slow = new Promise((res) => setTimeout(res, 10_000));
    try {
      await withTimeout(slow, 20, "gen beat 3");
      expect.fail("Should have rejected");
    } catch (e: any) {
      expect(e).toBeDefined();
      expect(e.message).toMatch(/gen beat 3 timed out after/);
    }
  });

  it("propagates the underlying rejection unchanged when it loses the race", async () => {
    const boom = Promise.reject(new Error("higgsfield 500"));
    try {
      await withTimeout(boom, 1000, "fast");
      expect.fail("Should have rejected");
    } catch (e: any) {
      expect(e).toBeDefined();
      expect(e.message).toBe("higgsfield 500");
    }
  });
});
