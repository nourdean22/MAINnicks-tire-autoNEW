/**
 * tests/brain/memory-trust.test.ts
 *
 * Guards the provenance classifier that decides whether a stored memory
 * may be spoken as fact or must be fenced as a quote.
 *
 * PROD BASIS (2026-09-03): ~2,179 rows in brain_memories carry `source`
 * values that are news sites — cleantechnica, electrek, cleveland-com,
 * fox8-cleveland, wkyc-3, inside-evs, car-driver — all with
 * `created_by: "system"`, all in category `industry_intel`, and still
 * being written today. Recall did not filter on source, so a scraped
 * article was retrieved indistinguishably from something Nour said.
 *
 * CANARY DISCIPLINE: the dangerous failure is not "a first-party source
 * got mislabelled external" — that costs a missing recall. It is
 * "external content got labelled trusted", which is a durable prompt
 * injection. So the tests assert the FAIL-CLOSED direction explicitly:
 * unknown, empty, and hostname-shaped sources must all land in
 * EXTERNAL_CONTENT, and the every-real-prod-source table is pinned.
 */

import { describe, it, expect } from "vitest";
import {
  classifyTrustTier,
  isAuthoritative,
  fenceUntrustedMemory,
  looksLikeExternalHost,
  AUTHORITATIVE_TIERS,
} from "@/lib/brain/memory-trust";

describe("classifyTrustTier — the seven scraped sources found in prod", () => {
  // Every one of these is real, with a real row count, measured 2026-09-03.
  it.each([
    ["cleantechnica", 368],
    ["car-driver", 378],
    ["cleveland-com", 329],
    ["electrek", 324],
    ["fox8-cleveland", 317],
    ["wkyc-3", 305],
    ["inside-evs", 158],
  ])("%s (%i prod rows) is EXTERNAL_CONTENT", (source) => {
    expect(classifyTrustTier(source, "system")).toBe("EXTERNAL_CONTENT");
  });

  it("does NOT let created_by:system launder a scraped source into trusted", () => {
    // This is the exact prod shape: every scraped row says system.
    expect(isAuthoritative(classifyTrustTier("electrek", "system"))).toBe(false);
  });
});

describe("classifyTrustTier — first-party sources stay usable", () => {
  it.each([
    ["manual", "OPERATOR"],
    ["user", "OPERATOR"],
    ["lib:semantic-link", "SYSTEM_DERIVED"],
    ["mastery-xp", "SYSTEM_DERIVED"],
    ["journal_brain", "SYSTEM_DERIVED"],
    ["memory-commit-gateway", "SYSTEM_DERIVED"],
    ["cron:data-source-health", "SYSTEM_DERIVED"],
    ["brain/customer-preferences", "SYSTEM_DERIVED"],
    ["device_analysis", "SYSTEM_DERIVED"],
    ["distillation", "AGENT_INFERRED"],
    ["output_critic", "AGENT_INFERRED"],
    ["judge-eval", "AGENT_INFERRED"],
  ] as const)("%s -> %s", (source, tier) => {
    expect(classifyTrustTier(source, "system")).toBe(tier);
  });

  it("an explicit human author outranks the source slug", () => {
    // Nour correcting a scraped claim by hand must become OPERATOR.
    expect(classifyTrustTier("electrek", "user")).toBe("OPERATOR");
    expect(classifyTrustTier("anything", "nour")).toBe("OPERATOR");
  });
});

describe("CANARY: unknown provenance must FAIL CLOSED", () => {
  // Cost of over-restricting a first-party source: one missing recall.
  // Cost of under-restricting a scraped one: a durable prompt injection.
  it("treats an empty source as EXTERNAL_CONTENT, not SYSTEM_DERIVED", () => {
    expect(classifyTrustTier("", "system")).toBe("EXTERNAL_CONTENT");
    expect(classifyTrustTier(null)).toBe("EXTERNAL_CONTENT");
    expect(classifyTrustTier(undefined)).toBe("EXTERNAL_CONTENT");
  });

  it("treats a bare hostname as EXTERNAL_CONTENT even though it is not in the list", () => {
    // A feed added later without editing memory-trust.ts must not
    // silently arrive as trusted.
    expect(classifyTrustTier("techcrunch.com")).toBe("EXTERNAL_CONTENT");
    expect(classifyTrustTier("sub.example.co.uk")).toBe("EXTERNAL_CONTENT");
    expect(classifyTrustTier("https://evil.example/post")).toBe("EXTERNAL_CONTENT");
  });

  it.each(["web:", "rss:", "scrape:", "firecrawl", "news:", "telegram:", "email:"])(
    "treats the %s prefix as EXTERNAL_CONTENT",
    (prefix) => {
      expect(classifyTrustTier(`${prefix}whatever`)).toBe("EXTERNAL_CONTENT");
    }
  );

  it("EXTERNAL_CONTENT is never in the authoritative set", () => {
    // If this ever passes, everything above is decorative.
    expect(AUTHORITATIVE_TIERS).not.toContain("EXTERNAL_CONTENT");
    expect(isAuthoritative("EXTERNAL_CONTENT")).toBe(false);
  });

  it("looksLikeExternalHost does not misfire on first-party slugs", () => {
    // The complement: a fail-closed default is only usable if it does
    // not swallow every internal source name.
    expect(looksLikeExternalHost("lib:semantic-link")).toBe(false);
    expect(looksLikeExternalHost("cron:data-source-health")).toBe(false);
    expect(looksLikeExternalHost("mastery-xp")).toBe(false);
    expect(looksLikeExternalHost("journal_brain")).toBe(false);
  });
});

describe("fenceUntrustedMemory", () => {
  it("labels the content with its source so it reads as a quote, not knowledge", () => {
    const out = fenceUntrustedMemory("EVs outsold trucks in Q2", "electrek");
    expect(out).toContain('<untrusted-memory source="electrek">');
    expect(out).toContain("EVs outsold trucks in Q2");
    expect(out).toContain("</untrusted-memory>");
  });
});
