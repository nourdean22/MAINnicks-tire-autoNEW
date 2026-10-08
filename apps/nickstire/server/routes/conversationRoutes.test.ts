/**
 * conversationRoutes tests.
 *
 * The extractor has its own suite; what is untested until here is the BOUNDARY -- whether the
 * route actually hands the extractor the numbers that make it refuse. A coverage gate that the
 * route never reaches is a gate that does not exist, and it would look identical in the
 * extractor's own green tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/conversationFacts", () => ({
  extractConversationFacts: vi.fn(),
}));

vi.mock("../services/officeVisual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/officeVisual")>()),
  analyzeOfficeFrames: vi.fn(),
  officeVisualColumnReady: vi.fn(),
  conversationEpisodeColumnReady: vi.fn().mockResolvedValue(false),
  loadVisualCalibration: vi.fn().mockResolvedValue([]),
  loadVisualCalibrationDetailed: vi.fn().mockResolvedValue({ notes: [], episodeIds: [] }),
}));

const logSpy = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../lib/logger", () => ({ createLogger: () => logSpy }));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: vi.fn(),
}));

import { extractConversationFacts } from "../services/conversationFacts";
import { getDb } from "../db";
import { analyzeOfficeFrames, conversationEpisodeColumnReady, loadVisualCalibrationDetailed, officeVisualColumnReady } from "../services/officeVisual";
import { registerConversationEpisodeRoute } from "./conversationRoutes";

const extract = extractConversationFacts as unknown as ReturnType<typeof vi.fn>;
const db = getDb as unknown as ReturnType<typeof vi.fn>;
const analyzeFrames = analyzeOfficeFrames as unknown as ReturnType<typeof vi.fn>;
const visualReady = officeVisualColumnReady as unknown as ReturnType<typeof vi.fn>;

const KEY = "test-ingest-key";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;

/** Captures the handler the route registers, so it can be driven with no HTTP server. */
function mount(): Handler {
  let handler: Handler | null = null;
  registerConversationEpisodeRoute({
    post: (_path: string, h: Handler) => { handler = h; },
  } as never);
  if (!handler) throw new Error("route did not register");
  return handler;
}

function fakeRes() {
  const out: { code: number; body: unknown } = { code: 200, body: null };
  const res = {
    status(c: number) { out.code = c; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  return { res, out };
}

const SEGMENTS = [{
  index: 0,
  start: 0,
  end: 4,
  text: "front right tire keeps losing air",
  speaker: "SPEAKER_00",
}];

const body = (over: Record<string, unknown> = {}) => ({
  episodeId: "ep-1", source: "eufy-office", segments: SEGMENTS,
  speakerCount: 1, coveredSeconds: 85, totalSeconds: 90, ...over,
});

const okExtract = {
  ok: true, error: null, facts: [], summary: null, dropped: [], engine: "m", latencyMs: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CAMERA_INGEST_KEY = KEY;
  delete process.env.STATENOUR_SYNC_KEY;
  extract.mockResolvedValue(okExtract);
  db.mockResolvedValue({ execute: vi.fn().mockResolvedValue(undefined) });
  visualReady.mockResolvedValue(false);
  delete process.env.OFFICE_VISUAL_ANALYSIS;
});

describe("conversation ingest — auth fails CLOSED", () => {
  it("rejects a post with no key configured, rather than allowing it", async () => {
    // An unconfigured secret must not read as "no auth required". This endpoint receives
    // everything said at the counter.
    delete process.env.CAMERA_INGEST_KEY;
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": "" }, body: body() }, res);
    expect(out.code).toBe(401);
    expect(extract).not.toHaveBeenCalled();
  });

  it("rejects a wrong key and never reaches the database", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": "wrong-key-xx" }, body: body() }, res);
    expect(out.code).toBe(401);
    expect(db).not.toHaveBeenCalled();
  });

  it("accepts the configured key — the positive control", async () => {
    // Without this, every test above passes on a route that rejects everything.
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(out.code).toBe(200);
  });
});

describe("conversation ingest — diarization stays evidence, not identity", () => {
  it("passes speaker grouping labels to the extractor and reports speakerCount", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);

    expect(extract).toHaveBeenCalledWith(
      [expect.objectContaining({ speaker: "SPEAKER_00" })],
      expect.any(Object),
    );
    expect((out.body as { speakerCount: number | null }).speakerCount).toBe(1);
  });
});

describe("conversation ingest — the coverage gate is REACHED through the route", () => {
  it("forwards coveredSeconds/totalSeconds to the extractor", async () => {
    // THE CANARY. The extractor leaves its gate OFF when either number is missing, so a
    // route that dropped them would produce confident facts from a 44%-recovered
    // transcript while the extractor's own tests stayed green.
    const h = mount();
    const { res } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ coveredSeconds: 37.4, totalSeconds: 90 }) }, res);
    expect(extract).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ coveredSeconds: 37.4, totalSeconds: 90 }),
    );
  });

  it("REFUSES a payload that omits the coverage numbers", async () => {
    // Omitting them is how a caller would silently get the ungated path. 400, not a
    // default -- a default here is a guess about audio quality.
    const h = mount();
    const { res, out } = fakeRes();
    const b = body() as Record<string, unknown>;
    delete b.coveredSeconds;
    await h({ headers: { "x-sync-key": KEY }, body: b }, res);
    expect(out.code).toBe(400);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("conversation ingest — a failed extraction is not an empty one", () => {
  it("stores FAILED when extraction could not run", async () => {
    extract.mockResolvedValue({ ...okExtract, ok: false, error: "upstream 503" });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("FAILED");
  });

  it("stores SKIPPED for a genuinely silent capture, which is a different claim", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ segments: [] }) }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("SKIPPED");
  });

  it("stores DONE when segments were transcribed", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("DONE");
  });

  it("extracts BEFORE writing, so no PENDING row is left behind on failure", async () => {
    // A two-step write would strand a PENDING row whenever extraction failed, and nothing
    // reaps those. Asserted by ordering, because the shape is invisible in the result.
    const order: string[] = [];
    extract.mockImplementation(async () => { order.push("extract"); return okExtract; });
    db.mockImplementation(async () => {
      order.push("db");
      return { execute: vi.fn().mockResolvedValue(undefined) };
    });
    const h = mount();
    const { res } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(order).toEqual(["extract", "db"]);
  });

  it("a DB outage is a 503, never a success with zero facts", async () => {
    db.mockResolvedValue(null);
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(out.code).toBe(503);
  });
});

describe("conversation ingest — a DEAD TRANSCRIBER is not a quiet room", () => {
  it("stores FAILED when the producer reports transcriptError, even with zero segments", async () => {
    // The shape that would otherwise record hours of "nobody spoke": the shop PC's whisper
    // binary goes missing, every post carries an empty segment list, and every row reads
    // SKIPPED -- a durable, confident claim that the counter was silent all day.
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY },
              body: body({ segments: [], transcriptError: "transcriber exited 2" }) }, res);
    const b = out.body as { transcriptStatus: string; transcriptError: string };
    expect(b.transcriptStatus).toBe("FAILED");
    expect(b.transcriptError).toContain("exited 2");
  });

  it("an empty transcript with NO error stays SKIPPED — the genuinely quiet case", async () => {
    // The positive control that keeps the rule above from becoming "empty is always failure".
    // A quiet morning is a real finding and must not be reported as a broken producer.
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ segments: [] }) }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("SKIPPED");
  });

  it("transcriptError OUTRANKS a successful extraction over partial text", async () => {
    // A transcriber can fail partway and still return some text. The run is still broken, and
    // facts drawn from a truncated transcript are the fluent-and-wrong shape.
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY },
              body: body({ transcriptError: "timed out after 600s" }) }, res);
    expect((out.body as { transcriptStatus: string }).transcriptStatus).toBe("FAILED");
  });

  it("keeps BOTH reasons when transcription AND extraction failed", async () => {
    // Debugging a FAILED row means knowing whether audio never became text, or text never
    // became facts. Keeping one reason throws away half the answer.
    extract.mockResolvedValue({ ...okExtract, ok: false, error: "upstream 503" });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY },
              body: body({ transcriptError: "transcriber exited 2" }) }, res);
    const b = out.body as { transcriptError: string };
    expect(b.transcriptError).toContain("exited 2");
    expect(b.transcriptError).toContain("503");
  });
});

describe("conversation ingest — the reply reports what was DROPPED", () => {
  it("returns dropped reasons alongside the stored count", async () => {
    // A caller seeing only factsStored: 0 cannot tell a quiet conversation from a
    // transcript the gate rejected, and those call for opposite responses at the shop.
    extract.mockResolvedValue({
      ...okExtract,
      dropped: [{ reason: "below threshold (transcript coverage too low)", count: 2 }],
    });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ coveredSeconds: 37.4, totalSeconds: 90 }) }, res);
    const b = out.body as { factsStored: number; dropped: { reason: string }[]; coverage: number };
    expect(b.factsStored).toBe(0);
    expect(b.dropped[0].reason).toContain("coverage");
    expect(b.coverage).toBeCloseTo(0.416, 3);
  });
});

// 2026-10-02 · office "watch": frames ride along with the episode; only the description is kept.
describe("conversation ingest — office visual frames", () => {
  const FRAME = { mime: "image/jpeg", base64: "A".repeat(200) };
  const DONE = {
    status: "DONE", summary: "Customer at the counter talking with staff.", peopleCount: 2,
    activities: ["customer at counter"], waitingUnattended: false, frameCount: 2,
    provider: "ollama", model: "m", latencyMs: 5, error: null,
  };

  it("an episode without frames is unchanged: no readiness check, no vision call, visualStatus null", async () => {
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body() }, res);
    expect(out.code).toBe(200);
    expect(visualReady).not.toHaveBeenCalled();
    expect(analyzeFrames).not.toHaveBeenCalled();
    expect((out.body as { visualStatus: unknown }).visualStatus).toBeNull();
  });

  it("before migration 0140: frames are accepted but NOT analyzed, and the reply says why", async () => {
    visualReady.mockResolvedValue(false);
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME, FRAME] }) }, res);
    expect(out.code).toBe(200);
    expect(analyzeFrames).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ framesReceived: 2, visualStatus: "NOT_STORED_VISUAL_COLUMN_UNAVAILABLE" });
    // Only the main INSERT ran: no statement names the visual column on an unmigrated database.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("after migration 0140: frames are described and ONLY the description is stored", async () => {
    visualReady.mockResolvedValue(true);
    analyzeFrames.mockResolvedValue(DONE);
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME, FRAME] }) }, res);
    expect(out.code).toBe(200);
    expect(analyzeFrames).toHaveBeenCalledWith(
      [{ mime: "image/jpeg", base64: FRAME.base64 }, { mime: "image/jpeg", base64: FRAME.base64 }],
      undefined,
      { calibration: [], onBoxPeople: null },
    );
    expect(out.body).toMatchObject({ framesReceived: 2, visualStatus: "DONE", visualError: null });
    expect(execute).toHaveBeenCalledTimes(2);
    const update = JSON.stringify(execute.mock.calls[1][0]);
    expect(update).toContain("UPDATE conversation_episodes SET visual");
    expect(update).toContain("Customer at the counter");
    // The raw frame bytes never reach the database.
    for (const call of execute.mock.calls) expect(JSON.stringify(call[0])).not.toContain(FRAME.base64);
  });

  it("a FAILED vision call is still stored (could-not-look is not saw-nothing)", async () => {
    visualReady.mockResolvedValue(true);
    analyzeFrames.mockResolvedValue({ ...DONE, status: "FAILED", summary: null, error: "ollama: 503" });
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, res);
    expect(out.body).toMatchObject({ visualStatus: "FAILED", visualError: "ollama: 503" });
    expect(JSON.stringify(execute.mock.calls[1][0])).toContain("FAILED");
  });

  it("logs one line per framed episode: info when stored, warn with the reason when not", async () => {
    logSpy.info.mockClear(); logSpy.warn.mockClear();
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });

    visualReady.mockResolvedValue(true);
    analyzeFrames.mockResolvedValue(DONE);
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, fakeRes().res);
    expect(logSpy.info).toHaveBeenCalledWith("office visual stored",
      expect.objectContaining({ visualStatus: "DONE", provider: "ollama", frames: 1 }));

    analyzeFrames.mockResolvedValue({ ...DONE, status: "FAILED", summary: null, error: "gemini: 400" });
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, fakeRes().res);
    expect(logSpy.warn).toHaveBeenCalledWith("office visual not stored",
      expect.objectContaining({ visualStatus: "FAILED", error: "gemini: 400" }));

    visualReady.mockResolvedValue(false);
    logSpy.warn.mockClear();
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, fakeRes().res);
    expect(logSpy.warn).toHaveBeenCalledWith("office visual not stored",
      expect.objectContaining({ visualStatus: "NOT_STORED_VISUAL_COLUMN_UNAVAILABLE" }));

    // No frames, no line: ordinary audio-only episodes stay quiet.
    logSpy.info.mockClear(); logSpy.warn.mockClear();
    await mount()({ headers: { "x-sync-key": KEY }, body: body() }, fakeRes().res);
    expect(logSpy.info).not.toHaveBeenCalledWith("office visual stored", expect.anything());
    expect(logSpy.warn).not.toHaveBeenCalledWith("office visual not stored", expect.anything());
  });

  it("on-box person counts: the max across frames rides into the prompt and the stored visual; unmeasured stays null", async () => {
    visualReady.mockResolvedValue(true);
    analyzeFrames.mockResolvedValue(DONE);
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });
    const { res, out } = fakeRes();
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [
      { ...FRAME, people: 1 }, { ...FRAME, people: 3 }, { ...FRAME, people: null },
    ] }) }, res);
    expect(analyzeFrames.mock.calls.at(-1)?.[2]).toMatchObject({ onBoxPeople: 3 });
    expect(JSON.stringify(execute.mock.calls[1][0])).toContain('\\"onBoxPeople\\":3');
    expect(out.body).toMatchObject({ onBoxPeople: 3 });

    // No frame measured -> null, never 0 ("could not look" is not "nobody there").
    const b = fakeRes();
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [{ ...FRAME, people: null }, FRAME] }) }, b.res);
    expect(analyzeFrames.mock.calls.at(-1)?.[2]).toMatchObject({ onBoxPeople: null });
    expect(b.out.body).toMatchObject({ onBoxPeople: null });
  });

  it("what the camera saw is handed to fact extraction as context, only when the description succeeded", async () => {
    visualReady.mockResolvedValue(true);
    db.mockResolvedValue({ execute: vi.fn().mockResolvedValue(undefined) });

    analyzeFrames.mockResolvedValue(DONE);
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, fakeRes().res);
    const ctx = extract.mock.calls.at(-1)?.[1]?.visualContext as string;
    expect(ctx).toContain("Customer at the counter talking with staff.");
    expect(ctx).toContain("customer at counter");

    analyzeFrames.mockResolvedValue({ ...DONE, status: "FAILED", summary: null, error: "x" });
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, fakeRes().res);
    expect(extract.mock.calls.at(-1)?.[1]?.visualContext).toBeNull();

    await mount()({ headers: { "x-sync-key": KEY }, body: body() }, fakeRes().res);
    expect(extract.mock.calls.at(-1)?.[1]?.visualContext).toBeNull();
  });

  it("a slow vision call does not hold fact extraction past the wait; its description is still stored", async () => {
    vi.useFakeTimers();
    try {
      visualReady.mockResolvedValue(true);
      let finishVision: (v: unknown) => void = () => {};
      analyzeFrames.mockReturnValue(new Promise((r) => { finishVision = r; }));
      const execute = vi.fn().mockResolvedValue(undefined);
      db.mockResolvedValue({ execute });
      const { res, out } = fakeRes();
      const done = mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, res);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(extract).toHaveBeenCalledTimes(1);
      expect(extract.mock.calls[0][1].visualContext).toBeNull();
      finishVision(DONE);
      await done;
      expect(out.body).toMatchObject({ visualStatus: "DONE" });
      expect(JSON.stringify(execute.mock.calls[1][0])).toContain("Customer at the counter");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gist: written by its own UPDATE only once 0141 exists; logged as a flag, never as text", async () => {
    const colReady = conversationEpisodeColumnReady as unknown as ReturnType<typeof vi.fn>;
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });
    extract.mockResolvedValue({ ...okExtract, gist: "Customer asking when the car will be ready" });

    colReady.mockResolvedValue(false);
    const a = fakeRes();
    await mount()({ headers: { "x-sync-key": KEY }, body: body() }, a.res);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(a.out.body).toMatchObject({ gistStored: true });

    colReady.mockResolvedValue(true);
    logSpy.info.mockClear();
    execute.mockClear();
    await mount()({ headers: { "x-sync-key": KEY }, body: body() }, fakeRes().res);
    expect(execute).toHaveBeenCalledTimes(2);
    const upd = JSON.stringify(execute.mock.calls[1][0]);
    expect(upd).toContain("UPDATE conversation_episodes SET gist");
    expect(upd).toContain("Customer asking when the car will be ready");
    const line = logSpy.info.mock.calls.find((c) => c[0] === "conversation extracted");
    expect(line?.[1]).toMatchObject({ facts: 0, gist: true });
    expect(JSON.stringify(line)).not.toContain("Customer asking");
  });

  it("OFFICE_VISUAL_ANALYSIS=0 switches analysis off without touching the database", async () => {
    process.env.OFFICE_VISUAL_ANALYSIS = "0";
    visualReady.mockResolvedValue(true);
    const h = mount();
    const { res, out } = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, res);
    expect(visualReady).not.toHaveBeenCalled();
    expect(analyzeFrames).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ visualStatus: "DISABLED" });
  });

  it("rejects more frames than the cap, and oversized frames", async () => {
    const h = mount();
    const a = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ frames: Array(7).fill(FRAME) }) }, a.res);
    expect(a.out.code).toBe(400);
    const b = fakeRes();
    await h({ headers: { "x-sync-key": KEY }, body: body({ frames: [{ mime: "image/jpeg", base64: "A".repeat(400_001) }] }) }, b.res);
    expect(b.out.code).toBe(400);
  });
});

describe("office visual calibration receipt (audit N5)", () => {
  it("stores and logs WHICH reviewed episodes shaped the description, ids only, never the review text", async () => {
    const visualReady = vi.mocked(officeVisualColumnReady);
    const analyzeFrames = vi.mocked(analyzeOfficeFrames);
    const db = vi.mocked(getDb);
    const FRAME = { mime: "image/jpeg", base64: "A".repeat(200) };
    const DONE = {
      status: "DONE" as const, summary: "Customer at the counter", peopleCount: 1, activities: [],
      waitingUnattended: false, frameCount: 1, provider: "ollama", model: "m", latencyMs: 5, error: null,
    };
    visualReady.mockResolvedValue(true);
    analyzeFrames.mockResolvedValue(DONE);
    vi.mocked(loadVisualCalibrationDetailed).mockResolvedValueOnce({
      notes: ['Was wrong: "one person" -- what actually happened: "two customers, staff on phone"'],
      episodeIds: ["ep-wrong-1"],
    });
    const execute = vi.fn().mockResolvedValue(undefined);
    db.mockResolvedValue({ execute });
    logSpy.info.mockClear();
    const { res, out } = fakeRes();
    await mount()({ headers: { "x-sync-key": KEY }, body: body({ frames: [FRAME] }) }, res);
    expect(out.code).toBe(200);
    // The note reached the prompt...
    expect(analyzeFrames).toHaveBeenCalledWith(
      [{ mime: "image/jpeg", base64: FRAME.base64 }],
      undefined,
      expect.objectContaining({ calibration: [expect.stringContaining("two customers, staff on phone")] }),
    );
    // ...and the stored visual names where it came from, by id only.
    const update = JSON.stringify(execute.mock.calls[1][0]);
    expect(update).toContain("ep-wrong-1");
    expect(update).toContain("calibrationFrom");
    expect(update).not.toContain("two customers, staff on phone");
    expect(logSpy.info).toHaveBeenCalledWith("office visual stored",
      expect.objectContaining({ calibrationFrom: ["ep-wrong-1"] }));
  });
});
