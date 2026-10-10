/**
 * INNGEST_MEGA_V2 is a default-ON kill switch (audit 2026-10-10, 03-F2).
 *
 * The gate ran the mega fan-out only when the env read exactly "true". Unset, or
 * any other value, silently stopped all ~51 daily/weekly children, and the flag
 * board's own text sent the reader to "the Railway cron path", which does not
 * exist. Prod reads "true" today (children observed running 2026-10-10 03:00Z),
 * so that value must keep running; unset must now run too; only an explicit
 * "false" or "0" stops it.
 *
 * These drive the REAL Inngest handlers. Past the gate, an unset CRON_SECRET
 * throws "CRON_SECRET unset" before any fetch: that throw is the proof the gate
 * let the run through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (ctx: { step: { run: (id: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>;
const { handlers } = vi.hoisted(() => ({ handlers: {} as Record<string, Handler> }));

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({
    createFunction: (cfg: { id: string }, handler: Handler) => {
      handlers[cfg.id] = handler;
      return { cfg, handler };
    },
  }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJobLog: { create: vi.fn(async () => ({})) },
    userPreference: { findMany: vi.fn(async () => []) },
  },
}));

import "@/lib/inngest/functions/mega-fanout";
import { getFlag } from "@/lib/feature-flags";

const step = { run: async (_id: string, fn: () => unknown) => fn() };
const SLOTS = ["mega-fanout-morning", "mega-fanout-evening"] as const;
const saved = { flag: process.env.INNGEST_MEGA_V2, secret: process.env.CRON_SECRET };

function setFlag(v: string | undefined) {
  if (v === undefined) delete process.env.INNGEST_MEGA_V2;
  else process.env.INNGEST_MEGA_V2 = v;
}

/** "ran" when the gate let the run through, "skipped" when it stopped it. */
async function outcome(slot: (typeof SLOTS)[number]): Promise<"ran" | "skipped"> {
  try {
    const r = (await handlers[slot]({ step })) as { skipped?: boolean };
    if (r?.skipped) return "skipped";
    throw new Error(`unexpected result ${JSON.stringify(r)}`);
  } catch (e) {
    if (e instanceof Error && /CRON_SECRET unset/.test(e.message)) return "ran";
    throw e;
  }
}

beforeEach(() => {
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  setFlag(saved.flag);
  if (saved.secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved.secret;
});

describe("mega fan-out gate", () => {
  it.each(SLOTS)("RED CASE: %s runs when INNGEST_MEGA_V2 is UNSET", async (slot) => {
    setFlag(undefined);
    expect(await outcome(slot)).toBe("ran");
  });

  it.each(SLOTS)("CONTROL (prod value): %s runs when INNGEST_MEGA_V2=true", async (slot) => {
    setFlag("true");
    expect(await outcome(slot)).toBe("ran");
  });

  it.each(SLOTS)("%s stops on an explicit false or 0", async (slot) => {
    setFlag("false");
    expect(await outcome(slot)).toBe("skipped");
    setFlag("0");
    expect(await outcome(slot)).toBe("skipped");
  });
});

describe("the flag board agrees with the runtime", () => {
  it.each([undefined, "", "true", "false", "0", "1", "FALSE", " false"])(
    "INNGEST_MEGA_V2=%j: board isOn === the fan-out runs",
    async (raw) => {
      setFlag(raw);
      const ran = (await outcome("mega-fanout-morning")) === "ran";
      expect(getFlag("INNGEST_MEGA_V2")?.isOn).toBe(ran);
    },
  );

  it("the description no longer points at a Railway cron path that does not exist", () => {
    const spec = getFlag("INNGEST_MEGA_V2");
    expect(spec?.defaultOn).toBe(true);
    expect(`${spec?.description} ${spec?.defaultBehavior}`).not.toMatch(/Railway cron/i);
  });
});
