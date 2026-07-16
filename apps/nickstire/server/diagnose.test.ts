import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-test control over the model reply — the old suite pinned ONE static
// mockResolvedValue at module scope, so it could only ever assert the happy
// path and never noticed that failures rendered as fake diagnoses.
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { invokeLLM } from "./_core/llm";
import { runDiagnosis, type DiagnosisAnalyzed } from "./diagnose";
import { detectRedFlags, applySafetyFloor } from "./diagnose-safety";

const mockLLM = vi.mocked(invokeLLM);

/** A well-formed model reply. Override fields per test. */
function aiReply(overrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            urgency: "high",
            urgencyScore: 4,
            title: "Brake System Inspection Needed",
            summary: "The grinding noise when braking suggests worn brake pads that have reached the metal backing plate.",
            likelyCauses: [
              { cause: "Worn Brake Pads", explanation: "Pads worn to the backing plate cause metal-on-metal contact.", likelihood: "high" },
              { cause: "Damaged Rotors", explanation: "Driving on worn pads can score the rotors.", likelihood: "medium" },
            ],
            recommendedService: "Brakes",
            safetyNote: "Have the brakes inspected before extended driving.",
            nextSteps: ["Call (216) 862-0005", "Avoid heavy braking until inspected"],
            ...overrides,
          }),
        },
      },
    ],
  };
}

/** Narrow to the analyzed branch, failing loudly if the call went unavailable. */
function expectAnalyzed(result: Awaited<ReturnType<typeof runDiagnosis>>): DiagnosisAnalyzed {
  if (result.status !== "ai") throw new Error(`expected an AI analysis, got status="${result.status}"`);
  return result;
}

beforeEach(() => {
  mockLLM.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runDiagnosis · happy path", () => {
  it("returns a validated, structured analysis", async () => {
    mockLLM.mockResolvedValue(aiReply() as never);

    const result = expectAnalyzed(await runDiagnosis({
      vehicleYear: "2018",
      vehicleMake: "Honda",
      vehicleModel: "Civic",
      mileage: "85000",
      symptoms: ["Metal-on-metal grinding sound during braking"],
    }));

    expect(result.urgency).toBe("high");
    expect(result.urgencyScore).toBe(4);
    expect(result.title).toBeTruthy();
    expect(result.likelyCauses.length).toBeGreaterThan(0);
    expect(result.recommendedService).toBe("Brakes");
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it("normalizes likelihood casing from the model", async () => {
    mockLLM.mockResolvedValue(aiReply({
      likelyCauses: [{ cause: "Worn Pads", explanation: "Pads are thin.", likelihood: "HIGH" }],
    }) as never);

    const result = expectAnalyzed(await runDiagnosis({ symptoms: ["grinding"] }));
    expect(result.likelyCauses[0].likelihood).toBe("high");
  });

  it("normalizes urgency casing — 'High' must not discard a good diagnosis", async () => {
    // Review round: likelihood was case-hardened but urgency (the field the
    // whole safety floor rides on) wasn't — a title-case reply would have
    // failed validation and shown "we couldn't check this one" for nothing.
    mockLLM.mockResolvedValue(aiReply({ urgency: "High" }) as never);

    const result = expectAnalyzed(await runDiagnosis({ symptoms: ["grinding"] }));
    expect(result.urgency).toBe("high");
  });

  it("never returns an invented dollar cost — the model has no pricing data", async () => {
    mockLLM.mockResolvedValue(aiReply() as never);

    const result = expectAnalyzed(await runDiagnosis({ symptoms: ["grinding when braking"] }));

    expect(result.costNote).toBe("Free quick check · written quote before any work");
    expect(JSON.stringify(result)).not.toMatch(/\$\s?\d/);
  });

  it("instructs the model not to price the job", async () => {
    mockLLM.mockResolvedValue(aiReply() as never);
    await runDiagnosis({ symptoms: ["grinding"] });

    const systemPrompt = mockLLM.mock.calls[0][0].messages[0].content as string;
    expect(systemPrompt).toMatch(/NEVER estimate prices/i);
    expect(systemPrompt).toMatch(/NEVER claim you scanned/i);
  });
});

describe("runDiagnosis · honest failure", () => {
  it("reports unavailable instead of fabricating a diagnosis when the AI call throws", async () => {
    mockLLM.mockRejectedValue(new Error("upstream 503"));

    const result = await runDiagnosis({ symptoms: ["weird noise"] });

    expect(result.status).toBe("unavailable");
    // The regression that mattered: the old code returned a complete,
    // confident-looking result card on error. Nothing to render as one now.
    expect(result).not.toHaveProperty("title");
    expect(result).not.toHaveProperty("summary");
    expect(result).not.toHaveProperty("urgencyScore");
  });

  it("reports unavailable when the model returns an off-contract shape", async () => {
    mockLLM.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ urgency: "kinda bad", likelyCauses: null }) } }],
    } as never);

    const result = await runDiagnosis({ symptoms: ["weird noise"] });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("ai_invalid");
  });

  it("reports unavailable when the model returns unparseable content", async () => {
    mockLLM.mockResolvedValue({
      choices: [{ message: { content: "I'm sorry, I can't help with that." } }],
    } as never);

    expect((await runDiagnosis({ symptoms: ["noise"] })).status).toBe("unavailable");
  });

  it("reports unavailable when the model returns no content at all", async () => {
    mockLLM.mockResolvedValue({ choices: [] } as never);

    const result = await runDiagnosis({ symptoms: ["noise"] });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toBe("ai_error");
  });
});

describe("runDiagnosis · deterministic safety floor", () => {
  it("keeps the red-flag warning when the AI is down — the old fallback said 'moderate'", async () => {
    mockLLM.mockRejectedValue(new Error("upstream down"));

    const result = await runDiagnosis({
      symptoms: ["My brakes went to the floor and I can't stop the car"],
    });

    expect(result.status).toBe("unavailable");
    expect(result.redFlags.map((f) => f.id)).toContain("brake-failure");
    expect(result.redFlags[0].guidance).toMatch(/stop driving/i);
  });

  it("overrides the model when it downplays a red-flag symptom", async () => {
    // The exact failure the deterministic layer exists to prevent: model says
    // "low, wait a few weeks" about a car that will not stop.
    mockLLM.mockResolvedValue(aiReply({ urgency: "low", urgencyScore: 1 }) as never);

    const result = expectAnalyzed(await runDiagnosis({
      symptoms: ["brake pedal goes to the floor, can't stop"],
    }));

    expect(result.urgency).toBe("critical");
    expect(result.urgencyScore).toBe(5);
    expect(result.safetyNote).toMatch(/stop driving/i);
  });

  it("leaves ordinary symptoms alone — no false red flags", async () => {
    mockLLM.mockResolvedValue(aiReply({ urgency: "low", urgencyScore: 2 }) as never);

    const result = expectAnalyzed(await runDiagnosis({
      symptoms: ["Slight squeal from the front when I brake gently in the morning"],
    }));

    expect(result.redFlags).toEqual([]);
    expect(result.urgency).toBe("low");
  });

  it("tells the model about the red flag so it does not contradict the page", async () => {
    mockLLM.mockResolvedValue(aiReply() as never);
    await runDiagnosis({ symptoms: ["engine is overheating badly"] });

    const userMessage = mockLLM.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toMatch(/Safety screening already flagged/i);
    expect(userMessage).toMatch(/Engine overheating/i);
  });
});

describe("detectRedFlags", () => {
  const hits: [string, string][] = [
    ["my brakes failed on the highway", "brake-failure"],
    ["pedal goes to the floor", "brake-failure"],
    ["I have no brakes", "brake-failure"],
    ["I lost power steering while turning", "steering-loss"],
    ["no steering at all when I start it", "steering-loss"],
    ["check engine light is flashing", "flashing-mil"],
    ["the oil pressure light came on", "oil-pressure"],
    ["low oil pressure warning on the dash", "oil-pressure"],
    ["car keeps overheating in traffic", "overheating"],
    ["there is smoke coming from under the hood", "fire-smoke"],
    ["it smells like gas inside the car", "fuel-leak"],
    ["the tread is separating from my front tire", "tire-failure"],
    ["it shakes violently and I lose control at 60", "control-loss"],
  ];

  it.each(hits)("flags %j", (text, expectedId) => {
    expect(detectRedFlags(text).map((f) => f.id)).toContain(expectedId);
  });

  const misses: string[] = [
    "my check engine light is on steady",
    "the engine has a misfire at idle",
    "it fires up fine every morning",
    "small oil leak on the driveway, a drop or two",
    "brakes squeak a little when cold",
    "AC is blowing warm air",
    "burning rubber smell after a long drive",
    // Review-round false positives — customers ruling a hazard OUT:
    "I checked the oil pressure, it's fine",
    "No brake noise, just want a routine check",
    "No steering issues, just a squeak over bumps",
    "my AC isn't running, hot in here",
  ];

  it.each(misses)("does not flag %j", (text) => {
    expect(detectRedFlags(text)).toEqual([]);
  });

  it("returns every distinct hazard present", () => {
    const flags = detectRedFlags("the car is overheating and there is smoke coming from the hood");
    expect(flags.map((f) => f.id).sort()).toEqual(["fire-smoke", "overheating"]);
  });

  it("handles empty input", () => {
    expect(detectRedFlags("")).toEqual([]);
  });
});

describe("applySafetyFloor", () => {
  it("clamps the score DOWN when it contradicts a low urgency verdict", () => {
    // First review round found the floor-only logic shipped urgency "low" with
    // urgencyScore 5 — a green "LOW RISK" badge over a 100%-filled bar.
    const out = applySafetyFloor({ urgency: "low", urgencyScore: 5, safetyNote: "" }, []);
    expect(out.urgency).toBe("low");
    expect(out.urgencyScore).toBeLessThanOrEqual(2);
  });

  it("pulls the score UP when a red flag raises the level", () => {
    const raised = applySafetyFloor({ urgency: "low", urgencyScore: 1, safetyNote: "" }, [
      { id: "x", label: "X", guidance: "Stop driving it." },
    ]);
    expect(raised.urgency).toBe("critical");
    expect(raised.urgencyScore).toBe(5);
  });

  it("keeps score and level in the same band for every level", () => {
    const bands: [Parameters<typeof applySafetyFloor>[0]["urgency"], number, number][] = [
      ["low", 1, 2],
      ["moderate", 3, 3],
      ["high", 4, 4],
      ["critical", 5, 5],
    ];
    for (const [urgency, min, max] of bands) {
      for (const rawScore of [0, 1, 3, 5, 99]) {
        const out = applySafetyFloor({ urgency, urgencyScore: rawScore, safetyNote: "" }, []);
        expect(out.urgencyScore).toBeGreaterThanOrEqual(min);
        expect(out.urgencyScore).toBeLessThanOrEqual(max);
      }
    }
  });

  it("never lowers an urgency the model already raised", () => {
    const out = applySafetyFloor({ urgency: "critical", urgencyScore: 5, safetyNote: "" }, []);
    expect(out.urgency).toBe("critical");
  });

  it("puts red-flag guidance ahead of the model's own safety note", () => {
    const out = applySafetyFloor(
      { urgency: "low", urgencyScore: 1, safetyNote: "Consider an inspection." },
      [{ id: "brake-failure", label: "Possible brake failure", guidance: "Stop driving it." }],
    );
    expect(out.safetyNote.indexOf("Stop driving it.")).toBeLessThan(
      out.safetyNote.indexOf("Consider an inspection."),
    );
  });
});
