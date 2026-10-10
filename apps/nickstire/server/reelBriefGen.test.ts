import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { parseReelJson } from "./services/reelBriefGen";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_REEL_ASK, captionAskMismatch, stripCaptionAsks } from "../shared/reelAsk";

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

/**
 * THE GENERATED CAPTION AGREES WITH THE DECLARED END CARD (2026-10-10).
 *
 * Job 2070005: the prompt REQUIRED a "send this to someone..." sentence in the
 * caption while the brief declared `profile` (DEFAULT_REEL_ASK, end card "MORE
 * IN OUR BIO") — two asks on two surfaces, refused at assembly after five paid
 * clips. Two things are pinned: the instruction no longer demands a caption
 * ask, and the normaliser strips any ask the model writes anyway. The strip
 * itself is behaviour-tested in reelTextSurfaces.test.ts.
 */
describe("generateReelBriefAI: caption and ask.kind agree by construction", () => {
  const SRC = readFileSync(path.join(__dirname, "services", "reelBriefGen.ts"), "utf8");

  it("the prompt no longer requires a caption CTA, and says the end card is the one ask", () => {
    expect(SRC).not.toContain("SHARE CTA: the selectedCaption MUST include");
    expect(SRC).toContain("CAPTION ASK: the reel's ONE ask is the end card");
    expect(SRC).not.toContain("Name the PERSON to send it to, not the action.");
  });

  it("the generated caption passes through stripCaptionAsks against the declared ask; an operator caption does not", () => {
    const line = SRC.split("\n").find((l) => l.includes("selectedCaption: input.caption?.trim() ||"));
    expect(line, "the selectedCaption normalisation line moved").toBeDefined();
    expect(line).toContain("stripCaptionAsks(str(parsed.selectedCaption), DEFAULT_REEL_ASK)");
    expect(line).toMatch(/^\s*selectedCaption: input\.caption\?\.trim\(\) \|\| stripCaptionAsks/);
  });

  it("CONTROL: a brief that strips a send sentence under the default ask is what enqueue will accept", () => {
    const stripped = stripCaptionAsks("Bald tires slide first. Send this to someone whose tires look smooth.", DEFAULT_REEL_ASK);
    expect(stripped).toBe("Bald tires slide first.");
    expect(captionAskMismatch(stripped, DEFAULT_REEL_ASK)).toBeNull();
    expect(captionAskMismatch("Bald tires slide first. Send this to someone whose tires look smooth.", DEFAULT_REEL_ASK)).toMatch(/two different asks/);
  });
});
