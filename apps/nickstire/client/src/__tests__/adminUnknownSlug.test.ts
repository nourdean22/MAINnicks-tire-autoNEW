/**
 * adminUnknownSlug.test.ts · 2026-08-03
 *
 * `resolveInitialSection()` used to end in `?? "overview"`. Every failure mode of
 * a deep link — mistyped slug, section renamed out from under a saved link, a URL
 * copied from a stale note — produced the byte-identical result of the operator
 * deliberately opening Today. The failure had no way to be seen.
 *
 * That is the same shape this admin has been removing elsewhere: a read that fails
 * and renders as an ordinary success. These tests hold the line by asserting the
 * DISTINCTION rather than the destination — landing on `overview` is correct in
 * both cases, so a test that only checked `section` would have passed against the
 * old silent code and proved nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveInitialSection } from "../pages/admin/registry";

/**
 * Serial vitest shares ONE process across files, so anything mutated here has to
 * be handed back exactly as found or it resurfaces as a failure in an unrelated
 * file. Both the URL and the console spy are restored in afterEach.
 */
const ORIGINAL_URL = "/admin";

function visit(search: string): void {
  window.history.replaceState({}, "", `/admin${search}`);
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", ORIGINAL_URL);
});

describe("resolveInitialSection · a bad link says it is bad", () => {
  it("reports an unknown slug instead of silently landing on Today", () => {
    visit("?tab=this-section-does-not-exist");

    const result = resolveInitialSection();

    expect(result.section).toBe("overview");
    expect(result.unresolvedSlug).toBe("this-section-does-not-exist");
  });

  it("warns on the unknown slug, matching the admin:navigate-section listener", () => {
    visit("?tab=totally-bogus");

    resolveInitialSection();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown ?tab= slug"),
      "totally-bogus",
    );
  });

  /**
   * The regression this file exists for. Both cases land on `overview`, so only
   * the unresolvedSlug field separates "the operator opened Today" from "the
   * operator asked for something that does not exist". Assert the difference.
   */
  it("distinguishes a bad slug from no slug, even though both land on Today", () => {
    visit("");
    const noSlug = resolveInitialSection();

    visit("?tab=garbage");
    const badSlug = resolveInitialSection();

    expect(noSlug.section).toBe(badSlug.section);
    expect(noSlug.unresolvedSlug).toBeNull();
    expect(badSlug.unresolvedSlug).toBe("garbage");
  });
});

describe("resolveInitialSection · legitimate links stay silent", () => {
  it("resolves a section id with no notice", () => {
    visit("?tab=revenue");

    expect(resolveInitialSection()).toEqual({ section: "revenue", unresolvedSlug: null });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolves an alias with no notice", () => {
    // "money" is an alias of the `revenue` section, not an id.
    visit("?tab=money");

    expect(resolveInitialSection()).toEqual({ section: "revenue", unresolvedSlug: null });
  });

  it("accepts the legacy ?section= parameter", () => {
    visit("?section=customers");

    expect(resolveInitialSection()).toEqual({ section: "customers", unresolvedSlug: null });
  });

  it("normalises case and surrounding whitespace before resolving", () => {
    visit(`?tab=${encodeURIComponent("  Revenue  ")}`);

    expect(resolveInitialSection()).toEqual({ section: "revenue", unresolvedSlug: null });
  });

  it("treats a bare /admin as a correct landing, not a failure", () => {
    visit("");

    expect(resolveInitialSection()).toEqual({ section: "overview", unresolvedSlug: null });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("follows a compound redirect and rewrites the URL without raising a notice", () => {
    visit("?tab=declined");

    const result = resolveInitialSection();

    expect(result).toEqual({ section: "revenue", unresolvedSlug: null });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("revenue");
    expect(params.get("moneyTab")).toBe("declined");
  });
});
