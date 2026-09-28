import type { ReelPattern } from "./reelPatterns";

/**
 * HOUSE HYPOTHESES, not external "winning references".
 *
 * Production Pattern Lab can legitimately be empty because capture is manual.
 * These four stable, original Nick's structures give the outcome loop something
 * to test without fabricating that we observed a creator or copied a winner.
 *
 * They are deliberately labeled unmeasured. The learning policy must earn the
 * right to prefer one from Instagram outcomes; until then rotation stays fair.
 */
export const HOUSE_REEL_PATTERN_SEEDS: readonly ReelPattern[] = [
  {
    id: "rp_house_forensic_macro",
    label: "House hypothesis · forensic macro reveal",
    sourceLabel: "Nick's house hypothesis · unmeasured bootstrap",
    hookType: "forensic_scan",
    pacing: { totalSeconds: 18, beatCount: 5, avgShotLength: 3.2, firstTextAtSecond: 0.5 },
    visualStyle: {
      lens: "extreme macro into mechanic-eye close detail",
      lighting: "hard shop task light with controlled falloff",
      color: "graphite, steel, restrained Nick's yellow accents",
      motion: "slow push-in, decisive match cuts, no decorative drift",
      texture: "real rubber, metal, dust, grease, tread and tool texture",
    },
    captionStyle: {
      wordsPerBeat: 5,
      placement: "upper third, clear of controls and the physical clue",
      hierarchy: "headline_subline",
    },
    audioStyle: {
      musicMood: "tense minimal pulse that leaves room for diagnosis",
      voiceover: true,
      sfx: ["ratchet click", "rubber scrub"],
    },
    loopType: "problem_loop",
    shareTrigger: "Send to the driver who keeps describing this exact symptom but does not know what to inspect.",
    saveTrigger: "A short visual checklist of physical clues worth checking again later.",
    nickAdaptation: "Open on one real automotive symptom in extreme macro. Reveal two or three physical clues that change the diagnosis, explain the safe next step without overclaiming, then return to the opening clue so the loop feels inevitable.",
  },
  {
    id: "rp_house_myth_reality",
    label: "House hypothesis · myth vs physical reality",
    sourceLabel: "Nick's house hypothesis · unmeasured bootstrap",
    hookType: "myth_vs_reality",
    pacing: { totalSeconds: 16, beatCount: 4, avgShotLength: 3.5, firstTextAtSecond: 0.4 },
    visualStyle: {
      lens: "tight before-after detail with one wider context frame",
      lighting: "clean neutral shop light, no fake dramatic failure state",
      color: "natural vehicle color with black and yellow graphic restraint",
      motion: "hard comparison cuts and one controlled reveal",
      texture: "documentary, tactile, visibly real shop surfaces",
    },
    captionStyle: {
      wordsPerBeat: 6,
      placement: "top-center with the compared object unobstructed",
      hierarchy: "kinetic",
    },
    audioStyle: {
      musicMood: "confident rhythmic build, not sensational",
      voiceover: true,
      sfx: ["impact tick", "air hiss"],
    },
    loopType: "question_loop",
    shareTrigger: "Send to someone repeating the common car myth shown in the opener.",
    saveTrigger: "The viewer gets one reusable rule for separating the myth from the physical evidence.",
    nickAdaptation: "Open with a familiar car-care belief as a question, immediately show the real physical evidence that supports or contradicts it, explain what actually changes the decision, and end by restating the opener as the next thing to inspect.",
  },
  {
    id: "rp_house_warning_countdown",
    label: "House hypothesis · warning countdown",
    sourceLabel: "Nick's house hypothesis · unmeasured bootstrap",
    hookType: "warning_alert",
    pacing: { totalSeconds: 18, beatCount: 5, avgShotLength: 3.0, firstTextAtSecond: 0.3 },
    visualStyle: {
      lens: "close symptom shots ordered from subtle to obvious",
      lighting: "real bay lighting with focused practical highlights",
      color: "mostly natural, amber warning emphasis only where useful",
      motion: "fast opening cut, then steady evidence-first progression",
      texture: "road wear, corrosion, fluid, rubber and metal as actually found",
    },
    captionStyle: {
      wordsPerBeat: 5,
      placement: "upper left or upper center, never over the evidence",
      hierarchy: "headline_only",
    },
    audioStyle: {
      musicMood: "measured urgency, no horror-trailer exaggeration",
      voiceover: true,
      sfx: ["warning chime", "tool tap"],
    },
    loopType: "cause_loop",
    shareTrigger: "Send to the person whose car is showing one of these warning signs.",
    saveTrigger: "A compact ordered list of symptoms and the sensible next inspection step.",
    nickAdaptation: "Use a short numbered progression of observable symptoms, moving from easy-to-miss to obvious. Tie each symptom to a grounded mechanic explanation, avoid fear language, give the safe inspection next step, and loop back to the first subtle sign.",
  },
  {
    id: "rp_house_useful_absurdity",
    label: "House hypothesis · useful absurd object",
    sourceLabel: "Nick's house hypothesis · unmeasured bootstrap",
    hookType: "impossible_object",
    pacing: { totalSeconds: 20, beatCount: 5, avgShotLength: 3.4, firstTextAtSecond: 0.5 },
    visualStyle: {
      lens: "cinematic object close-up followed by real-shop proof shots",
      lighting: "stylized first beat, grounded shop lighting immediately after",
      color: "dark graphite with a controlled yellow accent",
      motion: "one surreal pattern interrupt, then clean mechanical motion",
      texture: "stylized opener contrasted with real tire, brake, fluid or suspension texture",
    },
    captionStyle: {
      wordsPerBeat: 5,
      placement: "upper third with clean negative space",
      hierarchy: "headline_subline",
    },
    audioStyle: {
      musicMood: "playful tension resolving into confident utility",
      voiceover: true,
      sfx: ["comic mechanical click", "shop ambience"],
    },
    loopType: "object_loop",
    shareTrigger: "The absurd opening makes it sendable; the mechanic truth gives the sender a reason beyond the joke.",
    saveTrigger: "The payoff is a real diagnostic or maintenance rule the viewer can use later.",
    nickAdaptation: "Use one original absurd object or impossible visual only as the first-second pattern interrupt. Pivot immediately to a real mechanic truth, show physical evidence in the shop, solve a small useful problem, and return to the absurd object only as the loop—not as a fabricated claim.",
  },
] as const;
