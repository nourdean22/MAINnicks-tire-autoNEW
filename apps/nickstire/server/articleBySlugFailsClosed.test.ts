/**
 * A database failure must not be rendered to Google as "this article does not exist".
 *
 * THIS IS THE FABRICATED-READ CLASS (ROS-102) CAUSING SEO DAMAGE, and the two
 * were investigated as separate problems for most of a day before they turned
 * out to be one.
 *
 * getDynamicArticleBySlug returns `null` on a dead handle
 * (content-generator.ts:449) — the same value it returns for a slug that
 * genuinely has no article. BlogPost.tsx cannot tell those apart, so it renders
 * its not-found branch: "ARTICLE NOT FOUND". The prerenderer captured that at
 * HTTP 200 and committed it for URLs the sitemap advertises, and Google
 * classified them as Soft 404s.
 *
 * MEASURED, not theorised. Prerender refresh run 34522396903 (2026-09-10):
 * SIX DB-backed blog routes rendered the not-found branch, all inside a
 * 90-second window about fourteen minutes into the run — exactly where the
 * DB-dynamic routes are appended, last. All 118 static articles rendered fine
 * in the same run. That shape is a handle failing late in a long run, reported
 * to the reader as missing content.
 *
 * ROS-083 SHAPE: the guard belongs at the ROUTER. The helper's `null` is
 * load-bearing for genuinely-absent slugs, so changing the helper would break
 * the honest case to fix the dishonest one.
 *
 * Asserted through the REAL procedure with the db module mocked to hand back a
 * dead handle — the condition itself, not a restatement of the source.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const getDbTyped = vi.fn();

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDbTyped: () => getDbTyped() };
});

// The helper must stay reachable and honest: it is NOT what we are changing.
const getDynamicArticleBySlug = vi.fn();
const getPublishedArticles = vi.fn();
vi.mock("./content-generator", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDynamicArticleBySlug: (s: string) => getDynamicArticleBySlug(s),
    getPublishedArticles: () => getPublishedArticles(),
  };
});

// Capture the miss diagnostic. It is an instrument, so it gets asserted.
const warn = vi.fn();
vi.mock("./lib/logger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "routers:content"
        ? { warn: (...a: unknown[]) => warn(...a), info: () => {}, error: () => {}, debug: () => {} }
        : (actual.createLogger as (n: string) => unknown)(name),
  };
});

async function callArticleBySlug(slug: string) {
  const { contentRouter } = await import("./routers/content");
  const caller = contentRouter.createCaller({} as never);
  return caller.articleBySlug({ slug });
}

describe("articleBySlug fails CLOSED on a dead database handle", () => {
  beforeEach(() => {
    getDbTyped.mockReset();
    getDynamicArticleBySlug.mockReset();
    getPublishedArticles.mockReset();
    warn.mockReset();
  });
  afterEach(() => vi.resetModules());

  it("throws SERVICE_UNAVAILABLE rather than reporting the article missing", async () => {
    getDbTyped.mockResolvedValue(null); // the outage condition
    await expect(callArticleBySlug("brake-fluid-flush-when-needed")).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("does not even ask the helper when the handle is dead", async () => {
    // If it still called through, the helper's own `if (!db) return null` would
    // hand back the fabricated value and the guard would be decorative.
    getDbTyped.mockResolvedValue(null);
    await callArticleBySlug("anything").catch(() => {});
    expect(getDynamicArticleBySlug).not.toHaveBeenCalled();
  });

  it("still returns null for a slug that genuinely has no article", async () => {
    // The other half, and the reason the guard is at the router: a real absence
    // must stay a null. Without this arm, "throw on everything" would pass the
    // arms above while breaking every legitimately-missing slug.
    getDbTyped.mockResolvedValue({} as never);
    getDynamicArticleBySlug.mockResolvedValue(null);
    await expect(callArticleBySlug("no-such-post")).resolves.toBeNull();
  });

  it("returns the row when the database is healthy", async () => {
    getDbTyped.mockResolvedValue({} as never);
    getDynamicArticleBySlug.mockResolvedValue({ slug: "x", status: "published" });
    await expect(callArticleBySlug("x")).resolves.toMatchObject({ slug: "x" });
  });

  it("a MISS reports how many published rows that connection can see", async () => {
    // The diagnostic exists because a miss and a healthy empty result are
    // indistinguishable from outside the process, and two prerendered URLs have
    // been missing for four consecutive refreshes while production serves the
    // same slugs a full article. The count is the discriminator: 14 means the
    // row was there and the match failed; a lower number means that connection
    // is reading a partial view.
    //
    // Asserted rather than assumed — an unproven instrument is the thing this
    // whole class of bug is made of.
    getDbTyped.mockResolvedValue({} as never);
    getDynamicArticleBySlug.mockResolvedValue(null);
    getPublishedArticles.mockResolvedValue([{ slug: "a" }, { slug: "b" }, { slug: "c" }]);

    await expect(callArticleBySlug("ghost-slug")).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      "articleBySlug found no published row",
      expect.objectContaining({ slug: "ghost-slug", publishedVisibleToThisConnection: 3 }),
    );
  });

  it("stays quiet on a HIT — the miss log is not noise on the happy path", async () => {
    getDbTyped.mockResolvedValue({} as never);
    getDynamicArticleBySlug.mockResolvedValue({ slug: "real", status: "published" });
    await callArticleBySlug("real");
    expect(warn).not.toHaveBeenCalled();
    expect(getPublishedArticles, "the follow-up count must not run on a hit").not.toHaveBeenCalled();
  });

  it("a miss whose follow-up count ALSO fails still reports the miss", async () => {
    // Without this arm the diagnostic could throw inside its own catch path and
    // swallow the very event it exists to record.
    getDbTyped.mockResolvedValue({} as never);
    getDynamicArticleBySlug.mockResolvedValue(null);
    getPublishedArticles.mockRejectedValue(new Error("connection lost"));

    await expect(callArticleBySlug("ghost-slug")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "articleBySlug miss — and the follow-up count also failed",
      expect.objectContaining({ slug: "ghost-slug" }),
    );
  });
});
