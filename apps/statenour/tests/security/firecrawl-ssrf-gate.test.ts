/**
 * tests/security/firecrawl-ssrf-gate.test.ts
 * 2026-09-02 deep-research audit · finding C-2
 *
 * assertPublicUrl() was written for exactly one sink — the Firecrawl scrape —
 * and was called at 2 of the 6 places that reach it. lib/ai/deep-research.ts,
 * lib/intelligence/ingest.ts, lib/intelligence/change-detection.ts and
 * lib/intelligence/connectors/competitor-watch.ts all passed a URL that
 * traces back to model output or a stored source row with no check at all.
 *
 * The fix moved the check INTO the sink, so this test asserts the sink's
 * behaviour rather than enumerating call sites. That choice is deliberate:
 * a call-site census is only as wide as its file list and goes stale the
 * moment someone adds a seventh caller, whereas a gate at the sink cannot
 * be bypassed by a new caller at all. (Contrast tests/repo/ui-mount-graph:
 * enumeration is right when there is no single chokepoint. Here there is.)
 *
 * Canary discipline (guard-red-team): every refusal case is paired with the
 * positive control that a PUBLIC url gets PAST the gate. Without that half,
 * a gate that refused everything — including a broken assertPublicUrl that
 * always returned unsafe — would score green here while silently killing
 * every scrape in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK must never be reached for a refused URL. If the gate regresses,
// this mock records the call and the assertion below fails loudly rather
// than the test quietly passing because the network was unavailable.
const scrapeSpy = vi.fn();
vi.mock("@mendable/firecrawl-js", () => ({
  default: class {
    scrapeUrl(...args: unknown[]) {
      scrapeSpy(...args);
      return Promise.resolve({ markdown: "ok", metadata: { title: "t", sourceURL: "u" } });
    }
  },
}));

const PRIVATE_URLS = [
  // Cloud metadata — the canonical SSRF prize, named in url-safety.ts's header.
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "http://metadata.google.internal/computeMetadata/v1/",
  // RFC-1918 + loopback + CGNAT literals.
  "http://127.0.0.1:11434/api/tags",
  "http://10.0.0.5/admin",
  "http://192.168.1.1/",
  "http://172.16.0.9/",
  "http://100.64.0.1/",
  "http://[::1]/",
  // Hostname deny-list and suffix deny-list.
  "http://localhost:3001/api/system/health",
  "http://redis.internal/",
  // Non-HTTP schemes must not reach an HTTP client at all.
  "file:///etc/passwd",
  "gopher://example.com/",
];

describe("firecrawl scrapeUrl · SSRF gate lives at the sink, so every caller inherits it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FIRECRAWL_API_KEY = "fc-test-key";
  });
  afterEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
  });

  it.each(PRIVATE_URLS)("refuses %s without ever calling the vendor SDK", async (url) => {
    const { scrapeUrl } = await import("@/lib/integrations/firecrawl");
    await expect(scrapeUrl(url)).rejects.toThrow(/Refused to scrape/i);
    expect(scrapeSpy).not.toHaveBeenCalled();
  });

  it("positive control · a public URL passes the gate and reaches the SDK", async () => {
    // If this fails, the gate is refusing everything and the cases above are
    // meaningless. example.com resolves publicly; the mocked SDK then answers,
    // proving the request got past assertPublicUrl and no further.
    const { scrapeUrl } = await import("@/lib/integrations/firecrawl");
    const result = await scrapeUrl("https://example.com/");
    expect(scrapeSpy).toHaveBeenCalledTimes(1);
    expect(result.markdown).toBe("ok");
  });

  it("the refusal is typed, and classified so the guardian does not retry it", async () => {
    // withGuardian normalises everything to GuardianError but preserves the
    // original on `.lastError`, so a caller can still tell "we refused" from
    // "the vendor failed".
    //
    // The load-bearing half is the CLASSIFICATION: a deterministic refusal
    // must not burn two more attempts and ~800ms of backoff on every
    // poisoned URL. `classify()` is asserted directly because
    // GuardianError.attempts is not a measurement — guardian.ts:666 passes
    // the constant `maxRetries + 1` regardless of how many attempts actually
    // ran, so that field can never falsify a retry claim. Asserting the
    // category instead tests the input to `isRetryable()`, which is the
    // decision that governs the loop.
    const { scrapeUrl, UnsafeScrapeUrlError } = await import("@/lib/integrations/firecrawl");
    const { classify } = await import("@/lib/tools/guardian");

    const err = await scrapeUrl("http://169.254.169.254/").catch((e) => e);
    expect(err.name).toBe("GuardianError");
    expect(err.lastError).toBeInstanceOf(UnsafeScrapeUrlError);
    expect(err.lastError.reason).toMatch(/private_ipv4_literal/);

    // "unknown" is the only category isRetryable() rejects that this message
    // can land in; if a future classify() rule caught it as transient
    // (network/timeout/rate-limit), this fails.
    expect(classify(err.lastError)).toBe("unknown");
  });
});
