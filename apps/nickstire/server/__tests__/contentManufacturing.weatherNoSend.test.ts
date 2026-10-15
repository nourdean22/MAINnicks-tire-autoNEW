/**
 * content generation reads the weather, it never ACTS on it (2026-09-23)
 *
 * WHAT WAS WRONG. explodeTopic() and generateScoredDraft() called the SENDING
 * checkWeatherTriggers() only to put the weather into a prompt. They run from
 * the hourly content-reserve-replenish job and admin content actions, so each
 * call could fire a Telegram alert and up to 10 customer texts per trigger.
 * The side-effect-free evaluateWeatherTriggers() exists for exactly this (#824).
 *
 * The real weatherIntelligence module runs here; only the NWS network (recorded
 * fixtures), Telegram, the SMS feature-flag gate, the DB and the LLM are
 * stubbed. A heavy-rain forecast is a genuine trigger, so the sending path
 * WOULD alert: the control test below proves it with this same stub, which
 * keeps the two no-alert assertions live.
 *
 * Salvaged from the stale branch nickstire/weather-units-no-content-sends
 * (5edafcdaf). Main then moved the weather lane from OpenWeather to the NWS
 * forecast, so only the fetch stub changed; the assertions are the original ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const alertSystem = vi.fn().mockResolvedValue(true);
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

import { nwsFixtures, stubNwsFetch } from "./nwsWeatherFixtures";
import { __resetNwsCacheForTests } from "../lib/nwsWeather";
import { __resetWeatherAlertMemoryForTests, checkWeatherTriggers } from "../services/weatherIntelligence";
import { explodeTopic, generateScoredDraft } from "../services/contentManufacturing";

const llmReply = (content: unknown) => ({
  choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }],
});

// The recorded forecast is dated 2026-09-23; weatherIntelligence reads the wall
// clock, so pin Date to it. In September the recorded forecast fires nothing on
// its own; the edit below makes tonight heavy rain, which fires heavy_rain only.
const RECORDED_NOW = new Date("2026-09-23T15:30:00Z");
const TONIGHT = 1;

const heavyRainForecast = () => {
  const f = nwsFixtures.forecast();
  f.properties.periods[TONIGHT] = {
    ...f.properties.periods[TONIGHT],
    shortForecast: "Heavy Rain",
    probabilityOfPrecipitation: { value: 95 },
  };
  return f;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(RECORDED_NOW);
  __resetNwsCacheForTests();
  __resetWeatherAlertMemoryForTests();
  stubNwsFetch({ forecast: heavyRainForecast() });
  alertSystem.mockClear();
  isEnabled.mockClear();
  invokeLLM.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("content generation never reaches the weather send path", () => {
  it("control: the sending entry point DOES alert on this forecast (so the no-alert tests below are live)", async () => {
    const r = await checkWeatherTriggers();
    expect(r.triggered).toEqual(["heavy_rain"]);
    expect(alertSystem).toHaveBeenCalledWith("Weather: Heavy Rain", expect.any(String));
    // Heavy rain tonight is imminent, so the send path also consults the SMS gate:
    // this is what makes the isEnabled not-called assertions below live.
    expect(isEnabled).toHaveBeenCalledWith("weather_triggered_sms");
  });

  it("explodeTopic: weather lands in the prompt, no alert, SMS gate never consulted", async () => {
    invokeLLM.mockResolvedValueOnce(llmReply({ angles: [] }));
    await explodeTopic("tires");

    const prompt = invokeLLM.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("NWS 7-day");
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
