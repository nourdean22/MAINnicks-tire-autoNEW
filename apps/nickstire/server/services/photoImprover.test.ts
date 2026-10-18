/**
 * photoImprover -- the two legs behind instagramStudio.checkPhoto / brandedPhoto.
 *
 * Fakes only: analyzePhoto and generateImage are the lower layers a live call would spend credit
 * on, so both are mocked whole (every export the service imports, no partial factory). The cases
 * that matter most are the unhappy ones: a vision outage and a reply that is not a scorecard must
 * each come back as a NAMED failure, never as a default number (empty-vs-error).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { analyzePhoto, generateImage } = vi.hoisted(() => ({ analyzePhoto: vi.fn(), generateImage: vi.fn() }));
vi.mock("./vision-analyzer", () => ({ analyzePhoto }));
vi.mock("../_core/imageGeneration", () => ({ generateImage }));

import { analyzePhotoForShop, renderBrandedScene, photoAnalysisSchema } from "./photoImprover";

const PHOTO = "https://cdn.example.test/ig-evidence/1-2-front.jpg";

const SCORECARD = {
  scores: { lighting: 72, framing: 64, brandPresence: 40, cleanliness: 81, professionalPolish: 58, overall: 63 },
  subject: "Storefront from across the street",
  currentMood: "clean, plain",
  issues: ["Sign is in shadow", "Parked van blocks the left bay door"],
  improvements: [
    { type: "lighting", instruction: "Shoot in the morning so the sign faces the sun.", priority: "high" },
    { type: "framing", instruction: "Step left so the van is out of frame.", priority: "medium" },
  ],
  marketingFit: { instagram: "ok", facebook: "good", gbp: "good", billboard: "bad", best: "gbp" },
  rebrandPrompt:
    "Professional automotive photography of an independent Cleveland tire shop storefront, gold #FDB913 accent on the sign, clean bays, morning light.",
};

/** The vision backend's ok reply: the model's text lands in `description`. */
function visionSays(text: string) {
  return { ok: true, description: text, source: "gemini", modelName: "gemini-2.5-flash", latencyMs: 900 };
}

beforeEach(() => {
  analyzePhoto.mockReset();
  generateImage.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analyzePhotoForShop", () => {
  it("returns the scorecard for a valid reply, tagged with the model that said it", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(SCORECARD)));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.analysis).toEqual(SCORECARD);
    expect(r.model).toBe("gemini-2.5-flash");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("asks the vision layer for the internal, explicitly-keyed path with the scorecard prompt (an image model, no vendor model name)", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(SCORECARD)));
    await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
    const arg = analyzePhoto.mock.calls[0][0];
    expect(arg).toMatchObject({ photoUrl: PHOTO, provider: "gemini", internal: true });
    expect(arg.prompt).toContain("rebrandPrompt");
    expect(arg.prompt).toContain("an image model");
    expect(arg.prompt).not.toMatch(/recraft/i);
  });

  it("reads JSON wrapped in ```json fences", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays("```json\n" + JSON.stringify(SCORECARD) + "\n```"));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r.ok).toBe(true);
  });

  it("reads JSON with a sentence of chatter around it", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays("Here is the scorecard:\n" + JSON.stringify(SCORECARD) + "\nHope that helps."));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r.ok).toBe(true);
  });

  it("a vision outage is vision_unavailable with no analysis key, never a score", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: false, error: "gemini 503: overloaded", reason: "http_error" });
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "vision_unavailable" });
    expect(r).not.toHaveProperty("analysis");
    expect(analyzePhoto).toHaveBeenCalledTimes(1);
  });

  it("a timeout and a missing provider key from the vision layer are also vision_unavailable", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: false, error: "timeout", reason: "timeout" });
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "vision_unavailable" });
    analyzePhoto.mockResolvedValueOnce({ ok: false, error: "GEMINI_API_KEY not set", reason: "no_provider" });
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "vision_unavailable" });
  });

  it("a vision layer that throws is vision_unavailable, not an exception into the router", async () => {
    analyzePhoto.mockRejectedValueOnce(new Error("socket hang up"));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "vision_unavailable" });
  });

  it("no vision key at all is vision_unavailable and the vision layer is never called", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "vision_unavailable" });
    expect(analyzePhoto).not.toHaveBeenCalled();
  });

  it("a URL the vision layer refuses (private host, unreachable photo) is invalid_url", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: false, error: "photoUrl is not a public HTTPS URL", reason: "invalid_url" });
    const r = await analyzePhotoForShop({ photoUrl: "http://192.168.1.5/a.jpg" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_url" });
  });

  it.each([
    ["prose with no JSON", "The photo shows a tire shop. It looks fine to me."],
    ["an empty reply", ""],
    ["JSON cut off mid-object (a token budget ran out)", JSON.stringify(SCORECARD).slice(0, 180)],
    ["a JSON array, not an object", "[1, 2, 3]"],
  ])("%s is unreadable, with no analysis key", async (_label, text) => {
    analyzePhoto.mockResolvedValueOnce(visionSays(text));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "unreadable" });
    expect(r).not.toHaveProperty("analysis");
  });

  it("a scorecard missing a field is unreadable: no default number stands in for it", async () => {
    const { rebrandPrompt: _drop, ...noPrompt } = SCORECARD;
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(noPrompt)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });

    const noLighting = { ...SCORECARD, scores: { ...SCORECARD.scores, lighting: undefined } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(noLighting)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("a score that is not a number is unreadable, not coerced", async () => {
    const bad = { ...SCORECARD, scores: { ...SCORECARD.scores, overall: "high" } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(bad)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("an off-list enum value is unreadable, not passed through", async () => {
    const bad = { ...SCORECARD, marketingFit: { ...SCORECARD.marketingFit, best: "tiktok" } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(bad)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("clamps scores to 0..100 and rounds them", async () => {
    const wild = { ...SCORECARD, scores: { lighting: 140, framing: -8, brandPresence: 55.6, cleanliness: 100, professionalPolish: 0, overall: 63 } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(wild)));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    if (!r.ok) throw new Error("unreachable");
    expect(r.analysis.scores).toEqual({ lighting: 100, framing: 0, brandPresence: 56, cleanliness: 100, professionalPolish: 0, overall: 63 });
  });

  it("caps the lists the model can pad, and keeps rebrandPrompt inside what brandedPhoto will accept (20..2000)", async () => {
    const padded = {
      ...SCORECARD,
      issues: Array.from({ length: 9 }, (_, i) => `issue ${i}`),
      rebrandPrompt: "x".repeat(2600),
    };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(padded)));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    if (!r.ok) throw new Error("unreachable");
    expect(r.analysis.issues).toHaveLength(5);
    expect(r.analysis.rebrandPrompt).toHaveLength(2000);

    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify({ ...SCORECARD, rebrandPrompt: "too short" })));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("the exported schema is the same gate (a client or test can validate with it)", () => {
    expect(photoAnalysisSchema.safeParse(SCORECARD).success).toBe(true);
    expect(photoAnalysisSchema.safeParse({ ...SCORECARD, subject: "" }).success).toBe(false);
  });
});

describe("renderBrandedScene", () => {
  const PROMPT = "Professional automotive photography of an independent Cleveland tire shop, gold #FDB913 accent.";

  it("calls the image generator exactly once and returns its URL", async () => {
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/generated/1.png" });
    const r = await renderBrandedScene({ prompt: PROMPT });
    expect(r).toMatchObject({ ok: true, imageUrl: "https://cdn.example.test/generated/1.png" });
    if (!r.ok) throw new Error("unreachable");
    expect(typeof r.model).toBe("string");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledWith({ prompt: PROMPT });
  });

  it("a generator that throws is image_unavailable, called once (no retry), and the provider's error text does not reach the caller", async () => {
    generateImage.mockRejectedValueOnce(new Error("Image generation request failed (429 Too Many Requests): quota exceeded for key AIza-secret"));
    const r = await renderBrandedScene({ prompt: PROMPT });
    expect(r).toMatchObject({ ok: false, reason: "image_unavailable" });
    expect(r).not.toHaveProperty("imageUrl");
    expect(generateImage).toHaveBeenCalledTimes(1);
    if (r.ok) throw new Error("unreachable");
    expect(r.message).not.toContain("AIza");
    expect(r.message).not.toContain("429");
  });

  it("a generator that returns no URL is image_unavailable, not an ok with an empty picture", async () => {
    generateImage.mockResolvedValueOnce({});
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: false, reason: "image_unavailable" });
    generateImage.mockResolvedValueOnce({ url: "" });
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: false, reason: "image_unavailable" });
    expect(generateImage).toHaveBeenCalledTimes(2);
  });
});
