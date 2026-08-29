/**
 * Five buses, declared ducking, and silence you can author.
 *
 * ── WHAT THE PIPELINE DOES TODAY ────────────────────────────────────────────
 * Two sources - a voiceover and a music bed - mixed with one sidechain
 * compressor and a hardcoded `volume=0.6` on the music. That is already better
 * than a static duck, and the sidechain was hard-won (the comment in
 * reelAssembly records that the compressor's output ENDS when its key input
 * ends, which once truncated a reel's audio to 7s). Nothing here undoes that.
 *
 * What it cannot express is everything else a mix needs: footsteps and tool
 * clinks (foley), designed hits on a reveal (sfx), and room tone that makes a
 * shop feel like a place rather than a void (ambience). With one music channel
 * those either do not exist or fight the voice for the same fader.
 *
 * ── DUCKING IS A RULE, NOT A NUMBER ─────────────────────────────────────────
 * `volume=0.6` is a decision taken once, in the dark, applied to every reel.
 * A rule says WHICH bus yields to WHICH and by how much, so a designed hit can
 * punch through while a music bed steps back, and so the reason is written down
 * where the next person can argue with it.
 *
 * ── ON LOUDNESS TARGETS ─────────────────────────────────────────────────────
 * This module does NOT ship a platform loudness number. Instagram publishes no
 * organic loudness target, and a figure like "-14 LUFS" circulates as if it
 * were a spec. `PRODUCTION_LOUDNESS_LUFS` below is a PRODUCTION CHOICE for
 * internal consistency between episodes - so episode 17 is not louder than
 * episode 16 - and it is labelled as such deliberately. If it is ever cited as
 * a platform requirement, that citation is wrong.
 */
import { AUDIO_BUSES, type AudioBus } from "./reelTimeline";

/**
 * A production choice, NOT a platform standard. See the module header.
 * Chosen for episode-to-episode consistency only.
 */
export const PRODUCTION_LOUDNESS_LUFS = -14;

export interface BusConfig {
  bus: AudioBus;
  /** Linear gain applied before the mix. */
  gain: number;
  /** Human reason, so the number is arguable rather than inherited. */
  why: string;
}

export const BUS_DEFAULTS: Readonly<Record<AudioBus, BusConfig>> = {
  dialogue: { bus: "dialogue", gain: 1.15, why: "the voice is the content; everything else yields to it" },
  music: { bus: "music", gain: 0.6, why: "bed only — carries energy, never competes with a word" },
  foley: { bus: "foley", gain: 0.75, why: "tool clinks and footsteps sell the room as a real place" },
  sfx: { bus: "sfx", gain: 0.9, why: "designed hits mark a reveal and must survive the duck" },
  ambience: { bus: "ambience", gain: 0.35, why: "room tone; felt, not heard" },
};

export interface DuckingRule {
  /** The bus whose signal triggers the duck. */
  key: AudioBus;
  /** The bus that steps back. */
  target: AudioBus;
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  why: string;
}

/**
 * Dialogue ducks the beds. SFX is deliberately NOT ducked: a designed hit that
 * gets squashed by the voice is a hit nobody hears, and the whole point of
 * placing one on a reveal is that it lands.
 */
export const DUCKING_RULES: readonly DuckingRule[] = [
  {
    key: "dialogue", target: "music", threshold: 0.03, ratio: 8, attackMs: 20, releaseMs: 400,
    why: "music breathes back in the gaps between phrases rather than sitting at a fixed level",
  },
  {
    key: "dialogue", target: "ambience", threshold: 0.05, ratio: 4, attackMs: 30, releaseMs: 500,
    why: "room tone recedes under speech but never disappears, so the space stays continuous",
  },
  {
    key: "dialogue", target: "foley", threshold: 0.05, ratio: 3, attackMs: 20, releaseMs: 300,
    why: "props stay audible but stop competing with consonants",
  },
];

/** Which buses are present in a given render. */
export interface MixInputs {
  present: readonly AudioBus[];
}

/** Rules that actually apply, given which buses exist in this render. */
export function applicableRules(inputs: MixInputs): DuckingRule[] {
  const have = new Set(inputs.present);
  return DUCKING_RULES.filter((r) => have.has(r.key) && have.has(r.target));
}

/**
 * Why this mix is not authored, or null when it is sound.
 *
 * The one hard requirement: if dialogue and a bed both exist, the bed must be
 * ducked. A static-level bed under a voice is the defect this replaces.
 */
export function mixProblem(inputs: MixInputs): string | null {
  const have = new Set(inputs.present);
  for (const b of inputs.present) {
    if (!AUDIO_BUSES.includes(b)) return `unknown audio bus "${b}"`;
  }
  if (!have.has("dialogue")) return null; // instrumental reels are legitimate
  const beds: AudioBus[] = ["music", "ambience"];
  for (const bed of beds) {
    if (have.has(bed) && !applicableRules(inputs).some((r) => r.target === bed)) {
      return `${bed} plays under dialogue with no ducking rule — a fixed-level bed fights every word`;
    }
  }
  return null;
}

/**
 * ffmpeg filter fragments for the declared mix.
 *
 * `labels` maps a bus to its existing filtergraph label. Returned fragments are
 * appended to the graph; the final mixed label is returned so the caller can
 * map it. Kept pure and string-returning so the result is assertable in a test
 * without spawning ffmpeg — the same seam the picture side already uses.
 */
export function buildMixFragments(
  labels: Readonly<Partial<Record<AudioBus, string>>>,
  opts: { totalSec: number },
): { fragments: string[]; outLabel: string } | null {
  const present = AUDIO_BUSES.filter((b) => labels[b]);
  if (!present.length) return null;

  const fragments: string[] = [];
  const gained: Partial<Record<AudioBus, string>> = {};

  for (const bus of present) {
    const cfg = BUS_DEFAULTS[bus];
    const out = `${bus}_g`;
    fragments.push(`[${labels[bus]}]aresample=48000,volume=${cfg.gain}[${out}]`);
    gained[bus] = out;
  }

  const rules = applicableRules({ present });
  let keyLabel = gained.dialogue;
  if (keyLabel && rules.length) {
    // One split per consumer plus the mix copy. sidechaincompress consumes its
    // key, so each target needs its own branch of the dialogue signal.
    const branches = rules.map((_, i) => `dlg_key${i}`);
    fragments.push(`[${keyLabel}]asplit=${branches.length + 1}[dlg_mix]${branches.map((b) => `[${b}]`).join("")}`);
    gained.dialogue = "dlg_mix";
    rules.forEach((r, i) => {
      // Pad the key to the full duration: the compressor's output ends when its
      // key ends, which once truncated a whole reel's audio.
      fragments.push(`[${branches[i]}]apad=whole_dur=${opts.totalSec}[${branches[i]}_p]`);
      fragments.push(
        `[${gained[r.target]}][${branches[i]}_p]sidechaincompress=` +
          `threshold=${r.threshold}:ratio=${r.ratio}:attack=${r.attackMs}:release=${r.releaseMs}[${r.target}_duck]`,
      );
      gained[r.target] = `${r.target}_duck`;
    });
  }

  const mixIn = present.map((b) => `[${gained[b]}]`).join("");
  fragments.push(`${mixIn}amix=inputs=${present.length}:duration=longest:normalize=0[amix_out]`);
  fragments.push(
    `[amix_out]atrim=0:${opts.totalSec},asetpts=PTS-STARTPTS,apad=whole_dur=${opts.totalSec},` +
      `loudnorm=I=${PRODUCTION_LOUDNESS_LUFS}:TP=-1.5:LRA=11,aresample=48000[aout]`,
  );
  return { fragments, outLabel: "aout" };
}
