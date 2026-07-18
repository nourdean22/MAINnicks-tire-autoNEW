/**
 * What can actually still be done with a stuck reel job — and what it would cost.
 *
 * WHY THIS EXISTS
 * Three reels sat in status "assembled" for two days with nothing to move them.
 * The obvious "action center" would offer Run QA / Repair / Publish. Probing
 * production showed why that would be a lie: every one of those jobs' mp4Url
 * returns 404. data/generated is on the container's ephemeral disk, so a restart
 * takes the master with it. You cannot QA, repair, or publish bytes that no
 * longer exist, and an operator clicking "Repair" would get a confusing failure
 * instead of the truth.
 *
 * So actions are derived from MEASURED artifact reachability, never from status
 * alone. Status says what the pipeline believed; reachability says what survived.
 *
 * COST HONESTY
 * "Regenerate from brief" is NOT a repair. It is a new paid generation producing
 * new media, new hashes and a fresh approval lifecycle. It is labelled that way
 * everywhere so nobody clicks it thinking they are recovering an asset.
 */

/** Ordered most-recoverable to least. */
export type Recoverability =
  | "master_available"
  | "clips_available_master_missing"
  | "provider_resume_available"
  | "brief_only"
  | "unrecoverable";

/** One artifact and whether it is actually fetchable right now. */
export interface ArtifactProbe {
  url: string | null;
  reachable: boolean;
}

export interface RecoverabilityInput {
  status: string;
  master: ArtifactProbe;
  /** Source clips. Partial survival still matters — see the note in classify(). */
  clips: ArtifactProbe[];
  voiceover?: ArtifactProbe;
  music?: ArtifactProbe;
  /** A provider-side job that could be resumed without re-paying, if any. */
  providerResumeId?: string | null;
  /** Does the payload still hold a usable brief (storyboard beats)? */
  hasBrief: boolean;
}

export interface RecoveryAction {
  id: "publish" | "rerun_qa" | "reassemble" | "resume_generation" | "regenerate_new_job" | "archive_unrecoverable" | "discard";
  label: string;
  /** true when the action spends money with a generation provider. */
  costsMoney: boolean;
  /** true when it produces a NEW asset identity (new hashes, new approval). */
  newAssetIdentity: boolean;
  detail: string;
}

export interface RecoveryAssessment {
  recoverability: Recoverability;
  /** Plain-language reason, for the operator — not a status code. */
  explanation: string;
  actions: RecoveryAction[];
  /** Artifacts the job's own record points at that no longer resolve. */
  danglingUrls: string[];
}

const DISCARD: RecoveryAction = {
  id: "discard",
  label: "Discard job",
  costsMoney: false,
  newAssetIdentity: false,
  detail: "Close the job without publishing. Nothing is recovered.",
};

const ARCHIVE: RecoveryAction = {
  id: "archive_unrecoverable",
  label: "Archive as unrecoverable",
  costsMoney: false,
  newAssetIdentity: false,
  detail: "Keep the record and its decisions for audit, but mark the media permanently lost.",
};

const REGENERATE: RecoveryAction = {
  id: "regenerate_new_job",
  label: "Regenerate from brief (new paid job)",
  costsMoney: true,
  newAssetIdentity: true,
  // Spelled out because the tempting shorthand — "repair" — would be false.
  detail:
    "Starts a NEW generation from the surviving brief. This is not a repair: it spends generation " +
    "budget and produces different media with new hashes, so it needs its own QA and approval.",
};

/**
 * Classify a job from measured reachability.
 *
 * Deliberately conservative in two places:
 *  - A master counts only if it is REACHABLE. A non-null mp4Url proves the
 *    pipeline once wrote one, not that it still exists — conflating those is
 *    exactly how three jobs looked publishable while being empty.
 *  - Clips count only if ALL of them survive. A partial set cannot be
 *    re-assembled into the approved reel, and silently assembling a shorter one
 *    would change the content behind an approval that described the original.
 */
export function classifyRecoverability(input: RecoverabilityInput): RecoveryAssessment {
  const dangling = [
    input.master,
    ...input.clips,
    ...(input.voiceover ? [input.voiceover] : []),
    ...(input.music ? [input.music] : []),
  ]
    .filter((a) => a.url && !a.reachable)
    .map((a) => a.url as string);

  if (input.master.url && input.master.reachable) {
    return {
      recoverability: "master_available",
      explanation: "The rendered master is still fetchable, so every normal action applies.",
      actions: [
        { id: "publish", label: "Publish", costsMoney: false, newAssetIdentity: false, detail: "Publish through the normal gates." },
        { id: "rerun_qa", label: "Re-run rendered QA", costsMoney: false, newAssetIdentity: false, detail: "Re-evaluate the existing master; no generation spend." },
        DISCARD,
      ],
      danglingUrls: dangling,
    };
  }

  const clipsPresent = input.clips.length > 0;
  const allClipsReachable = clipsPresent && input.clips.every((c) => c.reachable);
  if (allClipsReachable) {
    return {
      recoverability: "clips_available_master_missing",
      explanation:
        "The master is gone but every source clip survives, so the reel can be re-assembled without paying to generate again.",
      actions: [
        {
          id: "reassemble",
          label: "Re-assemble from surviving clips",
          costsMoney: false,
          newAssetIdentity: true,
          detail:
            "Re-runs ffmpeg over the existing clips. No generation spend, but the output is a new file " +
            "with a new hash, so it must pass QA and be approved again.",
        },
        REGENERATE,
        DISCARD,
      ],
      danglingUrls: dangling,
    };
  }

  if (input.providerResumeId) {
    return {
      recoverability: "provider_resume_available",
      explanation: "Local media is gone, but the provider still holds a resumable job for this reel.",
      actions: [
        {
          id: "resume_generation",
          label: "Resume from the provider",
          costsMoney: false,
          newAssetIdentity: true,
          detail: "Re-fetches already-paid-for output from the provider rather than generating again.",
        },
        REGENERATE,
        DISCARD,
      ],
      danglingUrls: dangling,
    };
  }

  if (input.hasBrief) {
    return {
      recoverability: "brief_only",
      explanation:
        clipsPresent
          ? "Some clips are missing and the master is gone, so nothing can be re-assembled. Only the brief survives."
          : "All media for this job is gone. Only the brief survives.",
      actions: [REGENERATE, ARCHIVE, DISCARD],
      danglingUrls: dangling,
    };
  }

  return {
    recoverability: "unrecoverable",
    explanation: "Neither media nor a usable brief survives. There is nothing left to act on.",
    actions: [ARCHIVE, DISCARD],
    danglingUrls: dangling,
  };
}

/**
 * HEAD a URL to see whether it still resolves.
 *
 * Any failure counts as unreachable — for a recovery decision, "cannot confirm it
 * exists" and "does not exist" lead to the same safe action, and treating a
 * timeout as success is how a dead asset gets offered as publishable.
 */
export async function probeUrl(url: string | null | undefined, timeoutMs = 10_000): Promise<ArtifactProbe> {
  if (!url) return { url: null, reachable: false };
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    return { url, reachable: res.ok };
  } catch {
    return { url, reachable: false };
  }
}
