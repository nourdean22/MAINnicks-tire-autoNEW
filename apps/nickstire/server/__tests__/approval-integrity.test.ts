import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function adminCtx(userId = 101): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `admin-user-${userId}`,
      email: `admin-${userId}@nickstire.com`,
      name: `Admin User ${userId}`,
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("Reel Approval & Publishing Integrity", () => {
  const caller = appRouter.createCaller(adminCtx());

  it("blocked briefs cannot enqueue due to safety validation", async () => {
    const invalidBrief = {
      selectedCaption: "We guarantee this is the cheapest shop in Cleveland!",
      campaignKeyword: "educational",
      topic: "brakes",
      storyboardBeats: [{ beatNumber: 1, visual: "Rusting rotor" }],
      hashtags: ["tires"],
      sourceType: "review",
      sourceId: "99999",
    };
    await expect(caller.contentAdmin.enqueueReelJob({ brief: invalidBrief })).rejects.toThrow();
  });

  it("stageDraft rejects Reel format drafts", async () => {
    await expect(
      caller.instagramAdmin.stageDraft({
        format: "reel",
        caption: "Banned Reel",
        sourceType: "review",
      })
    ).rejects.toThrow();
  });

  it("fail closed when Gemini model requested but key is missing", async () => {
    const origKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      const { invokeLLM } = await import("../_core/llm");
      await expect(
        invokeLLM({
          model: "gemini-1.5-pro",
          messages: [{ role: "user", content: "hello" }],
        })
      ).rejects.toThrow(/GEMINI_API_KEY is missing/);
    } finally {
      process.env.GEMINI_API_KEY = origKey;
    }
  });

  it("fail closed when OpenAI model requested but key is missing", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      const { invokeLLM } = await import("../_core/llm");
      await expect(
        invokeLLM({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hello" }],
        })
      ).rejects.toThrow(/OPENAI_API_KEY is missing/);
    } finally {
      process.env.OPENAI_API_KEY = origKey;
    }
  });
});
