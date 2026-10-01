/**
 * The ESTIMATE state of the owner panel's "SMS + voice cost vs recovered
 * revenue" tile (#2838).
 *
 * #2838 drew that tile from the two estimate fields alone. A window holding
 * only an estimated revenue row therefore read "~$0.00 → ~$80.00", a free
 * money ratio the tile's own note says it does not claim. Measured money that
 * joined no attributionRef also vanished, so a measured $5.00 send cost read
 * as ~$0.00. Each case below runs the real report builder into the real tile
 * builder; only Prisma is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { realityEvent: { findMany: h.findMany, findFirst: vi.fn() } },
}));
vi.mock("@/lib/intelligence/episodes", () => ({ recordEpisode: vi.fn() }));

import { buildCostPerOutcomeAttribution } from "@/lib/intelligence/value-attribution";
import { costTiles } from "@/lib/system/owner-panel";

type Measurement = "MEASURED" | "ESTIMATE";

const sendCost = (amountCents: number, measurement: Measurement, attributionRef = "recovery:lane-a") => ({
  payload: { cost: { attributionRef, category: "sms", amountCents, measurement } },
});

const recovered = (amountCents: number, measurement: Measurement, attributionRef = "recovery:lane-a") => ({
  payload: {
    businessValue: {
      attributionRef,
      category: "recovered_revenue",
      amountCents,
      measurement,
      holdoutAdjusted: measurement === "MEASURED",
      outcomeCount: 1,
    },
  },
});

async function tileFor(rows: unknown[]) {
  h.findMany.mockResolvedValue(rows);
  const report = await buildCostPerOutcomeAttribution(7);
  const tile = costTiles(null, null, report).find((t) => t.key === "recovered_revenue");
  if (!tile) throw new Error("recovered_revenue tile missing");
  return { report, tile };
}

beforeEach(() => {
  h.findMany.mockReset();
});

describe("recovered-revenue tile in the ESTIMATE state", () => {
  it("an estimated revenue row with no cost row says no cost is recorded, not ~$0.00", async () => {
    const { report, tile } = await tileFor([recovered(8_000, "ESTIMATE")]);
    expect(report.measurementState).toBe("ESTIMATE");
    expect(tile.provenance).toBe("ESTIMATE");
    expect(tile.value).toBe("no cost recorded → ~$80.00");
  });

  it("an estimated cost row with no revenue row says no revenue is recorded", async () => {
    const { tile } = await tileFor([sendCost(150, "ESTIMATE")]);
    expect(tile.value).toBe("~$1.50 → no revenue recorded");
  });

  it("a measured send cost that joined no revenue still counts on the cost side", async () => {
    const { report, tile } = await tileFor([sendCost(500, "MEASURED"), recovered(8_000, "ESTIMATE")]);
    expect(report.measurementState).toBe("ESTIMATE");
    expect(report.matchedRefs).toBe(0);
    expect(tile.value).toBe("~$5.00 → ~$80.00");
  });

  it("measured holdout-adjusted revenue that joined no cost still counts on the revenue side", async () => {
    const { report, tile } = await tileFor([sendCost(150, "ESTIMATE"), recovered(8_000, "MEASURED")]);
    expect(report.measurementState).toBe("ESTIMATE");
    expect(report.matchedRefs).toBe(0);
    expect(tile.value).toBe("~$1.50 → ~$80.00");
  });

  it("estimates on both sides render as before (positive control)", async () => {
    const { tile } = await tileFor([sendCost(150, "ESTIMATE"), recovered(8_000, "ESTIMATE")]);
    expect(tile.value).toBe("~$1.50 → ~$80.00");
    expect(tile.note).toMatch(/no ROI is claimed/);
  });
});
