/**
 * officeVisual — the vision layer of the office camera ("watch", 2026-10-02).
 * Pins: lenient JSON parsing, provider fallback, failure-is-stored, the frame cap, and the
 * readiness cache that keeps the feature inert until migration 0140 is applied.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseVisualReply, analyzeOfficeFrames, officeVisualColumnReady, storedVisual,
  __resetOfficeVisualReadyCache, OFFICE_VISUAL_MAX_FRAMES,
  buildPrompt, calibrationNote, conversationEpisodeColumnReady, loadVisualCalibrationDetailed, __resetOfficeVisualCalibration, type OfficeVisual,
} from "./officeVisual";

const META = { frameCount: 2, provider: "ollama", model: "m", latencyMs: 9 };
const IMG = { mime: "image/jpeg" as const, base64: "AAAA" };

describe("parseVisualReply", () => {
  it("reads JSON wrapped in a code fence and prose", () => {
    const v = parseVisualReply('Sure:\n```json\n{"summary":"Customer at counter with staff.","peopleCount":2,"activities":["customer at counter"],"waitingUnattended":false}\n```', META);
    expect(v).toMatchObject({ status: "DONE", summary: "Customer at counter with staff.", peopleCount: 2, activities: ["customer at counter"], waitingUnattended: false });
  });

  it("a reply with no summary is FAILED, never an empty DONE", () => {
    expect(parseVisualReply('{"peopleCount":1}', META).status).toBe("FAILED");
    expect(parseVisualReply("I cannot see anything useful.", META).status).toBe("FAILED");
  });

  it("drops non-string activities and nonsense counts", () => {
    const v = parseVisualReply('{"summary":"x","peopleCount":"many","activities":["a",3,""]}', META);
    expect(v.peopleCount).toBeNull();
    expect(v.activities).toEqual(["a"]);
  });
});

describe("analyzeOfficeFrames", () => {
  const saved = { o: process.env.OLLAMA_API_KEY, g: process.env.GEMINI_API_KEY };
  beforeEach(() => { process.env.OLLAMA_API_KEY = "k"; process.env.GEMINI_API_KEY = "k"; });
  afterEach(() => {
    if (saved.o === undefined) delete process.env.OLLAMA_API_KEY; else process.env.OLLAMA_API_KEY = saved.o;
    if (saved.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = saved.g;
  });

  it("uses Ollama first and returns its description", async () => {
    const describe_ = vi.fn().mockResolvedValue({ ok: true, text: '{"summary":"Two people at the counter."}', provider: "ollama", model: "gemma", latencyMs: 3 });
    const v = await analyzeOfficeFrames([IMG, IMG], describe_);
    expect(v).toMatchObject({ status: "DONE", provider: "ollama", frameCount: 2 });
    expect(describe_).toHaveBeenCalledTimes(1);
    expect(describe_.mock.calls[0][0]).toMatchObject({ provider: "ollama" });
  });

  it("falls back to Gemini when Ollama fails, and keeps both errors when both fail", async () => {
    const describe_ = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "503", reason: "http_error" })
      .mockResolvedValueOnce({ ok: true, text: '{"summary":"Staff alone at the desk."}', provider: "gemini", model: "g", latencyMs: 2 });
    expect(await analyzeOfficeFrames([IMG], describe_)).toMatchObject({ status: "DONE", provider: "gemini" });

    const failing = vi.fn().mockResolvedValue({ ok: false, error: "down", reason: "http_error" });
    const v = await analyzeOfficeFrames([IMG], failing);
    expect(v.status).toBe("FAILED");
    expect(v.error).toContain("ollama: down");
    expect(v.error).toContain("gemini: down");
  });

  it("no provider key is a FAILED visual with the reason, and no call is made", async () => {
    delete process.env.OLLAMA_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const describe_ = vi.fn();
    const v = await analyzeOfficeFrames([IMG], describe_);
    expect(v.status).toBe("FAILED");
    expect(v.error).toMatch(/no vision provider/);
    expect(describe_).not.toHaveBeenCalled();
  });

  it("caps the frames sent to the model", async () => {
    const describe_ = vi.fn().mockResolvedValue({ ok: true, text: '{"summary":"x"}', provider: "ollama", model: "m", latencyMs: 1 });
    await analyzeOfficeFrames(Array(10).fill(IMG), describe_);
    expect(describe_.mock.calls[0][0].images).toHaveLength(OFFICE_VISUAL_MAX_FRAMES);
  });
});

describe("officeVisualColumnReady", () => {
  beforeEach(() => __resetOfficeVisualReadyCache());

  it("caches a positive answer; re-checks a negative one after the TTL", async () => {
    const yes = { execute: vi.fn().mockResolvedValue([[{ n: 1 }]]) };
    expect(await officeVisualColumnReady(yes, 0)).toBe(true);
    expect(await officeVisualColumnReady(yes, 10 ** 9)).toBe(true);
    expect(yes.execute).toHaveBeenCalledTimes(1);

    __resetOfficeVisualReadyCache();
    const no = { execute: vi.fn().mockResolvedValue([[{ n: 0 }]]) };
    expect(await officeVisualColumnReady(no, 0)).toBe(false);
    expect(await officeVisualColumnReady(no, 1000)).toBe(false);
    expect(no.execute).toHaveBeenCalledTimes(1);
    await officeVisualColumnReady(no, 11 * 60 * 1000);
    expect(no.execute).toHaveBeenCalledTimes(2);
  });

  it("a failed check reads as NOT ready", async () => {
    const broken = { execute: vi.fn().mockRejectedValue(new Error("db down")) };
    expect(await officeVisualColumnReady(broken, 0)).toBe(false);
  });
});

describe("storedVisual", () => {
  it("round-trips a stored string and rejects garbage", () => {
    const stored = JSON.stringify({ status: "DONE", summary: "s", peopleCount: 1, activities: ["a"], waitingUnattended: true, frameCount: 2 });
    expect(storedVisual(stored)).toMatchObject({ status: "DONE", summary: "s", waitingUnattended: true });
    expect(storedVisual("{nope")).toBeNull();
    expect(storedVisual({ status: "MAYBE" })).toBeNull();
    expect(storedVisual(null)).toBeNull();
  });
});

describe("office visual — learning loop and on-box people", () => {
  const base: OfficeVisual = {
    status: "DONE", summary: "One customer at the counter.", peopleCount: 1, activities: [],
    waitingUnattended: false, frameCount: 1, provider: "ollama", model: "m", latencyMs: 5, error: null,
  };
  beforeEach(() => __resetOfficeVisualCalibration());

  it("the prompt carries the on-box count and calibration notes only when present", () => {
    const plain = buildPrompt(2);
    expect(plain).not.toContain("person detector");
    expect(plain).not.toContain("Calibration");
    const p = buildPrompt(2, { onBoxPeople: 3, calibration: ["Was wrong: \"x\" -- what actually happened: \"y\""] });
    expect(p).toContain("counted at most 3 people");
    expect(p).toContain("Calibration from the shop owner");
    expect(p).toContain("what actually happened");
    // null means "not measured": no hint at all, never a claimed zero.
    expect(buildPrompt(2, { onBoxPeople: null })).not.toContain("person detector");
  });

  it("calibration notes: confirmed vs corrected, and nothing for an unreviewed description", () => {
    expect(calibrationNote(base)).toBeNull();
    expect(calibrationNote({ ...base, review: { verdict: "correct", note: null, at: "t" } })).toContain("Confirmed accurate");
    expect(calibrationNote({ ...base, review: { verdict: "wrong", note: "two customers, staff on phone", at: "t" } }))
      .toContain("two customers, staff on phone");
  });

  it("loads corrections before confirmations, caches them, and a failed read is an empty list", async () => {
    const row = (verdict: "correct" | "wrong", summary: string, note: string | null = null) =>
      ({ visual: JSON.stringify({ ...base, summary, review: { verdict, note, at: "t" } }) });
    const execute = vi.fn().mockResolvedValue([[
      row("correct", "ok one"), row("wrong", "bad one", "really two people"), row("correct", "ok two"),
    ]]);
    const { notes } = await loadVisualCalibrationDetailed({ execute }, 1_000);
    expect(notes[0]).toContain("really two people");
    expect(notes).toHaveLength(3);
    await loadVisualCalibrationDetailed({ execute }, 2_000);
    expect(execute).toHaveBeenCalledTimes(1);

    __resetOfficeVisualCalibration();
    const broken = vi.fn().mockRejectedValue(new Error("db down"));
    expect(await loadVisualCalibrationDetailed({ execute: broken }, 3_000)).toEqual({ notes: [], episodeIds: [] });
  });

  it("storedVisual reads back the review and the on-box count", () => {
    const v = storedVisual(JSON.stringify({ ...base, onBoxPeople: 2, review: { verdict: "wrong", note: "n", at: "t" } }));
    expect(v).toMatchObject({ onBoxPeople: 2, review: { verdict: "wrong", note: "n" } });
    expect(storedVisual(JSON.stringify(base))).toMatchObject({ onBoxPeople: null, review: null });
  });

  it("storedVisual keeps the calibrationFrom receipt (ids only) so the N5 proof is readable, not write-only", () => {
    const v = storedVisual(JSON.stringify({ ...base, calibrationFrom: ["ep-wrong-1", 7, "ep-ok-2"] }));
    expect(v?.calibrationFrom).toEqual(["ep-wrong-1", "ep-ok-2"]);
    // Absent stays absent: an older row is not given an empty receipt it never had.
    expect(storedVisual(JSON.stringify(base))).not.toHaveProperty("calibrationFrom");
  });
});

describe("conversationEpisodeColumnReady (0140 visual, 0141 gist)", () => {
  beforeEach(() => __resetOfficeVisualReadyCache());

  it("checks the named column and caches each column separately", async () => {
    const execute = vi.fn().mockImplementation(async (q: unknown) =>
      [[{ n: JSON.stringify(q).includes("gist") ? 0 : 1 }]]);
    expect(await conversationEpisodeColumnReady({ execute }, "visual", 0)).toBe(true);
    expect(await conversationEpisodeColumnReady({ execute }, "gist", 0)).toBe(false);
    // visual's positive answer is cached; gist's negative answer is not re-read inside the TTL.
    await conversationEpisodeColumnReady({ execute }, "visual", 1_000);
    await conversationEpisodeColumnReady({ execute }, "gist", 1_000);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("office visual calibration receipt (audit N5)", () => {
  const base2: OfficeVisual = {
    status: "DONE", summary: "one person", peopleCount: 1, activities: [], waitingUnattended: null,
    frameCount: 1, provider: "ollama", model: "m", latencyMs: 1, error: null,
  };
  it("returns one episode id per note, corrections first, and the cache keeps the pairing", async () => {
    __resetOfficeVisualCalibration();
    const row = (episodeId: string, verdict: "correct" | "wrong", summary: string, note: string | null = null) =>
      ({ episodeId, visual: JSON.stringify({ ...base2, summary, review: { verdict, note, at: "t" } }) });
    const execute = vi.fn().mockResolvedValue([[
      row("ep-ok-1", "correct", "ok one"), row("ep-wrong-1", "wrong", "bad one", "really two people"), row("ep-ok-2", "correct", "ok two"),
    ]]);
    const first = await loadVisualCalibrationDetailed({ execute }, 1_000);
    expect(first.episodeIds).toEqual(["ep-wrong-1", "ep-ok-1", "ep-ok-2"]);
    expect(first.notes).toHaveLength(3);
    expect(first.notes[0]).toContain("really two people");
    const cached = await loadVisualCalibrationDetailed({ execute }, 2_000);
    expect(cached.episodeIds).toEqual(first.episodeIds);
    expect(execute).toHaveBeenCalledTimes(1);

    __resetOfficeVisualCalibration();
    const broken = vi.fn().mockRejectedValue(new Error("db down"));
    expect(await loadVisualCalibrationDetailed({ execute: broken }, 3_000)).toEqual({ notes: [], episodeIds: [] });
  });
});
