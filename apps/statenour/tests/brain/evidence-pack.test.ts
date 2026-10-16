/**
 * tests/brain/evidence-pack.test.ts · 2026-09-08 (Brain plan, Wave 2)
 * 2026-10-16 (W1 arbiter): validity filter, one rerank, graph addendum split, eval mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rerankMock = vi.hoisted(() => ({
  available: false,
  rerank: vi.fn(),
}));
vi.mock("@/lib/brain/rerank", () => ({
  isRerankAvailable: () => rerankMock.available,
  getActiveRerankBackend: () => (rerankMock.available ? "cohere" : "none"),
  rerank: rerankMock.rerank,
}));

import {
  candidatesFromLanes,
  buildEvidencePack,
  buildEvidencePackAsync,
  renderEvidencePack,
  extractRecallAddendum,
  toRetrievedMemories,
  RERANK_WINDOW_MAX,
} from "@/lib/brain/evidence-pack";

const hybrid = [
  { memoryId: "a", key: "k_a", category: "preference", source: "user_save", content: "I run on Tuesdays", confidence: 0.9 },
  { memoryId: "b", key: "k_b", category: "wisdom", source: "wisdom_sync_cron", content: "Ship the canary, not just the control" },
];
const contextual = [
  { id: "b", key: "k_b", category: "wisdom", source: "wisdom_sync_cron", content: "Ship the canary, not just the control" },
  { id: "c", key: "k_c", category: "decision_log", source: "manual", content: "Chose Neon over Supabase" },
];

beforeEach(() => {
  rerankMock.available = false;
  rerankMock.rerank.mockReset();
});

describe("evidence pack", () => {
  it("builds lane-attributed candidates from both lanes, in rank order", () => {
    const c = candidatesFromLanes(hybrid, contextual);
    expect(c.map((x) => `${x.lane}:${x.id}:${x.rank}`)).toEqual(["hybrid:a:0", "hybrid:b:1", "contextual:b:0", "contextual:c:1"]);
  });
  it("arbitrates to one list: the item in both lanes is attributed to both, nothing is rendered twice, provenance is labelled", () => {
    const pack = buildEvidencePack(hybrid, contextual);
    expect(pack.candidates).toBe(4);
    expect(pack.items.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
    const b = pack.items.find((i) => i.id === "b")!;
    expect(b.lanes.sort()).toEqual(["contextual", "hybrid"]);
    expect(pack.block).toContain("Evidence pack (3");
    expect(pack.block.match(/Ship the canary/g)?.length).toBe(1);
    expect(pack.block).toMatch(/\[you stated · preference · hybrid\] I run on Tuesdays/);
    expect(pack.block).toMatch(/both lanes\] Ship the canary/);
  });
  it("renders nothing for an empty pack and respects the char budget", () => {
    expect(renderEvidencePack([])).toBe("");
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, content: "x".repeat(200), lanes: ["hybrid" as const], ranks: { hybrid: i }, rrf: 1 / (61 + i) }));
    const block = renderEvidencePack(many, { maxChars: 1000 });
    expect(block.length).toBeLessThan(1400); // fence + header + a few lines
  });
  it("is wired behind NICK_RECALL_ARBITER, ADDS the pack beside a reduced Context Memories block, and the flag defaults off", () => {
    const src = readFileSync(join(process.cwd(), "lib/services/chat/brain-context.ts"), "utf8");
    expect(src).toMatch(/getFlag\("NICK_RECALL_ARBITER"\)/);
    expect(src).toMatch(/buildEvidencePackAsync\(/);
    expect(src).toMatch(/name: "Evidence Pack"/);
    expect(src).toMatch(/asOf: queryPlan\.asOf/);
    // W1: the arbiterOn branch keeps the graph / cross-source / related lines
    // (extractRecallAddendum) instead of deleting the whole Context Memories block.
    expect(src).toMatch(/arbiterOn && contextMemories \? extractRecallAddendum\(contextMemories\)/);
    const arbiterBranch = src.slice(src.indexOf("arbiterOn && evidencePackBlock"), src.indexOf('name: "Hybrid Recall"'));
    expect(arbiterBranch).toMatch(/name: "Context Memories", content: recallAddendumOnly/);
    // The receipt records the arbiter state at the point it is built.
    expect(src).toMatch(/arbiter: arbiterOn/);
    const flags = readFileSync(join(process.cwd(), "lib/feature-flags.ts"), "utf8");
    const i = flags.indexOf('key: "NICK_RECALL_ARBITER"');
    expect(i).toBeGreaterThan(-1);
    expect(flags.slice(i, i + 900)).toMatch(/defaultOn: false/);
    expect(flags.slice(i, i + 900)).not.toMatch(/28-case/);
    expect(flags.slice(i, i + 900)).toMatch(/121-case corpus/);
  });
});

describe("evidence pack · validity filter (W1)", () => {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);
  const superseded = { memoryId: "s", key: "k_s", category: "belief", source: "manual", content: "old belief", supersededById: "n" };
  const expired = { memoryId: "e", key: "k_e", category: "belief", source: "manual", content: "lapsed belief", validUntil: past };
  const probationOver = { memoryId: "p", key: "k_p", category: "insight", source: "manual", content: "unreinforced insight", expiresAt: past.toISOString() };
  const current = { memoryId: "c1", key: "k_c1", category: "belief", source: "manual", content: "current belief", validUntil: future, supersededById: null };

  it("drops a superseded, expired-validity or expired-probation hybrid hit and counts the drops", () => {
    const pack = buildEvidencePack([superseded, expired, probationOver, current, ...hybrid], contextual);
    expect(pack.items.map((i) => i.id).sort()).toEqual(["a", "b", "c", "c1"]);
    expect(pack.droppedValidity).toBe(3);
    expect(pack.block).not.toMatch(/old belief|lapsed belief|unreinforced insight/);
  });

  it("drops a superseded contextual row too, and a row without validity fields is kept", () => {
    const pack = buildEvidencePack(hybrid, [...contextual, { id: "z", key: "k_z", category: "x", source: "manual", content: "zzz", supersededById: "q" }]);
    expect(pack.items.map((i) => i.id)).not.toContain("z");
    expect(pack.droppedValidity).toBe(1);
    expect(buildEvidencePack(hybrid, contextual).droppedValidity).toBe(0);
  });
});

describe("evidence pack · one rerank over the arbitrated window (W1)", () => {
  it("calls rerank once over the arbitrated items when a backend is available, and its order wins", async () => {
    rerankMock.available = true;
    rerankMock.rerank.mockImplementation(async (args: { candidates: Array<{ item: { id: string } }> }) =>
      [...args.candidates].reverse().map((c, i) => ({ item: c.item, score: 1 - i * 0.1, originalIndex: 0, source: "cohere" as const })),
    );
    const pack = await buildEvidencePackAsync(hybrid, contextual, { query: "what do I run on?", limit: 2 });
    expect(rerankMock.rerank).toHaveBeenCalledTimes(1);
    const call = rerankMock.rerank.mock.calls[0][0] as { query: string; candidates: Array<{ item: { id: string }; text: string }> };
    expect(call.query).toBe("what do I run on?");
    // the window is the arbitrated list (limit*2 = 4 > 3 items), not the raw candidates
    expect(call.candidates.map((c) => c.item.id).sort()).toEqual(["a", "b", "c"]);
    expect(call.candidates.every((c) => typeof c.text === "string" && c.text.length > 0)).toBe(true);
    expect(pack.reranked).toBe("cohere");
    expect(pack.items.length).toBe(2);
    // identity order of the sync pack is b (both lanes), a, c; reversed = c, a, b -> top 2 = c, a
    const identity = buildEvidencePack(hybrid, contextual).items.map((i) => i.id);
    expect(pack.items.map((i) => i.id)).toEqual([...identity].reverse().slice(0, 2));
    expect(pack.block).toContain("Evidence pack (2");
  });

  it("is an identity pass when no backend is available: rerank never called, same items as the sync pack", async () => {
    rerankMock.available = false;
    const pack = await buildEvidencePackAsync(hybrid, contextual, { query: "q", limit: 2 });
    expect(rerankMock.rerank).not.toHaveBeenCalled();
    expect(pack.reranked).toBe("none");
    expect(pack.items.map((i) => i.id)).toEqual(buildEvidencePack(hybrid, contextual, { limit: 2 }).items.map((i) => i.id));
  });

  it("a rerank that returns null (budget or backend failure) keeps the identity order", async () => {
    rerankMock.available = true;
    rerankMock.rerank.mockResolvedValue(null);
    const pack = await buildEvidencePackAsync(hybrid, contextual, { query: "q", limit: 3 });
    expect(pack.reranked).toBe("none");
    expect(pack.items.map((i) => i.id)).toEqual(buildEvidencePack(hybrid, contextual, { limit: 3 }).items.map((i) => i.id));
  });

  it("the rerank window is capped at RERANK_WINDOW_MAX (a cost cap), then cut to limit", async () => {
    rerankMock.available = true;
    rerankMock.rerank.mockImplementation(async (args: { candidates: Array<{ item: unknown }> }) =>
      args.candidates.map((c, i) => ({ item: c.item, score: 1 - i * 0.01, originalIndex: i, source: "bge" as const })),
    );
    // no shared word tokens between items, so the MMR cut keeps all of them
    const many = Array.from({ length: 60 }, (_, i) => ({ memoryId: `m${i}`, key: `k${i}`, category: "x", source: "manual", content: `memory${i} token${i}x` }));
    const pack = await buildEvidencePackAsync(many, [], { query: "q", limit: 20 });
    const call = rerankMock.rerank.mock.calls[0][0] as { candidates: unknown[] };
    expect(call.candidates.length).toBeLessThanOrEqual(RERANK_WINDOW_MAX);
    expect(RERANK_WINDOW_MAX).toBe(24);
    expect(pack.items.length).toBe(20);
    expect(pack.reranked).toBe("bge");
  });
});

describe("extractRecallAddendum · the graph / cross-source / related lines of a Context Memories block (W1)", () => {
  const open = '<tool_data tool="brainRecall" source="memory_recall">';
  const close = '</tool_data tool="brainRecall">';
  const block = [
    "## Nick Brain — Context Memories",
    open,
    "### Directly Relevant",
    "- [decision_log] Chose Neon over Supabase",
    "### Core Knowledge",
    "- [wisdom] Ship the canary",
    "### Connected (linked in your brain graph)",
    "[decision_log] (caused by) Supabase pricing changed",
    "### Deeper Context",
    "[Reflections] the 2026-05 migration retro",
    "### Related People",
    "- Mash (operations)",
    close,
  ].join("\n");

  it("keeps the heading and the fence, drops the memory list, keeps every addendum section", () => {
    const out = extractRecallAddendum(block);
    expect(out.startsWith("## Nick Brain — Context Memories\n" + open)).toBe(true);
    expect(out.endsWith(close)).toBe(true);
    expect(out).not.toMatch(/Directly Relevant|Core Knowledge|Chose Neon|Ship the canary/);
    expect(out).toContain("### Connected (linked in your brain graph)\n[decision_log] (caused by) Supabase pricing changed");
    expect(out).toContain("### Deeper Context\n[Reflections] the 2026-05 migration retro");
    expect(out).toContain("### Related People\n- Mash (operations)");
  });

  it("returns an empty string when the block has no addendum section, or no fence", () => {
    const noAddendum = ["## Nick Brain — Context Memories", open, "### Directly Relevant", "- x", close].join("\n");
    expect(extractRecallAddendum(noAddendum)).toBe("");
    expect(extractRecallAddendum("")).toBe("");
    expect(extractRecallAddendum("### Connected (linked in your brain graph)\nunfenced")).toBe("");
  });
});

describe("toRetrievedMemories · evidence items as a recall-eval lane (W1)", () => {
  it("maps key + rrf in pack order and drops keyless items", () => {
    const items = buildEvidencePack(hybrid, [...contextual, { id: "nokey", category: "x", source: "manual", content: "no key here" }]).items;
    const out = toRetrievedMemories(items);
    expect(out.map((r) => r.key)).toEqual(items.filter((i) => i.key).map((i) => i.key));
    expect(out.every((r) => typeof r.score === "number" && r.score > 0)).toBe(true);
    expect(out.map((r) => r.key)).not.toContain("");
  });
});
