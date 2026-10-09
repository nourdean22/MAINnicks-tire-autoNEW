import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  beatGenerationRoute,
  beatsTheGeneratorMustNotRender,
  declaredBeatSource,
  generationHoldReason,
  routeShot,
  shotRouteProblems,
  type ShotFacts,
} from "./shotRouter";

const facts = (over: Partial<ShotFacts> = {}): ShotFacts => ({
  claimsRealWork: false, explainsMechanism: false, atmosphereOrMetaphor: false, hasApprovedStill: false,
  defectWouldHarmTrust: false, reusableShotExists: false, essential: true, ...over,
});

describe("routeShot — the seven questions, cheapest accepted method first", () => {
  it("anything that claims real work is real footage, whatever else is true of it", () => {
    const d = routeShot(facts({ claimsRealWork: true, atmosphereOrMetaphor: true, hasApprovedStill: true }));
    expect(d).toMatchObject({ route: "real", step: 1 });
  });
  it("a mechanism explanation is deterministic even when a still exists", () => {
    expect(routeShot(facts({ explainsMechanism: true, hasApprovedStill: true }))).toMatchObject({ route: "deterministic", step: 2 });
  });
  it("an approved still gets deterministic motion before any generation, even for atmosphere", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true, hasApprovedStill: true }))).toMatchObject({ route: "still_motion", step: 4 });
  });
  it("a shot whose defect would harm trust is not generated — even as atmosphere", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true, defectWouldHarmTrust: true }))).toMatchObject({ route: "do_not_generate", step: 5 });
  });
  it("an honest reusable shot beats a new AI shot", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true, reusableShotExists: true }))).toMatchObject({ route: "reuse", step: 6 });
  });
  it("pure atmosphere with no cheaper route is AI, labelled illustrative", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true }))).toMatchObject({ route: "ai_illustrative", step: 3 });
  });
  it("a non-essential shot with no route is deleted before any spend; an essential one is captured, not generated", () => {
    expect(routeShot(facts({ essential: false }))).toMatchObject({ route: "delete", step: 7 });
    expect(routeShot(facts({ essential: true }))).toMatchObject({ route: "do_not_generate", step: 7 });
  });
});

describe("declaredBeatSource — explicit tags only, never a guess", () => {
  it("reads the field first, then the leading tag, else unspecified", () => {
    expect(declaredBeatSource({ visual: "REAL macro of a tire", source: "deterministic" })).toBe("deterministic");
    expect(declaredBeatSource({ visual: "REAL macro of a tire" })).toBe("real");
    expect(declaredBeatSource({ visual: "REAL + DETERMINISTIC: nail head with a zone outline" })).toBe("real");
    expect(declaredBeatSource({ visual: "DETERMINISTIC card: three columns" })).toBe("deterministic");
    expect(declaredBeatSource({ visual: "STILL-MOTION push on the approved exterior" })).toBe("still_motion");
    expect(declaredBeatSource({ visual: "AI illustrative: abstract vibration plate" })).toBe("ai_illustrative");
    expect(declaredBeatSource({ visual: "a tire on a lift, real-looking" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: null })).toBe("unspecified");
  });
});

describe("declaredBeatSource — a tag counts only as written, in capitals", () => {
  it("ordinary prose that starts with the same word is not a declaration", () => {
    // The generator acts on a declaration now; title-case prose must not hold a Reel nobody tagged.
    expect(declaredBeatSource({ visual: "Real-world pothole damage on a rim" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: "Real tire, real shop, real light" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: "Still frame of the gauge at 4/32" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: "Ai-generated wheel spinning" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: "AIRBAG light on the cluster" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: "Deterministic? no, a camera move" })).toBe("unspecified");
  });
  it("CONTROL: the capitalised tags still read", () => {
    expect(declaredBeatSource({ visual: "REAL: the balancer display" })).toBe("real");
    expect(declaredBeatSource({ visual: "  REAL macro: a nail head" })).toBe("real");
    expect(declaredBeatSource({ visual: "STILL push on the exterior" })).toBe("still_motion");
    expect(declaredBeatSource({ visual: "AI-ILLUSTRATIVE fog" })).toBe("ai_illustrative");
  });
});

describe("the generator's route for a declared source", () => {
  it("real and deterministic are never generated; everything else generates as before", () => {
    expect(beatGenerationRoute({ visual: "REAL: the gauge in the tread" })).toBe("needs_real_footage");
    expect(beatGenerationRoute({ visual: "a tire", source: "real" })).toBe("needs_real_footage");
    // 2026-10-09: a deterministic beat is drawn locally (render_card), never held and never generated.
    expect(beatGenerationRoute({ visual: "DETERMINISTIC card: three columns" })).toBe("render_card");
    // A real beat that names its registry asset is bound locally; without one it is still held.
    expect(beatGenerationRoute({ visual: "REAL: the gauge in the tread", realAssetId: "ma_gauge" })).toBe("bound_real");
    expect(beatGenerationRoute({ visual: "STILL-MOTION push" })).toBe("generate");
    expect(beatGenerationRoute({ visual: "AI illustrative: fog" })).toBe("generate");
    expect(beatGenerationRoute({ visual: "a tire on the lift" })).toBe("generate");
    // The field wins over the tag, both ways.
    expect(beatGenerationRoute({ visual: "REAL macro", source: "ai_illustrative" })).toBe("generate");
  });

  it("names the beats without a clip, and a resumed job keeps the clips it has", () => {
    const beats = [
      { beatNumber: 1, visual: "REAL macro of the tread" },
      { beatNumber: 2, visual: "a tire on the lift" },
      { beatNumber: 3, visual: "DETERMINISTIC card: the zones" },
      { beatNumber: 4, visual: "REAL: the gauge" },
    ];
    // Beat 3 (deterministic) is no longer a hold since 2026-10-09: the card lane draws it (beatsToResolveLocally).
    expect(beatsTheGeneratorMustNotRender(beats, [])).toEqual([
      { beatNumber: 1, route: "needs_real_footage" },
      { beatNumber: 4, route: "needs_real_footage" },
    ]);
    expect(beatsTheGeneratorMustNotRender(beats, ["https://cdn/real-1.mp4", null, "", "https://cdn/real-4.mp4"])).toEqual([]);
    expect(beatsTheGeneratorMustNotRender(beats, "{not an array}")).toHaveLength(2);
    expect(beatsTheGeneratorMustNotRender([{ beatNumber: 1, visual: "a tire" }], [])).toEqual([]);
  });

  it("the refusal line says which beats, what each needs, and where it stopped", () => {
    expect(generationHoldReason([{ beatNumber: 2, route: "needs_real_footage" }])).toBe(
      "BEAT_SOURCE_NOT_GENERATABLE (blocked at generation, before spend): beat 2 is declared real with no registry asset bound: capture the footage, register it as real_shop, and name its asset id on the beat (docs/reels-engine-v2/05-CAPTURE-CHECKLIST.md). Nothing was generated.",
    );
    expect(generationHoldReason([
      { beatNumber: 1, route: "needs_real_footage" },
      { beatNumber: 3, route: "needs_deterministic_render" },
      { beatNumber: 4, route: "needs_real_footage" },
    ], "enqueue")).toBe(
      "BEAT_SOURCE_NOT_GENERATABLE (blocked at enqueue, nothing reserved): beats 1, 4 are declared real with no registry asset bound: capture the footage, register it as real_shop, and name its asset id on the beat (docs/reels-engine-v2/05-CAPTURE-CHECKLIST.md); beat 3 is declared deterministic: the local card could not be rendered (see the job log). Nothing was generated.",
    );
  });
});

describe("a visual that names no object is not generated (2026-10-08)", () => {
  // The ten placeholder shots two 2026-09-25 imports wrote into 34 packs, verbatim.
  const TEMPLATE = [
    "Extreme macro of the physical subject under clean shop inspection light; no readable markings are required in the generated image.",
    "Second angle on the same physical subject with stable geometry and a restrained lateral camera move.",
    "Neutral technical comparison of the relevant physical components, wordless and unbranded.",
    "Close inspection view that reveals the mechanical distinction through shape, position, surface, or motion.",
    "Return to the opening physical subject with the corrected condition clearly visible through shape, position, or motion.",
    "unbranded automotive component macro under clean shop light",
    "two matching physical comparison samples on a clean bench",
    "wordless mechanical cross-section model of the relevant component",
    "second physical comparison angle under the same lighting",
    "return to the opening component macro from the same angle",
  ];

  it("every placeholder shot is held: there is no subject to generate", () => {
    for (const visual of TEMPLATE) expect(beatGenerationRoute({ visual }), visual).toBe("needs_subject");
  });

  it("CONTROL: the same phrasing that names a part is a subject, and ordinary shots generate", () => {
    for (const visual of [
      "Extreme macro of the brake caliper slide pin, the relevant component, under shop light",
      "Second angle on the same physical subject: the tire sidewall bulge",
      "Extreme macro on a rubber tire valve stem where it meets the alloy wheel",
      "a tire on the lift",
      "",
    ]) expect(beatGenerationRoute({ visual }), visual).toBe("generate");
    expect(beatGenerationRoute({ visual: null })).toBe("generate");
  });

  it("a declaration still decides first: a REAL placeholder needs footage, not a subject", () => {
    expect(beatGenerationRoute({ visual: "REAL: macro of the physical subject" })).toBe("needs_real_footage");
    expect(beatGenerationRoute({ visual: TEMPLATE[0], source: "deterministic" })).toBe("render_card");
  });

  it("the refusal names the placeholder beats and what to do", () => {
    const beats = TEMPLATE.slice(0, 5).map((visual, i) => ({ beatNumber: i + 1, visual }));
    const held = beatsTheGeneratorMustNotRender(beats, []);
    expect(held.map((b) => b.route)).toEqual(Array(5).fill("needs_subject"));
    expect(generationHoldReason([{ beatNumber: 2, route: "needs_subject" }])).toContain("beat 2 is a placeholder that names no object");
    expect(generationHoldReason(held, "enqueue")).toBe(
      'BEAT_SOURCE_NOT_GENERATABLE (blocked at enqueue, nothing reserved): beats 1, 2, 3, 4, 5 are placeholders that name no object ("the physical subject"): write what the camera sees, or capture it. Nothing was generated.',
    );
  });
});

describe("shotRouteProblems — contradictions only, silent on undeclared beats", () => {
  it("an AI beat that describes a measurement or repair is flagged", () => {
    const p = shotRouteProblems([{ beatNumber: 2, visual: "AI: a technician reads the gauge on the rotor", purpose: "measurement" }]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^beat 2: declared ai_illustrative but describes real work/);
  });
  it("a real beat that asks for a generated shot is flagged", () => {
    expect(shotRouteProblems([{ beatNumber: 3, visual: "REAL: generated close-up of the lug nuts", purpose: "evidence" }])).toHaveLength(1);
  });
  it("undeclared beats and consistent beats produce nothing", () => {
    expect(shotRouteProblems([
      { beatNumber: 1, visual: "a tire on the lift", purpose: "hook" },
      { beatNumber: 2, visual: "AI illustrative: fog rolling over an empty lot at dawn", purpose: "atmosphere" },
      { beatNumber: 3, visual: "REAL macro of the tread", purpose: "evidence" },
    ])).toEqual([]);
  });
  it("the three proof packs declare a source on every beat and raise no contradiction", () => {
    for (const slug of ["2026-10-08-proof-01-uneven-wear", "2026-10-08-proof-02-highway-shake", "2026-10-08-proof-03-patch-or-replace"]) {
      const brief = JSON.parse(readFileSync(new URL(`../docs/reel-packs/${slug}/brief.json`, import.meta.url), "utf8"));
      const beats = brief.storyboardBeats as Array<{ beatNumber: number; visual: string; purpose: string }>;
      expect(beats.every((b) => declaredBeatSource(b) !== "unspecified")).toBe(true);
      expect(beats.some((b) => declaredBeatSource(b) === "ai_illustrative")).toBe(false);
      expect(shotRouteProblems(beats)).toEqual([]);
    }
  });
});
