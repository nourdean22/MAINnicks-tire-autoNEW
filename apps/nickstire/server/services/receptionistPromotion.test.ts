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
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkReceptionistCanary, promoteReceptionistCandidate, undoReceptionistPromotion, type PromotionDeps } from "./receptionistPromotion";

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
type Counts = { evaluated: number; success: number } | null;
function harness(opts: { live?: string; kv?: Record<string, string>; armed?: boolean; patchStatus?: number; readbackSystem?: string | null; killReadFails?: boolean; now?: Date; switchRow?: string | null } = {}) {
  // Nour's one tap (RESUME) writes "false"; a missing row means never switched on.
  const switchRow = opts.switchRow === undefined ? "false" : opts.switchRow;
  const kv = new Map<string, string>(Object.entries({ ...(switchRow === null ? {} : { [KILL_SWITCH_KEY]: switchRow }), ...(opts.kv ?? {}) }));
  let served = opts.live ?? LIVE;
  let servedMeta: Record<string, unknown> = liveAssistant(LIVE).metadata;
  const patches: Array<Record<string, any>> = [];
  let readbackOverride = opts.readbackSystem;
  const canary: { before: Counts; after: Counts; asked: Array<Record<string, unknown>> } = { before: { evaluated: 400, success: 200 }, after: { evaluated: 0, success: 0 }, asked: [] };
  const clock = { now: opts.now ?? new Date("2026-11-03T05:30:00Z") };
  const deps: PromotionDeps = {
    canaryCounts: async (q) => {
      canary.asked.push(q);
      return { before: canary.before, after: canary.after };
    },
    armed: opts.armed ?? true,
    codePrompt: CODE,
    now: () => clock.now,
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
        servedMeta = body.metadata;
        return new Response("{}", { status: 200 });
      }
    },
    getAssistant: async () => {
      const sys = readbackOverride !== undefined && patches.length === 1 ? readbackOverride : served;
      if (patches.length === 1 && readbackOverride !== undefined) readbackOverride = undefined;
      return new Response(JSON.stringify({ ...liveAssistant(sys ?? served), metadata: servedMeta }), { status: 200 });
    },
  };
  return {
    kv,
    deps,
    patches,
    canary,
    clock,
    served: () => served,
    meta: () => servedMeta,
    /** A manual Push Latest Config happened: the live text changed under the promotion. */
    setServed: (s: string) => void (served = s),
  };
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
  it("W3 arms it: the production deps say armed true (the canary, rollback and undo exist)", async () => {
    const { productionPromotionDeps } = await import("./receptionistPromotion");
    expect((await productionPromotionDeps()).armed).toBe(true);
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

  it.each(["TRUE", "1", "yes", "on", "paused", "", "maybe"])("the kill switch reads %j as paused (anything but an explicit run value)", async (v) => {
    const h = harness({ kv: { [KILL_SWITCH_KEY]: v } });
    expect(await promoteReceptionistCandidate(accepted(GOOD), h.deps)).toMatchObject({ status: "held", reason: "kill_switch" });
    expect(h.patches).toHaveLength(0);
  });

  it.each(["false", "0", "no", "OFF", "running"])("the kill switch reads %j as running", async (v) => {
    const h = harness({ kv: { [KILL_SWITCH_KEY]: v } });
    expect((await promoteReceptionistCandidate(accepted(GOOD), h.deps)).status).toBe("promoted");
  });

  it("a fresh deploy never promotes on its own: no switch row = never switched on, held, nothing pushed", async () => {
    const h = harness({ switchRow: null });
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r).toMatchObject({ status: "held", reason: "not_switched_on" });
    expect(r.line).toMatch(/RESUME/);
    expect(h.patches).toHaveLength(0);
    expect(history(h.kv)[0]).toMatchObject({ status: "held", reason: "not_switched_on" });
  });

  it("a promotion still in flight (a crashed run left 'promoting') blocks the next claim", async () => {
    const h = harness();
    const stuck = { versionId: "v-stuck", at: "2026-11-02T05:30:00.000Z", loop: RECEPTIONIST_LOOP, status: "promoting", reason: null, baseHash: hash(LIVE), candidateHash: hash(GOOD) };
    const held = { ...stuck, versionId: "v-later", status: "held", reason: "promotion_in_flight" };
    h.kv.set(HISTORY, JSON.stringify([held, stuck]));
    const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(r).toMatchObject({ status: "held", reason: "promotion_in_flight" });
    expect(h.patches).toHaveLength(0);
  });

  it("a second runner that starts after the first claimed acts on nothing", async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realGet = h.deps.getAssistant;
    let first = true;
    // Runner A pauses on its live read, i.e. after its claim landed.
    h.deps.getAssistant = async (id) => {
      if (first) {
        first = false;
        await gate;
      }
      return realGet(id);
    };
    const a = promoteReceptionistCandidate(accepted(GOOD), h.deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(history(h.kv)[0].status).toBe("promoting");
    const b = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    release();
    expect(b).toMatchObject({ status: "held", reason: "promotion_in_flight" });
    expect((await a).status).toBe("promoted");
    expect(h.patches).toHaveLength(1);
    // B's row landed between A's claim and its end: A still settles its own row, so the canary and undo see it.
    expect(history(h.kv).map((r: { status: string }) => r.status)).toEqual(["held", "promoted"]);
    expect(await checkReceptionistCanary(h.deps)).toMatchObject({ status: "watching" });
  });

  it("a baseline too thin for the canary to judge is held before anything goes live", async () => {
    const h = harness();
    h.canary.before = { evaluated: 99, success: 50 };
    expect(await promoteReceptionistCandidate(accepted(GOOD), h.deps)).toMatchObject({ status: "held", reason: "canary_unmeasurable" });
    const h2 = harness();
    h2.canary.before = null;
    expect(await promoteReceptionistCandidate(accepted(GOOD), h2.deps)).toMatchObject({ status: "held", reason: "canary_baseline_unreadable" });
    expect(h.patches.length + h2.patches.length).toBe(0);
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

// ── Self-learning W3: the canary, automatic rollback and Nour's undo ──────────
/** The next night's winner, measured against the promoted prompt. */
const OTHER = GOOD.replace("Ask where the car is.", "Ask where the car is, then whether it is safe to drive.");
const H = 3_600_000;

/** Promote GOOD and move the clock forward by `hours`. */
async function promoted(h: ReturnType<typeof harness>, hours = 48) {
  const r = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
  expect(r.status).toBe("promoted");
  h.clock.now = new Date(h.clock.now.getTime() + hours * H);
  return r;
}

describe("W3 · canary, rollback, undo", () => {
  it("while a canary is open, the next night's winner is held", async () => {
    const h = harness();
    await promoted(h);
    const next = await promoteReceptionistCandidate({ ...accepted(OTHER), baseline: { assistantId: "asst-1", prompt: GOOD, promptHash: hash(GOOD), parity: "code_plus_lessons" } }, h.deps);
    expect(next).toMatchObject({ status: "held", reason: "canary_open" });
    expect(h.patches).toHaveLength(1);
  });

  it("nothing promoted: the canary check has nothing to say", async () => {
    const h = harness();
    expect(await checkReceptionistCanary(h.deps)).toBeNull();
  });

  it("the canary asks for exactly the promoted prompt's calls and the assistant's 14 days before", async () => {
    const h = harness();
    await promoted(h);
    await checkReceptionistCanary(h.deps);
    expect(h.canary.asked.at(-1)).toMatchObject({ assistantId: "asst-1", promptHash: hash(GOOD), promotedAt: "2026-11-03T05:30:00.000Z", baselineDays: 14 });
  });

  it("too few calls yet: watching, nothing changes", async () => {
    const h = harness();
    await promoted(h);
    h.canary.after = { evaluated: 20, success: 10 };
    const r = await checkReceptionistCanary(h.deps);
    expect(r).toMatchObject({ status: "watching" });
    expect(h.served()).toBe(GOOD);
  });

  it("enough calls and no harm: the canary passes, and a new winner may promote again", async () => {
    const h = harness();
    await promoted(h);
    h.canary.after = { evaluated: 60, success: 31 };
    expect(await checkReceptionistCanary(h.deps)).toMatchObject({ status: "canary_passed" });
    expect(history(h.kv)[0]).toMatchObject({ status: "canary_passed", candidateHash: hash(GOOD) });
    const next = await promoteReceptionistCandidate({ ...accepted(OTHER), baseline: { assistantId: "asst-1", prompt: GOOD, promptHash: hash(GOOD), parity: "code_plus_lessons" } }, h.deps);
    expect(next.status).toBe("promoted");
  });

  it("harm rolls back automatically: the prior prompt hash is restored, read back, the overlay cleared", async () => {
    const h = harness();
    await promoted(h);
    h.canary.after = { evaluated: 60, success: 18 };
    const r = await checkReceptionistCanary(h.deps);
    expect(r).toMatchObject({ status: "rolled_back", reason: "canary_harm" });
    expect(hash(h.served())).toBe(hash(LIVE));
    expect(h.meta()).toMatchObject({ nickBehaviorHash: "old", other: "kept" });
    expect(h.meta()).not.toHaveProperty("nickPromptHash");
    expect(h.kv.get(OVERLAY_KEY)).toBe("null");
    expect(history(h.kv)[0]).toMatchObject({ status: "rolled_back", reason: "canary_harm", candidateHash: hash(GOOD) });
  });

  it("a canary read that failed keeps the canary open: never passed, never rolled back", async () => {
    const h = harness();
    await promoted(h);
    h.canary.before = null;
    expect(await checkReceptionistCanary(h.deps)).toMatchObject({ status: "unknown" });
    expect(h.served()).toBe(GOOD);
    expect(history(h.kv)[0].status).toBe("promoted");
  });

  it("Nour's undo restores the prior prompt hash with one call", async () => {
    const h = harness();
    await promoted(h, 1);
    const r = await undoReceptionistPromotion(h.deps);
    expect(r).toMatchObject({ status: "undone", reason: "operator" });
    expect(hash(h.served())).toBe(hash(LIVE));
    expect(hash(h.served())).toBe(history(h.kv)[0].baseHash);
    expect(history(h.kv)[0]).toMatchObject({ status: "undone" });
  });

  it.each(["undo", "canary"] as const)("a candidate taken back (%s) is never promoted again", async (how) => {
    const h = harness();
    await promoted(h);
    if (how === "undo") await undoReceptionistPromotion(h.deps);
    else {
      h.canary.after = { evaluated: 60, success: 18 };
      expect(await checkReceptionistCanary(h.deps)).toMatchObject({ status: "rolled_back" });
    }
    const again = await promoteReceptionistCandidate(accepted(GOOD), h.deps);
    expect(again).toMatchObject({ status: "held", reason: "candidate_taken_back_before" });
    expect(h.served()).toBe(LIVE);
    expect(h.patches).toHaveLength(2);
  });

  it("undo with nothing promoted changes nothing", async () => {
    const h = harness();
    expect(await undoReceptionistPromotion(h.deps)).toMatchObject({ status: "nothing_to_undo" });
    expect(h.patches).toHaveLength(0);
  });

  it("an undo and a canary rollback racing act once", async () => {
    const h = harness();
    await promoted(h);
    h.canary.after = { evaluated: 60, success: 18 };
    const [a, b] = await Promise.all([undoReceptionistPromotion(h.deps), checkReceptionistCanary(h.deps)]);
    expect([a?.status, b?.status].filter((s) => s === "undone" || s === "rolled_back")).toHaveLength(1);
    expect(h.patches).toHaveLength(2);
  });

  it("two undo taps reading the same history act once: the second loses the swap", async () => {
    const h = harness();
    await promoted(h, 1);
    const [a, b] = await Promise.all([undoReceptionistPromotion(h.deps), undoReceptionistPromotion(h.deps)]);
    expect([a.status, b.status].sort()).toEqual(["duplicate", "undone"]);
    expect(h.patches).toHaveLength(2);
  });

  it("the nightly path never calls updateAssistant or rebuilds the config (comments stripped)", () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const banned = /\b(?:updateAssistant|buildAssistantConfig)\b/;
    const files = {
      promotion: strip(readFileSync(new URL("./receptionistPromotion.ts", import.meta.url), "utf8")),
      job: strip(readFileSync(new URL("../cron/jobs/promptEvolutionWeekly.ts", import.meta.url), "utf8")),
    };
    // Located the subject: the push and the job's two calls are in the scanned text.
    expect(files.promotion.match(/deps\s*\.patchAssistant\(/g)?.length).toBe(3);
    expect(files.promotion).toContain("vapi.patchAssistantPromptOnly");
    expect(files.job).toContain("promoteReceptionistCandidate(");
    expect(files.job).toContain("checkReceptionistCanary(");
    // The scanner fires on a planted call and stays quiet on a comment about it.
    expect(banned.test(strip("const r = await updateAssistant(id);"))).toBe(true);
    expect(banned.test(strip("// never updateAssistant here"))).toBe(false);
    expect(banned.test(files.promotion)).toBe(false);
    expect(banned.test(files.job)).toBe(false);
  });

  it("a manual push since the promotion: the edit is reversed on the live text, the rest of the push kept", async () => {
    const h = harness();
    await promoted(h, 1);
    h.setServed(`${GOOD}\n- a lesson the manual push added`);
    const r = await undoReceptionistPromotion(h.deps);
    expect(r).toMatchObject({ status: "undone" });
    expect(h.served()).toBe(`${LIVE}\n- a lesson the manual push added`);
  });
});
