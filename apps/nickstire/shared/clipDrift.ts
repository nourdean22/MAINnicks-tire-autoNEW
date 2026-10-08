/**
 * Provider drift, measured on clips already paid for (2026-10-08).
 *
 * A video provider changes its model, its defaults or its encoder without
 * telling anyone; the clips keep arriving and the pipeline keeps assembling,
 * and the first sign is a Reel that looks softer or cuts short. Nothing had
 * ever compared one week's clips with the last. Assembly already downloads
 * every clip before stitching (reelAssembly.ts), so probing them there costs
 * nothing — no provider call, no credit.
 *
 * Self-calibrating on purpose: the baseline is the provider's own MODAL shape
 * over the recent window (width x height @ fps, and the modal duration), not
 * a hardcoded expectation that would alarm on day one over a /16 padding
 * nobody minds. Fewer than MIN_BASELINE probes is "no baseline yet", not
 * drift. A provider with no probes says nothing.
 */
export interface ClipProbe {
  beatNumber: number;
  /** Who rendered it: the beat's last succeeded providerOp, or "local" for an ffmpeg render. */
  provider: string;
  width: number;
  height: number;
  /** Rounded from frame count / stream seconds; null when the container reports no frame count. */
  fps: number | null;
  durationSec: number;
}

export interface ClipDrift {
  provider: string;
  /** "1080x1920@24" — the shape most of this provider's recent clips share. */
  baseline: string;
  /** Share of the window on the baseline shape. Under 0.5 there is no majority: the window is split, not drifting from a norm. */
  baselineShare: number;
  baselineDurationSec: number;
  total: number;
  drifted: Array<{ jobId: number; beatNumber: number; signature: string; durationSec: number }>;
}

const MIN_BASELINE = 5;
const DURATION_TOLERANCE_SEC = 1;

const clipSignature = (p: Pick<ClipProbe, "width" | "height" | "fps">) => `${p.width}x${p.height}@${p.fps ?? "?"}`;

function mode<T extends string | number>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: [T, number] = [xs[0], 0];
  for (const e of counts) if (e[1] > best[1]) best = e;
  return best[0];
}

/**
 * One report per provider with enough recent clips to have a baseline. A clip
 * drifts when its shape differs from the modal shape or its length is more
 * than a second off the modal length. Local renders are deterministic and
 * are not reported.
 *
 * Probes are taken OLDEST-FIRST (by job id within the window the caller
 * passes newest-first), so when a provider changes mid-window and the two
 * shapes tie, the older shape is the baseline and the NEW clips read as the
 * drift — not the other way round. `baselineShare` says how much of the
 * window the baseline actually holds.
 */
export function clipDriftReport(probes: Array<ClipProbe & { jobId: number }>): ClipDrift[] {
  const byProvider = new Map<string, Array<ClipProbe & { jobId: number }>>();
  for (const p of [...probes].sort((a, b) => a.jobId - b.jobId || a.beatNumber - b.beatNumber)) {
    if (p.provider === "local") continue;
    const list = byProvider.get(p.provider) ?? [];
    list.push(p);
    byProvider.set(p.provider, list);
  }
  const out: ClipDrift[] = [];
  for (const [provider, list] of byProvider) {
    if (list.length < MIN_BASELINE) continue;
    const baseline = mode(list.map(clipSignature));
    const baselineShare = list.filter((p) => clipSignature(p) === baseline).length / list.length;
    const baselineDurationSec = mode(list.map((p) => Math.round(p.durationSec * 2) / 2));
    const drifted = list
      .filter((p) => clipSignature(p) !== baseline || Math.abs(p.durationSec - baselineDurationSec) > DURATION_TOLERANCE_SEC)
      .map((p) => ({ jobId: p.jobId, beatNumber: p.beatNumber, signature: clipSignature(p), durationSec: p.durationSec }));
    out.push({ provider, baseline, baselineShare, baselineDurationSec, total: list.length, drifted });
  }
  return out.sort((a, b) => b.drifted.length - a.drifted.length || a.provider.localeCompare(b.provider));
}
