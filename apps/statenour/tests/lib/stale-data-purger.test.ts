/**
 * tests/lib/stale-data-purger.test.ts — purger contract invariants
 *
 * Locks down the purer pieces of lib/system/stale-data-purger.ts:
 *   - purgeStaleCategory rejects unknown ids (D6 safety)
 *   - buildDismissedContradictionContent emits canonical shape and
 *     correctly no-ops rows that are already resolved/dismissed (D5,
 *     D6, D9 fixes)
 */

import { describe, it, expect } from "vitest";
import {
  purgeStaleCategory,
  buildDismissedContradictionContent,
} from "@/lib/system/stale-data-purger";

describe("purgeStaleCategory", () => {
  it("throws on unknown category", async () => {
    await expect(
      // @ts-expect-error — intentional invalid category for the guard
      purgeStaleCategory("not_a_real_category"),
    ).rejects.toThrow(/Unknown stale category/);
  });
});

describe("buildDismissedContradictionContent", () => {
  const NOW_ISO = "2026-04-24T10:15:00.000Z";

  it("emits a dismissed record for an unresolved contradiction", () => {
    const input = JSON.stringify({
      status: "unresolved",
      why: "we said X but keep doing Y",
      text: "scroll scroll scroll",
    });
    const out = buildDismissedContradictionContent(input, NOW_ISO);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.status).toBe("dismissed");
    expect(parsed.resolved_at).toBe(NOW_ISO);
    expect(parsed.why).toContain("[auto-dismissed 2026-04-24 · stale >60d]");
    expect(parsed.why).toContain("we said X but keep doing Y");
    // Any extra fields on the original row are preserved.
    expect(parsed.text).toBe("scroll scroll scroll");
  });

  it("no-ops (returns null) when status is already resolved", () => {
    const input = JSON.stringify({ status: "resolved", why: "fixed it" });
    expect(buildDismissedContradictionContent(input, NOW_ISO)).toBeNull();
  });

  it("no-ops (returns null) when status is dismissed", () => {
    const input = JSON.stringify({ status: "dismissed", why: "ignored" });
    expect(buildDismissedContradictionContent(input, NOW_ISO)).toBeNull();
  });

  it("no-ops (returns null) when status is both_valid", () => {
    const input = JSON.stringify({ status: "both_valid", why: "context dep" });
    expect(buildDismissedContradictionContent(input, NOW_ISO)).toBeNull();
  });

  it("treats missing-status row as unresolved → dismiss", () => {
    const input = JSON.stringify({ why: "no status field" });
    const out = buildDismissedContradictionContent(input, NOW_ISO);
    expect(out).not.toBeNull();
    expect(JSON.parse(out as string).status).toBe("dismissed");
  });

  it("recovers from malformed JSON with a minimal dismissed record", () => {
    const out = buildDismissedContradictionContent("not even json {", NOW_ISO);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.status).toBe("dismissed");
    expect(parsed.resolved_at).toBe(NOW_ISO);
    expect(parsed.why).toContain("previously unparseable");
  });

  it("strips leading whitespace when original `why` is empty", () => {
    const input = JSON.stringify({ status: "unresolved" });
    const out = buildDismissedContradictionContent(input, NOW_ISO);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.why.startsWith("[auto-dismissed")).toBe(true);
  });

  it("uses the exact date slice (YYYY-MM-DD) in the marker", () => {
    const iso = "2099-12-31T23:59:59.000Z";
    const input = JSON.stringify({ status: "unresolved" });
    const out = buildDismissedContradictionContent(input, iso);
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.why).toContain("2099-12-31");
    // And NOT the hour/minute/second portion
    expect(parsed.why).not.toContain("23:59");
  });
});
