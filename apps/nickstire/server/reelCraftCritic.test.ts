/**
 * THE CRITIC HAD NO WORD FOR "THIS LOOKS MADE", AND ONE PALETTE FOR FOURTEEN WORLDS.
 *
 * Two defects, one of them self-inflicted earlier the same day.
 *
 * 1 · Every defect code asked "is this broken?" - identity drift, stray
 *     lettering, a hand in frame, warped geometry. Not one asked "does this
 *     look generated?". A reel could pass every block gate and still be the
 *     waxy, weightless, could-be-any-shop footage that 104 tracked posts turned
 *     into an average of 0.00 saves per post, every month measured.
 *
 * 2 · LENS_PALETTES gave each motion lens the world its own grammar asks for -
 *     blueprint_technical drafts in blue and paper white, tilt_shift_miniature
 *     works in bright daylight. The critic was still judging all fourteen
 *     against the fixed graphite+gold brand palette, so it would have reported
 *     PALETTE_DRIFT on every correctly-rendered non-noir reel. The generator
 *     and its inspector were handed contradicting specs.
 *
 * The spend rule is the load-bearing part. clampVerdict already refuses to let
 * the model set SEVERITY, but the model owns the top-level `decision`, and a
 * "repair" routes to a paid beat regeneration. Handing a taste judgement that
 * lever lets a critic having a strict day burn the daily budget and dark the
 * lane. So craft findings are recorded, counted, and declined as grounds for
 * spending - and the decline is a visible flag, not a silent downgrade.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { RENDERED_DEFECT_CODES, clampVerdict, type RenderedFinding } from "./services/renderedQa";
import { planRepairs, routeFinding } from "./services/repairRouter";
import { CRITIC_LENSES } from "./services/criticPanel";
import { BRAND_BIBLE_VERSION } from "../shared/brandBible";

const CRAFT = ["PLASTIC_AI_LOOK", "IMPOSSIBLE_PHYSICALITY", "GENERIC_STOCK_LOOK"] as const;

function finding(code: string, beatNumber: number | null = 1): RenderedFinding {
  return {
    beatNumber,
    code: code as RenderedFinding["code"],
    severity: RENDERED_DEFECT_CODES[code as keyof typeof RENDERED_DEFECT_CODES].severity,
    description: "d",
    preserve: [],
    change: [],
  };
}

afterEach(() => {
  vi.doUnmock("./_core/llm");
  vi.resetModules();
});

describe("the critic can name an AI look", () => {
  it("all three craft codes exist, and every one is a warn", () => {
    for (const c of CRAFT) {
      expect(RENDERED_DEFECT_CODES[c], `${c} missing from the registry`).toBeTruthy();
      expect(RENDERED_DEFECT_CODES[c].severity, `${c} must not be able to block`).toBe("warn");
    }
  });

  it("they are routed to a fix that could actually work, not to the free lie", () => {
    // regrade and reassemble are free, which makes them tempting. Neither adds
    // pore detail to a plastic tyre or a contact shadow under a floating part -
    // a route that cannot fix its defect reports a repair over an unchanged
    // frame, which is worse than no route.
    for (const c of CRAFT) {
      const r = routeFinding(finding(c));
      expect(r.method, `${c} routed to a method that cannot fix it`).toBe("regenerate");
    }
  });
});

describe("craft findings are evidence, never a reason to spend", () => {
  it("a craft-only repair is DECLINED, and the findings survive as evidence", () => {
    const v = clampVerdict(
      { decision: "repair", findings: CRAFT.map((c) => ({ code: c, description: "looks generated" })) },
      5,
      "vision",
    );
    expect(v.decision).toBe("approve");
    expect(v.craftOnlyRepairDeclined).toBe(true);
    // Declined is not discarded - the whole point is to measure how often it fires.
    expect(v.findings).toHaveLength(3);
    expect(v.findings.map((f) => f.code).sort()).toEqual([...CRAFT].sort());
  });

  it("a block finding still forces a repair even when craft rides along", () => {
    const v = clampVerdict(
      { decision: "repair", findings: [{ code: "HUMAN_PRESENT" }, { code: "PLASTIC_AI_LOOK" }] },
      5,
      "vision",
    );
    expect(v.decision).toBe("repair");
    expect(v.craftOnlyRepairDeclined).toBe(false);
  });

  it("a NON-craft warn still carries a repair - only pure taste is declined", () => {
    // PALETTE_DRIFT is a warn too, but it names a measurable, fixable fact and
    // routes to a free regrade. It must not get swept up in the craft decline.
    const v = clampVerdict(
      { decision: "repair", findings: [{ code: "PALETTE_DRIFT" }, { code: "GENERIC_STOCK_LOOK" }] },
      5,
      "vision",
    );
    expect(v.decision).toBe("repair");
    expect(v.craftOnlyRepairDeclined).toBe(false);
  });

  it("REGRESSION GUARD: a zero-finding repair is still a repair", () => {
    // A critic asking for a repair with no findings is saying something is wrong
    // it had no vocabulary for. That is signal, not taste - the decline must not
    // widen into it.
    const v = clampVerdict({ decision: "repair", findings: [] }, 5, "vision");
    expect(v.decision).toBe("repair");
    expect(v.craftOnlyRepairDeclined).toBe(false);
  });

  it("an approve stays an approve - the flag never invents a downgrade", () => {
    const v = clampVerdict({ decision: "approve", findings: [{ code: "PLASTIC_AI_LOOK" }] }, 5, "vision");
    expect(v.decision).toBe("approve");
    expect(v.craftOnlyRepairDeclined).toBe(false);
  });

  it("planRepairs still reports the honest cost of a craft route", () => {
    // The decline happens at the decision, not by hiding the price.
    const plan = planRepairs(CRAFT.map((c) => finding(c, 2)));
    expect(plan.routes).toHaveLength(3);
    expect(plan.paidRegenerations).toBe(3);
  });
});

describe("PALETTE_DRIFT is judged against the world THIS reel declared", () => {
  it("the code's own meaning no longer names one house palette", () => {
    expect(RENDERED_DEFECT_CODES.PALETTE_DRIFT.meaning.toLowerCase()).not.toContain("graphite+gold");
  });

  async function promptFor(brief: Record<string, unknown>): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "craft-"));
    const frame = path.join(dir, "f.jpg");
    await fs.writeFile(frame, Buffer.from("fakejpegbytes"));
    const spy = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ decision: "approve", findings: [] }) } }],
    });
    vi.doMock("./_core/llm", () => ({ invokeLLM: spy }));
    vi.resetModules();
    const { evaluateRenderedReel } = await import("./services/renderedQa");
    await evaluateRenderedReel({
      frames: [{ label: "beat1", beatNumber: 1, timestamp: 1, path: frame }],
      brief: brief as never,
    });
    expect(spy, "the critic was never called").toHaveBeenCalledTimes(1);
    return String(spy.mock.calls[0][0].messages[0].content);
  }

  it("a blueprint reel is judged in drafting blue, not in graphite and gold", async () => {
    // The sharpest case in LENS_PALETTES: blueprint_technical is drafting blue
    // and paper white. Under the old prompt the critic was told the world was
    // graphite+gold, so a perfectly rendered blueprint reel read as drift.
    const prompt = await promptFor({
      topic: "brake wear",
      motionLens: "blueprint_technical",
      storyboardBeats: [{ beatNumber: 1, visual: "exploded caliper" }],
    });
    expect(prompt).toContain("drafting blue and paper white");
    expect(prompt).toContain("Brand accent rule");
    // and it must say the comparison is per-reel, not cross-reel
    expect(prompt).toContain("not against any other reel");
  });

  it("a daylight lens is not judged against a dark world either", async () => {
    const prompt = await promptFor({
      motionLens: "tilt_shift_miniature",
      storyboardBeats: [{ beatNumber: 1, visual: "toy bay" }],
    });
    expect(prompt).toContain("bright even daylight");
    expect(prompt).not.toContain("drafting blue");
  });

  it("an older payload with no lens DEGRADES to the brand palette instead of darkening QA", async () => {
    const prompt = await promptFor({ storyboardBeats: [{ beatNumber: 1, visual: "tyre" }] });
    expect(prompt).toContain(BRAND_BIBLE_VERSION);
    expect(prompt).not.toContain("drafting blue");
  });

  it("an unknown lens also degrades rather than emitting an empty world", async () => {
    const prompt = await promptFor({ motionLens: "not_a_real_lens", storyboardBeats: [] });
    expect(prompt).toContain(BRAND_BIBLE_VERSION);
  });

  it("the prompt TEACHES each craft code, not merely lists its name", async () => {
    // Read this before loosening any assertion below.
    //
    // The prompt already contains an auto-generated list of every code and its
    // registry meaning, so a naive toContain() matches the LIST and passes even
    // when the calibration is gone. Two mutation rounds proved it: renaming the
    // craft header survived, then "any shop in any city" survived because that
    // phrase is also GENERIC_STOCK_LOOK's registry meaning.
    //
    // So slice the calibration out first and assert inside it. codeDoc sits
    // above the CALIBRATION block, and the instructions end where the output
    // contract begins.
    const prompt = await promptFor({ motionLens: "hyperreal_cinematic", storyboardBeats: [] });
    const start = prompt.indexOf("- CRAFT (");
    expect(start, "the craft calibration block is gone entirely").toBeGreaterThan(-1);
    const end = prompt.indexOf("For each finding give");
    expect(end).toBeGreaterThan(start);
    const craft = prompt.slice(start, end);

    expect(craft, "no guidance on what a plastic AI surface looks like").toContain("pore, grain and scratch detail");
    expect(craft, "no guidance on impossible light").toContain("contact shadow");
    expect(craft, "no guidance on anonymity").toContain("nothing in it is specific to this vehicle");
    // and it tells the critic these are not grounds for a repair, matching the
    // decline that clampVerdict actually enforces
    expect(craft).toContain("not grounds for");
  });
});

describe("the critic panel stopped enforcing one world on fourteen", () => {
  it("the brand lens no longer polices graphite+gold", () => {
    expect(CRITIC_LENSES.brand.focus.toLowerCase()).not.toContain("graphite+gold");
  });

  it("the lens told to watch for over-AI sheen finally has codes for it", () => {
    // It was already instructed to judge "generic-shop risk, over-AI sheen" while
    // holding only PALETTE_DRIFT - a reader with no vocabulary. Both findings had
    // to be reported as a colour problem, or not at all.
    expect(CRITIC_LENSES.brand.codes).toContain("GENERIC_STOCK_LOOK");
    expect(CRITIC_LENSES.brand.codes).toContain("PLASTIC_AI_LOOK");
  });

  it("impossible light is judged by the lens that already judges impossible parts", () => {
    expect(CRITIC_LENSES.automotive.codes).toContain("IMPOSSIBLE_PHYSICALITY");
  });

  it("every craft code is owned by some lens - none is defined and never asked for", () => {
    const owned = new Set(Object.values(CRITIC_LENSES).flatMap((l) => l.codes as string[]));
    for (const c of CRAFT) expect(owned.has(c), `${c} has no lens that looks for it`).toBe(true);
  });
});
