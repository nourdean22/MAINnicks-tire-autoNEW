import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { parseBriefJson } from "./services/carouselBriefGen";

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

describe("contentAdmin.generateCarouselBrief (auth gating)", () => {
  it("is registered in the appRouter", () => {
    expect(appRouter._def.procedures["contentAdmin.generateCarouselBrief"]).toBeDefined();
  });

  it("rejects unauthenticated callers with FORBIDDEN (before any LLM call)", async () => {
    const caller = appRouter.createCaller(ctx(null));
    await expect(caller.contentAdmin.generateCarouselBrief({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-admin callers with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctx("user"));
    await expect(caller.contentAdmin.generateCarouselBrief({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an over-long topic at input validation", async () => {
    const caller = appRouter.createCaller(ctx("admin"));
    await expect(
      caller.contentAdmin.generateCarouselBrief({ topic: "x".repeat(400) }),
    ).rejects.toBeTruthy();
  });
});

describe("parseBriefJson (resilient extraction)", () => {
  it("parses a clean JSON object", () => {
    expect(parseBriefJson('{"topic":"brakes","hashtags":["cleveland"]}')).toMatchObject({ topic: "brakes" });
  });

  it("strips a ```json markdown fence", () => {
    const fenced = '```json\n{"topic":"salt","slides":[]}\n```';
    expect(parseBriefJson(fenced)).toMatchObject({ topic: "salt" });
  });

  it("extracts the object when wrapped in stray prose", () => {
    const messy = 'Here is the winning brief:\n{"topic":"alignment"}\nThanks!';
    expect(parseBriefJson(messy)).toMatchObject({ topic: "alignment" });
  });
});
