/**
 * The phone line's speech-to-text keyword list must know every payment-programs provider, or a
 * caller saying "Kafene" is transcribed as something else and no classifier ever sees the word
 * (Codex round 3 on #3148). Asserted on the CONSUMER: the assistant config that would be POSTed
 * to Vapi, for both the receptionist and the follow-up caller. Nothing is sent: fetch is stubbed.
 *
 * Vapi accepts only 'word' or 'word:boost' keywords (no spaces, slashes or hyphens), so a
 * multi-word name ("American First") is boosted word by word.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINANCING_PROVIDERS } from "../../shared/financing";

const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.VAPI_API_KEY;
  process.env.VAPI_API_KEY = "test-vapi-key";
  sent.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ id: "asst_test" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.VAPI_API_KEY;
  else process.env.VAPI_API_KEY = savedKey;
  vi.unstubAllGlobals();
});

async function keywordsSent(create: "createProductionAssistant" | "createFollowUpAssistant"): Promise<string[]> {
  const vapi = await import("../services/vapi");
  const res = await vapi[create]("https://example.test");
  expect(res.success).toBe(true);
  const transcriber = sent.at(-1)!.body.transcriber as { keywords?: string[] };
  return transcriber.keywords ?? [];
}

describe("Vapi transcriber keywords know every payment program", () => {
  for (const create of ["createProductionAssistant", "createFollowUpAssistant"] as const) {
    it(`${create}: every word of every provider's short name is a keyword`, async () => {
      const words = (await keywordsSent(create)).map((k) => k.split(":")[0].toLowerCase());
      expect(words.length).toBeGreaterThan(10); // positive control: the real list was read
      for (const p of FINANCING_PROVIDERS) {
        for (const w of p.shortName.split(/\s+/)) expect(words, `${p.shortName}: ${w}`).toContain(w.toLowerCase());
      }
    });

    it(`${create}: every keyword is in the only shape Vapi accepts`, async () => {
      for (const k of await keywordsSent(create)) expect(k).toMatch(/^[A-Za-z0-9']+(:\d+(\.\d+)?)?$/);
    });
  }
});
