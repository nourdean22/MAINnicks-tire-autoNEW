/**
 * W2 · the forced wisdom slots (2026-10-29 wisdom-brain audit).
 *
 * Before: the top 3 category=wisdom rows went into every chat turn with no
 * relevance floor, so on prod the two most-injected "wisdom" rows were an
 * archived document chunk and a cron output. Measured the same day (read-only,
 * 150 of Nour's own brain dumps vs the live curated wisdom vectors): best-match
 * cosine p10 0.21 · median 0.27 · p90 0.37. A 0.35 floor admits wisdom on about
 * the top 15% of turns, when it fits.
 *
 * Readwise frequency tuning is the borrowed mechanism: an item just shown
 * yields to its peers (https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights, read 2026-10-29).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { selectWisdomSlots, WISDOM_SLOT_MIN_SIMILARITY, isNonWisdomPayload } from "@/lib/brain/contextual-recall";

const NOW = new Date("2026-10-29T23:00:00Z");
const DAY = 86_400_000;
const row = (over: Record<string, unknown>) => ({
  id: String(over.id ?? over.key),
  category: "wisdom",
  key: "wisdom_naval-ravikant_001",
  source: "manual",
  hybrid: 0.5,
  semantic: 0.5,
  lastSeen: new Date(NOW.getTime() - 10 * DAY),
  ...over,
});

describe("selectWisdomSlots", () => {
  it("injects nothing when no wisdom clears the relevance floor", () => {
    const pool = [
      row({ key: "wisdom_naval-ravikant_001", semantic: 0.27 }),
      row({ key: "wisdom_charlie-munger_002", semantic: 0.3 }),
    ];
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: true, now: NOW })).toEqual([]);
  });

  it("keeps a curated row that clears the floor", () => {
    const pool = [row({ key: "wisdom_naval-ravikant_001", semantic: WISDOM_SLOT_MIN_SIMILARITY + 0.02 })];
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: true, now: NOW }).map((r) => r.key)).toEqual([
      "wisdom_naval-ravikant_001",
    ]);
  });

  it("never forces an archive chunk or a cron output, however similar", () => {
    const pool = [
      row({ key: "archive_756b7577_doc.txt_chunk71", source: "manual", semantic: 0.9, hybrid: 0.9 }),
      row({ key: "move_2026-05-24_2", source: "cron:revenue-decision", semantic: 0.9, hybrid: 0.9 }),
      row({ key: "wisdom_cmabc123", source: "manual", semantic: 0.9, hybrid: 0.9 }),
    ];
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: true, now: NOW })).toEqual([]);
  });

  it("admits machine-distilled principles from the known principle producers", () => {
    const pool = [row({ key: "from_skill_df9fd2", source: "skill_graduation", semantic: 0.5 })];
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: true, now: NOW })).toHaveLength(1);
  });

  it("a row shown in the last 24h yields to an equally relevant peer", () => {
    const pool = [
      row({ id: "recent", key: "wisdom_naval-ravikant_001", hybrid: 0.6, lastSeen: new Date(NOW.getTime() - 3_600_000) }),
      row({ id: "rested", key: "wisdom_charlie-munger_002", hybrid: 0.5 }),
    ];
    expect(selectWisdomSlots(pool, 1, { useEmbeddings: true, now: NOW }).map((r) => r.id)).toEqual(["rested"]);
  });

  it("caps at the slot count, best first", () => {
    const pool = [1, 2, 3, 4].map((i) =>
      row({ id: `w${i}`, key: `wisdom_bezos-letters_00${i}`, hybrid: i / 10 }),
    );
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: true, now: NOW }).map((r) => r.id)).toEqual(["w4", "w3", "w2"]);
  });

  it("keyword fallback (no embeddings) still needs some topical overlap", () => {
    const pool = [
      row({ id: "none", key: "wisdom_naval-ravikant_001", semantic: 0 }),
      row({ id: "some", key: "wisdom_charlie-munger_002", semantic: 0.2 }),
    ];
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: false, now: NOW }).map((r) => r.id)).toEqual(["some"]);
  });

  it.each([
    [0.349, 0],
    [0.35, 1],
    [0.351, 1],
  ])("the floor as literals: cosine %s gives %s row(s)", (semantic, n) => {
    expect(selectWisdomSlots([row({ semantic })], 3, { useEmbeddings: true, now: NOW })).toHaveLength(n);
  });

  it("with 2 slots a recent and a rested row both come back, rested first", () => {
    const pool = [
      row({ id: "recent", key: "wisdom_naval-ravikant_001", hybrid: 0.6, lastSeen: new Date(NOW.getTime() - 3_600_000) }),
      row({ id: "rested", key: "wisdom_charlie-munger_002", hybrid: 0.5 }),
    ];
    expect(selectWisdomSlots(pool, 2, { useEmbeddings: true, now: NOW }).map((r) => r.id)).toEqual(["rested", "recent"]);
  });

  it.each(["consolidation", "output_critic", "skill_graduation", "wisdom-distiller", "distillation"])(
    "principle producer %s qualifies without a curated author",
    (source) => {
      expect(selectWisdomSlots([row({ key: `w_${source}`, source })], 3, { useEmbeddings: true, now: NOW })).toHaveLength(1);
    },
  );

  it("ignores rows outside category wisdom", () => {
    const pool = [row({ category: "insight", key: "wisdom_naval-ravikant_001" })];
    expect(selectWisdomSlots(pool, 3, { useEmbeddings: true, now: NOW })).toEqual([]);
  });
});

describe("isNonWisdomPayload", () => {
  it("flags archive chunks and cron outputs filed as wisdom", () => {
    expect(isNonWisdomPayload({ category: "wisdom", key: "archive_756b_doc.txt_chunk71", source: "manual" })).toBe(true);
    expect(isNonWisdomPayload({ category: "wisdom", key: "move_2026-05-24_2", source: "cron:revenue-decision" })).toBe(true);
  });
  it("CONTROL: leaves curated wisdom and other categories alone", () => {
    expect(isNonWisdomPayload({ category: "wisdom", key: "wisdom_naval-ravikant_001", source: "manual" })).toBe(false);
    expect(isNonWisdomPayload({ category: "insight", key: "archive_x", source: "cron:x" })).toBe(false);
  });
});
