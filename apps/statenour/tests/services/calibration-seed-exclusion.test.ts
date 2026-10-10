/**
 * Audit 2026-10-10 · 06-F6. scripts/seed-judge-calibration.ts writes 30
 * fabricated thumbs (`msg_calibration_*`) and 30 comparisons
 * (`comparison_calibration_*`) tuned to 86.7% agreement into whatever DB is
 * bound — and every worktree binds prod. Readers must not count them as
 * operator labels; the script must refuse unless explicitly allowed on a
 * non-production database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ memFindMany: vi.fn(), msgFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: m.memFindMany }, chatMessage: { findMany: m.msgFindMany } },
}));

import { buildJudgeCalibration } from "@/lib/services/judge-calibration";
import { selectQ32Turn } from "@/lib/evals/q32-regression";
import { calibrationSeedRefusal } from "../../scripts/seed-judge-calibration";

beforeEach(() => {
  vi.clearAllMocks();
  m.memFindMany.mockResolvedValue([
    { metadata: { winner: "v2", sourceMessageId: "msg_calibration_1" } },
    { metadata: { winner: "v2", sourceMessageId: "real1" } },
  ]);
  m.msgFindMany.mockResolvedValue([{ id: "real1", feedbackScore: 1 }]);
});

describe("judge calibration reader", () => {
  it("excludes seeded comparison rows and seeded source messages", async () => {
    await buildJudgeCalibration();
    expect(m.memFindMany.mock.calls[0][0].where).toMatchObject({ NOT: { key: { startsWith: "comparison_calibration_" } } });
    expect(m.msgFindMany.mock.calls[0][0].where.id.in).toEqual(["real1"]);
  });
});

describe("q32 selector", () => {
  it("a seeded thumbs-down is not review material", () => {
    expect(selectQ32Turn({ id: "msg_calibration_3", createdAt: new Date(), feedbackScore: -1 })).toBeNull();
  });

  it("CONTROL: a real thumbs-down is selected", () => {
    expect(selectQ32Turn({ id: "real", createdAt: new Date(), feedbackScore: -1 })?.signals).toEqual(["thumbs_down"]);
  });
});

describe("seed-judge-calibration guard", () => {
  const local = "postgresql://u:p@localhost:5432/dev";
  const neon = "postgresql://u:p@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require";

  it("refuses without ALLOW_CALIBRATION_SEED=1", () => {
    expect(calibrationSeedRefusal({ DATABASE_URL: local })).toMatch(/ALLOW_CALIBRATION_SEED/);
  });

  it("refuses a Neon host (production) even when allowed", () => {
    expect(calibrationSeedRefusal({ ALLOW_CALIBRATION_SEED: "1", DATABASE_URL: neon })).toMatch(/neon/i);
  });

  it("refuses a missing or unparseable DATABASE_URL (fail closed)", () => {
    expect(calibrationSeedRefusal({ ALLOW_CALIBRATION_SEED: "1" })).toMatch(/DATABASE_URL/);
    expect(calibrationSeedRefusal({ ALLOW_CALIBRATION_SEED: "1", DATABASE_URL: "not a url" })).toMatch(/DATABASE_URL/);
  });

  it("a Neon dev branch is allowed only when the non-prod marker names that exact host", () => {
    const host = "ep-cool-123.us-east-2.aws.neon.tech";
    expect(calibrationSeedRefusal({ ALLOW_CALIBRATION_SEED: "1", DATABASE_URL: neon, CALIBRATION_SEED_NON_PROD_HOST: host })).toBeNull();
    expect(calibrationSeedRefusal({ ALLOW_CALIBRATION_SEED: "1", DATABASE_URL: neon, CALIBRATION_SEED_NON_PROD_HOST: "other.neon.tech" })).toMatch(/neon/i);
  });

  it("allows an explicit opt-in against a non-Neon host", () => {
    expect(calibrationSeedRefusal({ ALLOW_CALIBRATION_SEED: "1", DATABASE_URL: local })).toBeNull();
  });
});
