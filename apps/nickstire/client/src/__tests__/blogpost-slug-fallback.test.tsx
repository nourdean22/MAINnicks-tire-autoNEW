/**
 * A blog post must find its own slug even when the route re-match comes back empty.
 *
 * WHAT WENT WRONG. App.tsx matches `/blog/:slug` to render BlogPost, and
 * BlogPost then called useRoute("/blog/:slug") a SECOND time to read the param.
 * When that second match returned nothing, `slug` was "" — which makes the
 * static lookup miss AND disables the dynamic query, because it is gated on
 * `slug.length > 0`. The page then rendered "ARTICLE NOT FOUND" having asked
 * nobody anything.
 *
 * THE EVIDENCE THAT IT WAS THE QUERY NEVER FIRING, not the query failing:
 * prerender run 34548151768 rendered the not-found branch for four DB-backed
 * blog routes while the server log contained NO articleBySlug error and NO
 * articleBySlug miss. Since #2315 a miss logs itself with the count of rows its
 * connection can see, so "no miss logged" means the procedure was never called.
 * Production serves those same slugs a full article and the pages render fine in
 * a real browser — the data path was never the problem.
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS — read before "simplifying" it.
 *
 * The first version of this test could not import the hook (it needs a React
 * renderer and a wouter Router), so it asserted against a local MIRROR of the
 * derivation plus a few `toContain` checks on BlogPost.tsx's source text. All
 * eight tests passed. Then the mutation ran — the SSR guard in BlogPost.tsx was
 * replaced with a bare `return ""`, killing the fallback outright — and all
 * eight tests STILL PASSED. The mirror is a copy, so it cannot notice; and
 * "window.location.pathname" was still present in the file one line below the
 * mutation, so the substring check could not notice either.
 *
 * The fix was not a better assertion. It was removing the obstacle: the pure
 * decision now lives in @/lib/blogSlug and BOTH the component and this file
 * import the same function. Every arm below executes the code that ships.
 * The source-shape block at the bottom covers the only part that cannot be
 * imported — that the hook actually hands the real URL to that function.
 */
import { describe, expect, it } from "vitest";
import { deriveBlogSlug } from "@/lib/blogSlug";
import { sliceBlock } from "../../../server/testUtils/sourceBlock";

describe("blog slug derivation", () => {
  it("uses the route match when there is one", () => {
    expect(deriveBlogSlug("brake-fluid-flush-when-needed", "/blog/anything-else")).toBe(
      "brake-fluid-flush-when-needed",
    );
  });

  it("falls back to the URL when the re-match is empty — the actual bug", () => {
    // Before the fix this returned "", which disabled the query and rendered
    // ARTICLE NOT FOUND for an article that exists.
    expect(deriveBlogSlug(undefined, "/blog/best-all-season-tires-ohio-highway")).toBe(
      "best-all-season-tires-ohio-highway",
    );
    expect(deriveBlogSlug(undefined, "/blog/tire-pressure-warning-light-what-to-do")).toBe(
      "tire-pressure-warning-light-what-to-do",
    );
  });

  it("returns empty during SSR, where there is no pathname to read", () => {
    // The hook passes `undefined` rather than hiding a `typeof window` check
    // inside the pure function, precisely so this arm can exist.
    expect(deriveBlogSlug(undefined, undefined)).toBe("");
    // ...but a route match still wins with no pathname at all.
    expect(deriveBlogSlug("real-slug", undefined)).toBe("real-slug");
  });

  it("stops at a query string or hash rather than swallowing them into the slug", () => {
    expect(deriveBlogSlug(undefined, "/blog/some-post?utm_source=google")).toBe("some-post");
    expect(deriveBlogSlug(undefined, "/blog/some-post#section")).toBe("some-post");
  });

  it("ignores a trailing path segment", () => {
    expect(deriveBlogSlug(undefined, "/blog/some-post/extra")).toBe("some-post");
  });

  it("decodes a percent-encoded slug", () => {
    expect(deriveBlogSlug(undefined, "/blog/caf%C3%A9-repair")).toBe("café-repair");
  });

  it("survives a malformed escape instead of throwing", () => {
    // decodeURIComponent("%E0%A4%A") throws. A blog page must not white-screen
    // because someone hand-typed a bad URL.
    expect(() => deriveBlogSlug(undefined, "/blog/%E0%A4%A")).not.toThrow();
    expect(deriveBlogSlug(undefined, "/blog/%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("returns empty off a non-blog path — no false slug", () => {
    // The fallback must not invent a slug on a route that has none; an empty
    // string is the honest answer there.
    expect(deriveBlogSlug(undefined, "/tires")).toBe("");
    expect(deriveBlogSlug(undefined, "/blog")).toBe("");
    expect(deriveBlogSlug(undefined, "/")).toBe("");
  });
});

describe("the hook hands deriveBlogSlug the real URL", () => {
  it("useBlogSlug passes the live pathname, not a constant", async () => {
    // This is the ONE thing the arms above cannot reach: they prove the rule,
    // but a hook that called deriveBlogSlug(params?.slug, "") would satisfy
    // every one of them while shipping the original bug back.
    //
    // Asserted on the hook's BODY, sliced with a helper that throws on a missing
    // anchor — an `indexOf` that returns -1 silently widens a slice to EOF, and
    // a test bounded that way asserts on somebody else's code (see
    // server/testUtils/sourceBlock.ts).
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "client/src/pages/BlogPost.tsx"), "utf8");

    const body = sliceBlock(src, "function useBlogSlug()", "\nexport default function BlogPost", {
      label: "BlogPost.tsx",
    });

    expect(body, "the hook must delegate, not re-implement the rule inline").toContain(
      "deriveBlogSlug(",
    );
    expect(
      body,
      "the second argument must be the live pathname — a constant here is the original bug",
    ).toMatch(/window\.location\.pathname/);
    expect(body, "the route match stays the primary source").toMatch(/params\?\.slug/);

    // And the wiring: a hook calling a function it never imported would fail at
    // runtime, not here, so pin the import too.
    expect(src).toMatch(/import \{ deriveBlogSlug \} from "@\/lib\/blogSlug"/);
  });
});
