/**
 * UI v3 W1a, header diet as rendered: PageHeader and StandardPage.
 *
 * The eyebrow shows only when it adds information; the description is gone on the seven core
 * pages and shows from the md breakpoint up everywhere else. `description` stays in the props API,
 * so no call site changes.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("keeps the description at every width when it carries a live value (always)", () => {
    const html = renderToString(<PageHeader eyebrow="x" title="T" description="v1.2 · 3 pins" descriptionVisibility="always" />);
    expect(html).toMatch(/<p class="page-copy">v1\.2 · 3 pins<\/p>/);
    expect(html).not.toContain("hidden md:block");
  });

  it("omits the description element at every width when asked", () => {
    const html = renderToString(<PageHeader eyebrow="x" title="T" description="The long line" descriptionVisibility="never" />);
    expect(html).not.toContain("The long line");
    expect(html).not.toContain("page-copy");
  });
});

describe("StandardPage", () => {
  it("drops the description on a core page at every width", () => {
    nav.path = "/brain";
    const html = renderToString(
      <StandardPage eyebrow="Mastery" title="Brain" description="What is saved, where it came from, and what is inferred.">
        <i>body</i>
      </StandardPage>,
    );
    expect(html).not.toContain("What is saved");
    expect(html).toContain("Mastery");
    expect(html).toContain("<i>body</i>");
  });

  it("drops the Missions description at every width (W2: the hero and the control strip carry it)", () => {
    nav.path = "/missions";
    const html = renderToString(<StandardPage eyebrow="Execution Deck" title="Missions" description="The work that needs you." />);
    expect(html).not.toContain("The work that needs you");
  });

  it("an explicit descriptionVisibility wins over the core-page default (review round 4)", () => {
    nav.path = "/brain";
    const html = renderToString(<StandardPage eyebrow="Mastery" title="Brain" description="Live: 3 pins" descriptionVisibility="always" />);
    expect(html).toMatch(/<p class="page-copy">Live: 3 pins<\/p>/);
  });

  it("the Missions page no longer forces its description (the W1a shortcut is gone)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app", "(mastery)", "missions", "page.tsx"), "utf8");
    const open = src.slice(src.indexOf("<StandardPage"), src.indexOf(">", src.indexOf("<StandardPage")));
    expect(open).not.toContain("descriptionVisibility");
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
