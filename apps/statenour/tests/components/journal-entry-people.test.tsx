/**
 * W4 (job 2026-11-02-nour-os-interconnect) · a journal row shows the people the entry names as links to their
 * dossier. The link is the inspect URL /people already reads (`?inspect=person:<id>`, lib/ui/inspect-url.ts); a
 * `?personId=` link would open /people with nothing selected, because no code reads that param.
 * Names that couldn't load say so; an entry that names no one shows nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/trpc/client", () => ({ trpc: new Proxy({}, { get: () => new Proxy({}, { get: () => ({ useQuery: () => ({}), useMutation: () => ({}), useUtils: () => ({}) }) }) }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...(rest as object)}>
      {children}
    </a>
  ),
}));

import { JournalEntryRow } from "@/components/journal/entry-row";
import type { FeedEntry } from "@/components/journal/types";

const entry = (people: FeedEntry["people"]): FeedEntry => ({
  id: "d1",
  source: "dump",
  createdAt: "2026-11-02T14:00:00.000Z",
  date: "2026-11-02",
  entryType: "reflection",
  title: "I talked to Dania about the move.",
  body: "Talked to Dania about the move.",
  summary: null,
  mood: null,
  domains: [],
  linkedTopics: [],
  tasksCreated: 0,
  goalId: null,
  people,
});

const render = (people: FeedEntry["people"]) =>
  renderToStaticMarkup(<JournalEntryRow entry={entry(people)} isExpanded={false} onToggle={() => {}} delay={0} />);

describe("JournalEntryRow · people on the row", () => {
  it("each person is a link to their dossier through the inspect URL", () => {
    const html = render([
      { id: "p_dania", name: "Dania" },
      { id: "p_sam", name: "Samir" },
    ]);
    expect(html).toContain('href="/people?inspect=person:p_dania"');
    expect(html).toContain('href="/people?inspect=person:p_sam"');
    expect(html).toContain(">Dania<");
    expect(html).not.toContain("personId=");
  });

  it("names that couldn't load say so instead of showing nobody", () => {
    expect(render(null)).toContain("People on this entry couldn&#x27;t load.");
  });

  it("control: an entry that names no one renders no people line", () => {
    const html = render([]);
    expect(html).not.toContain("/people?inspect");
    expect(html).not.toContain("couldn");
  });
});
