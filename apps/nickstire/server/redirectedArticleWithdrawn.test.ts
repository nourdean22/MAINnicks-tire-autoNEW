/**
 * A blog slug that server/_core/redirects.ts 301s is withdrawn everywhere, not
 * only on a full page load.
 *
 * 2026-10-01: /blog/tire-shop-near-me-open-now (a DB article promising "$0
 * down financing ... 2-minute approval, no hard credit check") got a 301. The
 * 301 is Express middleware, so it never sees in-app navigation: /blog and
 * /site-map still listed the article from content.publishedArticles, and the
 * SPA rendered it from content.articleBySlug. The prerenderer loads the same
 * list. Asserted through the real accessors with a fake handle that returns
 * the row, so the filter, not the query, is what is under test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const rows = [
  { slug: "tire-shop-near-me-open-now", status: "published" },
  { slug: "brake-fluid-flush-when-needed", status: "published" },
];
const queried = vi.fn();
function fakeDb() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = (n: number) => {
    queried(n);
    return Promise.resolve(n === 1 ? rows.slice(0, 1) : rows);
  };
  return chain;
}

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDb: async () => fakeDb() };
});

afterEach(() => {
  queried.mockReset();
});

describe("a redirected blog slug is withdrawn from the article store", () => {
  it("is left out of the published list that /blog, /site-map and the prerenderer read", async () => {
    const { getPublishedArticles } = await import("./content-generator");
    const slugs = (await getPublishedArticles()).map((a: { slug: string }) => a.slug);
    expect(slugs).toEqual(["brake-fluid-flush-when-needed"]);
  });

  it("reads as absent by slug, without querying", async () => {
    const { getDynamicArticleBySlug } = await import("./content-generator");
    expect(await getDynamicArticleBySlug("tire-shop-near-me-open-now")).toBeNull();
    expect(queried).not.toHaveBeenCalled();
  });

  it("still returns a slug that is not redirected (control)", async () => {
    const { getDynamicArticleBySlug } = await import("./content-generator");
    expect(await getDynamicArticleBySlug("brake-fluid-flush-when-needed")).not.toBeNull();
    expect(queried).toHaveBeenCalledWith(1);
  });
});
