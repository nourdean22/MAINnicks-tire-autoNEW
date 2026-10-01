/**
 * Q-23 phase 11 · the lane registry must name real jobs and real variant keys.
 *
 * shared/laneHealth.ts is a list of strings that point at other files. If a job
 * is renamed in the scheduler, the strip would read "no run in 7d" for that lane
 * forever and be believed. These tests pin each string to its source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_LANES } from "../shared/laneHealth";
import { contactLaneForVariant } from "./services/contactExperiment";

const scheduler = readFileSync(path.resolve(__dirname, "cron/scheduler.ts"), "utf8");

/** A variantKey each sender writes today, quoted from the sender. */
const SENDER_KEYS: Record<string, { file: string; literal: string; sample: string }> = {
  declined_recovery: { file: "cron/jobs/declinedWorkRecovery.ts", literal: "variantKey", sample: "declined_7d_P2" },
  retention: { file: "cron/jobs/retentionSequences.ts", literal: "`retention_d${tier.days}`", sample: "retention_d7_v2" },
  winback: { file: "services/winbackProcessor.ts", literal: 'variantKey: "winback"', sample: "winback" },
  review_request: { file: "routers/reviewRequests.ts", literal: 'variantKey: "review_request"', sample: "review_request" },
  review_reminder: { file: "services/reviewReminder.ts", literal: '"review_reminder"', sample: "review_reminder" },
  weather: { file: "services/weatherIntelligence.ts", literal: "`weather_${triggerId}`", sample: "weather_freeze" },
  drip: { file: "services/dripProcessor.ts", literal: 'variantKey: "drip"', sample: "drip" },
  campaign_retry: { file: "services/workOrderAutomation.ts", literal: 'variantKey: "campaign_retry"', sample: "campaign_retry" },
};

describe("CUSTOMER_LANES", () => {
  it("every lane names a job the scheduler registers", () => {
    for (const lane of CUSTOMER_LANES) {
      expect(scheduler, lane.jobName).toMatch(new RegExp(`name:\\s*"${lane.jobName}"`));
    }
  });

  it("covers every sender listed here, and each sender still writes its key", () => {
    expect(CUSTOMER_LANES.map((l) => l.key).sort()).toEqual(Object.keys(SENDER_KEYS).sort());
    for (const lane of CUSTOMER_LANES) {
      const s = SENDER_KEYS[lane.key]!;
      const src = readFileSync(path.resolve(__dirname, s.file), "utf8");
      expect(src, `${s.file} no longer contains ${s.literal}`).toContain(s.literal);
      expect(lane.variant.test(s.sample), `${lane.key} does not match ${s.sample}`).toBe(true);
    }
  });

  it("no two lanes claim the same variant key", () => {
    for (const lane of CUSTOMER_LANES) {
      const sample = SENDER_KEYS[lane.key]!.sample;
      const claimants = CUSTOMER_LANES.filter((l) => l.variant.test(sample)).map((l) => l.key);
      expect(claimants).toEqual([lane.key]);
    }
  });

  it("a lane with a holdout probes a variant the Q-21 registry knows, and its lane keys match", () => {
    for (const lane of CUSTOMER_LANES) {
      if (!lane.holdoutLane) {
        expect(lane.holdoutProbeVariant).toBeNull();
        expect(lane.noHoldoutReason).toBeTruthy();
        // And the Q-21 registry agrees: this lane is not a contact holdout.
        expect(contactLaneForVariant(SENDER_KEYS[lane.key]!.sample)).toBeNull();
        continue;
      }
      const def = contactLaneForVariant(lane.holdoutProbeVariant);
      expect(def, lane.key).not.toBeNull();
      expect(lane.holdoutLane.test(def!.laneKey), `${lane.key} vs ${def!.laneKey}`).toBe(true);
      // The sender's real key lands in the same holdout lane family.
      const real = contactLaneForVariant(SENDER_KEYS[lane.key]!.sample);
      expect(real && lane.holdoutLane.test(real.laneKey), lane.key).toBe(true);
    }
  });
});
