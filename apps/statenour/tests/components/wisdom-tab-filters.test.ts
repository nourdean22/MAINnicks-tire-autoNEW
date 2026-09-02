/**
 * A topic chip's count is what tapping it yields, and the wisdom tab
 * does not reload on its own bus echo.
 *
 * DEFECT #6 (2026-09-02 self-audit). The rendered list applied origin +
 * topic + search; the chip counts applied origin ONLY. With a search
 * active, a chip reading `money (37)` yielded far fewer than 37 rows
 * when tapped. The test that matters is the round trip — count the
 * chip, select it, count the rows — because that is the promise the
 * operator reads, and it holds under any filter combination.
 *
 * DEFECT #7 (bus half). `onDataChanged(["brain"], () => void reload())`
 * refetched the entire feed on ANY brain event, through
 * `utils.brain.wisdom.fetch()` so React Query never deduplicated it.
 * `saveEdit` and `deprecateWisdom` each call `reload()` inline and THEN
 * announce on the bus, so one operator edit cost two full-corpus
 * fetches. The predicate below is what stops the echo.
 *
 * The topic tagger is NOT mocked: the counts and the filter must agree
 * against the same real tagger the recall path uses. Everything else the
 * component drags in (trpc, next/navigation, toasts, icons, child
 * components) is mocked because this file is about two pure exports —
 * the vitest env here is Node with no DOM.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/trpc/client", () => {
  const leaf = { useMutation: () => ({ mutateAsync: async () => ({}) }) };
  return {
    trpc: {
      useUtils: () => ({ brain: { wisdom: { fetch: async () => ({}) } } }),
      brain: { updateWisdom: leaf, actOnWisdom: leaf },
    },
  };
});
vi.mock("@/lib/events/data-change", () => ({
  notifyDataChanged: () => {},
  onDataChanged: () => () => {},
}));
vi.mock("lucide-react", () => ({ Pencil: () => null, Trash2: () => null, Check: () => null, X: () => null }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {}, loading: () => "" } }));
vi.mock("@/components/ui/sort-dropdown", () => ({ SortDropdown: () => null }));
vi.mock("@/components/ui/filter-chip-bar", () => ({ ActiveFiltersStrip: () => null }));
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: async () => true, dialog: null }),
}));
vi.mock("@/components/brain/related-wisdom-links", () => ({ RelatedWisdomLinks: () => null }));
vi.mock("@/components/brain/wisdom-evolution-panel", () => ({ WisdomEvolutionPanel: () => null }));

import { buildWisdomView, isForeignBrainEvent } from "@/components/brain/wisdom-tab";
import { tagWisdomTopics, type WisdomTopic } from "@/lib/brain/wisdom-topic-tagger";

type Entry = Parameters<typeof buildWisdomView>[0][number];

function entry(id: string, content: string, origin = "distiller"): Entry {
  return {
    id,
    key: `wisdom_${id}`,
    content,
    confidence: 0.8,
    seenCount: 2,
    origin,
    source: "distiller",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-08-01T00:00:00.000Z",
    ageDays: 30,
    hotness: 0.5,
  };
}

// Content chosen so the REAL tagger assigns different topics, and so a
// search term ("margin") matches only some of them.
const CORPUS: Entry[] = [
  entry("a", "Raise the margin before you raise the price; cost discipline is a moat."),
  entry("b", "Pricing power is revenue you already earned; protect the margin."),
  entry("c", "Ship the ugly version, then delete half of it.", "elon-musk"),
  entry("d", "Sleep is the cheapest performance intervention you will ever buy."),
];

/** Every topic the tagger actually assigns across the fixture. */
function topicsPresent(entries: Entry[]): WisdomTopic[] {
  const set = new Set<WisdomTopic>();
  for (const e of entries) for (const t of tagWisdomTopics(e.content)) set.add(t);
  return [...set];
}

describe("buildWisdomView · a chip count is a promise about the rows", () => {
  it("chip count equals rows yielded, for every topic, with NO search", () => {
    const { topicCounts } = buildWisdomView(CORPUS, { origin: "all", topic: "all", search: "" });
    for (const t of topicsPresent(CORPUS)) {
      const { filtered } = buildWisdomView(CORPUS, { origin: "all", topic: t, search: "" });
      expect(filtered.length, `topic ${t}`).toBe(topicCounts[t]);
    }
  });

  it("chip count equals rows yielded WITH a search active — the defect", () => {
    const search = "margin";
    const { topicCounts } = buildWisdomView(CORPUS, { origin: "all", topic: "all", search });
    for (const t of topicsPresent(CORPUS)) {
      const { filtered } = buildWisdomView(CORPUS, { origin: "all", topic: t, search });
      expect(filtered.length, `topic ${t} under search "${search}"`).toBe(topicCounts[t]);
    }
  });

  it("the search actually narrows the counts (the fixture proves the case)", () => {
    // Without this, the test above could pass on a fixture where the
    // search matched everything and the defect never manifested.
    const wide = buildWisdomView(CORPUS, { origin: "all", topic: "all", search: "" });
    const narrow = buildWisdomView(CORPUS, { origin: "all", topic: "all", search: "margin" });
    expect(narrow.topicCounts.all).toBeLessThan(wide.topicCounts.all);
    expect(narrow.topicCounts.all).toBeGreaterThan(0);
  });

  it("chip count equals rows yielded with origin AND search active", () => {
    const filters = { origin: "distiller", search: "margin" };
    const { topicCounts } = buildWisdomView(CORPUS, { ...filters, topic: "all" });
    for (const t of topicsPresent(CORPUS)) {
      const { filtered } = buildWisdomView(CORPUS, { ...filters, topic: t });
      expect(filtered.length, `topic ${t}`).toBe(topicCounts[t]);
    }
  });

  it("topicCounts.all equals the origin+search pool, before the topic filter", () => {
    const { topicCounts, filtered } = buildWisdomView(CORPUS, {
      origin: "all",
      topic: "all",
      search: "margin",
    });
    expect(topicCounts.all).toBe(filtered.length);
  });

  it("origin filtering still works, and search matches the key as well as the content", () => {
    expect(
      buildWisdomView(CORPUS, { origin: "elon-musk", topic: "all", search: "" }).filtered,
    ).toHaveLength(1);
    expect(
      buildWisdomView(CORPUS, { origin: "all", topic: "all", search: "wisdom_c" }).filtered,
    ).toHaveLength(1);
  });

  it("a whitespace-only search is not a filter", () => {
    expect(
      buildWisdomView(CORPUS, { origin: "all", topic: "all", search: "   " }).filtered,
    ).toHaveLength(CORPUS.length);
  });
});

describe("isForeignBrainEvent · no reload on our own echo", () => {
  it("ignores an event this page fired", () => {
    // saveEdit / deprecateWisdom already reloaded inline before emitting.
    expect(isForeignBrainEvent({ source: "wisdom-page" })).toBe(false);
  });

  it("reloads for a write from anywhere else", () => {
    expect(isForeignBrainEvent({ source: "chat-tool" })).toBe(true);
    expect(isForeignBrainEvent({ source: "brain-page" })).toBe(true);
  });
});
