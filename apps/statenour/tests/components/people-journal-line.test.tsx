/**
 * PR 3522 test gap 1 · the /people journal lines. A failed journal read says so once (unknown, not empty); an ok read
 * where nobody has a journal entry shows neither the status line nor any "Journal," line.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JournalReadStatus, PersonJournalLine } from "@/components/people/journal-line";

describe("JournalReadStatus", () => {
  it('reads.journal "failed" renders the status line', () => {
    const html = renderToStaticMarkup(<JournalReadStatus reads={{ journal: "failed" }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Journal lines couldn&#x27;t load");
  });
  it('control: "ok" renders nothing; an older response without `reads` renders nothing', () => {
    expect(renderToStaticMarkup(<JournalReadStatus reads={{ journal: "ok" }} />)).toBe("");
    expect(renderToStaticMarkup(<JournalReadStatus reads={undefined} />)).toBe("");
  });
});

describe("PersonJournalLine", () => {
  it("renders 'Journal, <when>: <excerpt>' for a person with an entry", () => {
    const html = renderToStaticMarkup(
      <PersonJournalLine
        latestJournal={{ at: new Date().toISOString(), excerpt: "Talked to Dania about the move.", dumpId: "d1" }}
        formatDays={(d) => `${d}d ago`}
      />,
    );
    expect(html).toMatch(/Journal, 0d ago: <!-- -->Talked to Dania about the move\.|Journal, 0d ago: Talked to Dania about the move\./);
    // W8b: the line is a tap to the entry itself (the feed anchors each entry as bd-<id>).
    expect(html).toContain('href="/journal?entry=d1#bd-d1"');
  });
  it("control: null renders no 'Journal,' line", () => {
    expect(renderToStaticMarkup(<PersonJournalLine latestJournal={null} formatDays={() => "x"} />)).toBe("");
  });
});
