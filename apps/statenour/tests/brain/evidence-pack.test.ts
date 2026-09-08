/**
 * tests/brain/evidence-pack.test.ts · 2026-09-08 (Brain plan, Wave 2)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { candidatesFromLanes, buildEvidencePack, renderEvidencePack } from "@/lib/brain/evidence-pack";

const hybrid = [
  { memoryId: "a", key: "k_a", category: "preference", source: "user_save", content: "I run on Tuesdays", confidence: 0.9 },
  { memoryId: "b", key: "k_b", category: "wisdom", source: "wisdom_sync_cron", content: "Ship the canary, not just the control" },
];
const contextual = [
  { id: "b", key: "k_b", category: "wisdom", source: "wisdom_sync_cron", content: "Ship the canary, not just the control" },
  { id: "c", key: "k_c", category: "decision_log", source: "manual", content: "Chose Neon over Supabase" },
];

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
  it("is wired behind NICK_RECALL_ARBITER, replacing both lane blocks, and the flag defaults off", () => {
    const src = readFileSync(join(process.cwd(), "lib/services/chat/brain-context.ts"), "utf8");
    expect(src).toMatch(/getFlag\("NICK_RECALL_ARBITER"\)/);
    expect(src).toMatch(/buildEvidencePack\(/);
    expect(src).toMatch(/name: "Evidence Pack"/);
    expect(src).toMatch(/asOf: queryPlan\.asOf/);
    const flags = readFileSync(join(process.cwd(), "lib/feature-flags.ts"), "utf8");
    const i = flags.indexOf('key: "NICK_RECALL_ARBITER"');
    expect(i).toBeGreaterThan(-1);
    expect(flags.slice(i, i + 900)).toMatch(/defaultOn: false/);
  });
});
