/**
 * tests/home/home-typeface.test.tsx - bdnick appearance wave B (2026-10-23).
 *
 * antislop R-06 and docs/design/ui-v2/SYSTEM.md section 3: Geist Mono is METADATA (dates, ages, scope
 * labels, sources). A whole sentence or a button label set in it reads as a terminal costume. Home had
 * four sentences and two link labels in mono. Each is rendered here and asserted out of font-mono, next
 * to controls that prove mono still lands on the data it exists for, so "no mono anywhere" cannot pass.
 *
 * Also pinned: no em dash (R-02) and no emoji in what these components render.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { HorizonLine } from "@/components/home/horizon-line";
import { WaitingLineView } from "@/components/home/waiting-line";
import { BriefStateLine } from "@/components/home/brief-state-line";
import type { BriefStateSection } from "@/lib/home/operator-brief";
import type { WaitingItem, WaitingSummary } from "@/lib/home/waiting-summary";

const EM_DASH = String.fromCharCode(0x2014);

/** The class list of the element that directly holds the first text node containing `text`. */
function tagOf(html: string, text: string): string {
  const doc = document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = html;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent?.includes(text)) return `<${n.parentElement!.tagName.toLowerCase()} class="${n.parentElement!.className}">`;
  }
  throw new Error(`"${text}" does not render`);
}

const item = (n: number): WaitingItem => ({
  key: `task:${n}`,
  owner: "others",
  subject: `Quote ${n}`,
  who: "Dania",
  since: "2026-09-30T12:00:00Z",
  ageMin: 2_880,
  deadline: null,
  consequence: null,
  nextAction: "nudge",
  href: "/missions",
  source: "tasks k2",
});

const summaryWith = (count: number): WaitingSummary => ({
  measuredAt: "2026-10-02T12:00:00Z",
  scope: "statenour",
  me: { items: [], count: 0 },
  others: { items: [item(1), item(2)], count },
  system: { items: [], count: 0 },
  failedSources: [],
  staleSources: [],
  partial: false,
});

const state = (over: Partial<BriefStateSection> = {}): BriefStateSection => ({
  health: { state: "healthy", detail: "all green" },
  summary: "Two things need you today.",
  queues: { measured: false, clear: false, inbox: null, captures: null, approvals: null },
  ...over,
});

describe("Horizon", () => {
  it("the unmeasured sentence is body type and has no em dash", () => {
    const html = renderToStaticMarkup(<HorizonLine horizon={{ measured: false, slots: [] }} />);
    expect(tagOf(html, "Horizon unmeasured")).not.toMatch(/font-mono/);
    expect(html).not.toContain(EM_DASH);
  });

  it("CONTROL: scope labels and sources stay mono, they are data", () => {
    const html = renderToStaticMarkup(
      <HorizonLine horizon={{ measured: true, slots: [{ scope: "today", label: "Ship the deck", href: "/missions", source: "mit" }] }} />,
    );
    expect(tagOf(html, "Today")).toMatch(/font-mono/);
    expect(tagOf(html, "mit")).toMatch(/font-mono/);
  });
});

describe("Waiting on others", () => {
  it("the unknown sentence is body type", () => {
    const html = renderToStaticMarkup(<WaitingLineView summary={null} status="error" />);
    expect(tagOf(html, "Unknown, read failed")).not.toMatch(/font-mono/);
  });

  it("the +N more link is a button label in body type; ages stay mono; the owner glyph is not an emoji", () => {
    const html = renderToStaticMarkup(<WaitingLineView summary={summaryWith(9)} status="ready" />);
    expect(tagOf(html, "+7 more")).not.toMatch(/font-mono/);
    expect(tagOf(html, "2d")).toMatch(/font-mono/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("Brief state line", () => {
  it("the health label and the queues-unread sentence are body type", () => {
    const html = renderToStaticMarkup(<BriefStateLine state={state()} loading={false} unreadable={false} />);
    expect(tagOf(html, "system healthy")).not.toMatch(/font-mono/);
    expect(tagOf(html, "some queues unread")).not.toMatch(/font-mono/);
  });

  it("CONTROL: the date line stays mono, it is data", () => {
    const html = renderToStaticMarkup(<BriefStateLine state={state()} loading={false} unreadable={false} />);
    expect(html).toMatch(/<p class="font-mono[^"]*"/);
  });
});
