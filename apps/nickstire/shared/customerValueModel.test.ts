import { describe, expect, it } from "vitest";
import {
  CDNOW_BGNBD_PARAMS,
  CDNOW_GAMMA_GAMMA_PARAMS,
  bgnbdExpectedPurchases,
  bgnbdProbabilityAlive,
  customerValueRankingScore,
  gammaGammaExpectedAverageValue,
  gammaGammaPopulationMean,
  hypergeometric2F1,
} from "./customerValueModel";

describe("Q-27 BG/NBD · CDNOW golden answers", () => {
  /**
   * Published lifetimes Quickstart top-five ranking for t=1.
   * The architecture register intentionally stores the rounded fitted params
   * (r=.243, alpha=4.414, a=.793, b=2.426). Those rounded params reproduce
   * the published answers within a few millionths.
   */
  const goldens = [
    { frequency: 18, recency: 35.14, T: 35.86, expected: 0.424877 },
    { frequency: 19, recency: 34.0, T: 34.14, expected: 0.474738 },
    { frequency: 17, recency: 28.43, T: 28.86, expected: 0.486526 },
    { frequency: 29, recency: 37.71, T: 38.0, expected: 0.662396 },
    { frequency: 26, recency: 30.86, T: 31.0, expected: 0.710623 },
  ] as const;

  it("pins the architecture's rounded CDNOW BG/NBD fit", () => {
    expect(CDNOW_BGNBD_PARAMS).toEqual({
      r: 0.243,
      alpha: 4.414,
      a: 0.793,
      b: 2.426,
    });
  });

  for (const g of goldens) {
    it(`matches CDNOW expected-purchase golden for x=${g.frequency}`, () => {
      const actual = bgnbdExpectedPurchases({
        horizon: 1,
        frequency: g.frequency,
        recency: g.recency,
        T: g.T,
      });
      expect(Math.abs(actual - g.expected)).toBeLessThan(3e-6);
    });
  }

  it("a one-purchase customer is alive with probability 1 by model definition", () => {
    expect(
      bgnbdProbabilityAlive({ frequency: 0, recency: 0, T: 38.86 }),
    ).toBe(1);
  });

  it("refuses impossible recency > T", () => {
    expect(() =>
      bgnbdExpectedPurchases({
        horizon: 1,
        frequency: 2,
        recency: 40,
        T: 38,
      }),
    ).toThrow(/recency cannot exceed T/);
  });
});

describe("Q-27 Gamma-Gamma · CDNOW goldens", () => {
  /**
   * Lifetimes Quickstart prints this rounded fit from 946 returning CDNOW
   * customers and these conditional expected-average-profit examples.
   * Because the displayed params are rounded, allow cents-level tolerance.
   */
  it("pins the published rounded fit", () => {
    expect(CDNOW_GAMMA_GAMMA_PARAMS).toEqual({
      p: 6.25,
      q: 3.74,
      v: 15.45,
    });
  });

  const goldens = [
    { frequency: 2, monetaryValue: 22.35, expected: 24.658619 },
    { frequency: 1, monetaryValue: 11.77, expected: 18.911489 },
    { frequency: 7, monetaryValue: 73.74, expected: 71.462843 },
    { frequency: 2, monetaryValue: 25.55, expected: 27.282408 },
  ] as const;

  for (const g of goldens) {
    it(`stays within rounding tolerance for x=${g.frequency}, m=${g.monetaryValue}`, () => {
      const actual = gammaGammaExpectedAverageValue(g);
      expect(Math.abs(actual - g.expected)).toBeLessThan(0.02);
    });
  }

  it("zero-repeat customers shrink to the population mean instead of inventing personal evidence", () => {
    expect(
      gammaGammaExpectedAverageValue({ frequency: 0, monetaryValue: 0 }),
    ).toBe(gammaGammaPopulationMean());
  });
});

describe("Q-27 ranking-only safety", () => {
  it("higher purchase expectation or expected value raises the score; no send/action exists here", () => {
    const colder = customerValueRankingScore({
      horizon: 4,
      frequency: 1,
      recency: 1,
      T: 38,
      monetaryValue: 20,
    });
    const warmer = customerValueRankingScore({
      horizon: 4,
      frequency: 7,
      recency: 30,
      T: 38,
      monetaryValue: 70,
    });
    expect(warmer.score).toBeGreaterThan(colder.score);
    expect(warmer.expectedPurchases).toBeGreaterThan(colder.expectedPurchases);
    expect(warmer.expectedAverageValue).toBeGreaterThan(colder.expectedAverageValue);
  });

  it("the 2F1 implementation converges on a simple identity", () => {
    // 2F1(a,b;b,z) = (1-z)^(-a)
    const actual = hypergeometric2F1(2, 3, 3, 0.2);
    expect(actual).toBeCloseTo(1 / 0.8 ** 2, 10);
  });
});
