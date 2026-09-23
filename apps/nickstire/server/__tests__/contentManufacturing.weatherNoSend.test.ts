/**
 * content generation reads the weather, it never ACTS on it (2026-09-23)
 *
 * WHAT WAS WRONG. explodeTopic() and generateScoredDraft() called the SENDING
 * checkWeatherTriggers() only to put the weather into a prompt. They run from
 * the hourly content-reserve-replenish job and admin content actions, so each
 * call could fire a Telegram alert and up to 10 customer texts per trigger.
 * The side-effect-free evaluateWeatherTriggers() exists for exactly this (#824).
 *
 * The real weatherIntelligence module runs here; only the network, Telegram,
 * the SMS feature-flag gate, the DB and the LLM are stubbed. Heavy rain
 * (25 mm/h) is a genuine trigger, so the sending path WOULD alert — the
 * positive control in weatherIntelligence.units.test.ts proves that.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const alertSystem = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/telegram", () => ({ alertSystem: (...a: unknown[]) => alertSystem(...a) }));

const isEnabled = vi.fn().mockResolvedValue(false);
vi.mock("../services/featureFlags", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));

const emptyQuery: any = new Proxy(
  {},
  {
    get: (_t, prop) =>
      prop === "then" ? (ok: (v: unknown[]) => unknown) => Promise.resolve([]).then(ok) : () => emptyQuery,
  },
);
vi.mock("../db", () => ({
  getDbTyped: () => Promise.resolve({ select: () => emptyQuery }),
  getDb: () => Promise.resolve({ select: () => emptyQuery }),
}));

const invokeLLM = vi.fn();
vi.mock("../_core/llm", () => ({ invokeLLM: (...a: unknown[]) => invokeLLM(...a) }));

import { explodeTopic, generateScoredDraft } from "../services/contentManufacturing";

const llmReply = (content: unknown) => ({
  choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }],
});

beforeEach(() => {
  vi.stubEnv("OPENWEATHER_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        main: { temp_max: 62, temp_min: 55 },
        weather: [{ description: "heavy intensity rain" }],
        rain: { "1h": 25 },
      }),
    }),
  );
  alertSystem.mockClear();
  isEnabled.mockClear();
  invokeLLM.mockReset();
});

describe("content generation never reaches the weather send path", () => {
  it("explodeTopic: weather lands in the prompt, no alert, SMS gate never consulted", async () => {
    invokeLLM.mockResolvedValueOnce(llmReply({ angles: [] }));
    await explodeTopic("tires");

    const prompt = invokeLLM.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("heavy intensity rain");
    expect(alertSystem).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });

  it("generateScoredDraft: keeps triggered[0] as weatherTriggerCondition, no alert, SMS gate never consulted", async () => {
    invokeLLM.mockResolvedValueOnce(llmReply({ hookText: "h", bodyText: "b" }));
    const draft = await generateScoredDraft(
      "tires",
      { angle: "a", narrativeFranchise: "f", entertainmentPillar: "p", description: "d" },
      {
        hookText: "h", hookCategory: "local", scoreCuriosity: 1, scoreEmotion: 1,
        scoreLocalRelevance: 1, scoreAuthority: 1, scoreOverall: 1,
      },
      "cleveland_car_doctor",
      "reel",
      "both",
    );

    expect(draft.weatherTriggerCondition).toBe("heavy_rain");
    expect(alertSystem).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
