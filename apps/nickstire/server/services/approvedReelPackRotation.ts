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
import { resolvePacksDir } from "./reelPackRegistry";
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

] as const;

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
export function loadApprovedProductionPack(slug: string): ApprovedProductionPackSnapshot | null {
  const packsDir = resolvePacksDir();
  if (!packsDir) return null;
  const packDir = path.join(packsDir, slug);
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
    sourcePath: `apps/nickstire/docs/reel-packs/${slug}`,
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
    };
  });
  const selectedCaption = stringValue(source.selectedCaption) || stringValue(source.caption) || primaryCaptionFromReadme(snapshot.files.readme);
  if (storyboardBeats.length < 4 || !selectedCaption) return null;
  const hashtags = arrayOfStrings(source.hashtags).length ? arrayOfStrings(source.hashtags).slice(0, 5) : hashtagsFromCaption(selectedCaption);
  const voiceoverScript = stringValue(source.voiceoverScript) || storyboardBeats.map((beat) => {
    const raw = rawBeats[beat.beatNumber - 1] as Record<string, unknown> | undefined;
    return stringValue(raw?.narration) || stringValue(raw?.vo);
  }).filter(Boolean).join(" ");
  const campaignKeyword = stringValue(source.campaignKeyword) || pack.slug.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
  const topic = stringValue(source.topic) || pack.topic;
  const sourceNotes = Array.isArray(source.sourceNotes) ? source.sourceNotes : [];
  const hasProofSource = sourceNotes.some((note) =>
    Boolean(note && typeof note === "object" && (note as Record<string, unknown>).kind === "proof"),
  );
  return {
    id: briefId,
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
    archetype: "tiny_cinematic_story",
    motionLens: "extreme_macro_push_in",
    objectCharacter: "rust_creeping_villain",
    usefulAbsurdity: stringValue(source.usefulAbsurdity),
    concepts: [],
    winningConceptId: null,
    storyboardBeats,
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
