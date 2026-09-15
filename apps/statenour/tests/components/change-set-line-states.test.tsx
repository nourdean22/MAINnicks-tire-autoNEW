/**
 * ChangeSetLine states (2026-09-15, wave 3): error is amber and says
 * "unknown, not quiet"; loading renders nothing; ready with an empty set
 * renders NOTHING (never "0 changes"); ready with parts renders the
 * sentence, the clamp note and the optional link. Static markup.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeSetLine } from "@/components/ui/change-set-line";
import type { ChangeSet } from "@/lib/ui/change-cursor";

const SET: ChangeSet = {
  since: Date.UTC(2026, 8, 15, 12, 0),
  clamped: true,
  parts: [{ label: "new memories", count: 4 }, { label: "reinforced", count: 2 }],
  failedSources: ["tombstoned"],
  errors: { measured: false, count: 0 },
};

describe("ChangeSetLine", () => {
  it("error → amber 'unknown, not quiet'", () => {
    const html = renderToStaticMarkup(<ChangeSetLine set={null} status="error" />);
    expect(html).toContain('data-change-set="error"');
    expect(html).toContain("unknown, not quiet");
  });

  it("loading, and ready-but-empty, render nothing", () => {
    expect(renderToStaticMarkup(<ChangeSetLine set={undefined} status="loading" />)).toBe("");
    expect(renderToStaticMarkup(<ChangeSetLine set={{ ...SET, parts: [], failedSources: [], clamped: false }} status="ready" />)).toBe("");
  });

  it("ready renders the sentence, the clamp note, the unread source and the link", () => {
    const html = renderToStaticMarkup(<ChangeSetLine set={SET} status="ready" link={{ href: "/system", label: "Activity →" }} />);
    expect(html).toContain('data-change-set="3"');
    expect(html).toContain("4 new memories · 2 reinforced · tombstoned unread");
    expect(html).toContain("(last 7d)");
    expect(html).toContain('href="/system"');
    expect(html).toContain("Since ");
  });
});
