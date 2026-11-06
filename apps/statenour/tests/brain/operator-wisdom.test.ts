/**
 * tests/brain/operator-wisdom.test.ts · 2026-11-06 (Nick audit A8)
 *
 * Nour: "Extract insights from the brain about my personality and blind spots ... and add them to
 * Nick's accumulated wisdom". Wisdom reaches Nick only through selectWisdomSlots, which admits a
 * category=wisdom row only when it has a curated author. So the derived rows need (1) a curated
 * origin that names its author, (2) every insight grounded in brain rows that exist, (3) a source
 * the grinder and prune skip ("pack:*", memory-consolidation CURATED_GUARD).
 */
import { describe, expect, it } from "vitest";
import { curatedWisdomAuthor, selectWisdomSlots } from "@/lib/brain/contextual-recall";
import {
  OPERATOR_WISDOM_ORIGIN,
  operatorWisdomRows,
  parseOperatorInsights,
} from "@/lib/brain/operator-wisdom";

const now = new Date("2026-11-06T20:00:00Z");
const row = (key: string, origin: string | null) => ({
  category: "wisdom",
  key,
  origin,
  source: "pack:x",
  hybrid: 0.9,
  semantic: 0.9,
});

describe("brain-derived operator wisdom reaches Nick's wisdom slots", () => {
  it("the origin is a curated author, so selectWisdomSlots admits the row", () => {
    const r = row("wisdom_nour-brain-derived_trait_aaaaaaaa", OPERATOR_WISDOM_ORIGIN);
    // Reads as derived, never as his own words (manager ruling 2026-11-06).
    expect(curatedWisdomAuthor(r)).toBe("Nour (derived)");
    expect(selectWisdomSlots([r], 2, { useEmbeddings: true, now })).toHaveLength(1);
  });

  it("CONTROL: an uncurated origin with the same scores is still rejected", () => {
    const r = { ...row("nick_advice_1", "chat-scrape"), source: "chat" };
    expect(curatedWisdomAuthor(r)).toBeNull();
    expect(selectWisdomSlots([r], 2, { useEmbeddings: true, now })).toHaveLength(0);
  });
});

describe("parseOperatorInsights keeps only grounded insights", () => {
  const pool = new Set(["m1", "m2", "m3"]);
  const good = { kind: "blind_spot", text: "Takes on a new build before the last one is verified live.", sourceIds: ["m1", "m2"] };

  it("keeps an insight whose every source id is in the pool", () => {
    const out = parseOperatorInsights(JSON.stringify({ insights: [good] }), pool);
    expect(out.kept).toEqual([good]);
    expect(out.dropped).toBe(0);
  });

  it("drops an insight citing an id the pool does not hold, an unknown kind, no ids, or a too-short text", () => {
    const raw = JSON.stringify({
      insights: [
        good,
        { ...good, text: "Another grounded-looking claim with an invented id.", sourceIds: ["m1", "ghost"] },
        { ...good, kind: "horoscope" },
        { ...good, sourceIds: [] },
        { ...good, text: "short" },
      ],
    });
    const out = parseOperatorInsights(raw, pool);
    expect(out.kept).toHaveLength(1);
    expect(out.dropped).toBe(4);
  });

  it("caps each kind at 10 and reads JSON wrapped in a code fence", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ ...good, text: `${good.text} Variant ${i}.` }));
    const out = parseOperatorInsights("```json\n" + JSON.stringify({ insights: many }) + "\n```", pool);
    expect(out.kept).toHaveLength(10);
    expect(out.dropped).toBe(4);
  });

  it("an unparseable reply keeps nothing and says so (never a silent empty set)", () => {
    const out = parseOperatorInsights("I could not do that.", pool);
    expect(out.kept).toEqual([]);
    expect(out.parseError).toBe(true);
  });
});

describe("operatorWisdomRows", () => {
  const insight = { kind: "what_helps" as const, text: "Answer-first replies with one next step get acted on.", sourceIds: ["m3"] };

  it("writes a curated wisdom row the grinder skips, carrying its author and source ids", () => {
    const [r] = operatorWisdomRows([insight]);
    expect(r.key).toMatch(/^wisdom_nour-brain-derived_what_helps_[a-f0-9]{8}$/);
    expect(r.source).toBe("pack:nour-brain-derived");
    expect(r.content).toBe(insight.text);
    expect(r.metadata).toMatchObject({
      origin: OPERATOR_WISDOM_ORIGIN,
      kind: "what_helps",
      topic: "what_helps",
      sourceIds: ["m3"],
      author: "Nour (brain-derived)",
    });
  });

  it("the key is stable for the same text, so a re-run updates instead of duplicating", () => {
    expect(operatorWisdomRows([insight])[0].key).toBe(operatorWisdomRows([{ ...insight }])[0].key);
    expect(operatorWisdomRows([insight])[0].key).not.toBe(operatorWisdomRows([{ ...insight, text: `${insight.text} More.` }])[0].key);
  });
});
