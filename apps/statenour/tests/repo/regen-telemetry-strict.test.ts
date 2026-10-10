/**
 * Audit 2026-10-10 · 01-F6. The verified-regen telemetry write used the
 * fail-soft `recordMetric`, whose own `.catch(() => {})` swallowed a dead
 * system_metrics writer, so the surrounding `verified_regen_telemetry_failed`
 * warn could never fire: a missing row and "no regen" looked identical.
 * The strict writer rejects into that try/catch (the chat reply is still safe).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "../../app/api/ai/chat/alternate-paths.ts"), "utf8");

describe("alternate-paths · regen telemetry", () => {
  it("writes through recordMetricStrict inside the warn-on-failure try/catch", () => {
    const at = src.indexOf("formatRegenTelemetry(");
    const block = src.slice(at, src.indexOf("verified_regen_telemetry_failed", at));
    expect(block).toContain("await recordMetricStrict(regenMetric.metric");
    expect(block).not.toMatch(/\{ recordMetric \}/);
  });
});
