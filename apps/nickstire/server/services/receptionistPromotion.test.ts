/**
 * Receptionist auto-promotion (self-learning W2, 2026-10-31).
 *
 * The push path: read the kill switch, decide through the pure gate, claim the
 * promotion with a compare-and-swap on the history row, then PATCH only the live
 * system prompt (never updateAssistant: that rebuilds the whole config from code
 * and would ship every merged-but-untapped change), read it back, and restore the
 * snapshot when the read-back does not match. Ships DISARMED: W3 arms it.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { promoteReceptionistCandidate, type PromotionDeps } from "./receptionistPromotion";

// The kv rows, as Nour's admin and W3's undo will read them.
const KILL_SWITCH_KEY = "auto_promote_paused";
const STABLE_KEY = "autopromote_receptionist_prompt_stable";
const OVERLAY_KEY = "autopromote_receptionist_overlay";
import { promotionHistoryKey, RECEPTIONIST_LOOP } from "./autoPromote";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const HISTORY = promotionHistoryKey(RECEPTIONIST_LOOP);

const CODE = ["# IDENTITY", "You answer the phone for the shop.", "## TONE", "Be brief and kind.", "## FLAT TIRE", "Ask where the car is.", "## END"].join("\n");
const LIVE = `${CODE}\n\n## LEARNED\n- callers ask about rims`;
const GOOD = LIVE.replace("Be brief and kind.", "Be brief and kind. Answer the question asked before offering anything else.");
const PRICEY = LIVE.replace("Be brief and kind.", "Be brief and kind. Quote $60 for any used tire.");

const liveAssistant = (system: string) => ({
  id: "asst-1",
  model: { provider: "openai", model: "gpt-4o", temperature: 0.4, maxTokens: 250, toolIds: ["t1"], tools: [{ type: "transferCall", destinations: [{ number: "+12165550100" }] }], messages: [{ role: "system", content: system }] },
  metadata: { nickBehaviorHash: "old", other: "kept" },
});

/** In-memory kv with a real compare-and-swap, and a scripted Vapi. */
function harness(opts: { live?: string; kv?: Record<string, string>; armed?: boolean; patchStatus?: number; readbackSystem?: string | null; killReadFails?: boolean } = {}) {
  const kv = new Map<string, string>(Object.entries(opts.kv ?? {}));
  let served = opts.live ?? LIVE;
  const patches: Array<Record<string, any>> = [];
  let readbackOverride = opts.readbackSystem;
  const deps: PromotionDeps = {
    armed: opts.armed ?? true,
    codePrompt: CODE,
    now: () => new Date("2026-11-03T05:30:00Z"),
    kvGet: async (k) => {
      if (k === KILL_SWITCH_KEY && opts.killReadFails) throw new Error("db down");
      return kv.get(k) ?? null;
    },
    kvSet: async (k, v) => void kv.set(k, v),
    kvCompareAndSet: async (k, expected, next) => {
      if ((kv.get(k) ?? null) !== expected) return false;
      kv.set(k, next);
      return true;
    },
    patchAssistant: async (_id, body) => {
      {
        patches.push(JSON.parse(JSON.stringify(body)));
        if ((opts.patchStatus ?? 200) !== 200) return new Response("bad", { status: opts.patchStatus });
        served = (body.model as { messages: Array<{ content: string }> }).messages[0].content;
        return new Response("{}", { status: 200 });
      }
    },
    getAssistant: async () => {
      const sys = readbackOverride !== undefined && patches.length === 1 ? readbackOverride : served;
      if (patches.length === 1 && readbackOverride !== undefined) readbackOverride = undefined;
      return new Response(JSON.stringify(liveAssistant(sys ?? served)), { status: 200 });
    },
  };
  return { kv, deps, patches, served: () => served };
}

const accepted = (prompt: string, over: Record<string, unknown> = {}) => ({
  outcome: "accepted",
  accepted: { prompt, promptHash: hash(prompt), confirmed: true },
  candidateDiff: { codeEdit: true },
  baseline: { assistantId: "asst-1", prompt: LIVE, promptHash: hash(LIVE), parity: "code_plus_lessons" },
  ...over,
});
const history = (kv: Map<string, string>) => JSON.parse(kv.get(HISTORY) ?? "[]");

describe("promoteReceptionistCandidate", () => {
  it("ships disarmed: the production deps W3 arms say armed false", async () => {
    const { productionPromotionDeps } = await import("./receptionistPromotion");
    expect((await productionPromotionDeps()).armed).toBe(false);
  });

  it("disarmed: a gated winner is recorded as would_promote and nothing is pushed", async () => {
    const h = harness({ armed: false });
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r.status).toBe("would_promote");
    expect(h.patches).toHaveLength(0);
    expect(history(h.kv)[0]).toMatchObject({ status: "would_promote", candidateHash: hash(GOOD), baseHash: hash(LIVE) });
    expect(h.kv.has(OVERLAY_KEY)).toBe(false);
  });

  it("armed: a gated winner is promoted with no tap: only the system message changes, read-back verified", async () => {
    const h = harness();
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r.status).toBe("promoted");
    expect(h.patches).toHaveLength(1);
    const body = h.patches[0];
    const live = liveAssistant(LIVE);
    expect(body.model).toEqual({ ...live.model, messages: [{ role: "system", content: GOOD }] });
    expect(body.metadata).toMatchObject({ other: "kept", nickPromptHash: hash(GOOD), nickBehaviorHashBase: "old" });
    // Call evidence must not keep attributing calls to the behaviour that no longer serves.
    expect(body.metadata.nickBehaviorHash).toMatch(/^[0-9a-f]{24}$/);
    expect(body.metadata.nickBehaviorHash).not.toBe("old");
    expect(Object.keys(body).sort()).toEqual(["metadata", "model"]);
    expect(h.served()).toBe(GOOD);
    // The stable snapshot holds the prompt callers heard before, for undo.
    expect(JSON.parse(h.kv.get(STABLE_KEY)!)).toMatchObject({ promptHash: hash(LIVE), prompt: LIVE });
    // The overlay lets the next manual Push Latest Config keep the edit.
    expect(JSON.parse(h.kv.get(OVERLAY_KEY)!)).toMatchObject({ candidateHash: hash(GOOD), versionId: r.versionId });
    expect(history(h.kv)[0]).toMatchObject({ status: "promoted", versionId: r.versionId });
    expect(r.line).toMatch(/^Auto-promote: PROMOTED/);
  });

  it("a loser is refused: nothing pushed, the reason recorded", async () => {
    const h = harness();
    const r = await promoteReceptionistCandidate({ ...accepted(GOOD), outcome: "rejected-holdout", accepted: null }, h.deps);
    expect(r).toMatchObject({ status: "held", reason: "offline_rejected-holdout" });
    expect(h.patches).toHaveLength(0);
  });

  it("a protected-fact edit (a price) is refused even when the offline gate passed it", async () => {
    const h = harness();
    const r = await promoteReceptionistCandidate(accepted(PRICEY), h.deps);
    expect(r).toMatchObject({ status: "held", reason: "floor_price" });
    expect(h.patches).toHaveLength(0);
  });

  it("two runners racing promote once: the second loses the swap and acts on nothing", async () => {
    const h = harness();
    const [a, b] = await Promise.all([promoteReceptionistCandidate(accepted(GOOD), h.deps), promoteReceptionistCandidate(accepted(GOOD), h.deps)]);
    expect([a.status, b.status].sort()).toEqual(["duplicate", "promoted"]);
    expect(h.patches).toHaveLength(1);
  });

  it("the kill switch holds; an unreadable kill switch holds too (fail closed)", async () => {
    const h1 = harness({ kv: { [KILL_SWITCH_KEY]: "true" } });
    expect(await promoteReceptionistCandidate(accepted(GOOD), h1.deps)).toMatchObject({ status: "held", reason: "kill_switch" });
    const h2 = harness({ killReadFails: true });
    expect(await promoteReceptionistCandidate(accepted(GOOD), h2.deps)).toMatchObject({ status: "held", reason: "kill_switch_unreadable" });
    expect(h1.patches.length + h2.patches.length).toBe(0);
  });

  it.each(["TRUE", "1", "yes", "on", "paused"])("the kill switch reads %s as paused", async (v) => {
    const h = harness({ kv: { [KILL_SWITCH_KEY]: v } });
    expect(await promoteReceptionistCandidate(accepted(GOOD), h.deps)).toMatchObject({ status: "held", reason: "kill_switch" });
  });

  it.each(["false", "0", "", "off"])("the kill switch reads %j as running", async (v) => {
    const h = harness({ kv: { [KILL_SWITCH_KEY]: v } });
    expect((await promoteReceptionistCandidate(accepted(GOOD), h.deps)).status).toBe("promoted");
  });

  it("the live prompt changed after the run measured it: refused, nothing pushed", async () => {
    const h = harness({ live: LIVE.replace("rims", "rims and lugs") });
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r).toMatchObject({ status: "held", reason: "live_changed_since_measured" });
    expect(h.patches).toHaveLength(0);
  });

  it("a read-back that does not match restores the snapshot and records it", async () => {
    const h = harness({ readbackSystem: "something else" });
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r.status).toBe("readback_restored");
    expect(h.patches).toHaveLength(2);
    expect(h.patches[1].model.messages[0].content).toBe(LIVE);
    expect(h.patches[1].metadata).toEqual(liveAssistant(LIVE).metadata);
    expect(h.served()).toBe(LIVE);
    expect(h.kv.has(OVERLAY_KEY)).toBe(false);
    expect(history(h.kv)[0]).toMatchObject({ status: "readback_restored" });
  });

  it("a refused PATCH changes nothing and records push_failed", async () => {
    const h = harness({ patchStatus: 400 });
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r.status).toBe("push_failed");
    expect(h.served()).toBe(LIVE);
    expect(h.kv.has(OVERLAY_KEY)).toBe(false);
  });

  it("a history row that is not a list is never overwritten, and nothing is pushed", async () => {
    const h = harness({ kv: { [HISTORY]: "{oops" } });
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r).toMatchObject({ status: "held", reason: "history_unreadable" });
    expect(h.kv.get(HISTORY)).toBe("{oops");
    expect(h.patches).toHaveLength(0);
  });
});
