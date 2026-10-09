/**
 * Disclosure gate for reel packs.
 *
 * TWO RULES, both hard failures. A pack that trips either one must not publish.
 *
 * RULE 1 - GENERATED FOOTAGE MAY NOT BE FRAMED AS REAL EVIDENCE.
 * AI-generated video presented as a real customer incident, a repair we
 * performed, a test we ran, or a before/after is a fabricated claim about the
 * shop's own work. It is the automotive equivalent of inventing a receipt, it
 * is made under the shop's name, and no engagement number justifies it.
 *
 * RULE 2 - GENERATED PHOTOREALISTIC VIDEO MUST CARRY AN AI DISCLOSURE.
 * Verified against Meta's own policy 2026-08-28: Meta "requires people to use a
 * disclosure and label tool when they post organic content with a photorealistic
 * video or realistic-sounding audio that was digitally created or altered, and
 * may apply penalties if they fail to do so." So an undisclosed generated reel
 * is a platform-policy violation as well as an honesty one.
 *
 * Pure and exported so the canary drives real behaviour with fixtures, including
 * a positive control - a gate that fails everything is worth nothing.
 */

/** Video providers whose output is synthetic. */
import { parseShotLineage } from "./reelSourceProfile";

export const GENERATIVE_PROVIDERS = [
  "higgsfield",
  "veo",
  "seedance",
  "kling",
  "wan",
  "sora",
  "gemini",
  "hailuo",
  "minimax",
  "runway",
  "pika",
];

/**
 * Framings that assert the footage documents something real that happened at,
 * or was performed by, the shop. Deliberately matched on the CLAIM, not on
 * topic words - "how to check tread depth" is educational and fine; "this
 * customer's tread was down to the wear bars" is a claim about a real event.
 */
const REAL_EVIDENCE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "real-customer", re: /\b(this|a|our|the)\s+(customer|client|driver|car|truck|vehicle)\s+(came|brought|pulled|rolled|drove)\b/i },
  { id: "customer-possessive", re: /\b(this|a)\s+(customer|client)('s|s')\b/i },
  { id: "we-performed-repair", re: /\b(we|our tech|our techs|the tech)\s+(fixed|repaired|replaced|swapped|rebuilt|installed)\b/i },
  { id: "we-tested", re: /\b(we|our team)\s+(tested|measured|ran a test|put .* to the test)\b/i },
  { id: "before-after", re: /\bbefore\s*(and|\/|\+|vs\.?|versus)\s*after\b/i },
  { id: "before-after-possessive", re: /\b(here'?s|this is)\s+the\s+(before|after)\b/i },
  { id: "came-into-shop", re: /\b(came|walked|rolled)\s+(in|into)\s+(the|our)\s+(shop|bay|store)\b/i },
  { id: "caught-on-camera", re: /\b(caught on (camera|video)|actual footage|real footage|security cam)\b/i },
  { id: "this-happened", re: /\b(this|it)\s+(happened|actually happened)\b/i },
  { id: "in-our-bay", re: /\b(in|from)\s+(our|the)\s+(bay|shop|lift|garage)\s+(today|yesterday|this week|last week)\b/i },
];

/** Tokens that count as an AI disclosure somewhere in the pack's copy. */
const DISCLOSURE_PATTERNS = [
  /\bAI[- ]generated\b/i,
  /\bgenerated with AI\b/i,
  /\bAI visuali[sz]ation\b/i,
  /\bAI illustration\b/i,
  /\bmade with AI\b/i,
  /\bsimulated\b/i,
  /\billustrative\b/i,
  /\bdramati[sz]ation\b/i,
];

export interface DisclosurePack {
  /** Pack identifier for the failure message. */
  id: string;
  /** Video provider, if any clip is model-generated. */
  videoProvider?: string | null;
  /** Explicit flag when the pack knows its footage is synthetic. */
  hasGeneratedVideo?: boolean;
  /** Caption, script, on-screen text - everything the viewer reads or hears. */
  copy: string;
  /** Set when the pack carries a machine-checked disclosure label. */
  disclosureLabel?: string | null;
  /**
   * The value that WILL be sent as Meta's `is_ai_generated` container parameter.
   * THIS is the platform disclosure mechanism - caption text is not.
   */
  apiDisclosureFlag?: boolean;
}

/** True when a provider name denotes a generative video model. */
export function isGenerativeProvider(provider: string | null | undefined): boolean {
  const p = (provider ?? "").toLowerCase().trim();
  if (!p) return false;
  return GENERATIVE_PROVIDERS.some((x) => p.includes(x));
}

/** True when any clip in the pack is model-generated. */
export function isGenerated(pack: DisclosurePack): boolean {
  if (pack.hasGeneratedVideo) return true;
  return isGenerativeProvider(pack.videoProvider);
}

/** True when the pack's copy or label discloses the footage is synthetic. */
export function hasDisclosure(pack: DisclosurePack): boolean {
  const hay = `${pack.copy ?? ""} ${pack.disclosureLabel ?? ""}`;
  return DISCLOSURE_PATTERNS.some((re) => re.test(hay));
}

/** Which real-evidence framings the copy asserts. Empty when it asserts none. */
export function realEvidenceClaims(copy: string): string[] {
  const text = copy ?? "";
  return REAL_EVIDENCE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}

/**
 * The judge: null when the pack may publish, otherwise the operator-facing
 * reason it must not. A refusal is a VALUE, not a throw, so the pack can record
 * exactly why it is blocked instead of failing into UNKNOWN.
 */
export function disclosureViolation(pack: DisclosurePack): string | null {
  const generated = isGenerated(pack);
  if (!generated) return null;

  const claims = realEvidenceClaims(pack.copy);
  if (claims.length > 0) {
    return (
      `BLOCKED_AI_PRESENTED_AS_REAL: pack "${pack.id}" contains model-generated video ` +
      `(provider: ${pack.videoProvider ?? "flagged"}) while its copy claims real evidence [${claims.join(", ")}]. ` +
      "Generated footage may never be framed as a real customer, repair, test, or before/after. " +
      "Fix: either shoot the real footage, or rewrite the copy so it makes no claim about a real event."
    );
  }

  // CORRECTED 2026-08-28 after checking Meta's current docs rather than trusting
  // a prior. The platform disclosure mechanism is the STRUCTURED container
  // parameter `is_ai_generated` (boolean, "An optional parameter to provide a
  // self-disclosure of AI usage in the post", valid for REELS) - not a sentence
  // in the caption. An earlier draft of this gate accepted caption text, which
  // would have passed a reel that Meta reads as undisclosed.
  if (pack.apiDisclosureFlag !== true) {
    return (
      `BLOCKED_MISSING_AI_DISCLOSURE: pack "${pack.id}" contains model-generated video ` +
      "but the publish call would not set Meta's is_ai_generated=true. Meta requires " +
      "self-disclosure on organic photorealistic generated video or realistic audio and " +
      "may apply penalties for its absence. " +
      (hasDisclosure(pack)
        ? "The caption mentions AI, but caption text is NOT the platform mechanism. "
        : "") +
      "Fix: pass is_ai_generated=true on the media container."
    );
  }

  return null;
}

/**
 * The container parameters this pack MUST publish with. Returned as data so the
 * publish path cannot forget the flag and the dry run can show it.
 */
export function requiredPublishParams(pack: DisclosurePack): { is_ai_generated?: true } {
  return isGenerated(pack) ? { is_ai_generated: true } : {};
}

/* ── Disclosure derived from the ARTIFACT, not from an environment variable ──
 *
 * THE DEFECT THIS REPLACES. `dailyReelPost` computed the flag as
 * `isGenerativeProvider(process.env.REEL_VIDEO_PROVIDER)` - the provider
 * configured RIGHT NOW, not the one that rendered the job being published.
 * Jobs sit in the backlog for days. Flip the lane to a stock provider while ten
 * Higgsfield-rendered reels are queued and every one of them publishes with no
 * `is_ai_generated`, which is a Meta policy violation on the owner's business
 * account, not a tidiness problem. The reverse is also wrong: leaving the env on
 * a generative lane forces a disclosure onto genuinely non-generative footage.
 *
 * The storage path is the honest source and we already trust it elsewhere - the
 * stock guard in `qualityGate.ts` rejects publishes on exactly this evidence,
 * because "the generator stamps it and no flag can forge it". Same evidence,
 * same authority, now also used for the disclosure it determines.
 */

/** Clip-path marker for the free stock lane. Real footage - NOT model output. */
const STOCK_PATH_MARKER = "template-stock";

/** The Higgsfield generator's filename stamp. */
const HIGGSFIELD_FILE_PREFIX = "hf_";

/**
 * Path segments of a URL, query and fragment removed.
 *
 * MATCHING IS SEGMENT-AWARE, NOT SUBSTRING. A bare `url.includes(provider)`
 * scan looked correct and was not: GENERATIVE_PROVIDERS contains "wan", "veo"
 * and "pika", and every clip URL here ends in a long random hash. "wan"
 * appears inside a hash roughly one time in ten, which would classify stock
 * footage as model-generated, force a false AI disclosure onto real video, and
 * do it intermittently - green on the fixtures, wrong in production.
 */
function pathSegments(url: string): string[] {
  return url.split(/[?#]/)[0].split("/").filter(Boolean);
}

function isGenerativeClipUrl(url: string): boolean {
  const segments = pathSegments(url);
  const filename = segments[segments.length - 1] ?? "";
  if (filename.startsWith(HIGGSFIELD_FILE_PREFIX)) return true;
  // A provider name must BE a segment or start one ("veo-abc", "runway_01"),
  // never merely appear inside a hash.
  return segments.some((seg) =>
    GENERATIVE_PROVIDERS.some((p) => seg === p || seg.startsWith(`${p}-`) || seg.startsWith(`${p}_`)),
  );
}

export type ClipProvenance = "generative" | "stock" | "unknown";

/**
 * What actually rendered these clips, read off the storage paths.
 *
 * ANY generative clip makes the whole reel generated - a reel is one artifact,
 * and a viewer cannot tell which three seconds came from a model.
 *
 * Stock is tested FIRST because its marker is an explicit, unambiguous path the
 * stock lane writes; generative detection is the inferential one.
 */
export function clipProvenance(clipUrlsJson: string | null | undefined): ClipProvenance {
  if (!clipUrlsJson) return "unknown";
  let arr: unknown;
  try {
    arr = JSON.parse(clipUrlsJson);
  } catch {
    return "unknown";
  }
  if (!Array.isArray(arr)) return "unknown";
  const urls = arr.filter((u): u is string => typeof u === "string").map((u) => u.toLowerCase());
  if (!urls.length) return "unknown";

  if (urls.every((u) => u.includes(STOCK_PATH_MARKER))) return "stock";
  if (urls.some(isGenerativeClipUrl)) return "generative";
  return "unknown";
}

/**
 * Whether this specific job must publish with Meta's `is_ai_generated`.
 *
 * Provenance from the artifact WINS over the environment. The env provider is
 * consulted only when the clips say nothing recognisable - an unrecognised path
 * is not evidence of non-generation, so falling back to the configured lane is
 * strictly better than assuming either answer.
 */
export function shouldDiscloseAi(
  clipUrlsJson: string | null | undefined,
  envProvider: string | null | undefined,
  opts: { shotLineage?: unknown } = {},
): boolean {
  const provenance = clipProvenance(clipUrlsJson);
  if (provenance === "generative") return true;
  // Source-aware production (2026-10-09): when the job's lineage accounts for
  // EVERY clip and each one is registry-backed shop footage or a locally drawn
  // card, nothing in the Reel is model-generated — labelling it AI would be the
  // false claim in the other direction. A provider URL among the clips (above)
  // still wins over any lineage row, and a partial lineage proves nothing.
  if (allShotsNonGenerative(clipUrlsJson, opts.shotLineage)) return false;
  if (provenance === "stock") return false;
  return isGenerativeProvider(envProvider);
}

/**
 * True only when a lineage row covers every clip slot, none is a provider
 * shot, and each row's bound URL is the clip actually in that slot (beat N
 * sits at clipUrls[N-1]; validateBeatCount pins that numbering). A lineage
 * row is payload JSON, so the URL cross-check is what stops an edited row
 * from relabelling a generated clip as real.
 */
export function allShotsNonGenerative(clipUrlsJson: string | null | undefined, shotLineage: unknown): boolean {
  let clips: unknown[] = [];
  try { clips = clipUrlsJson ? JSON.parse(clipUrlsJson) : []; } catch { clips = []; }
  if (!Array.isArray(clips) || !clips.length) return false;
  const rows = parseShotLineage(shotLineage);
  if (rows.length !== clips.length) return false;
  const beats = new Set(rows.map((r) => r.beatNumber));
  if (beats.size !== clips.length) return false;
  return rows.every((r) => {
    if (r.origin !== "registry_real_shop" && r.origin !== "local_card") return false;
    const clip = clips[r.beatNumber - 1];
    return typeof r.url === "string" && r.url.length > 0 && clip === r.url;
  });
}

/**
 * The publish-door decision, as ONE function so it can be tested.
 *
 * Why this exists rather than composing the pieces at the call site: the
 * load-bearing detail is that the judged copy includes the ON-SCREEN TEXT and
 * not only the caption. A claim burned into a frame is the one a copy edit
 * cannot reach, and it is exactly what an inlined `disclosureViolation({copy:
 * caption})` at the door would let through while still looking correct.
 *
 * `willDiscloseAi` must be the value the publish call WILL send as Meta's
 * `is_ai_generated`, not a re-derivation. A gate judging a different value than
 * the one transmitted is judging nothing.
 */
export function publishDisclosureProblem(input: {
  jobId: string | number;
  caption?: string | null;
  onScreenText?: string | null;
  willDiscloseAi: boolean;
}): string | null {
  const copy = [input.caption ?? "", input.onScreenText ?? ""].filter(Boolean).join(" ");
  return disclosureViolation({
    id: String(input.jobId),
    copy,
    hasGeneratedVideo: input.willDiscloseAi,
    apiDisclosureFlag: input.willDiscloseAi,
  });
}

/**
 * Resolve Meta's AI self-disclosure for a publish call. DEFAULTS TO DISCLOSED.
 *
 * ── WHY THE DEFAULT IS INVERTED ─────────────────────────────────────────────
 * #2023 added `isAiGenerated` to the tRPC publish input and NOTHING EVER SENT
 * IT - not the Studio client, not the admin routes. An optional boolean
 * defaults to absent, absent means the container omits `is_ai_generated`, and
 * omitted means UNDISCLOSED, which is the harmful direction. The control
 * existed and its default was the unsafe state, which makes it a reminder
 * rather than a gate. Reminders fail silently.
 *
 * Every gate on the autonomous publish path is fail-closed. This one now
 * matches: forgetting the flag produces a DISCLOSED post. Opting out stays
 * possible but must be deliberate, which is the right shape for genuinely
 * human-shot footage.
 *
 * ONLY the boolean `false` opts out. `undefined`, `null`, a missing key, `0`,
 * `""` and the STRING `"false"` all resolve to true: a JSON body yields a real
 * boolean, and treating the string as an opt-out would let a stray query
 * parameter silently undisclose a post.
 */
export function resolveIsAiGenerated(explicit?: unknown): boolean {
  return explicit !== false;
}
