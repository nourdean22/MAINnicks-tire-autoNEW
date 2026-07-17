import { afterEach, describe, expect, it } from "vitest";
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

describe("winning-concept emission (boost-score cap regression)", () => {
  afterEach(async () => {
    const { vi } = await import("vitest");
    vi.doUnmock("./_core/llm");
    vi.doUnmock("./services/evidenceEngine");
    vi.resetModules();
  });

  it("assembles the emitted winningConcept so the boost score's concept parts can pass", async () => {
    const { vi } = await import("vitest");
    const model = {
      topic: "First freeze battery check",
      mechanicTruth: "Cold cuts cranking power roughly in half",
      driverConfusion: "Slow crank feels normal in winter",
      clevelandAngle: "Lake-effect cold snaps hit Euclid first",
      seasonality: "first hard freeze",
      usefulAbsurdity: "battery as hibernating animal",
      campaignKeyword: "BATTERY",
      creativeTerritory: "weather_local_alert",
      typographyPlan: "bold gold on graphite",
      avoidedForRepetition: "pothole crime scenes",
      selectedCaption: "Cold mornings tell on weak batteries first.",
      captionHooks: ["First freeze = battery test"],
      hashtags: ["#cleveland"],
      slides: [1, 2, 3, 4, 5].map((n) => ({
        headline: `H${n}`, body: `B${n}`, visualPrompt: `V${n}`, textOverlayPlan: `T${n}`, qaNotes: `Q${n}`,
      })),
      winningConcept: {
        hook: "First freeze = battery test",
        driverEmotion: "quiet dread at the first cold start",
        saveShareReason: "checklist neighbors will need the same week",
        boostReason: "seasonal urgency",
        nickFitReason: "practical, no fear-selling",
        nonGenericReason: "hibernation metaphor, not stock advice",
        rejectionRisk: "none identified",
        scores: { hook: 10, truth: 10, save: 10, local: 10, absurdity: 9, fit: 9 },
      },
    };
    vi.doMock("./_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(model) } }] }),
    }));
    vi.doMock("./services/evidenceEngine", () => ({ getProprietaryEvidence: vi.fn().mockResolvedValue(undefined) }));
    vi.resetModules();
    const { generateCarouselBriefAI } = await import("./services/carouselBriefGen");
    const { calculateBoostScore } = await import("../client/src/lib/igCarouselStudio");

    const { brief } = await generateCarouselBriefAI({ topic: "battery" });
    expect(brief.winningConceptId).toBe("winner");
    expect(brief.concepts).toHaveLength(1);
    expect(brief.concepts[0].saveShareReason).toContain("checklist");
    expect(brief.concepts[0].slideOutline).toEqual(["H1", "H2", "H3", "H4", "H5"]);

    const score = calculateBoostScore(brief);
    const byLabel = Object.fromEntries(score.parts.map((p) => [p.label, p.ok]));
    expect(byLabel["Save/share reason"]).toBe(true);
    expect(score.parts.find((p) => p.label.startsWith("Winning concept"))?.ok).toBe(true);

  });
});
