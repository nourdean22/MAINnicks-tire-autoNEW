/**
 * autopilot flags · 2026-10-02 · settings census
 *
 * Nine `auto_*` keys were stored and returned as if they were controls; no
 * code read any of them. Pinned: the service keeps only keys the runtime
 * reads (today `adhd_operating_rhythm`, read by operating-rhythm.ts), drops
 * dead keys from both the stored row and an incoming payload, and an
 * explicit `false` on the live key survives the round trip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { findFirst, upsert } = vi.hoisted(() => ({ findFirst: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { userPreference: { findFirst, upsert } } }));

import { AUTOPILOT_DEFAULTS, getAutopilotFlags, setAutopilotFlags } from "@/lib/services/autopilot-flags";

beforeEach(() => {
  findFirst.mockReset();
  upsert.mockReset();
  upsert.mockResolvedValue({});
});

describe("autopilot flags keep only what the runtime reads", () => {
  it("every default key has a reader outside the service", () => {
    const reader = readFileSync(join(process.cwd(), "lib/brain/operating-rhythm.ts"), "utf8");
    for (const key of Object.keys(AUTOPILOT_DEFAULTS)) expect(reader).toContain(key);
  });

  it("a stored row with dead keys reads back without them; the live value is kept", async () => {
    findFirst.mockResolvedValue({ value: JSON.stringify({ auto_morning_brief: true, auto_revenue_alerts: false, adhd_operating_rhythm: false }) });
    expect(await getAutopilotFlags()).toEqual({ adhd_operating_rhythm: false });
  });

  it("no row reads the defaults", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getAutopilotFlags()).toEqual({ adhd_operating_rhythm: true });
  });

  it("a write drops dead keys from the payload and persists the live one", async () => {
    const merged = await setAutopilotFlags({ auto_weekly_targets: true, adhd_operating_rhythm: false });
    expect(merged).toEqual({ adhd_operating_rhythm: false });
    expect(JSON.parse(upsert.mock.calls[0][0].update.value)).toEqual({ adhd_operating_rhythm: false });
  });
});
