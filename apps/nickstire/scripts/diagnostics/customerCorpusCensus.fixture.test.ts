import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end positive control for customer-corpus-census: the runner, fed the
 * synthetic fixture instead of the database, must compute every section from
 * rows. If this goes green while production prints zeros, the zeros are the
 * data's, not the instrument's.
 */
const APP = process.cwd();
const TSX = join(APP, "node_modules/.bin/tsx");
const BASE = [
  "scripts/diagnostics/customer-corpus-census.mts",
  "--fixture", "scripts/diagnostics/fixtures/customer-corpus.fixture.json",
  "--since", "2026-09-01", "--until", "2026-09-22",
];
const ENV = { ...process.env, DATABASE_URL: "", CORPUS_ANALYSIS_SALT: "" };
const run = () => JSON.parse(execFileSync(TSX, [...BASE, "--json"], { cwd: APP, encoding: "utf-8", env: ENV }));

describe("customer-corpus-census over the fixture", () => {
  const out = run();

  it("reads every source (no UNKNOWN section) and excludes the outbound call", () => {
    expect(out.unknownSections).toEqual([]);
    expect(out.counts.inboundCalls).toBe(8);
    expect(out.counts.outboundCallsExcluded).toBe(1);
  });

  it("an outbound-only run never opens an episode; the STOP reply does", () => {
    expect(out.counts.episodes).toBe(9);
    expect(out.sms.optOutEpisodes).toBe(1);
  });

  it("the live kernel splits the two-call tire episode the gap rule keeps whole", () => {
    expect(out.counts.callEpisodes).toBe(7);
    expect(out.counts.kernelBucketEpisodes).toBe(8);
  });

  it("a failed text is not a follow-up to a promise", () => {
    expect(out.assistantPromises.episodesWithPromise).toBe(1);
    expect(out.assistantPromises.followedByVisibleContact).toBe(0);
  });

  it("re-asking a size the caller already gave is counted", () => {
    expect(out.repeatedFacts.reaskedKnownSize).toBe(1);
  });

  it("linkage separates new from existing customers and never calls it a win", () => {
    expect(out.invoiceLinkage.linkedEpisodes).toBe(2); // the brakes episode's invoice + the tire episode's
    expect(out.invoiceLinkage.linkedEpisodesNewCustomers).toBe(1);
    expect(out.invoiceLinkage.note).toMatch(/not causation/i);
  });

  it("the classifier miss on a bare used-tire request is surfaced", () => {
    expect(out.kernelDisagreement.intentlessButTireWords).toBe(1);
  });

  it("three customers whose transfers failed inside an hour are ONE system incident", () => {
    expect(out.transferIncidents.failures).toBe(3);
    expect(out.transferIncidents.incidents).toHaveLength(1);
    expect(out.transferIncidents.incidents[0].customers).toBe(3);
  });

  it("a brakes call followed by a used-tire text is linked but flagged ambiguous, never forced", () => {
    expect(out.linkConfidence.ambiguous).toBe(1);
  });

  it("coming back 10+ minutes later is a recontact; opportunity rows join", () => {
    // the tire caller (40 min later), the brakes caller's evening text, and the
    // status texter who nudged 10 minutes later with no reply in between
    expect(out.recontact.episodesRecontactedLater).toBe(3);
    expect(out.opportunities.episodesWithWonRow).toBe(1);
  });
});

describe("--export", () => {
  it("refuses a path inside a git checkout", () => {
    const r = spawnSync(TSX, [...BASE, "--export", join(APP, "corpus-export.jsonl")], { cwd: APP, encoding: "utf-8", env: ENV });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/inside a git checkout/);
  });

  it("writes masked episodes, mode 600, with no raw phone anywhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "corpus-"));
    try {
      const file = join(dir, "episodes.jsonl");
      execFileSync(TSX, [...BASE, "--export", file], { cwd: APP, encoding: "utf-8", env: ENV });
      const text = readFileSync(file, "utf-8");
      const rows = text.trim().split("\n").map((l) => JSON.parse(l));
      expect(rows).toHaveLength(9);
      expect(text).not.toMatch(/555/); // every fixture phone is 216-555-01xx
      expect(rows.every((r) => r.customerKey === null || /^[0-9a-f]{10}$/.test(r.customerKey))).toBe(true);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const tire = rows.find((r) => r.contacts.some((c: { turns?: unknown[] }) => (c.turns ?? []).length > 0 && JSON.stringify(c).includes("already told you")));
      expect(tire).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
