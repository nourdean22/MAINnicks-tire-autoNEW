/**
 * tests/integrations/firecrawl.test.ts
 *
 * Unit tests for the Firecrawl integration wrapper.
 * Tests config detection and export shape — NOT live API calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("firecrawl integration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("isFirecrawlConfigured returns false when key is missing", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    // Re-import to get fresh module state
    const { isFirecrawlConfigured } = await import(
      "@/lib/integrations/firecrawl"
    );
    expect(isFirecrawlConfigured()).toBe(false);
  });

  it("isFirecrawlConfigured returns true when key is set", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key");
    const { isFirecrawlConfigured } = await import(
      "@/lib/integrations/firecrawl"
    );
    expect(isFirecrawlConfigured()).toBe(true);
  });

  it("exports scrapeUrl as a function", async () => {
    const mod = await import("@/lib/integrations/firecrawl");
    expect(typeof mod.scrapeUrl).toBe("function");
  });

  it("exports isFirecrawlConfigured as a function", async () => {
    const mod = await import("@/lib/integrations/firecrawl");
    expect(typeof mod.isFirecrawlConfigured).toBe("function");
  });
});
