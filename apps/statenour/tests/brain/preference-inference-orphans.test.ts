/**
 * Audit 2026-10-10 · 06-F10. `runWeeklyTune` + `aggregateRecentFeedback` had no
 * caller since the cron prune f87fb7e62 while the header still promised a
 * weekly self-tune. Deleted (operator ruling: delete, not re-wire); the header
 * must not describe a schedule that does not exist.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as engine from "@/lib/brain/preference-inference";

const src = readFileSync(join(__dirname, "../../lib/brain/preference-inference.ts"), "utf8");

describe("preference-inference · no orphaned weekly tuner", () => {
  it("the orphaned tuner is gone", () => {
    expect(engine).not.toHaveProperty("runWeeklyTune");
    expect(engine).not.toHaveProperty("aggregateRecentFeedback");
  });

  it("the header no longer claims a weekly cron", () => {
    expect(src).not.toMatch(/self-tuning weekly|weekly aggregate cron|Used by the weekly cron/);
  });

  it("CONTROL: the live surface the style adapter and the override route use is still exported", () => {
    expect(typeof engine.loadPreferenceVector).toBe("function");
    expect(typeof engine.savePreferenceVector).toBe("function");
    expect(typeof engine.buildSystemPromptAddendum).toBe("function");
  });
});
