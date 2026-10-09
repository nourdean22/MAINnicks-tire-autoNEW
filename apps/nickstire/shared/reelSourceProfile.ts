/**
 * Source-aware production profile (2026-10-09). Three independent dimensions
 * the creative mission asked to keep separate, expressed on the brief rather
 * than inferred from prose:
 *
 *   presenceProfile  — what human presence a beat may carry.
 *     object_only      today's contract: no faces, hands, gloves or arms on any beat.
 *     hands_only_real  real hands and tools are allowed ONLY on beats declared
 *                      source=real (captured footage); faces, talking heads and
 *                      figures stay blocked everywhere; generated beats keep the
 *                      object-only rule, because a model drawing hands doing
 *                      safety-critical work is exactly the defect the critic blocks.
 *   captionStyle     — how burned-in captions are sanitised and drawn.
 *     legacy_upper     uppercase, `%` and `\` stripped (drawtext expansion on).
 *     sentence         sentence case as written, `%`, `/` and units preserved,
 *                      drawn with drawtext `expansion=none` so nothing is re-parsed.
 *   ShotLineage      — per-shot provenance persisted on the job payload: which
 *                      exact asset (id + sha256) or renderer produced the clip
 *                      that reached the final MP4, its rights, source duration
 *                      and the trim that was used.
 *
 * Pure and client-safe (imported by the Studio brief type and the server).
 */
import type { ShotSource } from "./shotRouter";

export type PresenceProfile = "object_only" | "hands_only_real";
export type CaptionStyle = "legacy_upper" | "sentence";

const PRESENCE_PROFILES: readonly PresenceProfile[] = ["object_only", "hands_only_real"];
const CAPTION_STYLES: readonly CaptionStyle[] = ["legacy_upper", "sentence"];

/** Untrusted JSON → a profile, or the legacy default. Never throws. */
export function parsePresenceProfile(value: unknown): PresenceProfile {
  const v = typeof value === "string" ? value.trim() : "";
  return (PRESENCE_PROFILES as readonly string[]).includes(v) ? (v as PresenceProfile) : "object_only";
}

export function parseCaptionStyle(value: unknown): CaptionStyle {
  const v = typeof value === "string" ? value.trim() : "";
  return (CAPTION_STYLES as readonly string[]).includes(v) ? (v as CaptionStyle) : "legacy_upper";
}

/**
 * Whether a beat may show real hands/tools. True only under hands_only_real
 * AND for a beat whose declared source is real — a generated beat never gets
 * hands, whatever the profile says.
 */
export function beatAllowsHands(profile: PresenceProfile, source: ShotSource | "unspecified" | null | undefined): boolean {
  return profile === "hands_only_real" && source === "real";
}

/** Where the bytes of one shot came from. */
export type ShotOrigin = "registry_real_shop" | "local_card" | "provider";

export interface ShotLineage {
  beatNumber: number;
  source: ShotSource | "unspecified";
  origin: ShotOrigin;
  /** media_assets.id for registry-backed real footage. */
  assetId?: string;
  /** sha256 of the exact clip bytes bound to this beat (registry checksum, or the rendered card). */
  sha256?: string;
  /** The clip URL written into clipUrls for this beat at bind time; the disclosure cross-checks it. */
  url?: string;
  /** media_assets.rights_status at bind time. */
  rightsStatus?: string;
  /** Probed duration of the source clip, seconds. */
  sourceDurationSec?: number;
  /** Trim window used by assembly, seconds from the clip start. */
  trimInSec?: number;
  trimOutSec?: number;
  /** Seconds this shot occupies in the finished timeline. */
  onScreenSec?: number;
  /** Renderer id for local cards (e.g. svg_card_v1); provider id for generated beats. */
  renderer?: string;
  provider?: string;
  /** A declared still hold (a card that does not move) — never a disguised freeze. */
  stillHold?: boolean;
  /** ISO time the binding or render happened. */
  boundAt?: string;
}

/** Untrusted payload → lineage rows; rows without a beat number are dropped. Never throws. */
export function parseShotLineage(value: unknown): ShotLineage[] {
  if (!Array.isArray(value)) return [];
  const out: ShotLineage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const beatNumber = Number(r.beatNumber);
    if (!Number.isInteger(beatNumber) || beatNumber < 1) continue;
    const origin = r.origin;
    if (origin !== "registry_real_shop" && origin !== "local_card" && origin !== "provider") continue;
    out.push({ ...(r as unknown as ShotLineage), beatNumber, origin });
  }
  return out;
}

/** One line per shot for the disclosure/manifest: what the viewer is actually looking at. */
export function describeShotLineage(rows: ReadonlyArray<ShotLineage>): string[] {
  return [...rows]
    .sort((a, b) => a.beatNumber - b.beatNumber)
    .map((r) => {
      const what =
        r.origin === "registry_real_shop" ? `real shop footage (asset ${r.assetId ?? "?"}, sha256 ${(r.sha256 ?? "").slice(0, 12)})`
        : r.origin === "local_card" ? `deterministic card (${r.renderer ?? "card"}${r.stillHold ? ", still hold" : ""})`
        : `generated (${r.provider ?? "provider"})`;
      const secs = typeof r.onScreenSec === "number" ? ` ${r.onScreenSec.toFixed(1)}s` : "";
      return `beat ${r.beatNumber}: ${what}${secs}`;
    });
}
