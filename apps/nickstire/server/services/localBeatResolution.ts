/**
 * Local beat resolution (2026-10-09) — runs in processNextReelJob BEFORE the
 * provider loop and before any spend. For every beat shotRouter says this
 * machine resolves (beatsToResolveLocally):
 *
 *   bound_real   verify the named registry asset is real_shop VIDEO the lane may
 *                reuse (realShotBinding), bind its exact URL + sha256, and write
 *                the probed source duration onto the beat so assembly can hold it
 *                longer than a 4 s provider clip (reelAssembly.segmentCapSeconds).
 *   render_card  draw the deterministic card at the beat's segment length
 *                (deterministicCard) and bind the rendered mp4 + its sha256.
 *
 * Either outcome lands in clipUrls at the beat's slot, so the generator's own
 * "already has an http clip" skip leaves it alone, and in `shotLineage` so the
 * disclosure can say what each shot is. Any failure is a typed hold with a
 * reason; nothing degrades to a generated substitute.
 */
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
import type { ShotLineage } from "../../shared/reelSourceProfile";
import { parseCaptionStyle } from "../../shared/reelSourceProfile";
import type { LocalBeatRoute } from "../../shared/shotRouter";

const log = createLogger("services:local-beat-resolution");

export interface LocalResolvableBeat {
  beatNumber: number;
  startSecond?: number;
  endSecond?: number;
  onScreenText?: string;
  visual?: string;
  source?: string | null;
  realAssetId?: string | null;
  cardLines?: string[] | null;
  sourceDurationSec?: number | null;
}

export type LocalResolution =
  | { ok: true; clipUrls: string[]; lineage: ShotLineage[]; patchedBeats: LocalResolvableBeat[] }
  | { ok: false; reason: string; holds: Array<{ beatNumber: number; route: "needs_real_footage" | "needs_deterministic_render" }> };

export async function resolveLocalBeats(input: {
  database: DB;
  jobId: number;
  beats: LocalResolvableBeat[];
  existingClipUrls: unknown;
  local: ReadonlyArray<{ beatNumber: number; index: number; route: LocalBeatRoute; realAssetId?: string }>;
  captionStyle?: unknown;
  now?: () => string;
}): Promise<LocalResolution> {
  const now = input.now ?? (() => new Date().toISOString());
  const clipUrls: string[] = Array.isArray(input.existingClipUrls) ? [...(input.existingClipUrls as string[])] : [];
  const beats = input.beats.map((b) => ({ ...b }));
  const lineage: ShotLineage[] = [];

  // 1. Real beats: verify + bind, and patch the probed duration onto the beat first,
  //    because the segment length below depends on it.
  const realTargets = input.local.filter((l) => l.route === "bound_real");
  if (realTargets.length) {
    const { resolveRealBeatAssets, realShotRefusalReason, lineageForBinding } = await import("./realShotBinding");
    const { bindings, refusals } = await resolveRealBeatAssets(
      input.database,
      realTargets.map((t) => ({ beatNumber: t.beatNumber, realAssetId: t.realAssetId })),
    );
    if (refusals.length) {
      const reason = realShotRefusalReason(refusals);
      log.error("real beat(s) refused at binding — job held before spend", { jobId: input.jobId, reason });
      return { ok: false, reason, holds: refusals.map((r) => ({ beatNumber: r.beatNumber, route: "needs_real_footage" as const })) };
    }
    // A bound clip must carry the beat it was planned for (review of #2946):
    // enqueue budgeted narration and readability against the authored beat
    // (capped at the generated 4 s), so a shorter clip would silently shrink
    // the Reel under its own voice track. Refuse it; never pad or freeze it.
    const { MAX_CLIP_SECONDS } = await import("./reelAssembly");
    const short = bindings.flatMap((b) => {
      const beat = beats.find((x) => x.beatNumber === b.beatNumber);
      const declared = Number(beat?.endSecond) - Number(beat?.startSecond);
      const required = Math.min(Number.isFinite(declared) && declared > 0 ? declared : MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
      return b.sourceDurationSec + 0.05 < required ? [{ ...b, required }] : [];
    });
    if (short.length) {
      const reason = `REAL_ASSET_TOO_SHORT (blocked at generation, before spend): ${short.map((s) => `beat ${s.beatNumber} (asset ${s.assetId}) is ${s.sourceDurationSec.toFixed(2)} s but the beat needs ${s.required.toFixed(2)} s`).join("; ")}. Capture a longer clip or shorten the beat; nothing was padded. Nothing was generated.`;
      log.error("real beat(s) bound to a clip shorter than the beat — job held before spend", { jobId: input.jobId, reason });
      return { ok: false, reason, holds: short.map((s) => ({ beatNumber: s.beatNumber, route: "needs_real_footage" as const })) };
    }
    for (const b of bindings) {
      const beat = beats.find((x) => x.beatNumber === b.beatNumber);
      if (beat) beat.sourceDurationSec = b.sourceDurationSec;
    }
    const { briefToSegments } = await import("./reelAssembly");
    const segs = briefToSegments({ storyboardBeats: beats as never, captionStyle: parseCaptionStyle(input.captionStyle) });
    for (const b of bindings) {
      const slot = realTargets.find((t) => t.beatNumber === b.beatNumber)!.index;
      clipUrls[slot] = b.url;
      const dur = segs.find((s) => s.beatNumber === b.beatNumber)?.dur ?? 0;
      lineage.push(lineageForBinding(b, dur, now));
      log.info("real beat bound to registry asset", { jobId: input.jobId, beat: b.beatNumber, assetId: b.assetId, sha256: b.sha256.slice(0, 12), sourceDurationSec: b.sourceDurationSec, onScreenSec: dur });
    }
  }

  // 2. Deterministic beats: draw at exactly the segment length.
  const cardTargets = input.local.filter((l) => l.route === "render_card");
  if (cardTargets.length) {
    // A card re-hosts through storagePut like a template_stock beat; without
    // durable storage it would land on ephemeral disk and a redeploy would
    // destroy it before assembly. Same precondition, before any render.
    const { assertDurableStorageForGeneration } = await import("../storage");
    assertDurableStorageForGeneration(`reel job ${input.jobId} deterministic card render`);
    const { briefToSegments } = await import("./reelAssembly");
    const { cardSpecFromBeat, renderDeterministicCardClip, lineageForCard } = await import("./deterministicCard");
    const segs = briefToSegments({ storyboardBeats: beats as never, captionStyle: parseCaptionStyle(input.captionStyle) });
    for (const t of cardTargets) {
      const beat = beats.find((x) => x.beatNumber === t.beatNumber);
      const dur = segs.find((s) => s.beatNumber === t.beatNumber)?.dur ?? 3;
      try {
        const spec = cardSpecFromBeat(beat ?? {});
        const rendered = await renderDeterministicCardClip({ beatNumber: t.beatNumber, seconds: dur, spec });
        clipUrls[t.index] = rendered.url;
        lineage.push(lineageForCard(t.beatNumber, rendered.sha256, rendered.seconds, now, rendered.url));
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const reason = `CARD_RENDER_FAILED (blocked at generation, before spend): beat ${t.beatNumber} is declared deterministic and the local card could not be rendered — ${detail}. Nothing was generated.`;
        log.error("deterministic card render failed — job held before spend", { jobId: input.jobId, beat: t.beatNumber, detail });
        return { ok: false, reason, holds: [{ beatNumber: t.beatNumber, route: "needs_deterministic_render" }] };
      }
    }
  }

  return { ok: true, clipUrls, lineage, patchedBeats: beats };
}

/**
 * How many clip slots hold a locally resolved clip (registry footage or a
 * drawn card) according to the lineage. Read at settlement so those clips are
 * counted as free-lane, never billed at the paid provider's rate — and read
 * from the persisted lineage, not a loop counter, so a resumed job (clips
 * already bound on an earlier pulse) settles the same way. Pure.
 */
export function locallyResolvedClipCount(shotLineage: unknown, clipUrls: ReadonlyArray<unknown>, beats: ReadonlyArray<{ beatNumber: number }>): number {
  const rows = Array.isArray(shotLineage) ? (shotLineage as ShotLineage[]) : [];
  let n = 0;
  rows.forEach((r) => {
    if (!r || (r.origin !== "registry_real_shop" && r.origin !== "local_card")) return;
    const index = beats.findIndex((b) => b.beatNumber === r.beatNumber);
    const clip = index >= 0 ? clipUrls[index] : undefined;
    if (typeof clip === "string" && clip.startsWith("http")) n++;
  });
  return n;
}

/** Merge new lineage rows over any persisted ones, one row per beat (the newest binding wins). */
export function mergeShotLineage(existing: unknown, fresh: ReadonlyArray<ShotLineage>): ShotLineage[] {
  const prior = Array.isArray(existing) ? (existing as ShotLineage[]).filter((r) => r && Number.isInteger(r.beatNumber)) : [];
  const byBeat = new Map<number, ShotLineage>();
  for (const r of prior) byBeat.set(r.beatNumber, r);
  for (const r of fresh) byBeat.set(r.beatNumber, r);
  return [...byBeat.values()].sort((a, b) => a.beatNumber - b.beatNumber);
}
