import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { parseReelJson } from "./services/reelBriefGen";

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

describe("contentAdmin.generateReelBrief (auth gating)", () => {
  it("is registered in the appRouter", () => {
    expect(appRouter._def.procedures["contentAdmin.generateReelBrief"]).toBeDefined();
  });

  it("rejects unauthenticated callers with FORBIDDEN (before any LLM call)", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.contentAdmin.generateReelBrief({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin callers with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctx("user"));
    await expect(caller.contentAdmin.generateReelBrief({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an over-long topic at input validation", async () => {
    const caller = appRouter.createCaller(ctx("admin"));
    await expect(
      caller.contentAdmin.generateReelBrief({ topic: "x".repeat(400) }),
    ).rejects.toBeTruthy();
  });
});

describe("parseReelJson (resilient extraction)", () => {
  it("parses a clean JSON object", () => {
    expect(parseReelJson('{"topic":"brakes","storyboardBeats":[]}')).toMatchObject({ topic: "brakes" });
  });

  it("strips a ```json markdown fence", () => {
    expect(parseReelJson('```json\n{"topic":"salt"}\n```')).toMatchObject({ topic: "salt" });
  });

  it("extracts the object when wrapped in stray prose", () => {
    expect(parseReelJson('Winning reel:\n{"topic":"alignment"}\nDone.')).toMatchObject({ topic: "alignment" });
  });
});

describe("parseReelJson truncation detection (prod 2026-07-16)", () => {
  it("names token-budget truncation instead of 'Unexpected end of JSON input'", () => {
    const truncated = '{"caption":"Pothole season","storyboardBeats":[{"beatNumber":1,"onScreenText":"POTHOLE';
    expect(() => parseReelJson(truncated)).toThrowError(/TRUNCATED.*output-token budget/s);
  });

  it("detects mid-ARRAY truncation too (prod signature: \"Expected ',' or ']' after array element\")", () => {
    const midArray = '{"storyboardBeats":[{"beatNumber":1},{"beatNumber":2}';
    expect(() => parseReelJson(midArray)).toThrowError(/TRUNCATED/);
  });

  it("still parses complete JSON wrapped in a fence", () => {
    expect(parseReelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
