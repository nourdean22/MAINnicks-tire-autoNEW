/**
 * photoImprover -- the two legs behind instagramStudio.checkPhoto / brandedPhoto.
 *
 * Fakes only: analyzePhoto and generateImage are the lower layers a live call would spend credit
 * on, so both are mocked whole (every export the service imports, no partial factory). Storage keeps
 * its real URL and durability rules; only storageDelete is faked, so no test can reach a bucket.
 * The cases that matter most are the unhappy ones: a vision outage and a reply that is not a
 * scorecard must each come back as a NAMED failure, never as a default number (empty-vs-error).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { analyzePhoto, generateImage, storageDelete } = vi.hoisted(() => ({ analyzePhoto: vi.fn(), generateImage: vi.fn(), storageDelete: vi.fn() }));
vi.mock("./vision-analyzer", () => ({ analyzePhoto }));
vi.mock("../_core/imageGeneration", () => ({ generateImage }));
vi.mock("../storage", async (importOriginal) => ({ ...(await importOriginal<typeof import("../storage")>()), storageDelete }));

import { analyzePhotoForShop, renderBrandedScene } from "./photoImprover";

// A URL our own storage would hand back (SITE_URL is stubbed in beforeEach).
const PHOTO = "https://shop.example.test/generated/photo-check/1-2-front.jpg";

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

/** What the service returns for SCORECARD: the model's improvement `type` is dropped (nothing shows it). */
const PARSED = { ...SCORECARD, improvements: SCORECARD.improvements.map(({ instruction, priority }) => ({ instruction, priority })) };

/** The vision backend's ok reply: the model's text lands in `description`. */
function visionSays(text: string) {
  return { ok: true, description: text, source: "gemini", modelName: "gemini-2.5-flash", latencyMs: 900 };
}

beforeEach(() => {
  analyzePhoto.mockReset();
  generateImage.mockReset();
  storageDelete.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  vi.stubEnv("SITE_URL", "https://shop.example.test");
  vi.stubEnv("CLOUDFRONT_DOMAIN", "");
  vi.stubEnv("S3_BUCKET", "test-bucket");
  vi.stubEnv("REEL_ALLOW_EPHEMERAL_STORAGE", "");
});

describe("analyzePhotoForShop · the first live reply (2026-10-19, gemini-2.5-flash, storefront-day.webp)", () => {
  // Verbatim from the probe after the first live check came back "unreadable": complete, valid JSON,
  // but improvement 2 used a score name ("cleanliness") as its type, which the old enum refused.
  const LIVE_REPLY = "```json\n" + JSON.stringify({
    scores: { lighting: 70, framing: 40, brandPresence: 65, cleanliness: 50, professionalPolish: 45, overall: 50 },
    subject: "Exterior of Nick's Tire & Auto shop on a sunny day",
    currentMood: "Busy, functional",
    issues: [
      "Utility pole obstructs view of shop and signage.",
      "Clutter on lawn and around entrance.",
      "Power lines distracting in sky.",
      "Banners are wrinkled and not displayed well.",
    ],
    improvements: [
      { type: "framing", instruction: "Shoot from an angle that avoids the utility pole and power lines.", priority: "high" },
      { type: "cleanliness", instruction: "Remove all clutter from the lawn and shop entrance before shooting.", priority: "high" },
      { type: "brand", instruction: "Ensure banners are taut and professionally displayed, or remove them.", priority: "medium" },
      { type: "edit", instruction: "Adjust color balance and contrast to make the shop colors pop.", priority: "medium" },
    ],
    marketingFit: { instagram: "bad", facebook: "ok", gbp: "ok", billboard: "bad", best: "gbp" },
    rebrandPrompt:
      "A professional automotive photography shot of Nick's Tire & Auto, a Cleveland independent shop. The storefront is clean and modern, featuring a prominent sign with a gold #FDB913 accent. The entrance is inviting, with neatly arranged tires and no clutter. The lighting is bright and even, highlighting the shop's professional appearance. No distracting poles or power lines are visible.",
  }, null, 2) + "\n```";

  it("is a scorecard: an improvement's type is not shown anywhere, so a type off the old list does not sink it", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays(LIVE_REPLY));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error("unreachable");
    expect(r.analysis.scores.overall).toBe(50);
    expect(r.analysis.improvements).toHaveLength(4);
    expect(r.analysis.improvements[1]).toEqual({ instruction: "Remove all clutter from the lawn and shop entrance before shooting.", priority: "high" });
  });

  it("control: a priority off the list still fails the parse, because the card renders the priority", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays(LIVE_REPLY.replace('"priority": "medium"', '"priority": "urgent"')));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });
  });
});

describe("analyzePhotoForShop · the score-only photo is deleted after its check", () => {
  const EVIDENCE = "https://shop.example.test/generated/ig-evidence/1-2-front.jpg";

  it.each([
    ["a scorecard", () => analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(SCORECARD))), true],
    ["an unreadable reply", () => analyzePhoto.mockResolvedValueOnce(visionSays("no json here")), false],
    ["a vision outage", () => analyzePhoto.mockRejectedValueOnce(new Error("timeout")), false],
  ] as const)("after %s, photo-check/<key> is deleted once", async (_label, arrange, ok) => {
    arrange();
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r.ok).toBe(ok);
    expect(storageDelete).toHaveBeenCalledTimes(1);
    expect(storageDelete).toHaveBeenCalledWith("photo-check/1-2-front.jpg");
  });

  it("no Gemini key: nothing is scored and the photo is still deleted", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "vision_unavailable" });
    expect(storageDelete).toHaveBeenCalledWith("photo-check/1-2-front.jpg");
  });

  it("a Studio evidence photo (ig-evidence/) is scored and never deleted: it is the shop's library", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(SCORECARD)));
    expect((await analyzePhotoForShop({ photoUrl: EVIDENCE })).ok).toBe(true);
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("a refused URL deletes nothing (it is not ours to delete)", async () => {
    await analyzePhotoForShop({ photoUrl: "https://evil.example/generated/photo-check/1-2-front.jpg" });
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it("a delete that fails leaves the scorecard as it was", async () => {
    storageDelete.mockRejectedValueOnce(new Error("bucket down"));
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(SCORECARD)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: true, analysis: PARSED });
  });
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
    expect(r.analysis).toEqual(PARSED);
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

  it("a photo the vision layer cannot fetch from our own storage is invalid_url", async () => {
    analyzePhoto.mockResolvedValueOnce({ ok: false, error: "Photo URL fetch failed: 404", reason: "invalid_url" });
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "invalid_url" });
  });

  it("accepts both upload prefixes on our storage (photo-check and the evidence prefix)", async () => {
    analyzePhoto.mockResolvedValue(visionSays(JSON.stringify(SCORECARD)));
    expect(await analyzePhotoForShop({ photoUrl: "https://shop.example.test/generated/photo-check/a.jpg" })).toMatchObject({ ok: true });
    expect(await analyzePhotoForShop({ photoUrl: "https://shop.example.test/generated/ig-evidence/a.jpg" })).toMatchObject({ ok: true });
    expect(analyzePhoto).toHaveBeenCalledTimes(2);
  });

  it("accepts the CDN form of our storage URL when CLOUDFRONT_DOMAIN is set", async () => {
    vi.stubEnv("CLOUDFRONT_DOMAIN", "cdn.shop.example.test");
    analyzePhoto.mockResolvedValue(visionSays(JSON.stringify(SCORECARD)));
    expect(await analyzePhotoForShop({ photoUrl: "https://cdn.shop.example.test/photo-check/a.jpg" })).toMatchObject({ ok: true });
  });

  it.each([
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["a loopback IPv6 host", "https://[::1]/photo-check/x.jpg"],
    ["a Railway internal host", "https://db.railway.internal/photo-check/x.jpg"],
    ["another site with our path", "https://example.com/photo-check/x.jpg"],
    ["our host over plain http", "http://shop.example.test/generated/photo-check/x.jpg"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["a dot-dot walk out of the prefix", "https://shop.example.test/generated/photo-check/../backups/tidb/customers.jsonl.gz"],
    ["an encoded dot-dot walk", "https://shop.example.test/generated/photo-check/%2e%2e/backups/x"],
    ["another host with a dot-dot path", "https://evil.example/photo-check/.."],
    ["our host as userinfo in front of another host", "https://shop.example.test@evil.example/photo-check/x.jpg"],
    ["our host with credentials in front", "https://user:pw@shop.example.test/generated/photo-check/x.jpg"],
    ["our host on another port", "https://shop.example.test:8443/generated/photo-check/x.jpg"],
    ["our host with a sibling prefix", "https://shop.example.test/generated/photo-checkers/x.jpg"],
    ["a different folder of our storage", "https://shop.example.test/generated/backups/x.jpg"],
    ["a lookalike host", "https://shop.example.test.evil.example/generated/photo-check/x.jpg"],
  ])("refuses %s as invalid_url, without calling the vision layer", async (_label, photoUrl) => {
    const r = await analyzePhotoForShop({ photoUrl });
    expect(r).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(r).not.toHaveProperty("analysis");
    expect(analyzePhoto).not.toHaveBeenCalled();
  });

  it("an http SITE_URL (dev) still refuses an http photo: the scheme rule is its own check", async () => {
    vi.stubEnv("SITE_URL", "http://shop.example.test");
    const r = await analyzePhotoForShop({ photoUrl: "http://shop.example.test/generated/photo-check/x.jpg" });
    expect(r).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(analyzePhoto).not.toHaveBeenCalled();
  });

  it("scores that all sit on a 0-10 or 0-1 scale are unreadable (wrong scale), not '1 of 100'", async () => {
    const tenScale = { ...SCORECARD, scores: { lighting: 7, framing: 6, brandPresence: 4, cleanliness: 8, professionalPolish: 5, overall: 6 } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(tenScale)));
    const r = await analyzePhotoForShop({ photoUrl: PHOTO });
    expect(r).toMatchObject({ ok: false, reason: "unreadable", message: expect.stringContaining("wrong scale") });
    expect(r).not.toHaveProperty("analysis");

    const unitScale = { ...SCORECARD, scores: { lighting: 0.7, framing: 0.6, brandPresence: 0.4, cleanliness: 0.8, professionalPolish: 0.5, overall: 0.6 } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(unitScale)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable", message: expect.stringContaining("wrong scale") });
  });

  it("one score above 10 is enough to treat the set as a 0-100 answer (a real low score survives)", async () => {
    const low = { ...SCORECARD, scores: { lighting: 7, framing: 6, brandPresence: 4, cleanliness: 11, professionalPolish: 5, overall: 6 } };
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify(low)));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: true });
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

  it("a blank subject is unreadable, not an empty label", async () => {
    analyzePhoto.mockResolvedValueOnce(visionSays(JSON.stringify({ ...SCORECARD, subject: "   " })));
    expect(await analyzePhotoForShop({ photoUrl: PHOTO })).toMatchObject({ ok: false, reason: "unreadable" });
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

  it("names the model that ANSWERED: gemini when gemini served, the OpenAI model when the fallback served", async () => {
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/g.png", provider: "gemini", model: "gemini-test-image" });
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: true, model: "gemini-test-image" });
    // The configured primary is gemini here; the report must not say so when openai answered.
    vi.stubEnv("GEMINI_IMAGE_MODEL", "gemini-configured-primary");
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/o.png", provider: "openai", model: "dall-e-3" });
    const r = await renderBrandedScene({ prompt: PROMPT });
    expect(r).toMatchObject({ ok: true, model: "dall-e-3" });
    if (!r.ok) throw new Error("unreachable");
    expect(r.model).not.toContain("gemini");
  });

  it("a generator that does not say who answered is reported as unknown, never as the configured model", async () => {
    vi.stubEnv("GEMINI_IMAGE_MODEL", "gemini-configured-primary");
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/u.png" });
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: true, model: "unknown" });
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/p.png", provider: "openai" });
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: true, model: "openai" });
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

  it("no durable storage: refused before the generator is called, so no credit is spent on a picture a restart would lose", async () => {
    vi.stubEnv("S3_BUCKET", "");
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: false, reason: "image_unavailable" });
    expect(generateImage).not.toHaveBeenCalled();
    // Control: the operator's explicit ephemeral override still lets it run.
    vi.stubEnv("REEL_ALLOW_EPHEMERAL_STORAGE", "true");
    generateImage.mockResolvedValueOnce({ url: "https://cdn.example.test/generated/e.png" });
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: true });
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it("a generator that returns no URL is image_unavailable, not an ok with an empty picture", async () => {
    generateImage.mockResolvedValueOnce({});
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: false, reason: "image_unavailable" });
    generateImage.mockResolvedValueOnce({ url: "" });
    expect(await renderBrandedScene({ prompt: PROMPT })).toMatchObject({ ok: false, reason: "image_unavailable" });
    expect(generateImage).toHaveBeenCalledTimes(2);
  });
});
