import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * End-to-end positive control for customer-corpus-census: the runner, fed the
 * synthetic fixture instead of the database, must compute every section from
 * rows. If this goes green while production prints zeros, the zeros are the
 * data's, not the instrument's.
 */
const APP = process.cwd();
const run = () =>
  JSON.parse(
    execFileSync(
      join(APP, "node_modules/.bin/tsx"),
      [
        "scripts/diagnostics/customer-corpus-census.mts",
        "--fixture", "scripts/diagnostics/fixtures/customer-corpus.fixture.json",
        "--since", "2026-09-01", "--until", "2026-09-22", "--json",
      ],
      { cwd: APP, encoding: "utf-8", env: { ...process.env, DATABASE_URL: "" } },
    ),
  );

describe("customer-corpus-census over the fixture", () => {
  const out = run();

  it("reads every source (no UNKNOWN section) and excludes the outbound call", () => {
    expect(out.unknownSections).toEqual([]);
    expect(out.counts.inboundCalls).toBe(5);
    expect(out.counts.outboundCallsExcluded).toBe(1);
  });

  it("an outbound-only run never opens an episode; the STOP reply does", () => {
    expect(out.counts.episodes).toBe(6);
    expect(out.sms.optOutEpisodes).toBe(1);
  });

  it("the live kernel splits the two-call tire episode the gap rule keeps whole", () => {
    expect(out.counts.callEpisodes).toBe(4);
    expect(out.counts.kernelBucketEpisodes).toBe(5);
  });

  it("a failed text is not a follow-up to a promise", () => {
    expect(out.assistantPromises.episodesWithPromise).toBe(1);
    expect(out.assistantPromises.followedByVisibleContact).toBe(0);
  });

  it("re-asking a size the caller already gave is counted", () => {
    expect(out.repeatedFacts.reaskedKnownSize).toBe(1);
  });

  it("linkage separates new from existing customers and never calls it a win", () => {
    expect(out.invoiceLinkage.linkedEpisodes).toBe(2);
    expect(out.invoiceLinkage.linkedEpisodesNewCustomers).toBe(1);
    expect(out.invoiceLinkage.note).toMatch(/not causation/i);
  });

  it("the classifier miss on a bare used-tire request is surfaced", () => {
    expect(out.kernelDisagreement.intentlessButTireWords).toBe(1);
  });
});
