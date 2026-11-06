/**
 * tests/ai/tool-health-optional-providers.test.ts · 2026-11-06 (Nick audit A4)
 *
 * toolHealth put every unset key in `services.missing` and told Nick "Set these env vars to unlock
 * full power". ANTHROPIC_API_KEY is a fallback provider left UNSET by design (DEPLOY.md lists it as
 * "fallback provider"; app/api/ai/chat/route.ts says it is currently unset), so two Nick audits
 * reported it as an error and asked for a paid key. An optional fallback that is unset is "not
 * configured", never "missing". The control keeps a real gap (Telegram) in `missing`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } }));

import { metaTools } from "@/lib/ai/tools/meta";

type Health = {
  status: string;
  services: { operational: string[]; missing: string[]; notConfigured?: string[] };
  recommendation: string;
};
const run = () => (metaTools.toolHealth.execute as (i: unknown, o: unknown) => Promise<Health>)({}, {});

afterEach(() => vi.unstubAllEnvs());

describe("toolHealth: an unset optional fallback provider is not a missing service", () => {
  it("ANTHROPIC_API_KEY unset is listed as not configured, not missing, and not in the 'set these' advice", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    const h = await run();
    expect(h.services.missing).not.toContain("anthropic");
    expect(h.services.notConfigured).toContain("anthropic");
    expect(h.recommendation).not.toMatch(/anthropic/i);
  });

  it("CONTROL: a required integration that is unset is still reported missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const h = await run();
    expect(h.services.missing).toContain("telegram");
    expect(h.recommendation).toMatch(/telegram/);
  });

  it("CONTROL: a configured fallback reads as operational", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const h = await run();
    expect(h.services.operational).toContain("anthropic");
    expect(h.services.notConfigured ?? []).not.toContain("anthropic");
  });
});
