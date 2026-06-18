import { describe, expect, it, afterEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { processNextReelJob, processNextAssemblyJob } from "./services/reelPipeline";

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
});
