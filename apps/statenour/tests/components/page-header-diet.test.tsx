/**
 * UI v3 W1a, header diet as rendered: PageHeader and StandardPage.
 *
 * The eyebrow shows only when it adds information; the description is gone on the seven core
 * pages and shows from the md breakpoint up everywhere else. `description` stays in the props API,
 * so no call site changes.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ path: "/system/observability" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

import { PageHeader } from "@/components/layout/ui";
import { StandardPage } from "@/components/layout/standard-page";

const eyebrowCount = (html: string) => (html.match(/class="eyebrow"/g) ?? []).length;

describe("PageHeader", () => {
  it("drops an eyebrow that repeats the title", () => {
    const html = renderToString(<PageHeader eyebrow="Journal" title="Journal" description="d" />);
    expect(eyebrowCount(html)).toBe(0);
    expect(html).toContain("Journal");
  });

  it("keeps an eyebrow that says something else", () => {
    const html = renderToString(<PageHeader eyebrow="Execution Deck" title="Missions" description="d" />);
    expect(eyebrowCount(html)).toBe(1);
    expect(html).toContain("Execution Deck");
  });

  it("drops an eyebrow that only repeats the title and the parent hub", () => {
    const html = renderToString(
      <PageHeader eyebrow="System / observability" title="Observability" description="d" parentHref="/system" parentLabel="system" />,
    );
    expect(eyebrowCount(html)).toBe(0);
  });

  it("shows the description from the md breakpoint up only, by default", () => {
    const html = renderToString(<PageHeader eyebrow="x" title="T" description="The long line" />);
    expect(html).toMatch(/<p class="page-copy hidden md:block">The long line<\/p>/);
  });

  it("omits the description element at every width when asked", () => {
    const html = renderToString(<PageHeader eyebrow="x" title="T" description="The long line" descriptionVisibility="never" />);
    expect(html).not.toContain("The long line");
    expect(html).not.toContain("page-copy");
  });
});

describe("StandardPage", () => {
  it("drops the description on a core page at every width", () => {
    nav.path = "/missions";
    const html = renderToString(
      <StandardPage eyebrow="Execution Deck" title="Missions" description="The work that needs you.">
        <i>body</i>
      </StandardPage>,
    );
    expect(html).not.toContain("The work that needs you.");
    expect(html).toContain("Execution Deck");
    expect(html).toContain("<i>body</i>");
  });

  it("keeps the description, md and up, on any other page", () => {
    nav.path = "/settings";
    const html = renderToString(<StandardPage eyebrow="Account" title="Settings" description="Keys and limits." />);
    expect(html).toMatch(/<p class="page-copy hidden md:block">Keys and limits\.<\/p>/);
  });

  it("drops an eyebrow that repeats the auto-detected parent and the title", () => {
    nav.path = "/system/observability";
    const html = renderToString(<StandardPage eyebrow="System / observability" title="Observability" />);
    expect(eyebrowCount(html)).toBe(0);
    expect(html).toContain("Observability");
  });

  it("keeps an eyebrow that adds information under the same parent", () => {
    nav.path = "/system/observability";
    const html = renderToString(<StandardPage eyebrow="System / signal freshness" title="Observability" />);
    expect(eyebrowCount(html)).toBe(1);
  });

  it("still renders without a description prop", () => {
    nav.path = "/settings";
    expect(() => renderToString(<StandardPage eyebrow="Account" title="Settings" />)).not.toThrow();
  });
});
