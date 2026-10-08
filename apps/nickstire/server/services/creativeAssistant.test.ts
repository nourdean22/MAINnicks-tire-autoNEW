/**
 * Creative Assistant — deterministic ranking + the omission rule.
 *
 * Positive control first: the fixture below produces the five everyday card types
 * from real-shaped signals, so a later refactor that silently drops a card
 * fails here rather than rendering an emptier Today tab. The error tests
 * then prove a failed read becomes `inputs.<source> = "error: …"` and
 * removes exactly the cards that depend on it — never a confident zero.
 */
import { describe, it, expect } from "vitest";
import {
  buildCreativeAssistant,
  composeCreativeCards,
  computeFormatFit,
  significantWords,
  type AssistantReaders,
  type GatheredInputs,
  type PostRecord,
} from "./creativeAssistant";
import type { RecentReelSignals } from "./reelRepetitionHistory";

const ok = <T,>(value: T) => ({ ok: true as const, value });
const err = (error: string) => ({ ok: false as const, error });

const ledger: RecentReelSignals = {
  topics: ["bald tires in rain", "brake squeal", "battery in freeze", "pothole bent rim"],
  keywords: [], archetypes: ["myth_bust", "myth_bust", "myth_bust", "reveal"], motionLenses: [], objectCharacters: [],
  hookGrammars: ["symptom_question", "symptom_question", "symptom_question", "symptom_question"],
  structurePatternIds: ["pat-1", "pat-1"],
  ctaFamilies: ["send", "send", "profile", "send"],
  durationBuckets: ["20s", "20s", "20s", "20s"],
  topicAges: [
    { topic: "bald tires in rain", daysAgo: 2 },
    { topic: "brake squeal", daysAgo: 9 },
    { topic: "battery in freeze", daysAgo: 15 },
    { topic: "pothole bent rim", daysAgo: 20 },
  ],
  available: true,
};

const posts: PostRecord[] = [
  { postId: "c1", postType: "CAROUSEL_ALBUM", caption: "Winter tire checklist", reach: 1000, saved: 40, shares: 5 },
  { postId: "c2", postType: "CAROUSEL_ALBUM", caption: "Brake pad wear guide", reach: 800, saved: 30, shares: 2 },
  { postId: "c3", postType: "CAROUSEL_ALBUM", caption: "E-check prep", reach: 900, saved: 36, shares: 3 },
  { postId: "i1", postType: "IMAGE", caption: "Shop photo", reach: 1000, saved: 10, shares: 1 },
  { postId: "i2", postType: "IMAGE", caption: "Another shop photo", reach: 1000, saved: 20, shares: 0 },
  { postId: "i3", postType: "IMAGE", caption: "Team", reach: 500, saved: 10, shares: 0 },
  { postId: "r1", postType: "REELS", caption: "Grinding brakes means metal on metal — send this to a friend", reach: 5000, saved: 3, shares: 90 },
];

function fixture(over: Partial<GatheredInputs> = {}): GatheredInputs {
  return {
    topicSignals: ok({
      customerQuestions: ["is my e-check ready", "e-check not ready yet", "why is my tire light on", "e-check readiness after battery"],
      gscRising: [{ query: "e-check not ready ohio", impressions: 412, delta7d: 0.38, position: 11 }],
      declinedWork: ["rear brake pads and rotors", "serpentine belt"],
      failed: [],
    }),
    ledger: ok(ledger),
    posts: ok(posts),
    qaOutcomes: ok([]),
    realEvidence: ok({ windowDays: 30, published: 14, withReal: 2 }),
    realAssets: ok({ count: 12, assets: [{ id: 7, label: "brake-rotor-worn real-brake-pads.jpg" }], captures: [] }),
    experiments: ok([]),
    articles: ok({
      articles: [{ slug: "ohio-e-check-not-ready", title: "Ohio E-Check Not Ready: What It Means", publishDate: "2026-09-10" }],
      social: [{ topic: "brake squeal", hookText: "That squeal is a wear indicator" }],
    }),
    weather: ok(["first hard freeze"]),
    ...over,
  };
}

describe("composeCreativeCards — positive control", () => {
  const result = composeCreativeCards(fixture(), new Date("2026-10-01T12:00:00Z"));
  const byType = Object.fromEntries(result.cards.map((c) => [c.type, c]));

  it("emits all five card types, at most five cards", () => {
    expect(result.cards.map((c) => c.type)).toEqual(["opportunity", "capture", "fatigue", "experiment", "reuse"]);
    expect(result.cards.length).toBeLessThanOrEqual(5);
  });

  it("ranks e-check on top: three question mentions + a rising GSC query, never covered, carousel format", () => {
    const opp = byType.opportunity;
    expect(opp.title).toMatch(/e-check/i);
    expect(opp.format).toBe("carousel");
    expect(opp.why).toContain('GSC "e-check not ready ohio" 412 impressions, +38% 7d, position 11');
    expect(opp.why.some((w) => /customer questions? \(calls\/DMs\/forms\)/.test(w))).toBe(true);
    expect(opp.why).toContain("not covered in the last 21 days");
    expect(opp.why.some((w) => w.startsWith("carousels earn") && w.includes("saves/reach vs images (90d, n=3/3)"))).toBe(true);
    expect(opp.confidence).toBe("high");
    expect(opp.why.join(" ")).not.toMatch(/AI recommends/i);
    expect(opp.firstAction).toContain("carousel");
  });

  it("derives a capture card when the top opportunity has no real-shop asset", () => {
    expect(byType.capture.title).toMatch(/Shoot real-shop photos/);
    expect(byType.capture.why).toContain("real-shop pool: 12 reusable images");
  });

  it("fatigue names the most-repeated dimension value with its count", () => {
    expect(byType.fatigue.title).toBe('hook grammar "symptom_question" used 4x in 21 days');
    expect(byType.fatigue.why.length).toBeLessThanOrEqual(4);
    expect(byType.fatigue.why[0]).toMatch(/used 4x in 21 days \(4 reel jobs in window\)/);
    // Ties at 3x (archetype, CTA family) follow on their own lines.
    expect(byType.fatigue.why.some((w) => w.startsWith('archetype "myth_bust" used 3x'))).toBe(true);
    expect(byType.fatigue.firstAction).toBe('Exclude hook grammar "symptom_question" from the next brief');
  });

  it("recommends duration_v1 when every recent reel declared one duration and nothing is running", () => {
    expect(byType.experiment.preset).toBe("duration_v1");
    expect(byType.experiment.why).toContain("4 recent reel jobs all declared ~20s");
  });

  it("reuse flags the published article with no social derivative", () => {
    expect(byType.reuse.title).toMatch(/Ohio E-Check Not Ready/);
    expect(byType.reuse.format).toBe("carousel");
  });

  it("records a measured count per source in inputs", () => {
    expect(result.inputs).toMatchObject({ topicSignals: 7, ledger: 4, posts: 7, realAssets: 12, experiments: 0, articles: 1, weather: 1 });
    expect(String(result.inputs.formatFit)).toMatch(/^carousel .*x saves\/reach vs image \(n=3\/3\)$/);
  });
});

describe("a failed sub-source inside topic signals is visible on the card", () => {
  it("adds the line, caps confidence at medium, and records the names in inputs", () => {
    const g = fixture();
    (g.topicSignals as { ok: true; value: { failed: string[] } }).value.failed = ["declined_work"];
    const r = composeCreativeCards(g);
    const opp = r.cards.find((c) => c.type === "opportunity")!;
    expect(opp.confidence).toBe("medium");
    expect(opp.why).toContain("signal sources unreadable: declined_work — ranking incomplete");
    expect(r.inputs.topicSignalsFailed).toBe("declined_work");
  });
});

describe("ranking is multiplicative in freshness", () => {
  it("a covered topic loses to an uncovered one with less raw demand", () => {
    const g = fixture({
      topicSignals: ok({
        customerQuestions: ["bald tires in rain", "bald tires in rain", "bald tires in rain", "bald tires in rain", "bald tires in rain"],
        gscRising: [{ query: "serpentine belt squeal", impressions: 50 }],
        declinedWork: ["serpentine belt"],
        failed: [],
      }),
      weather: ok([]),
    });
    const opp = composeCreativeCards(g).cards.find((c) => c.type === "opportunity")!;
    expect(opp.title).toMatch(/serpentine/);
    expect(opp.why).toContain("not covered in the last 21 days");
    // The louder candidate is the one covered 2 days ago; it would win on demand alone.
    const loud = composeCreativeCards(fixture({ ...g, ledger: ok({ ...ledger, topicAges: [], topics: [] }) })).cards[0];
    expect(loud.title).toMatch(/bald tires/);
  });
});

describe("the omission rule — a failed read is never a zero", () => {
  it("topic signals error: no opportunity card, inputs.topicSignals = error", () => {
    const r = composeCreativeCards(fixture({ topicSignals: err("ECONNREFUSED") }));
    expect(r.inputs.topicSignals).toBe("error: ECONNREFUSED");
    expect(r.cards.some((c) => c.type === "opportunity")).toBe(false);
    // Independent cards survive.
    expect(r.cards.some((c) => c.type === "fatigue")).toBe(true);
  });

  it("ledger error: no fatigue card, opportunity drops to low confidence with the reason stated", () => {
    const r = composeCreativeCards(fixture({ ledger: err("timeout") }));
    expect(r.inputs.ledger).toBe("error: timeout");
    expect(r.cards.some((c) => c.type === "fatigue")).toBe(false);
    const opp = r.cards.find((c) => c.type === "opportunity")!;
    expect(opp.confidence).toBe("low");
    expect(opp.why).toContain("repetition ledger unreadable — freshness unknown");
  });

  it("ledger available:false (DB down inside the ledger) is treated as an error, not an empty window", () => {
    const r = composeCreativeCards(fixture({ ledger: ok({ ...ledger, topics: [], topicAges: [], hookGrammars: [], available: false }) }));
    expect(r.inputs.ledger).toBe("error: repetition ledger unavailable");
    expect(r.cards.some((c) => c.type === "fatigue")).toBe(false);
  });

  it("posts error: format fit reads as error, the opportunity defaults to reel and says why", () => {
    const r = composeCreativeCards(fixture({ posts: err("snapshots unreadable") }));
    expect(r.inputs.formatFit).toBe("error: snapshots unreadable");
    const opp = r.cards.find((c) => c.type === "opportunity")!;
    expect(opp.format).toBe("reel");
    expect(opp.why.some((w) => w.startsWith("format fit unknown"))).toBe(true);
  });

  it("too few posts per format is UNKNOWN, distinct from an error", () => {
    expect(computeFormatFit(posts.slice(0, 2))).toBeNull();
    const r = composeCreativeCards(fixture({ posts: ok(posts.slice(0, 2)) }));
    expect(r.inputs.formatFit).toBe("unknown");
  });

  it("real assets error: no capture card, evidence line says the pool was unreadable", () => {
    const r = composeCreativeCards(fixture({ realAssets: err("no database") }));
    expect(r.cards.some((c) => c.type === "capture")).toBe(false);
    expect(r.cards.find((c) => c.type === "opportunity")!.why).toContain("real-shop asset pool unreadable — AI visual assumed");
  });

  it("experiments error: no experiment card even though the ledger would recommend one", () => {
    const r = composeCreativeCards(fixture({ experiments: err("registry unavailable") }));
    expect(r.inputs.experiments).toBe("error: registry unavailable");
    expect(r.cards.some((c) => c.type === "experiment")).toBe(false);
  });

  it("articles error: no reuse card", () => {
    const r = composeCreativeCards(fixture({ articles: err("boom") }));
    expect(r.cards.some((c) => c.type === "reuse")).toBe(false);
  });
});

describe("experiment card for a running experiment that lacks samples", () => {
  it("names the thinnest arm against MIN_SAMPLES_PER_ARM", () => {
    const r = composeCreativeCards(fixture({
      experiments: ok([{ experimentId: "duration-lane-v1", primaryVariable: "length_band", primaryMetric: "shares_per_reach", arms: 3, thinnestArm: 1, attached: 5 }]),
    }));
    const card = r.cards.find((c) => c.type === "experiment")!;
    expect(card.title).toBe("Experiment running: duration-lane-v1");
    expect(card.why[0]).toBe("5 published episodes attached across 3 arms; thinnest arm 1/4 needed for a verdict");
    expect(card.preset).toBeUndefined();
  });
});

describe("reuse falls back to a social winner without an article", () => {
  it("picks the top-shares post whose caption no article covers", () => {
    const r = composeCreativeCards(fixture({
      articles: ok({
        articles: [{ slug: "ohio-e-check-not-ready", title: "Ohio E-Check Not Ready: What It Means", publishDate: "2026-09-10" }],
        social: [{ topic: "ohio e-check not ready", hookText: "what it means" }],
      }),
    }));
    const card = r.cards.find((c) => c.type === "reuse")!;
    expect(card.format).toBe("article");
    expect(card.why[0]).toBe("post r1: 90 shares / 5000 reach (latest 90d snapshot)");
  });
});

describe("buildCreativeAssistant with injected readers", () => {
  it("a throwing reader becomes an error input and its cards are omitted; the rest still render", async () => {
    const readers: AssistantReaders = {
      topicSignals: async () => ({ customerQuestions: ["tire light on"], gscRising: [], declinedWork: [], failed: [] }),
      ledger: async () => ledger,
      posts: async () => { throw new Error("snapshot read failed"); },
      realAssets: async () => ({ count: 0, assets: [], captures: [] }),
      experiments: async () => [],
      articles: async () => ({ articles: [], social: [] }),
      weather: async () => { throw new Error("NWS 503"); },
      qaOutcomes: async () => [],
      realEvidence: async () => ({ windowDays: 30, published: 0, withReal: 0 }),
    };
    const r = await buildCreativeAssistant(readers, new Date("2026-10-01T12:00:00Z"));
    expect(r.generatedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(r.inputs.posts).toBe("error: snapshot read failed");
    expect(r.inputs.weather).toBe("error: NWS 503");
    expect(r.cards.find((c) => c.type === "opportunity")?.title).toBe("tire light on");
    expect(r.cards.find((c) => c.type === "capture")?.confidence).toBe("high");
  });

  it("captureOpportunities output, when present, is preferred over the derived capture card", async () => {
    const base = fixture();
    const r = composeCreativeCards({
      ...base,
      realAssets: ok({ count: 3, assets: [], captures: [{ title: "Capture: worn rotor on the lift", why: ["bay 2 has a rotor job Thursday"], firstAction: "Shoot it Thursday" }] }),
    });
    const card = r.cards.find((c) => c.type === "capture")!;
    expect(card.title).toBe("Capture: worn rotor on the lift");
    expect(card.firstAction).toBe("Shoot it Thursday");
  });
});

describe("significantWords", () => {
  it("drops stopwords and short tokens", () => {
    expect(significantWords("Why is my E-Check not ready in Cleveland?")).toEqual(["check", "ready"]);
  });
});

describe("quality card: a critic finding the audience has priced (2026-10-08)", () => {
  const qa = (code: string, skips: number[], clean: number[]) => ok([
    ...skips.map((s, i) => ({ postId: `w${i}`, codes: [code], skipRate: s })),
    ...clean.map((s, i) => ({ postId: `c${i}`, codes: [], skipRate: s })),
  ]);

  it("appears only for a code whose posts are skipped significantly more, with the measured numbers", () => {
    const r = composeCreativeCards(fixture({ qaOutcomes: qa("PLASTIC_AI_LOOK", [88, 91, 86, 90, 89], [52, 48, 55, 50, 47, 53]) }));
    const card = r.cards.find((c) => c.type === "quality");
    expect(card?.title).toBe('Critic finding "PLASTIC_AI_LOOK" costs viewers');
    expect(card?.why[0]).toMatch(/PLASTIC_AI_LOOK: 5 posts with it skip 88\.8% vs 50\.8% for 6 without \(\+38\.0 pts, p=0\.\d{3} <= 0\.0500\)/);
    expect(card?.firstAction).toContain("PLASTIC_AI_LOOK");
    expect(r.inputs.qaOutcomes).toBe(11);
    expect(r.cards.length).toBeLessThanOrEqual(6);
  });

  it("a gap noise could explain, or too few posts, renders no card", () => {
    expect(composeCreativeCards(fixture({ qaOutcomes: qa("WEAK_COMPOSITION", [62, 58, 70, 55], [60, 57, 66, 54, 63]) })).cards.find((c) => c.type === "quality")).toBeUndefined();
    expect(composeCreativeCards(fixture({ qaOutcomes: qa("PLASTIC_AI_LOOK", [95, 96, 97], [40, 41, 42, 43]) })).cards.find((c) => c.type === "quality")).toBeUndefined();
  });

  it("a failed read is an error input, never a clean bill of health", () => {
    const r = composeCreativeCards(fixture({ qaOutcomes: err("reel_jobs read failed") }));
    expect(r.inputs.qaOutcomes).toBe("error: reel_jobs read failed");
    expect(r.cards.find((c) => c.type === "quality")).toBeUndefined();
  });
});

describe("real-evidence share: the shop adoption number (2026-10-08)", () => {
  it("is a provenance input and a line on the capture card, with the measured share", () => {
    const r = composeCreativeCards(fixture());
    expect(r.inputs.realEvidence).toBe("2/14 published pieces in 30d carried real shop evidence (14%)");
    expect(r.cards.find((c) => c.type === "capture")?.why).toContain("2/14 published pieces in 30d carried real shop evidence (14%)");
  });

  it("an empty window is unmeasured, never 0%", () => {
    const r = composeCreativeCards(fixture({ realEvidence: ok({ windowDays: 30, published: 0, withReal: 0 }) }));
    expect(r.inputs.realEvidence).toBe("no pieces published in 30d, so real-evidence share is unmeasured");
  });

  it("a failed read is an error input; the capture card still renders without the line", () => {
    const r = composeCreativeCards(fixture({ realEvidence: err("reel_jobs read failed") }));
    expect(r.inputs.realEvidence).toBe("error: reel_jobs read failed");
    const capture = r.cards.find((c) => c.type === "capture");
    expect(capture).toBeTruthy();
    expect(capture?.why.some((w) => w.includes("real shop evidence"))).toBe(false);
  });
});
