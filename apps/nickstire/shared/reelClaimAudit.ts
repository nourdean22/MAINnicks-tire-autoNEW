/**
 * Hand-audit of every rendered reel, expressed as an ENFORCED veto.
 *
 * WHY THIS IS CODE AND NOT A DOCUMENT. The ten rendered reels were audited by
 * hand on 2026-08-29 and three of them carry false or overstated factual
 * claims. A report saying so does not stop an armed publish pipeline; only a
 * check at the door does. So the verdicts live here, the publish door reads
 * them, and the canary proves a condemned job is actually refused.
 *
 * WHY BY HAND. The first pass used a claim-risk regex. It flagged 2 of 10,
 * MISSED job 1740004's "pull you off the road" (the pattern said "keep you off
 * the road"), and produced a false positive on 1770001 ("you have probably
 * never seen" is not a claim). That instrument is not reused here - each reel
 * was read as three separate surfaces: the voiceover transcript, the burned-in
 * on-screen text, and the caption. The distinction matters because a defect in
 * the caption is editable and a defect in the audio or the frame is not.
 *
 * HOW THIS LAYERS WITH THE APPROVAL GATE. `reelApproval.ts` is default-deny:
 * nothing publishes without a recorded human yes, including jobs absent from
 * this table. THIS module is the narrower veto that outranks a yes - an
 * operator cannot approve away a false claim about Ohio law. Unaudited jobs are
 * not blocked here because the approval gate already holds them.
 *
 * SOURCE TIERS ARE STATED, NOT IMPLIED. "regulator" is a government primary
 * source. "trade" is multiple independent industry sources where no regulator
 * publishes on the topic. "first_party" is the shop's own centralised record.
 * A claim with no source that survives is marked `unverified` and BLOCKS -
 * an unverified claim is not a clean claim.
 */

export type ReelClaimVerdict =
  /** Every surface checked, every claim sourced. May publish once approved. */
  | "clean"
  /** Only defect is in the caption, which is editable before publish. */
  | "caption_repairable"
  /** Defect is burned into audio or pixels. Cannot be fixed by editing copy. */
  | "needs_rerender"
  /** Should not be republished in any form. */
  | "discard"
  /** A claim could not be sourced. Blocks until it is. */
  | "unverified";

/** Verdicts that must never publish, whatever an approval says. */
const CONDEMNED: readonly ReelClaimVerdict[] = ["needs_rerender", "discard", "unverified"];

export interface ReelClaimAuditEntry {
  jobId: number;
  verdict: ReelClaimVerdict;
  /** One line a human can act on. */
  summary: string;
  /** Which surface each defect lives on - this decides repairable vs re-render. */
  defects: Array<{ surface: "voiceover" | "onscreen_text" | "caption" | "asset"; detail: string }>;
  /** Claims cleared, each with where it was verified. */
  cleared: Array<{ claim: string; source: string; tier: "regulator" | "trade" | "first_party" }>;
}

/**
 * The audit. Job ids are stable primary keys in `reel_jobs`.
 *
 * Ohio E-Check facts used below, all from Ohio EPA's testing-information page
 * (fetched 2026-08-29):
 *   - "If the 'Check Engine' light is on, you will still be able to test the
 *     vehicle, however, you will receive a failing test."
 *   - "The seven Ohio counties currently participating in the program include:
 *     Cuyahoga, Geauga, Lake, Lorain, Medina, Portage, and Summit counties."
 *   - "Each vehicle is allowed three free tests within a 365-day period."
 * Ohio has 88 counties, so "in Ohio" is false for the other 81.
 */
export const REEL_CLAIM_AUDIT: Readonly<Record<number, ReelClaimAuditEntry>> = {
  1710001: {
    jobId: 1710001,
    verdict: "discard",
    summary:
      "Content claims are fine, but the asset is unpublishable twice over and 1770004 is the same script rendered clean.",
    defects: [
      { surface: "asset", detail: "3 of 5 clips resolve to reels/template-stock/ - stock_guard refuses it permanently" },
      { surface: "asset", detail: "carries a recorded ffmpeg re-assembly failure (exit 187, encoder could not open)" },
    ],
    cleared: [
      {
        claim: "worn suspension components cause uneven tire wear",
        source: "NHTSA tire maintenance best practices (MC-10176182-0001): uneven wear can result from damaged, worn, or misaligned suspension components",
        tier: "regulator",
      },
    ],
  },

  1740001: {
    jobId: 1740001,
    verdict: "needs_rerender",
    summary: "Burns the same Ohio-scope error into the on-screen text, and is stock-contaminated as well.",
    defects: [
      {
        surface: "onscreen_text",
        detail: 'stamps "In Ohio, that light = fail E-Check". E-Check runs in 7 of Ohio\'s 88 counties, so the claim is false statewide. Burned into the frame.',
      },
      { surface: "voiceover", detail: '"In Ohio, that light means you will fail E-Check" - same scope error, in the audio' },
      { surface: "asset", detail: "5 of 6 clips are template-stock; stock_guard refuses it regardless" },
    ],
    cleared: [
      {
        claim: "an illuminated check engine light produces a failing E-Check result",
        source: "Ohio EPA E-Check testing information: a lit Check Engine light means you will receive a failing test",
        tier: "regulator",
      },
    ],
  },

  1740002: {
    jobId: 1740002,
    verdict: "clean",
    summary: "All three surfaces check out. The ASE wording matches the shop's own approved phrasing.",
    defects: [],
    cleared: [
      {
        claim: "grinding on braking is pads worn past the friction material, backing plate contacting the rotor",
        source: "NHTSA brake system guidance; standard wear-indicator mechanics",
        tier: "regulator",
      },
      {
        claim: "ASE-certified",
        source: "shared/business.ts BUSINESS.ase - certified: true, short: 'ASE-certified'; the centralised approved wording, which forbids 'ASE Master Certified' and any count",
        tier: "first_party",
      },
    ],
  },

  1740003: {
    jobId: 1740003,
    verdict: "clean",
    summary: "Both numeric claims match NHTSA verbatim, including the placard-not-sidewall point most shops get wrong.",
    defects: [],
    cleared: [
      {
        claim: "tire pressure drops about 1 PSI per 10 degrees F",
        source: "NHTSA: tire pressure drops about 1 psi for every 10 degree F decrease in ambient temperature",
        tier: "regulator",
      },
      {
        claim: "the door jamb placard is the correct target pressure, not the sidewall",
        source: "NHTSA TireWise: recommended cold inflation pressure is on the vehicle's tire information placard (driver's side doorjamb), not the tire sidewall",
        tier: "regulator",
      },
    ],
  },

  1740004: {
    jobId: 1740004,
    verdict: "needs_rerender",
    summary: "Overstated outcome claim in the audio - a worn bushing does not pull a car off the road.",
    defects: [
      {
        surface: "voiceover",
        detail: '"Wait, and it will chew up your tire and pull you off the road" - asserts a loss-of-control outcome from a torn control-arm bushing. Alarmist and unsourceable. In the audio, so copy edits cannot reach it.',
      },
    ],
    cleared: [
      {
        claim: "a torn lower control arm bushing causes a clunk over bumps and accelerates tire wear",
        source: "NHTSA tire maintenance best practices (MC-10176182-0001): irregular wear results from damaged or worn suspension components",
        tier: "regulator",
      },
    ],
  },

  1770001: {
    jobId: 1770001,
    verdict: "needs_rerender",
    summary: "Claims are accurate and genuinely useful, but the rendered asset failed re-assembly - the file is not trustworthy.",
    defects: [
      {
        surface: "asset",
        detail: "recorded error: re-assembly failed, ffmpeg exit 187, libx264 could not open encoder (-22). The mp4 on disk is from a run that errored; integrity unproven.",
      },
    ],
    cleared: [
      {
        claim: "tires carry built-in tread wear indicator bars that sit flush with the tread when worn to the limit",
        source: "NHTSA TireWise treadwear guidance - wear indicator bars appear when tread reaches the minimum legal depth",
        tier: "regulator",
      },
    ],
  },

  1770002: {
    jobId: 1770002,
    verdict: "caption_repairable",
    summary: "No factual claim to verify - it is advice about asking for evidence. The caption's hashtags are malformed.",
    defects: [
      {
        surface: "caption",
        detail: 'hashtag block reads "clevelandautorepair tuneup diagnosis euclidohio nicks tire" with no # characters - the tags are inert plain words. Editable before publish.',
      },
    ],
    cleared: [
      {
        claim: "asking to see the failed part or the scan reading before authorising work",
        source: "no factual assertion about specs, law, or outcomes - consumer advice only, nothing to source",
        tier: "trade",
      },
    ],
  },

  1770003: {
    jobId: 1770003,
    verdict: "clean",
    summary: "Hedged throughout, locally specific, and the mechanism is corroborated. The recommended candidate.",
    defects: [],
    cleared: [
      {
        claim: "road salt corrodes the alloy wheel bead seat and can cause a slow leak with no puncture",
        source: "multiple independent wheel-refinishing and tire trade sources describe bead-seat oxidation lifting the bead and creating a micro-leak; no regulator publishes on this topic. The copy hedges ('might not be a nail', 'could be the culprit'), so it asserts a possibility rather than a fact.",
        tier: "trade",
      },
    ],
  },

  1770004: {
    jobId: 1770004,
    verdict: "clean",
    summary: "Same script as 1710001 but rendered entirely on generative clips with no stock contamination and no asset error.",
    defects: [],
    cleared: [
      {
        claim: "worn suspension parts throw off alignment and wear tires unevenly",
        source: "NHTSA tire maintenance best practices (MC-10176182-0001): uneven wear can result from damaged, worn, or misaligned suspension components",
        tier: "regulator",
      },
    ],
  },

  1770005: {
    jobId: 1770005,
    verdict: "needs_rerender",
    summary: "Three false claims, two of them burned into the audio and the frame. Not repairable by editing the caption.",
    defects: [
      {
        surface: "voiceover",
        detail: '"In Ohio, it is an automatic fail for your E-Check" - E-Check covers 7 of Ohio\'s 88 counties (Cuyahoga, Geauga, Lake, Lorain, Medina, Portage, Summit). False for the other 81.',
      },
      {
        surface: "voiceover",
        detail: '"even a minor sensor issue can keep you off the road" - a failed E-Check does not remove a vehicle from the road. Unsourceable.',
      },
      {
        surface: "onscreen_text",
        detail: '"Automatic E-Check FAILED." stamped into the frame, carrying the same statewide overreach.',
      },
      {
        surface: "caption",
        detail: '"Don\'t risk a retest" invents a cost. Ohio EPA: "Each vehicle is allowed three free tests within a 365-day period." The retest is free.',
      },
    ],
    cleared: [
      {
        claim: "an illuminated check engine light produces a failing E-Check result",
        source: "Ohio EPA E-Check testing information: a lit Check Engine light means you will receive a failing test",
        tier: "regulator",
      },
    ],
  },
};

/**
 * Why the audit forbids publishing this job, or null when it does not object.
 *
 * Returns null for unaudited jobs BY DESIGN - they are held by the approval
 * gate, which is default-deny. Blocking them here too would conflate "no claim
 * defect found" with "never looked", and would wrongly read as a second opinion.
 */
export function auditPublishBlock(jobId: number): string | null {
  const entry = REEL_CLAIM_AUDIT[jobId];
  if (!entry) return null;
  if (!CONDEMNED.includes(entry.verdict)) return null;
  const worst = entry.defects[0];
  return (
    `reel job ${jobId} is marked ${entry.verdict} by the 2026-08-29 claim audit: ${entry.summary}` +
    (worst ? ` First defect (${worst.surface}): ${worst.detail}` : "")
  );
}

/** Jobs the audit condemns. Exported so a report and the gate cannot disagree. */
export function condemnedJobIds(): number[] {
  return Object.values(REEL_CLAIM_AUDIT)
    .filter((e) => CONDEMNED.includes(e.verdict))
    .map((e) => e.jobId)
    .sort((a, b) => a - b);
}
