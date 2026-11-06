/**
 * tests/brain/operator-wisdom.test.ts · 2026-11-06 (Nick audit A8)
 *
 * Nour: "Extract insights from the brain about my personality and blind spots ... and add them to
 * Nick's accumulated wisdom". Wisdom reaches Nick only through selectWisdomSlots, which admits a
 * category=wisdom row only when it has a curated author. So the derived rows need (1) a curated
 * origin that names its author, (2) every insight grounded in brain rows that exist, (3) a source
 * the grinder and prune skip ("pack:*", memory-consolidation CURATED_GUARD).
 */
import { describe, expect, it, vi } from "vitest";
import { curatedWisdomAuthor, provenancePrefix, selectWisdomSlots } from "@/lib/brain/contextual-recall";
import {
  OPERATOR_WISDOM_ORIGIN,
  operatorWisdomArgs,
  operatorWisdomRows,
  parseOperatorInsights,
  writeOperatorWisdom,
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

  it("recall labels the row inferred, never 'curated' like a hand-picked pack (Codex P2, PR 3562)", () => {
    const m = { category: "wisdom", key: "wisdom_nour-brain-derived_trait_aaaaaaaa", origin: OPERATOR_WISDOM_ORIGIN, content: "x", confidence: 0.7, relevance: "direct" as const, source: "pack:nour-brain-derived" };
    expect(provenancePrefix(m)).toContain("inferred");
    expect(provenancePrefix(m)).not.toContain("curated");
    // CONTROL: a hand-curated pack row still says curated.
    expect(provenancePrefix({ ...m, key: "wisdom_baltasar-gracian_001", origin: "baltasar-gracian", source: "pack:baltasar-gracian" })).toContain("curated");
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

describe("operatorWisdomArgs: a bounded pool by default (Codex P2: the full 177-row pool came back empty 3 of 3)", () => {
  it("defaults to the 50 newest rows, never the whole pool", () => {
    expect(operatorWisdomArgs([])).toEqual({ apply: false, limit: 50 });
  });
  it("reads --limit and --apply", () => {
    expect(operatorWisdomArgs(["--limit=20"])).toEqual({ apply: false, limit: 20 });
    expect(operatorWisdomArgs(["--apply", "--limit=40"])).toEqual({ apply: true, limit: 40 });
  });
  it("refuses a limit that is not a positive whole number", () => {
    for (const bad of ["--limit=0", "--limit=abc", "--limit=-5", "--limit=2.5"]) {
      expect(operatorWisdomArgs([bad])).toHaveProperty("error");
    }
  });
});

describe("writeOperatorWisdom: admitted as derived, embedded before the old set is retired", () => {
  const insight = { kind: "trait" as const, text: "Moves fastest when the next step is one concrete action.", sourceIds: ["m1", "d1"] };
  function fakeDeps(over: Partial<Parameters<typeof writeOperatorWisdom>[1]> = {}) {
    const calls: string[] = [];
    const deps = {
      admit: vi.fn(async (input: Record<string, unknown>) => { calls.push(`admit:${String(input.key)}`); return { id: "row1" }; }),
      categoryOf: vi.fn(async () => "wisdom"),
      keepForever: vi.fn(async (ids: string[]) => { calls.push(`keep:${ids.join(",")}`); }),
      embed: vi.fn(async (ids: string[]) => { calls.push("embed"); return { landed: ids.length, total: ids.length }; }),
      retire: vi.fn(async () => { calls.push("retire"); return 2; }),
      ...over,
    };
    return { deps, calls };
  }
  const memoryIds = new Set(["m1"]);

  it("goes through admission as a derived memory with its brain lineage, then keeps, embeds, and only then retires", async () => {
    const { deps, calls } = fakeDeps();
    const out = await writeOperatorWisdom(operatorWisdomRows([insight]), { ...deps, memoryIds, modelId: "minimax-m3" });
    expect(deps.admit).toHaveBeenCalledWith(expect.objectContaining({
      category: "wisdom",
      source: "pack:nour-brain-derived",
      memoryKind: "derived",
      extractionMethod: "llm_extract",
      modelId: "minimax-m3",
      derivedFrom: ["m1"],
      evidenceRefs: ["brain-memory:m1", "brain-dump:d1"],
      trustTier: "AGENT_INFERRED",
      confidence: 0.7,
    }));
    // The admitted row is still a curated author the wisdom slots admit (manager ruling, 14:55 ET).
    const admitted = deps.admit.mock.calls[0][0] as { category: string; key: string; metadata: { origin: string } };
    expect(curatedWisdomAuthor({ category: admitted.category, key: admitted.key, origin: admitted.metadata.origin })).toBe("Nour (derived)");
    expect(calls.at(-1)).toBe("retire");
    expect(calls.indexOf("embed")).toBeLessThan(calls.indexOf("retire"));
    expect(out).toMatchObject({ wisdom: 1, candidates: 0, retired: 2, kept: true });
  });

  it("keeps the previous set when any new row did not embed (a row with no vector is never recalled)", async () => {
    const { deps } = fakeDeps({ embed: vi.fn(async () => ({ landed: 0, total: 1 })) });
    const out = await writeOperatorWisdom(operatorWisdomRows([insight]), { ...deps, memoryIds, modelId: "m" });
    expect(deps.retire).not.toHaveBeenCalled();
    expect(out).toMatchObject({ retired: 0, kept: false });
  });

  it("a row the wisdom quality gate parks as wisdom_candidate is counted, not kept forever and not embedded as wisdom", async () => {
    const { deps } = fakeDeps({ categoryOf: vi.fn(async () => "wisdom_candidate") });
    const out = await writeOperatorWisdom(operatorWisdomRows([insight]), { ...deps, memoryIds, modelId: "m" });
    expect(deps.keepForever).toHaveBeenCalledWith([]);
    expect(out).toMatchObject({ wisdom: 0, candidates: 1 });
    // Nothing reached wisdom: the old set stays.
    expect(deps.retire).not.toHaveBeenCalled();
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
