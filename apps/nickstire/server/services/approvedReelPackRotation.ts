/**
 * Operator-approved human-review packs, in the order they enter the daily
 * Reel generator. A pack supplies the reviewed production input; generation,
 * claims, spend, rendered QA, and the publish door remain the normal
 * pipeline's job.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApprovedProductionPackSnapshot } from "../../shared/episodeContract";
import {
  assessReelStructureNovelty,
  reelStructureFingerprint,
  type ReelStructureFingerprint,
} from "../../shared/reelStructureFingerprint";
import { resolvePacksDir } from "./reelPackRegistry";
import { MOTION_LENSES, REEL_ARCHETYPES, type ReelBrief } from "../../client/src/lib/facelessReelStudio";
import type { MotionLens, ReelArchetype } from "../../client/src/lib/facelessReelStudio";
import type { ApprovedPackPool } from "../../shared/reelJobPayload";
import { parseShotSource } from "../../shared/shotRouter";
import { briefEnqueueRefusals } from "./reelEnqueueRefusals";
import { VISUAL_DIRECTION_LENSES, type VisualDirectionId } from "../../shared/contentExperiments";

/**
 * EVERY PACK-DERIVED REEL LOOKED THE SAME, AND THIS IS WHY.
 *
 * motionLens, archetype and objectCharacter were hardcoded here, so the lane
 * that produces most of the account's reels stamped one visual grammar onto all
 * of them. Measured 2026-09-09: of 27 reels queued and ready to publish, 26
 * carried the identical lens. Across the 21-day window only 5 of 14 lenses and
 * 6 of 14 archetypes appeared at all.
 *
 * That also silently defeated the per-lens palettes: LENS_PALETTES gives each of
 * the fourteen lenses its own world, and a lane pinned to one lens can only ever
 * see one of them.
 *
 * DETERMINISTIC, not random. The same pack must always resolve to the same lens,
 * or a re-run produces a different reel from the same source and the repetition
 * ledger can no longer tell a retry from a new idea. Hashing the briefId gives a
 * stable spread: fixed per pack, distributed across packs.
 *
 * objectCharacter is deliberately NOT rotated. Lens and archetype are grammar -
 * how the camera moves, how the story is shaped - and apply to any subject. The
 * object character names the HERO of the frame, and rotating it would describe a
 * different object from the one the pack's own storyboard is about.
 *
 * For the same reason it is "plain_part", no persona (2026-10-08). It was fixed
 * to "rust_creeping_villain", which named rust as the hero of every pack Reel:
 * the provider prompt for a penny test carried "Character energy: Rust, Creeping
 * Villain" and, with no locked visual world, "Hero subject: Rust, Creeping
 * Villain" in its continuity block. A persona per pack would not fix it either:
 * the characters are metaphors ("a balloonist whose altitude is your PSI"), and
 * a video model reads the noun. The pack's beat 1 visual is the hero.
 */
/** A pack's declared ask, if it declared one in the shape reelAsk defines. */
function isReelAskShape(value: unknown): value is { kind: string; keyword?: string | null } {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "profile" || kind === "dm" || kind === "save" || kind === "visit";
}

function pickForPack<T>(briefId: string, salt: string, options: readonly T[]): T {
  const digest = createHash("sha256").update(`${briefId}::${salt}`).digest();
  return options[digest.readUInt32BE(0) % options.length];
}

const ROTATABLE_LENSES = Object.keys(MOTION_LENSES) as MotionLens[];

/** The lenses a pack Reel may draw: every lens, or only the running visual_direction arm's family. */
function lensPoolFor(direction: VisualDirectionId | undefined): readonly MotionLens[] {
  if (!direction) return ROTATABLE_LENSES;
  const family: readonly string[] = VISUAL_DIRECTION_LENSES[direction];
  const pool = ROTATABLE_LENSES.filter((lens) => family.includes(lens));
  // A family naming no real lens would leave nothing to pick; fall back rather than throw a pack away.
  return pool.length ? pool : ROTATABLE_LENSES;
}
const ROTATABLE_ARCHETYPES = Object.keys(REEL_ARCHETYPES) as ReelArchetype[];
export const APPROVED_REEL_PACK_SLUGS = [
  "2026-08-16-wheel-bearing-hum",
  "2026-08-16-check-engine-light",
  "2026-08-17-balance-vs-alignment",
  "2026-08-17-spare-tire-mileage",
  "2026-08-17-coolant-color",
  "2026-08-17-cabin-air-filter",
  "2026-08-17-stop-driving-noises",
  "2026-08-17-repair-questions",
  "2026-08-17-why-car-pulls",
  "2026-08-17-oil-change-intervals",
  "2026-08-17-summer-heat-tire-pressure",
  "2026-08-17-strut-bounce-test",
  "2026-08-17-exhaust-smoke-color",
  "2026-08-17-tire-rotation",
  "2026-08-17-wiper-blade-check",
  "2026-08-17-pothole-damage",
  "2026-08-17-transmission-fluid-color-test",
  "2026-08-17-plug-vs-patch",
  "2026-08-17-tread-depth-rain-vs-snow",
  "2026-08-17-serpentine-belt-squeal",
  "2026-08-17-roadtrip-tire-check",
  "2026-08-17-road-salt-brake-lines",
  "2026-08-17-sidewall-bulge",
  "2026-08-18-cold-weather-tire-light",
  "2026-08-18-cv-joint-click",
  "2026-08-18-allseason-vs-winter-tires",
  "2026-08-18-brake-fluid-moisture-test",
  "2026-08-18-ac-not-blowing-cold",
  "2026-08-18-uneven-tire-wear-patterns",
  "2026-08-18-tpms-sensor-battery",
  "2026-08-18-power-steering-whine",
  "2026-08-19-wont-start-battery-starter-alternator",

  // ── Approved 2026-09-07 on explicit operator instruction ──────────────
  // "all 132 packs do need to be in rotation ... I do not know why they are
  // just being off put to the side."
  //
  // 67 packs, every one verified through buildBriefFromApprovedProductionPack
  // — the SAME builder production uses, which normalises both brief schemas
  // (`beats` and `storyboardBeats`) and returns null below 4 beats or with no
  // caption. A first pass read `storyboardBeats` by hand and called 113 packs
  // unusable and 30 others clean; both numbers were artefacts of reading the
  // wrong key, and the "clean" half was absent-evidence-as-pass. Gate through
  // the real builder or do not gate.
  //
  // Each also cleared the claim gate and the originality gate against the live
  // 144-item published corpus. Of the 164 packs carrying a brief.json: 99
  // clean (32 already listed above + these 67), 1 repost
  // (2026-08-20-tire-sidewall-numbers, on-screen text 1.00 — deliberately NOT
  // added), 0 condemned, 64 rejected by the builder itself.
  //
  // APPENDED, NEVER REORDERED. The rotation cursor is an INDEX into this
  // array, so inserting or sorting would silently move the daily topic to a
  // different pack. The operator set that cursor to 2 by hand today; it still
  // means 2026-08-17-balance-vs-alignment.
  //
  // Safe to be this long ONLY because a terminally-refused pack now advances
  // the cursor past itself (089823177). Before that, one bad pack in a
  // 99-entry rotation jammed it as completely as one in a 32-entry rotation.
  "2026-08-14-penny-test",
  "2026-08-16-battery-summer-heat",
  "2026-08-16-squealing-vs-grinding-brakes",
  "2026-08-19-burning-smell-diagnosis",
  "2026-08-19-clunk-over-bumps-sway-bar-ball-joint",
  "2026-08-19-engine-overheating-first-60-seconds",
  "2026-08-19-heat-shield-rattle",
  "2026-08-19-spongy-brake-pedal",
  "2026-08-19-timing-belt-no-warning-light",
  "2026-08-19-warped-rotor-brake-shake",
  "2026-08-19-windshield-chip-spreads",
  "2026-08-20-awd-one-new-tire",
  "2026-08-20-battery-terminal-corrosion",
  "2026-08-20-caliper-sticking-hot-wheel",
  "2026-08-20-cloudy-headlights",
  "2026-08-20-dashboard-light-colors",
  "2026-08-20-echeck-readiness-monitors",
  "2026-08-20-fuel-smell-in-cabin",
  "2026-08-20-heater-not-blowing-hot",
  "2026-08-20-idle-shake-spark-plug-motor-mount",
  "2026-08-20-oil-dipstick-color-check",
  "2026-08-20-radiator-fan-idle-overheat",
  "2026-08-20-slow-leak-soap-test",
  "2026-08-20-tie-rod-steering-wobble-test",
  "2026-08-21-abs-light-wheel-speed-sensor",
  "2026-08-21-battery-parasitic-drain",
  "2026-08-21-blower-motor-resistor",
  "2026-08-21-key-fob-dead-battery-no-start",
  "2026-08-21-pcv-valve-oil-consumption",
  "2026-08-21-power-window-stuck-halfway",
  "2026-08-21-radiator-cap-pressure-test",
  "2026-08-21-spark-plug-wire-arcing",
  "2026-08-21-timing-chain-rattle-cold-start",
  "2026-08-21-valve-stem-dry-rot",
  "2026-08-22-clutch-slipping-rpm-flare",
  "2026-08-22-hard-brake-pedal-vacuum-booster",
  "2026-08-22-motor-mount-clunk-acceleration",
  "2026-08-22-oil-pressure-light-flicker-idle",
  "2026-08-23-door-lock-actuator-stripped-gear",
  "2026-08-23-exhaust-suddenly-loud-rusted-muffler",
  "2026-08-23-fuel-gauge-sending-unit",
  "2026-08-23-fuel-pump-whine",
  "2026-08-23-rough-shifting-check-fluid-first",
  "2026-08-23-sunroof-drain-clog-water-leak",
  "2026-08-23-sweet-smell-heater-core-coolant-leak",
  "2026-08-23-trunk-hatch-gas-strut-sag",
  "2026-08-23-washer-fluid-wont-spray",
  "2026-08-24-head-gasket-white-smoke-milky-oil",
  "2026-08-24-horn-wont-work",
  "2026-08-24-turbo-whistle-vs-boost-leak",
  "2026-08-24-water-pump-weep-hole-leak",
  "2026-08-25-4wd-transfer-case-bind-tight-turns",
  "2026-08-25-collapsing-radiator-hose",
  "2026-08-25-misfire-shudder-coil-vs-plug",
  "2026-08-25-torque-converter-shudder-40-45mph",
  "2026-08-26-check-engine-flashing-vs-steady",
  "2026-08-26-exhaust-hanger-rattle-over-bumps",
  "2026-08-28-new-brake-squeak-bed-in",
  "2026-08-28-power-steering-fluid-leak-color",
  "2026-09-01-clutch-pedal-sinks-hydraulic-leak",
  "2026-09-04-back-to-school-carpool-check",
  "2026-09-04-fall-car-care-checklist",
  "2026-09-04-trunk-release-not-working",
  "2026-09-05-battery-date-code",
  "2026-09-06-sealed-transmission-no-dipstick-check",
  "2026-09-07-auto-headlights-wont-turn-on-dusk",
  "2026-09-07-wheel-stud-snapped",

  // -- 2026-09-25 imports (evening 23 + midday 11): OUT of the rotation ------
  // Removed 2026-10-08. Every beat of all 34 packs is one of ten placeholder
  // shots that name no object ("Extreme macro of the physical subject…"), so
  // the generator could not show any of their topics. They are listed in
  // ROTATION_EXCLUDED with what each needs. They were the TAIL of this array
  // (indices 99-132) and the production cursor read 32 that day (Railway,
  // "daily reel topic from approved pack selection", 10:02Z), so no index at or
  // below the cursor moved. Re-admit by APPENDING at the end, never in place.
] as const;

/**
 * Packs deliberately kept OUT of the rotation, each with the reason.
 *
 * This exists so "not in rotation" can never again mean "nobody looked".
 * `reelPackRotationCoverage.test.ts` fails when a pack on disk is accepted by
 * `buildBriefFromApprovedProductionPack` and appears in neither list — which is
 * how 67 usable packs sat unreachable while new ones kept being written.
 */
const PROOF_PACK_EXCLUSION =
  "Reels Engine v2 proof pack (docs/reels-engine-v2/08-PILOT.md): every evidence beat is declared REAL " +
  "and the real-shop pool does not hold its shots yet. The generator refuses a beat declared real or " +
  "deterministic (shared/shotRouter.beatsTheGeneratorMustNotRender, at enqueue and at generation), so in " +
  "the rotation today it would fail every day rather than ship a synthetic shot of real work. Enters the " +
  "rotation on operator instruction once the six-shot set is captured AND a publishable route exists for " +
  "real footage and cards (the stock guard refuses every locally hosted clip; 09-90-DAY-MODEL.md decision).";

const SUBJECT_FREE_IMPORT =
  "2026-09-25 import: every beat is a placeholder that names no object (\"Extreme macro of the physical " +
  "subject…\", \"…the relevant physical components…\"), so the generator was sent no subject and the clip " +
  "could not show the topic (shared/shotRouter.isSubjectFreeVisual; the generator also refuses such beats).";
const SUBJECT_FREE_REAL =
  SUBJECT_FREE_IMPORT +
  " The pack's own production note asks for real shop footage (its videoPrompt / modelRecommendation), so it waits for that " +
  "capture (05-CAPTURE-CHECKLIST.md) and the operator's real-evidence publish decision.";
const SUBJECT_FREE_NO_ROUTE =
  SUBJECT_FREE_IMPORT +
  " The pack names only its batch's generic route (original footage first, a generated connector shot if one " +
  "is missing) and no shot for any beat: write what the camera sees in each beat (operator-approved), or capture it.";
const SUBJECT_FREE_DETERMINISTIC =
  SUBJECT_FREE_IMPORT +
  " The pack's note asks for a deterministic cutaway first (its videoPrompt / modelRecommendation), which has no " +
  "publishable lane yet (the generator refuses a declared deterministic beat): write what the camera sees in each " +
  "beat (operator-approved), or wait for the card renderer.";

export const ROTATION_EXCLUDED: Readonly<Record<string, string>> = {
  "2026-08-20-tire-sidewall-numbers":
    "Repost: on-screen text scores 1.00 against an already-published post. The originality gate " +
    "would refuse it at the publish door anyway; keeping it out of the rotation saves the render.",
  "2026-10-08-proof-01-uneven-wear":
    PROOF_PACK_EXCLUSION +
    " Also: beat 2's INNER 3/32 / OUTER 7/32 are example readings. Replace them with the captured tire's " +
    "gauge values before admission, or the Reel shows a measurement nobody took.",
  "2026-10-08-proof-02-highway-shake":
    PROOF_PACK_EXCLUSION +
    " Also: it rests on the vibration truth packet (shared/mechanicalTruth.ts), which has no source and no " +
    "technician approval yet. It stays out until that packet is cited or technician-approved.",
  "2026-10-08-proof-03-patch-or-replace": PROOF_PACK_EXCLUSION,
  "2026-09-25-oil-overfill-not-extra-protection": SUBJECT_FREE_REAL,
  "2026-09-25-ev-regen-brake-corrosion": SUBJECT_FREE_REAL,
  "2026-09-25-alignment-green-loose-parts": SUBJECT_FREE_REAL,
  "2026-09-25-balancer-zero-still-vibrates": SUBJECT_FREE_REAL,
  "2026-09-25-ohio-used-tire-whole-inspection": SUBJECT_FREE_REAL,
  "2026-09-25-impact-gun-vs-torque-wrench": SUBJECT_FREE_REAL,
  "2026-09-25-xl-means-extra-load": SUBJECT_FREE_REAL,
  "2026-09-25-oil-pressure-vs-oil-life": SUBJECT_FREE_REAL,
  "2026-09-25-rotor-surface-rust-overnight": SUBJECT_FREE_REAL,
  "2026-09-25-coolant-level-vs-freeze-protection": SUBJECT_FREE_REAL,
  "2026-09-25-starting-circuit-voltage-drop": SUBJECT_FREE_REAL,
  "2026-09-25-puncture-repair-zone": SUBJECT_FREE_REAL,
  "2026-09-25-two-new-tires-rear-axle": SUBJECT_FREE_REAL,
  "2026-09-25-tpms-flash-vs-steady": SUBJECT_FREE_REAL,
  "2026-09-25-tire-age-dot-date-code": SUBJECT_FREE_REAL,
  "2026-09-25-sidewall-max-psi-vs-placard": SUBJECT_FREE_REAL,
  "2026-09-25-directional-tire-rotation-arrow": SUBJECT_FREE_REAL,
  "2026-09-25-battery-light-charging-system": SUBJECT_FREE_REAL,
  "2026-09-25-inner-outer-brake-pad-wear": SUBJECT_FREE_REAL,
  "2026-09-25-driven-flat-hidden-internal-damage": SUBJECT_FREE_REAL,
  "2026-09-25-epdm-belt-wear-no-cracks": SUBJECT_FREE_REAL,
  "2026-09-25-swollen-capped-lug-nuts": SUBJECT_FREE_REAL,
  "2026-09-25-run-flat-limited-mobility": SUBJECT_FREE_DETERMINISTIC,
  "2026-09-06-nitrogen-vs-air-tire-fill": SUBJECT_FREE_NO_ROUTE,
  "2026-08-27-foggy-windshield-recirculate-trick": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-locking-lug-roadside-tool": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-lug-nut-seat-shape-fit": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-hidden-inner-lip-wheel-bend": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-utqg-treadwear-not-mileage": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-strut-misting-vs-leak": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-run-flat-can-look-normal": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-wheel-fitment-beyond-bolt-pattern": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-sidewall-indent-vs-bulge": SUBJECT_FREE_NO_ROUTE,
  "2026-09-25-ms-vs-3pmsf": SUBJECT_FREE_NO_ROUTE,
};

/**
 * Operator-approved pack VARIANTS, by experiment, then pack slug, then the arm
 * ids a variant exists for (docs/reel-packs/<slug>/variants/<armId>/brief.json).
 *
 * The list, not the folder, is the approval (2026-10-08). Agents commit packs for
 * review, and with reel auto-approval on the per-job approval is recorded by
 * policy, so naming a variant here is the only human review of its wording.
 * A pack joins an experiment only when EVERY arm is listed and builds
 * (approvedVariantSnapshot). Variants suit packs not yet published: the
 * idempotency key is per pack, and the publish door blocks a near-repeat.
 * Empty until the operator approves the first pair.
 */
export const APPROVED_PACK_VARIANTS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {};

/**
 * The snapshot to build this episode from when a pack_variant experiment is
 * running: the drawn arm's variant, or null (build the base pack, record no
 * arm) unless the pack has an approved variant for every arm and each one
 * loads, builds and clears what enqueue would refuse. All arms or none: if one
 * arm's variant were refused at enqueue, the arm a day drew would decide
 * whether the pack aired or was skipped (review 2026-10-08).
 */
export function approvedVariantSnapshot(
  experimentId: string,
  slug: string,
  armId: string,
  armIds: readonly string[],
  approved: typeof APPROVED_PACK_VARIANTS = APPROVED_PACK_VARIANTS,
): ApprovedProductionPackSnapshot | null {
  const listed = approved[experimentId]?.[slug] ?? [];
  if (!armIds.length || !armIds.includes(armId) || !armIds.every((id) => listed.includes(id))) return null;
  let chosen: ApprovedProductionPackSnapshot | null = null;
  for (const id of armIds) {
    const snapshot = loadApprovedProductionPack(slug, id);
    const built = snapshot ? buildBriefFromApprovedProductionPack({ slug: slug as ApprovedReelPack["slug"], topic: "" }, snapshot, `variant-check-${id}`, true) : null;
    if (!snapshot || !built || briefEnqueueRefusals(built as unknown as ReelBrief).length) return null;
    if (id === armId) chosen = snapshot;
  }
  return chosen;
}

/**
 * The rotation packs a pack_variant experiment can actually build from: in
 * APPROVED_REEL_PACK_SLUGS (the only slugs the daily lane selects) with a full,
 * eligible pair. startContentExperiment refuses a preset with none, so an
 * approval for a pack the lane never picks cannot start an experiment that
 * records nothing (review 2026-10-08).
 */
export function eligibleVariantPacks(
  experimentId: string,
  armIds: readonly string[],
  approved: typeof APPROVED_PACK_VARIANTS = APPROVED_PACK_VARIANTS,
): string[] {
  const rotation = new Set<string>(APPROVED_REEL_PACK_SLUGS);
  return Object.keys(approved[experimentId] ?? {}).filter(
    (slug) => rotation.has(slug) && armIds.length > 0 && approvedVariantSnapshot(experimentId, slug, armIds[0], armIds, approved) !== null,
  );
}

export interface ApprovedReelPack {
  slug: (typeof APPROVED_REEL_PACK_SLUGS)[number];
  topic: string;
}

function readOptionalFile(dir: string, name: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return null;
  }
}

/** Load the exact reviewed files; no topic-only fallback is allowed. */
export function loadApprovedProductionPack(slug: string, variantArmId?: string): ApprovedProductionPackSnapshot | null {
  const packsDir = resolvePacksDir();
  if (!packsDir) return null;
  // A variant is read from <slug>/variants/<armId>/ and keeps the parent's packId
  // (episode preflight binds the snapshot to the approved slug), while its own
  // bytes are what contentSha256 and sourcePath describe.
  if (variantArmId !== undefined && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(variantArmId)) return null;
  const packDir = variantArmId ? path.join(packsDir, slug, "variants", variantArmId) : path.join(packsDir, slug);
  const briefJson = readOptionalFile(packDir, "brief.json");
  if (!briefJson) return null;
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(briefJson) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const readme = readOptionalFile(packDir, "README.md");
  const captionsSrt = readOptionalFile(packDir, "captions.srt");
  const contentSha256 = createHash("sha256")
    .update(`brief.json\0${briefJson}\0README.md\0${readme ?? ""}\0captions.srt\0${captionsSrt ?? ""}`)
    .digest("hex");
  return {
    packId: slug,
    sourcePath: `apps/nickstire/docs/reel-packs/${slug}${variantArmId ? `/variants/${variantArmId}` : ""}`,
    contentSha256,
    files: { briefJson, readme, captionsSrt },
    parsed,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function primaryCaptionFromReadme(readme: string | null): string {
  if (!readme) return "";
  const section = readme.match(/(?:\*\*Primary caption[^\n]*|\*\*Caption \(primary\):[^\n]*)\n([\s\S]*?)(?:\n\*\*Ad-ready|\n---|$)/i)?.[1]
    ?? readme.match(/### Variant A[^\n]*\n([\s\S]*?)(?:\n### |\n## |$)/i)?.[1]
    ?? "";
  const lines = section.split(/\r?\n/);
  const quoted = lines.filter((line) => /^\s*>/.test(line)).map((line) => line.replace(/^\s*>\s?/, "").trimEnd());
  return quoted.join("\n").replace(/(^|\s)#[A-Za-z0-9_-]+/g, "$1").replace(/[ \t]+\n/g, "\n").trim();
}

function hashtagsFromCaption(caption: string): string[] {
  return [...caption.matchAll(/#[A-Za-z0-9_-]+/g)].map((match) => match[0]).slice(0, 5);
}

/**
 * Older reviewed packs stored provenance in `slateSource` or README prose
 * rather than the machine-readable sourceNotes array. Preserve that reviewed
 * provenance at the brief boundary. If a pack has no external source field,
 * the immutable pack itself is named explicitly; claim evidence remains a
 * separate resolver concern and stays a warning until the registry can verify
 * the handle.
 */
function reviewedSourceNoteFromPack(
  source: Record<string, unknown>,
  snapshot: ApprovedProductionPackSnapshot,
  supports: string,
): { label: string; kind: "proof"; supports: string } {
  const metadataSource = stringValue(source.slateSource) || stringValue(source.source);
  const readmeLines = snapshot.files.readme?.split(/\r?\n/) ?? [];
  const sourceLineIndex = readmeLines.findIndex((line) => /\bsource:\s*/i.test(line));
  let readmeSource = "";
  if (sourceLineIndex >= 0) {
    const line = readmeLines[sourceLineIndex];
    readmeSource = line.replace(/^.*\bsource:\s*/i, "").trim();
    if (!readmeSource && readmeLines[sourceLineIndex + 1]) readmeSource = readmeLines[sourceLineIndex + 1].trim();
  }
  const raw = metadataSource || readmeSource || `${snapshot.sourcePath}/brief.json (operator-reviewed production input)`;
  const markdownLabel = raw.match(/\[([^\]]+)\]/)?.[1];
  return { label: (markdownLabel || raw).replace(/[`]/g, "").trim(), kind: "proof", supports };
}

/**
 * Normalize the two pack JSON shapes currently in the repo without changing
 * their reviewed copy. Missing machine fields remain explicit compatibility
 * defaults; the full source files stay in the Episode Contract snapshot.
 */
export function buildBriefFromApprovedProductionPack(
  pack: ApprovedReelPack,
  snapshot: ApprovedProductionPackSnapshot,
  briefId: string,
  skipStructureNovelty = false,
  /** visual_direction_v1's arm for this episode (contentExperimentStore.visualDirectionForEpisode); absent = the full lens pick. */
  visualDirection?: VisualDirectionId,
): Record<string, unknown> | null {
  const source = snapshot.parsed;
  const rawBeats = Array.isArray(source.storyboardBeats)
    ? source.storyboardBeats
    : Array.isArray(source.beats)
      ? source.beats
      : Array.isArray(source.storyboard)
        ? source.storyboard
        : [];
  const storyboardBeats = rawBeats.map((raw, index) => {
    const beat = raw as Record<string, unknown>;
    const beatNumber = Number(beat.beatNumber ?? beat.beat ?? beat.index ?? index + 1);
    const startSecond = Number(beat.startSecond ?? beat.start ?? index * 5);
    const endSecond = Number(beat.endSecond ?? beat.end ?? startSecond + 5);
    const declaredSource = parseShotSource(beat.source);
    return {
      beatNumber,
      startSecond,
      endSecond,
      visual: stringValue(beat.visual) || stringValue(beat.providerScene) || stringValue(beat.visualPrompt),
      motion: stringValue(beat.motion),
      onScreenText: stringValue(beat.onScreenText) || stringValue(beat.caption) || stringValue(beat.overlay),
      purpose: stringValue(beat.purpose) || stringValue(beat.intent) || stringValue(beat.role) || stringValue(beat.label),
      audioCue: stringValue(beat.audioCue) || stringValue(beat.audioNote),
      safeZoneNotes: stringValue(beat.safeZoneNotes),
      // The declared shot source (StoryboardBeat.source) rides through, or
      // runReelPreflight's route check sees every pack beat as "unspecified"
      // and silently skips it. Only the four declared values survive.
      ...(declaredSource ? { source: declaredSource } : {}),
    };
  });
  const selectedCaption = stringValue(source.selectedCaption) || stringValue(source.caption) || primaryCaptionFromReadme(snapshot.files.readme);
  if (storyboardBeats.length < 4 || !selectedCaption) return null;
  const hashtags = arrayOfStrings(source.hashtags).length ? arrayOfStrings(source.hashtags).slice(0, 5) : hashtagsFromCaption(selectedCaption);
  const voiceoverScript = stringValue(source.voiceoverScript) || storyboardBeats.map((beat) => {
    const raw = rawBeats[beat.beatNumber - 1] as Record<string, unknown> | undefined;
    return stringValue(raw?.narration) || stringValue(raw?.vo);
  }).filter(Boolean).join(" ");
  /** A pack's declared loop plan - how its last frame feeds its first. */
  const packLoopIdea = stringValue(source.loopIdea);
  const driverConfusionFallback = stringValue(source.driverConfusion) || stringValue(source.hookText) || "";
  const campaignKeyword = stringValue(source.campaignKeyword) || pack.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  const topic = stringValue(source.topic) || pack.topic;
  const sourceNotes = Array.isArray(source.sourceNotes) ? source.sourceNotes : [];
  const hasProofSource = sourceNotes.some((note) =>
    Boolean(note && typeof note === "object" && (note as Record<string, unknown>).kind === "proof"),
  );
  const productionGrammarFingerprint = reelStructureFingerprint({
    beats: storyboardBeats,
    ctaType: isReelAskShape(source.ask) ? source.ask.kind : null,
    loopIdea: packLoopIdea || null,
  });

  // Compare the candidate against a bounded window of REAL reviewed pack
  // structures. This is diagnostic metadata, not a publish gate: the audit
  // proved topic diversity can coexist with nearly identical production
  // grammar, but outcome data is not yet strong enough to let this score decide
  // what publishes. The recursive builder call explicitly skips novelty so this
  // stays finite and evaluates the same normalized brief shape production uses.
  let productionGrammarNovelty: {
    similarity: number;
    isProductionTwin: boolean;
    collisions: string[];
    nearestSignature: string | null;
    comparisonWindow: number;
  } | null = null;
  if (!skipStructureNovelty) {
    const packIndex = APPROVED_REEL_PACK_SLUGS.indexOf(pack.slug);
    const start = Math.max(0, packIndex - 12);
    const priors: ReelStructureFingerprint[] = [];

    for (let index = start; index < packIndex; index += 1) {
      const priorSlug = APPROVED_REEL_PACK_SLUGS[index];
      const priorSnapshot = loadApprovedProductionPack(priorSlug);
      if (!priorSnapshot) continue;
      const priorBrief = buildBriefFromApprovedProductionPack(
        { slug: priorSlug, topic: topicFromSlug(priorSlug) },
        priorSnapshot,
        `novelty-prior-${priorSlug}`,
        true,
      );
      const priorFingerprint = priorBrief?.productionGrammarFingerprint;
      if (priorFingerprint && typeof priorFingerprint === "object") {
        priors.push(priorFingerprint as ReelStructureFingerprint);
      }
    }

    const verdict = assessReelStructureNovelty(productionGrammarFingerprint, priors);
    productionGrammarNovelty = {
      similarity: verdict.similarity,
      isProductionTwin: verdict.isProductionTwin,
      collisions: verdict.collisions,
      nearestSignature: verdict.nearest?.signature ?? null,
      comparisonWindow: priors.length,
    };
  }

  return {
    id: briefId,
    // THE PACK LANE HAD NO ASK AT ALL.
    //
    // This builder never read `ask`, so resolveReelAsk returned null for every
    // pack-derived brief and the end card rendered nothing. The lane that makes
    // most of the account's reels was publishing them with no call to action.
    //
    // Four packs had worked around it by burning a CTA into their last BEAT -
    // shop name, address and phone as on-screen text, plus a spoken "stop by".
    // That is the one place an ask must never go: beats are content, they are
    // permanent, and no copy edit can reach them after render. askLeakageProblem
    // refuses exactly that, which is why those four could never have shipped.
    //
    // Passed through when the pack declares one, and NOT defaulted when it does
    // not. Inventing an ask for the other 95 would change what every one of them
    // renders, and which ask a business makes is the operator's call, not a
    // fallback's - it is recorded as an open decision rather than guessed here.
    ...(isReelAskShape(source.ask) ? { ask: source.ask } : {}),
    topic,
    mechanicTruth: stringValue(source.mechanicTruth) || topic,
    driverConfusion: stringValue(source.driverConfusion) || stringValue(source.hookText) || topic,
    clevelandAngle: stringValue(source.clevelandAngle),
    sourceNotes: hasProofSource ? sourceNotes : [
      ...sourceNotes,
      reviewedSourceNoteFromPack(source, snapshot, stringValue(source.mechanicTruth) || topic),
    ],
    factBucket: "invisible_killers",
    campaignKeyword,
    archetype: pickForPack(briefId, "archetype", ROTATABLE_ARCHETYPES),
    motionLens: pickForPack(briefId, "lens", lensPoolFor(visualDirection)),
    objectCharacter: "plain_part",
    usefulAbsurdity: stringValue(source.usefulAbsurdity),
    /**
     * A reviewed pack IS a selected concept, so the brief carries one - which is
     * what lets a pack DECLARE its loop plan and have the quality scorer read it
     * (`calculateReelQualityScore` resolves the loop through
     * `concepts.find(id === winningConceptId).loopIdea`, so an empty array made
     * "Loop plan" unreachable for every pack-derived brief no matter how well
     * the storyboard actually looped).
     *
     * THE TOURNAMENT SCORES ARE DELIBERATELY ZERO, and that is not an oversight.
     * These packs were authored and reviewed directly; no concept tournament
     * ranked them against rivals. Filling in 57+/60 would invent evidence of a
     * selection that never happened, so "Winning concept >= 57/60" is left to
     * fail honestly. It costs 5 of 75 points and caps a pack-derived brief at
     * 70 - exactly the passing threshold, reachable only on real merit.
     */
    concepts: packLoopIdea
      ? [{
          id: briefId,
          hook: stringValue(source.hookText) || driverConfusionFallback,
          coreFact: stringValue(source.mechanicTruth) || topic,
          factBucket: "myth_buster" as const,
          driverEmotion: "",
          campaignKeyword: campaignKeyword as never,
          archetype: pickForPack(briefId, "archetype", ROTATABLE_ARCHETYPES),
          motionLens: pickForPack(briefId, "lens", lensPoolFor(visualDirection)),
          objectCharacter: "plain_part" as const,
          usefulAbsurdity: stringValue(source.usefulAbsurdity),
          localAngle: stringValue(source.clevelandAngle),
          beatOutline: storyboardBeats.map((b) => b.onScreenText || b.purpose),
          loopIdea: packLoopIdea,
          captionAngle: "",
          saveShareReason: "",
          nickFitReason: "",
          nonGenericReason: "",
          rejectionRisk: "",
          scores: { hook: 0, truth: 0, save: 0, local: 0, absurdity: 0, fit: 0 },
        }]
      : [],
    winningConceptId: packLoopIdea ? briefId : null,
    storyboardBeats,
    productionGrammarFingerprint,
    ...(productionGrammarNovelty ? { productionGrammarNovelty } : {}),
    promptPack: [],
    higgsfieldPromptPack: [],
    ffmpegAssemblyNotes: stringValue(source.ffmpegAssemblyNotes),
    voiceoverScript,
    captionHooks: [selectedCaption.split(/\r?\n/)[0]],
    selectedCaption,
    hashtags,
    avoidedForRepetition: "approved production pack",
    qualityScore: 0,
    assetPlan: "approved production-pack asset plan",
    instagramUrl: null,
    operatorNotes: `Approved production pack ${pack.slug}; source content is immutable in the episode contract.`,
    approvedPackSlug: pack.slug,
  };
}

function topicFromSlug(slug: string): string {
  return slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
}

export const APPROVED_REEL_PACKS: readonly ApprovedReelPack[] = APPROVED_REEL_PACK_SLUGS.map((slug) => ({
  slug,
  topic: topicFromSlug(slug),
}));

export const ACTIVE_REEL_SLATE_KEY = "reel_active_slate_json";
export const ACTIVE_REEL_SLATE_CURSOR_KEY = "reel_active_slate_cursor";
const ACTIVE_REEL_SLATE_MAX = 24;

export interface ActiveReelSlateState {
  configured: boolean;
  slugs: string[];
  /** Independent from the full approved-library cursor. */
  cursor: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  malformed: boolean;
}

const APPROVED_SLUG_SET = new Set<string>(APPROVED_REEL_PACK_SLUGS);

export function normalizeActiveReelSlateSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !APPROVED_SLUG_SET.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= ACTIVE_REEL_SLATE_MAX) break;
  }
  return out;
}

export async function readActiveReelSlate(database: any): Promise<ActiveReelSlateState> {
  const { shopSettings } = await import("../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const rows = await database.select({
    key: shopSettings.key,
    value: shopSettings.value,
    updatedAt: shopSettings.updatedAt,
    updatedBy: shopSettings.updatedBy,
  }).from(shopSettings).where(inArray(shopSettings.key, [ACTIVE_REEL_SLATE_KEY, ACTIVE_REEL_SLATE_CURSOR_KEY])).limit(2);
  const slateRow = rows.find((row: { key: string }) => row.key === ACTIVE_REEL_SLATE_KEY);
  const cursorRow = rows.find((row: { key: string }) => row.key === ACTIVE_REEL_SLATE_CURSOR_KEY);
  if (!slateRow) {
    return { configured: false, slugs: [], cursor: null, updatedAt: null, updatedBy: null, malformed: false };
  }
  try {
    const parsed = JSON.parse(String(slateRow.value)) as { slugs?: unknown; updatedAt?: unknown };
    const slugs = normalizeActiveReelSlateSlugs(parsed.slugs);
    const payloadUpdatedAt =
      typeof parsed.updatedAt === "string" && !Number.isNaN(Date.parse(parsed.updatedAt))
        ? new Date(parsed.updatedAt).toISOString()
        : null;
    const invalidPayloadRevision = parsed.updatedAt !== undefined && payloadUpdatedAt === null;
    // Missing cursor means a newly introduced slate starts at its first item.
    // A present-but-malformed cursor is never guessed.
    const cursor = cursorRow
      ? parseApprovedPackRotationIndex(String(cursorRow.value))
      : 0;
    const malformed =
      !Array.isArray(parsed.slugs)
      || slugs.length === 0
      || slugs.length !== parsed.slugs.length
      || cursor === null
      || invalidPayloadRevision;
    return {
      configured: slugs.length > 0,
      slugs,
      cursor,
      // New saves carry an explicit definition revision in the payload. That
      // changes even when an operator re-saves the same slug order and resets
      // the cursor, unlike a DB on-update timestamp that may stay unchanged on
      // a no-op value update. Row time remains the legacy fallback.
      updatedAt: payloadUpdatedAt ?? (slateRow.updatedAt ? new Date(slateRow.updatedAt).toISOString() : null),
      updatedBy: slateRow.updatedBy ? String(slateRow.updatedBy) : null,
      malformed,
    };
  } catch {
    return {
      configured: false,
      slugs: [],
      cursor: null,
      updatedAt: slateRow.updatedAt ? new Date(slateRow.updatedAt).toISOString() : null,
      updatedBy: slateRow.updatedBy ? String(slateRow.updatedBy) : null,
      malformed: true,
    };
  }
}

export function approvedReelPackAtFromPool(index: number, activeSlugs: readonly string[]): ApprovedReelPack | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  if (!activeSlugs.length) return approvedReelPackAt(index);
  const slug = activeSlugs[index];
  if (!slug) return null;
  return APPROVED_REEL_PACKS.find((pack) => pack.slug === slug) ?? null;
}

export type ApprovedPackSelection =
  | { state: "cursor_invalid"; pack: null; index: null }
  | { state: "slate_malformed"; pack: null; index: null }
  | { state: "slate_exhausted"; pack: null; index: number }
  | { state: "active_slate"; pack: ApprovedReelPack; index: number }
  | { state: "full_approved_library"; pack: ApprovedReelPack | null; index: number };

export function resolveApprovedPackSelection(
  fullLibraryIndex: number | null,
  active: Pick<ActiveReelSlateState, "configured" | "slugs" | "cursor" | "malformed">,
): ApprovedPackSelection {
  // An operator-configured slate is an overlay with its OWN cursor. The full
  // library cursor is intentionally ignored while the overlay is active so a
  // short editorial slate cannot move or reset the canonical rotation.
  if (active.malformed) return { state: "slate_malformed", pack: null, index: null };
  if (active.configured) {
    if (active.cursor === null) return { state: "slate_malformed", pack: null, index: null };
    const pack = approvedReelPackAtFromPool(active.cursor, active.slugs);
    if (!pack) return { state: "slate_exhausted", pack: null, index: active.cursor };
    return { state: "active_slate", pack, index: active.cursor };
  }
  if (fullLibraryIndex === null) return { state: "cursor_invalid", pack: null, index: null };
  return { state: "full_approved_library", pack: approvedReelPackAt(fullLibraryIndex), index: fullLibraryIndex };
}

export async function clearActiveReelSlate(
  database: any,
  updatedBy: string,
): Promise<ActiveReelSlateState> {
  const { shopSettings } = await import("../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  // Remove only the overlay and its cursor. The full approved-library cursor is
  // untouched so disabling Strategy resumes the canonical rotation where it was.
  await database.transaction(async (tx: any) => {
    await tx.delete(shopSettings).where(inArray(shopSettings.key, [ACTIVE_REEL_SLATE_KEY, ACTIVE_REEL_SLATE_CURSOR_KEY]));
  });
  return { configured: false, slugs: [], cursor: null, updatedAt: new Date().toISOString(), updatedBy, malformed: false };
}

export async function writeActiveReelSlate(
  database: any,
  slugsInput: unknown,
  updatedBy: string,
): Promise<ActiveReelSlateState> {
  const slugs = normalizeActiveReelSlateSlugs(slugsInput);
  if (!slugs.length) throw new Error("active Reel slate must contain at least one approved pack");
  if (!Array.isArray(slugsInput) || slugs.length !== slugsInput.length) {
    throw new Error("active Reel slate contains an unknown, duplicate, or over-limit pack; nothing was saved");
  }
  const { shopSettings } = await import("../../drizzle/schema");
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify({ version: 1, slugs, updatedAt });
  await database.transaction(async (tx: any) => {
    await tx.insert(shopSettings).values({
      key: ACTIVE_REEL_SLATE_KEY,
      value: payload,
      label: "Instagram active Reel slate — ordered approved pack slugs",
      category: "general",
      updatedBy: updatedBy.slice(0, 100) || "admin",
    }).onDuplicateKeyUpdate({ set: { value: payload, updatedBy: updatedBy.slice(0, 100) || "admin" } });
    // A saved reorder is a new editorial queue. Reset only the overlay cursor;
    // the canonical full-library cursor must survive activation/clear intact.
    await tx.insert(shopSettings).values({
      key: ACTIVE_REEL_SLATE_CURSOR_KEY,
      value: "0",
      label: "Instagram active Reel slate — next item index",
      category: "general",
      updatedBy: updatedBy.slice(0, 100) || "admin",
    }).onDuplicateKeyUpdate({ set: { value: "0", updatedBy: updatedBy.slice(0, 100) || "admin" } });
  });
  return { configured: true, slugs, cursor: 0, updatedAt, updatedBy, malformed: false };
}

/** Returns null for a completed or malformed rotation index. */
export function approvedReelPackAt(index: number): ApprovedReelPack | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return APPROVED_REEL_PACKS[index] ?? null;
}

/** Never silently restart the queue when durable state is malformed. */
export function parseApprovedPackRotationIndex(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value.trim())) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) ? index : null;
}

/** A missing cursor is the first pack; a malformed cursor is never guessed. */
export function resolveApprovedPackRotationIndex(value: string | null): number | null {
  return value === null ? 0 : parseApprovedPackRotationIndex(value);
}

/**
 * Where the rotation should point after a reel from `jobPackSlug` was
 * TERMINALLY refused — or null to hold.
 *
 * Pure and exported so the decision can be exercised directly. The first
 * version of this lived inline in dailyReelPost and was covered only by tests
 * that matched source text, which stay green if the write never persists or the
 * helper returns early. AGENTS.md is explicit that a control must assert
 * BEHAVIOUR, not presence.
 */
export function nextRotationIndexAfterRefusal(
  jobPackSlug: string | null | undefined,
  currentIndex: number | null,
  packSlugAtCurrentIndex: string | null | undefined,
): number | null {
  // A miner- or manifest-sourced job has no rotation slot to advance.
  if (!jobPackSlug) return null;
  // An exhausted or malformed cursor is never guessed at — the miner is
  // authority there, and parseApprovedPackRotationIndex already refused it.
  if (currentIndex === null) return null;
  // The cursor moved while this reel rendered. Advancing now would skip an
  // untouched pack, so hold — same posture as the success path.
  if (packSlugAtCurrentIndex !== jobPackSlug) return null;
  return currentIndex + 1;
}

export interface ApprovedPackProgressTarget {
  pool: ApprovedPackPool;
  currentIndex: number;
  nextIndex: number;
  expectedSlug: string;
}

/**
 * Resolve the ONLY cursor an already-created Reel job is allowed to consume.
 *
 * Missing pool provenance means a pre-feature/legacy job and is deliberately
 * treated as full-library work. Before the active-slate feature existed, that
 * was the only approved-pack source, so interpreting a legacy job through a
 * newly-enabled slate would be the dangerous guess.
 *
 * Active-slate jobs also carry the slate definition revision. Reordering or
 * re-saving a slate resets its cursor and changes that revision; an older
 * in-flight job must then hold instead of consuming the new editorial queue.
 */
export function resolveApprovedPackProgressTarget(
  jobPackSlug: string | null | undefined,
  fullLibraryIndex: number | null,
  active: Pick<ActiveReelSlateState, "configured" | "slugs" | "cursor" | "updatedAt" | "malformed">,
  jobPackPool?: ApprovedPackPool | null,
  jobSlateRevision?: string | null,
): ApprovedPackProgressTarget | null {
  if (!jobPackSlug) return null;

  const pool: ApprovedPackPool = jobPackPool ?? "full_approved_library";
  if (pool === "active_slate") {
    if (
      active.malformed
      || !active.configured
      || active.cursor === null
      || !jobSlateRevision
      || active.updatedAt !== jobSlateRevision
    ) return null;
    const expected = approvedReelPackAtFromPool(active.cursor, active.slugs);
    const nextIndex = nextRotationIndexAfterRefusal(jobPackSlug, active.cursor, expected?.slug);
    if (!expected || nextIndex === null) return null;
    return {
      pool,
      currentIndex: active.cursor,
      nextIndex,
      expectedSlug: expected.slug,
    };
  }

  if (fullLibraryIndex === null) return null;
  const expected = approvedReelPackAt(fullLibraryIndex);
  const nextIndex = nextRotationIndexAfterRefusal(jobPackSlug, fullLibraryIndex, expected?.slug);
  if (!expected || nextIndex === null) return null;
  return {
    pool,
    currentIndex: fullLibraryIndex,
    nextIndex,
    expectedSlug: expected.slug,
  };
}

/**
 * Advance the rotation past a pack whose reel was terminally refused.
 *
 * THE DEADLOCK THIS BREAKS. `setApprovedPackProgress` in dailyReelPost is the
 * only other writer of this cursor and is called exclusively inside the
 * successful-publish branch, so the rotation advanced only when a reel actually
 * reached Instagram. When every candidate is refused the cursor freezes, the
 * next day regenerates the SAME pack's topic, the new reel duplicates the last
 * attempt, originality refuses it as a repost, and nothing publishes — which
 * holds the cursor. Measured in production 2026-09-07: frozen at index 1
 * (`2026-08-16-check-engine-light`) since the last successful post on
 * 2026-08-29, with the held queue being that one topic attempted repeatedly.
 *
 * SKIPPED, NOT DELETED: the pack keeps its slot in the list, but the cursor
 * has no wrap (corrected 2026-10-08; this said it "comes back around"). It airs
 * again only if an operator moves reel_approved_pack_rotation_index back, and
 * past the last pack the daily lane falls to the topic miner.
 *
 * It writes ONLY the index. `setApprovedPackProgress` also stamps
 * `reel_autopost_last_date`, the one-post-per-day guard; stamping that here
 * would spend the day's slot on a reel that never posted.
 *
 * Returns the new index, or null when it held (and why is logged).
 */
export async function advanceRotationPastRefusedPack(input: {
  /** Log-only. Absent when the refusal happened BEFORE a job row existed —
   *  an approved pack blocked at enqueue preflight never gets an id, and the
   *  rotation must still move or that pack jams every later pulse. */
  jobId?: number | null;
  jobPackSlug: string | null | undefined;
  /** Persisted on new jobs. Missing means a legacy full-library job. */
  jobPackPool?: ApprovedPackPool | null;
  /** Active-slate definition revision captured when the job was selected. */
  jobSlateRevision?: string | null;
  reason: string;
}): Promise<number | null> {
  const { createLogger } = await import("../lib/logger");
  const log = createLogger("services:approved-pack-rotation");

  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;

  const { shopSettings } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await d
    .select({ value: shopSettings.value })
    .from(shopSettings)
    .where(eq(shopSettings.key, "reel_approved_pack_rotation_index"))
    .limit(1);
  const fullLibraryIndex = resolveApprovedPackRotationIndex(rows.length ? String(rows[0].value) : null);
  const activeSlate = await readActiveReelSlate(d);
  const target = resolveApprovedPackProgressTarget(
    input.jobPackSlug,
    fullLibraryIndex,
    activeSlate,
    input.jobPackPool,
    input.jobSlateRevision,
  );

  if (!target) {
    if (input.jobPackSlug) {
      log.warn("approved-pack selection NOT advanced past a refused reel", {
        jobId: input.jobId,
        slug: input.jobPackSlug,
        fullLibraryIndex,
        activeSlateCursor: activeSlate.cursor,
        jobPool: input.jobPackPool ?? "legacy_full_approved_library",
        activeSlateRevision: activeSlate.updatedAt,
        jobSlateRevision: input.jobSlateRevision ?? null,
        reason: input.reason,
      });
    }
    return null;
  }

  const cursorKey = target.pool === "active_slate"
    ? ACTIVE_REEL_SLATE_CURSOR_KEY
    : "reel_approved_pack_rotation_index";
  const cursorLabel = target.pool === "active_slate"
    ? "Instagram active Reel slate — next item index"
    : "Approved Reel-pack rotation — next pack index";

  await d
    .insert(shopSettings)
    .values({
      key: cursorKey,
      value: String(target.nextIndex),
      label: cursorLabel,
      category: "general",
      updatedBy: "system",
    })
    .onDuplicateKeyUpdate({ set: { value: String(target.nextIndex), updatedBy: "system" } });

  log.warn("approved-pack selection ADVANCED past a terminally refused reel", {
    jobId: input.jobId,
    slug: input.jobPackSlug,
    from: target.currentIndex,
    to: target.nextIndex,
    pool: target.pool,
    reason: input.reason,
  });
  return target.nextIndex;
}

/**
 * Load a pack and build its brief in one call, by slug.
 *
 * Exists for `reelPackRotationCoverage.test.ts`, which must ask exactly what
 * production asks — "can the real builder turn this directory into a brief?" —
 * rather than re-deriving that judgement. A hand-rolled version of this check
 * read the wrong beat key on 2026-09-07 and misclassified 143 of 164 packs in
 * both directions.
 */
export function buildApprovedPackBriefForTest(slug: string): Record<string, unknown> | null {
  const snapshot = loadApprovedProductionPack(slug);
  if (!snapshot) return null;
  return buildBriefFromApprovedProductionPack({ slug: slug as ApprovedReelPack["slug"], topic: "" }, snapshot, "coverage-probe");
}

/**
 * "Does the production builder accept this pack?" — the lane's own definition
 * of a usable pack, for readers that grade inventory (the angle bank's status
 * line). Beats counted on disk are the weaker instrument: on 2026-10-08 a
 * beat-count draft condemned 2026-08-18-power-steering-whine (0 beats under the
 * two common keys, accepted here) and passed 16 packs this rejects.
 */
export function packBuildsForLane(slug: string): boolean {
  const snapshot = loadApprovedProductionPack(slug);
  if (!snapshot) return false;
  return buildBriefFromApprovedProductionPack({ slug: slug as ApprovedReelPack["slug"], topic: "" }, snapshot, "angle-bank") !== null;
}
