/**
 * Undeclared burned-in text must be impossible, and ONE ask per reel.
 *
 * THE DEFECT THESE PIN, measured from the rendered file on 2026-08-29. Reel
 * 1770003's payload declares five storyboard beats. The mp4 contains six text
 * cards - the sixth reads `SAVE THIS | DM "SALT"` and appears nowhere in the
 * payload, because `reelAssembly.ts` built it at render time from
 * `brief.campaignKeyword`. Reel 1770004 ends on `SAVE THIS | DM "ALIGNMENT"`
 * plus a second burned-in line, three asks in one frame.
 *
 * The consequence is not one stray card: every payload-only review this
 * pipeline ever had was reading an incomplete artifact. It is the same shape as
 * 1770005, where a false claim about Ohio law lived in pixels no payload review
 * would surface.
 *
 * EVERY BLOCK BELOW CARRIES A POSITIVE CONTROL. A checker that rejects every
 * render passes every "it catches X" test and is exactly as broken as one that
 * catches nothing.
 */
import { describe, it, expect } from "vitest";
import {
  declaredTextSurfaces,
  filtergraphTextSources,
  undeclaredTextProblem,
} from "@shared/reelTextSurfaces";
import { askProblem, renderAskText, resolveReelAsk, captionAskMismatch, stripCaptionAsks, DEFAULT_REEL_ASK, type ReelAsk } from "@shared/reelAsk";
import { buildFfmpegArgs, briefToSegments } from "./services/reelAssembly";

/* ── the ask: exactly one, and it can express a profile visit ───────────── */

describe("one reel, one ask", () => {
  it("renders each kind as a SINGLE imperative", () => {
    expect(renderAskText({ kind: "profile" })).toBe("MORE IN OUR BIO");
    expect(renderAskText({ kind: "dm", keyword: "salt" })).toBe("DM US SALT");
    expect(renderAskText({ kind: "save" })).toBe("SAVE THIS");
    expect(renderAskText({ kind: "visit" })).toBe("STOP BY NICK'S");
  });

  // The profile ask makes a claim about a DESTINATION this code cannot verify.
  // The live bio links the homepage, so "full breakdown" (an earlier draft)
  // would have promised topic-specific content that is not there.
  it("the profile ask does not over-claim what is at the destination", () => {
    expect(renderAskText({ kind: "profile" })).not.toMatch(/FULL BREAKDOWN|GUIDE|EVERYTHING/);
  });

  // The exact string that shipped on 1770003 must be unreachable.
  it("no kind can render the compound card that shipped", () => {
    for (const ask of [
      { kind: "profile" },
      { kind: "dm", keyword: "SALT" },
      { kind: "save" },
      { kind: "visit" },
    ] as ReelAsk[]) {
      const text = renderAskText(ask);
      expect(text, `${ask.kind} must not be compound`).not.toContain("|");
      expect(askProblem(ask)).toBeNull();
    }
    expect(renderAskText({ kind: "dm", keyword: "SALT" })).not.toBe('SAVE THIS | DM "SALT"');
  });

  it("REJECTS a compound ask however it is spelled", () => {
    // Simulates someone rebuilding the old behaviour through the keyword.
    for (const kw of ['SALT" | SAVE THIS', "SALT AND SAVE", "SALT + SAVE"]) {
      const problem = askProblem({ kind: "dm", keyword: kw });
      expect(problem, `keyword ${JSON.stringify(kw)} should be refused`).toMatch(/COMPOUND/);
    }
  });

  it("REJECTS a dm ask with no keyword — 'DM US' alone is not an ask", () => {
    expect(askProblem({ kind: "dm", keyword: "" })).toMatch(/needs a keyword/);
    expect(askProblem({ kind: "dm" })).toMatch(/needs a keyword/);
  });

  // The design constraint with evidence behind it: Meta's media endpoint has no
  // link parameter and Reel captions render URLs as unclickable text, so the
  // profile is the ONLY route to a landing page.
  it("the profile ask needs no keyword and no automation", () => {
    expect(askProblem({ kind: "profile" })).toBeNull();
    expect(renderAskText({ kind: "profile" })).toMatch(/BIO/);
  });

  describe("resolveReelAsk", () => {
    it("a DECLARED ask wins outright", () => {
      const ask = resolveReelAsk({ ask: { kind: "profile" }, campaignKeyword: "SALT" });
      expect(ask).toEqual({ kind: "profile" });
    });

    // THE ASYMMETRY. `dm` promises an interaction nothing currently answers —
    // there is no keyword automation in this codebase, and the live SALT reel
    // is the proof. So it must be declared deliberately and can NEVER arrive by
    // default or by inference. An earlier version derived it from
    // campaignKeyword; that silently produced the one ask nobody answers.
    it("NEVER infers a dm ask from a legacy campaignKeyword", () => {
      const ask = resolveReelAsk({ campaignKeyword: "SALT" } as never);
      expect(ask).toBeNull();
    });

    it("permits dm only when it is explicitly declared", () => {
      expect(resolveReelAsk({ ask: { kind: "dm", keyword: "SALT" } })).toEqual({ kind: "dm", keyword: "SALT" });
    });

    // Nothing declared => no card. This is what keeps a payload review
    // sufficient: a brief that declares no ask must not render one anyway.
    it("returns null when nothing declares an ask", () => {
      expect(resolveReelAsk({})).toBeNull();
      expect(resolveReelAsk(null)).toBeNull();
    });

    it("the generator default is profile, not dm", () => {
      expect(DEFAULT_REEL_ASK).toEqual({ kind: "profile" });
      expect(askProblem(DEFAULT_REEL_ASK)).toBeNull();
      expect(renderAskText(DEFAULT_REEL_ASK)).toMatch(/BIO/);
    });

    it("ignores a declared ask that is itself invalid rather than rendering it", () => {
      expect(resolveReelAsk({ ask: { kind: "dm", keyword: "" } })).toBeNull();
    });
  });
});

/* ── the truth gap: declaration vs filtergraph ─────────────────────────── */

const BRIEF = {
  storyboardBeats: [
    { beatNumber: 1, onScreenText: "That slow leak might not be a nail.", endSecond: 3 },
    { beatNumber: 2, onScreenText: "Cleveland salt creeps into the bead seat.", endSecond: 6 },
  ],
  campaignKeyword: "SALT",
};

const segs = briefToSegments(BRIEF as never);
const baseOpts = {
  segs,
  clipPaths: segs.map((_, i) => `/t/c${i}.mp4`),
  voPath: null,
  musicPath: null,
  assPath: null,
  fontPath: "/f/font.ttf",
  outPath: "/t/out.mp4",
};

describe("every rendered card is declared", () => {
  // POSITIVE CONTROL FIRST. If a correct render does not pass, every rejection
  // below proves nothing.
  it("PASSES a render whose filtergraph draws exactly the declared surfaces", () => {
    const askText = renderAskText({ kind: "profile" });
    const declared = declaredTextSurfaces(segs, askText);
    const args = buildFfmpegArgs({ ...baseOpts, askText });
    expect(undeclaredTextProblem(args, declared)).toBeNull();
  });

  it("PASSES a render with no ask and no end card", () => {
    const declared = declaredTextSurfaces(segs, null);
    const args = buildFfmpegArgs({ ...baseOpts, askText: null });
    expect(undeclaredTextProblem(args, declared)).toBeNull();
    expect(filtergraphTextSources(args).textfiles).not.toContain("caption_save.txt");
  });

  // THE 1770003 DEFECT, reproduced exactly: the render draws an end card the
  // declaration does not contain.
  it("CATCHES an end card the storyboard never declared", () => {
    const declared = declaredTextSurfaces(segs, null); // storyboard declares no ask
    const args = buildFfmpegArgs({ ...baseOpts, askText: 'SAVE THIS | DM "SALT"' }); // render draws one
    const problem = undeclaredTextProblem(args, declared);
    expect(problem).toMatch(/caption_save\.txt/);
    expect(problem).toMatch(/does not declare/);
  });

  it("CATCHES a beat card the declaration does not contain", () => {
    const askText = renderAskText({ kind: "save" });
    const declared = declaredTextSurfaces(segs, askText).slice(0, -2); // drop a declared beat line
    const args = buildFfmpegArgs({ ...baseOpts, askText });
    expect(undeclaredTextProblem(args, declared)).toBeTruthy();
  });

  // The other direction of drift: the payload over-describes the render, so a
  // reviewer approves words the viewer never sees.
  it("CATCHES a declared card the render never draws", () => {
    const declared = [
      ...declaredTextSurfaces(segs, null),
      { file: "caption_ghost.txt", text: "words nobody will see" },
    ];
    const args = buildFfmpegArgs({ ...baseOpts, askText: null });
    expect(undeclaredTextProblem(args, declared)).toMatch(/never draws/);
  });

  // Inline text bypasses the file list entirely - the obvious way to reopen
  // this hole without touching the declaration.
  it("CATCHES inline drawtext that bypasses the declared file list", () => {
    const declared = declaredTextSurfaces(segs, null);
    const args = [...buildFfmpegArgs({ ...baseOpts, askText: null }), "-vf", "drawtext=text='CALL NOW'"];
    expect(undeclaredTextProblem(args, declared)).toMatch(/INLINE/);
  });

  // The second burn-in mechanism: VO word-timed subtitles, which REPLACE the
  // per-beat drawtext rather than adding to it.
  it("CATCHES burned-in subtitles when no voiceover is declared", () => {
    const declared = declaredTextSurfaces(segs, null, true);
    const args = buildFfmpegArgs({ ...baseOpts, askText: null, assPath: "/t/captions.ass" });
    expect(undeclaredTextProblem(args, declared, false)).toMatch(/no voiceover/);
    // POSITIVE CONTROL: with a declared VO the same render is fine.
    expect(undeclaredTextProblem(args, declared, true)).toBeNull();
  });

  it("declares NO caption files when subtitles carry the beat text", () => {
    const viaSubs = declaredTextSurfaces(segs, "SAVE THIS", true).map((s) => s.file);
    expect(viaSubs).toEqual(["caption_save.txt"]);
    // POSITIVE CONTROL: without subtitles the caption files ARE declared.
    expect(declaredTextSurfaces(segs, "SAVE THIS", false).length).toBeGreaterThan(1);
  });
});

describe("declaredTextSurfaces mirrors the assembler's file layout", () => {
  it("declares one file per caption LINE, matching per-line drawtext", () => {
    const multi = [{ caption: "line one\nline two" }, { caption: "solo" }];
    expect(declaredTextSurfaces(multi, null).map((s) => s.file)).toEqual([
      "caption_0_0.txt",
      "caption_0_1.txt",
      "caption_1_0.txt",
    ]);
  });

  it("appends the end card only when an ask exists", () => {
    expect(declaredTextSurfaces([{ caption: "a" }], "SAVE THIS").map((s) => s.file)).toContain("caption_save.txt");
    expect(declaredTextSurfaces([{ caption: "a" }], null).map((s) => s.file)).not.toContain("caption_save.txt");
    expect(declaredTextSurfaces([{ caption: "a" }], "").map((s) => s.file)).not.toContain("caption_save.txt");
  });
});

/* ── the ask must not leak into content surfaces ────────────────────────── */

import { askLeakageProblem, askSignals } from "@shared/reelAsk";

/**
 * MEASURED 2026-08-29 on three freshly generated briefs. Every one of them put
 * "Comment <KEYWORD>" into storyboard beat 5 AND into the voiceover, and every
 * caption carried three competing asks. The declared end-card ask governed the
 * end card only — the model wrote its own CTA straight into the pixels through
 * a door the end-card fix never covered. The master prompt was the cause: it
 * literally specified "soft CTA: DM/comment the campaign keyword + business
 * close (phone / address / website)".
 *
 * The fixtures below are the REAL generated strings.
 */
describe("a CTA must never reach a beat or the voiceover", () => {
  const REAL_BEATS = [
    "Cuyahoga County E-Check:",
    "A lit check engine light doesn't stop your test.",
    "It just fails it.",
    "Get the code read before you test.",
    "Comment ECHECK and we'll take a look.",
  ];

  it("CATCHES the CTA beat that generation actually produced", () => {
    const p = askLeakageProblem({ beats: REAL_BEATS });
    expect(p).toMatch(/beat 5/);
    expect(p).toMatch(/comment-keyword/);
  });

  it("CATCHES a spoken CTA — unreachable by any later copy edit", () => {
    const p = askLeakageProblem({
      voiceoverScript: "Get the code read first. Then test with the light off. Comment ECHECK and we'll take a look.",
    });
    expect(p).toMatch(/voiceover/);
  });

  it("CATCHES the three competing asks in the real generated caption", () => {
    const caption =
      "That check engine light won't stop your Cuyahoga County E-Check. Get the code read before you test. " +
      "Send this to someone whose E-Check is coming up. Comment ECHECK and we'll take a look. (216) 862-0005";
    expect(askSignals(caption)).toHaveLength(3);
    expect(askLeakageProblem({ caption })).toMatch(/3 competing asks/);
  });

  // POSITIVE CONTROLS. Content that teaches and asks nothing must pass, or the
  // guard blocks every brief and gets switched off.
  it("PASSES beats that teach and ask nothing", () => {
    expect(
      askLeakageProblem({
        beats: REAL_BEATS.slice(0, 4),
        voiceoverScript: "In Cuyahoga County, a lit check engine light doesn't stop your E-Check. It just fails it.",
        caption: "That check engine light won't stop your Cuyahoga County E-Check. It just fails it.",
      }),
    ).toBeNull();
  });

  it("PERMITS exactly one ask in the caption", () => {
    expect(askLeakageProblem({ caption: "Your tire may be leaking at the wheel. More in our bio." })).toBeNull();
    expect(askSignals("More in our bio.")).toEqual(["link-in-bio"]);
  });

  it("counts a phone number as an ask — it competes with the declared one", () => {
    expect(askSignals("Call today (216) 862-0005")).toContain("call-us");
  });

  it("does not fire on ordinary teaching copy", () => {
    for (const s of [
      "Cleveland salt creeps into the bead seat.",
      "A lit check engine light doesn't stop your test.",
      "Alignment is NOT balancing.",
    ]) expect(askSignals(s), s).toEqual([]);
  });
});

/**
 * ONE ASK PER REEL MEANS ACROSS SURFACES.
 *
 * Found by reading a generated brief on 2026-08-29: it declared `ask: profile`
 * (end card renders "MORE IN OUR BIO") while its caption said "Send this to
 * someone whose light is on." Every existing check passed — the caption held
 * exactly one ask and no beat carried a CTA — yet the reel asked for two
 * different things in two places. The rule was broken through a third door.
 */
describe("the caption's ask must agree with the end card", () => {
  const BEATS = ["That light?", "It won't pass E-Check."];

  it("CATCHES the real mismatch: profile end card, share caption", () => {
    const p = askLeakageProblem({
      beats: BEATS,
      caption: "That check engine light? Send this to someone whose light is on.",
      declaredAsk: { kind: "profile" },
    });
    expect(p).toMatch(/two different asks on two/);
    expect(p).toMatch(/send-this-to/);
  });

  it("CATCHES a dm caption under a profile end card", () => {
    expect(
      askLeakageProblem({ beats: BEATS, caption: "DM us ECHECK.", declaredAsk: { kind: "profile" } }),
    ).toMatch(/two different asks/);
  });

  // POSITIVE CONTROLS — three of them, because this check has three ways to be
  // satisfied and a guard that blocked all captions would pass the two above.
  it("PERMITS a caption whose ask IS the declared ask", () => {
    expect(
      askLeakageProblem({ beats: BEATS, caption: "More in our bio.", declaredAsk: { kind: "profile" } }),
    ).toBeNull();
    expect(
      askLeakageProblem({ beats: BEATS, caption: "DM us ECHECK.", declaredAsk: { kind: "dm", keyword: "ECHECK" } }),
    ).toBeNull();
  });

  it("PERMITS a caption with NO ask — the end card carries it", () => {
    expect(
      askLeakageProblem({
        beats: BEATS,
        caption: "That check engine light won't pass E-Check in Cuyahoga. Retests are free.",
        declaredAsk: { kind: "profile" },
      }),
    ).toBeNull();
  });

  it("stays silent when no ask is declared — nothing to be inconsistent with", () => {
    expect(askLeakageProblem({ beats: BEATS, caption: "Send this to a friend." })).toBeNull();
  });
});

/**
 * THE SAME VERDICT, BEFORE THE SPEND (2026-10-10). Job 2070005 declared
 * `profile` and captioned "Send this to someone whose tires look smooth."
 * Enqueue accepted it, five clips were paid for, and assembly refused the
 * mismatch three times in one pulse. `captionAskMismatch` is the cross-surface
 * rule on its own so enqueue can run it; `stripCaptionAsks` is how the
 * generator stops producing the shape in the first place.
 */
describe("captionAskMismatch is the cross-surface rule, callable before any clip is bought", () => {
  const PROD = "Smooth tires in Cleveland snow are a slide waiting to happen. Send this to someone whose tires look smooth.";

  it("CATCHES the production shape", () => {
    expect(captionAskMismatch(PROD, { kind: "profile" })).toMatch(/two different asks on two/);
  });

  it("CONTROL: same ask on both surfaces, or no declared ask, or no caption ask — null", () => {
    expect(captionAskMismatch(PROD, { kind: "save" })).toBeNull();
    expect(captionAskMismatch(PROD, null)).toBeNull();
    expect(captionAskMismatch("Smooth tires in Cleveland snow are a slide waiting to happen.", { kind: "profile" })).toBeNull();
  });

  it("is exactly what askLeakageProblem reports for a one-ask caption", () => {
    expect(askLeakageProblem({ beats: ["That light?"], caption: PROD, declaredAsk: { kind: "profile" } })).toBe(
      captionAskMismatch(PROD, { kind: "profile" }),
    );
  });
});

describe("stripCaptionAsks makes a generated caption agree with the declared end card", () => {
  it("removes the sentence that asks for something else and keeps the rest, line breaks included", () => {
    const out = stripCaptionAsks(
      "Smooth tires in Cleveland snow are a slide waiting to happen. Send this to someone whose tires look smooth.\n#UsedTiresEuclid #Cleveland",
      { kind: "profile" },
    );
    expect(out).toBe("Smooth tires in Cleveland snow are a slide waiting to happen.\n#UsedTiresEuclid #Cleveland");
    expect(captionAskMismatch(out, { kind: "profile" })).toBeNull();
  });

  it("drops every foreign ask, not just the first (the sample caption's comment / stop by / phone line)", () => {
    const out = stripCaptionAsks(
      "The biggest number on your tire is a trap.\nComment PRESSURE and we'll check it when you stop by.\nNick's Tire & Auto - 17625 Euclid Ave, Cleveland - (216) 862-0005 - nickstire.org",
      { kind: "profile" },
    );
    expect(out).toBe("The biggest number on your tire is a trap.");
    expect(askSignals(out)).toEqual([]);
  });

  it("CONTROL: keeps an ask that IS the declared one, and leaves an ask-free caption byte-identical", () => {
    const send = "Bald tires? Send this to someone whose tires look smooth.";
    expect(stripCaptionAsks(send, { kind: "save" })).toBe(send);
    expect(stripCaptionAsks("More in our bio.", { kind: "profile" })).toBe("More in our bio.");
    const plain = "Smooth tires in Cleveland snow are a slide waiting to happen.\n\n#UsedTiresEuclid";
    expect(stripCaptionAsks(plain, { kind: "profile" })).toBe(plain);
    expect(stripCaptionAsks(send, null)).toBe(send);
  });

  it("returns the caption untouched when stripping would leave nothing — enqueue refuses it loudly instead", () => {
    expect(stripCaptionAsks("Send this to someone whose tires look smooth.", { kind: "profile" })).toBe(
      "Send this to someone whose tires look smooth.",
    );
  });
});
