/**
 * instagramStudio.checkPhoto / instagramStudio.brandedPhoto -- the admin Photo Improver, through
 * the real procedures (auth chain included) with only the two credit-spending layers faked.
 * The pure parsing and failure mapping is pinned in services/photoImprover.test.ts; this file pins
 * what the router adds: the admin gate, the input bounds, one generator call per tap, and that the
 * two procedures are mounted on the app router the client talks to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { analyzePhoto, generateImage } = vi.hoisted(() => ({ analyzePhoto: vi.fn(), generateImage: vi.fn() }));
vi.mock("../services/vision-analyzer", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/vision-analyzer")>()), analyzePhoto }));
vi.mock("../_core/imageGeneration", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_core/imageGeneration")>()), generateImage }));

import { instagramStudioRouter } from "./instagramStudio";
import { appRouter } from "../routers";
import { permissionForAdminProcedure } from "../../shared/adminPermissions";
import type { TrpcContext } from "../_core/context";

type Role = "admin" | "user" | null;

function caller(role: Role) {
  return instagramStudioRouter.createCaller({
    user: role
      ? { id: 1, openId: "openid-photo-admin", email: "a@b.com", name: "A", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

const PHOTO = "https://shop.example.test/generated/photo-check/1-2-front.jpg";
const PROMPT = "Professional automotive photography of an independent Cleveland tire shop, gold #FDB913 accent.";
const SCORECARD = {
  scores: { lighting: 72, framing: 64, brandPresence: 40, cleanliness: 81, professionalPolish: 58, overall: 63 },
  subject: "Storefront from across the street",
  currentMood: "clean, plain",
  issues: ["Sign is in shadow"],
  improvements: [{ type: "lighting", instruction: "Shoot in the morning so the sign faces the sun.", priority: "high" }],
  marketingFit: { instagram: "ok", facebook: "good", gbp: "good", billboard: "bad", best: "gbp" },
  rebrandPrompt: PROMPT,
};

beforeEach(() => {
  analyzePhoto.mockReset();
  generateImage.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("SITE_URL", "https://shop.example.test");
  vi.stubEnv("CLOUDFRONT_DOMAIN", "");
  // The admin gate reads its role row through the real db helper: no URL means "no handle", which
  // the middleware answers with the documented owner fallback instead of a connection attempt.
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin gate", () => {
  it.each([["a signed-in non-admin", "user" as Role], ["no session", null as Role]])(
    "checkPhoto refuses %s before any vision call",
    async (_label, role) => {
      await expect(caller(role).checkPhoto({ photoUrl: PHOTO })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(analyzePhoto).not.toHaveBeenCalled();
    },
  );

  it.each([["a signed-in non-admin", "user" as Role], ["no session", null as Role]])(
    "brandedPhoto refuses %s before any image call",
    async (_label, role) => {
      await expect(caller(role).brandedPhoto({ prompt: PROMPT })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(generateImage).not.toHaveBeenCalled();
    },
  );

  it("both procedures are on the app router the client calls, behind the marketing permission", () => {
    const names = Object.keys(appRouter._def.procedures);
    expect(names).toContain("instagramStudio.checkPhoto");
    expect(names).toContain("instagramStudio.brandedPhoto");
    expect(permissionForAdminProcedure("instagramStudio.checkPhoto", "mutation")).toBe("marketing.manage");
    expect(permissionForAdminProcedure("instagramStudio.brandedPhoto", "mutation")).toBe("marketing.manage");
  });
});

describe("instagramStudio.checkPhoto", () => {
  it("returns the scorecard for a vision reply that is one", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: true, description: JSON.stringify(SCORECARD), source: "gemini", modelName: "gemini-2.5-flash", latencyMs: 800 });
    const r = await caller("admin").checkPhoto({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: true, model: "gemini-2.5-flash", analysis: SCORECARD });
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
  });

  it("a vision outage is vision_unavailable, not a score", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: false, error: "gemini 503", reason: "http_error" });
    const r = await caller("admin").checkPhoto({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "vision_unavailable" });
    expect(r).not.toHaveProperty("analysis");
  });

  it("a reply with no JSON in it is unreadable, not a score", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: true, description: "Looks like a tire shop to me.", source: "gemini", modelName: "gemini-2.5-flash", latencyMs: 800 });
    const r = await caller("admin").checkPhoto({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
    expect(r).not.toHaveProperty("analysis");
  });

  it("a URL that is not on our own storage is invalid_url through the real procedure, and nothing is fetched", async () => {
    const r = await caller("admin").checkPhoto({ photoUrl: "http://169.254.169.254/latest/meta-data/" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(analyzePhoto).not.toHaveBeenCalled();
  });

  it.each([["not a url", "not a url"], ["an over-long url", `https://cdn.example.test/${"a".repeat(2100)}`]])(
    "rejects %s at the input, before any vision call",
    async (_label, photoUrl) => {
      await expect(caller("admin").checkPhoto({ photoUrl })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(analyzePhoto).not.toHaveBeenCalled();
    },
  );
});

describe("instagramStudio.brandedPhoto", () => {
  it("makes exactly one generator call per tap and returns its URL", async () => {
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/generated/9.png" });
    const r = await caller("admin").brandedPhoto({ prompt: PROMPT });
    expect(r).toMatchObject({ ok: true, imageUrl: "https://cdn.example.test/generated/9.png" });
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledWith({ prompt: PROMPT });
  });

  it("a generator failure is image_unavailable and is not retried", async () => {
    generateImage.mockRejectedValueOnce(new Error("Image generation request failed (500)"));
    const r = await caller("admin").brandedPhoto({ prompt: PROMPT });
    expect(r).toMatchObject({ ok: false, reason: "image_unavailable" });
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it.each([["19 characters", "x".repeat(19)], ["2001 characters", "x".repeat(2001)]])(
    "rejects a prompt of %s at the input, before any image call (no credit spent)",
    async (_label, prompt) => {
      await expect(caller("admin").brandedPhoto({ prompt })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(generateImage).not.toHaveBeenCalled();
    },
  );

  it("accepts the bounds themselves (20 and 2000 characters)", async () => {
    generateImage.mockResolvedValue({ url: "https://cdn.example.test/generated/10.png" });
    await expect(caller("admin").brandedPhoto({ prompt: "x".repeat(20) })).resolves.toMatchObject({ ok: true });
    await expect(caller("admin").brandedPhoto({ prompt: "x".repeat(2000) })).resolves.toMatchObject({ ok: true });
    expect(generateImage).toHaveBeenCalledTimes(2);
  });
});
