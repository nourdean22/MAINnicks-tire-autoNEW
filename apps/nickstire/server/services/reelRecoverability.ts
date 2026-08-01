import type { DB } from "../db";
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

  /**
   * `input.status` was accepted by this function and never read — a parameter
   * that looked like a guard and guarded nothing.
   *
   * It matters most in the branch below that this function reaches FIRST for an
   * in-flight job: thirty seconds into `generating` there is no master and no
   * clips, which is indistinguishable from total media loss by reachability
   * alone. The old code fell to `hasBrief` and offered "Spend and regenerate"
   * on a job that was actively rendering.
   *
   * Reachability answers "what survives". Only status answers "is anyone still
   * working on it", and paying again is only safe when the answer is no.
   */
  const inFlight = !isRegenerable(input.status);
  const withoutRegenerate = (actions: RecoveryAction[]) =>
    // REGENERATE.id, not a re-typed literal — the union caught "regenerate" as a
    // value that cannot occur, which would have filtered nothing at all.
    inFlight ? actions.filter((a) => a.id !== REGENERATE.id) : actions;
  const inFlightNote = inFlight
    ? " This job is still in flight, so regenerating is withheld — paying again would run two renders of the same brief, and the running one cannot be cancelled."
    : "";

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
      actions: withoutRegenerate([
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
      ]),
      danglingUrls: dangling,
    };
  }

  if (input.providerResumeId) {
    return {
      recoverability: "provider_resume_available",
      explanation: "Local media is gone, but the provider still holds a resumable job for this reel." + inFlightNote,
      actions: withoutRegenerate([
        {
          id: "resume_generation",
          label: "Resume from the provider",
          costsMoney: false,
          newAssetIdentity: true,
          detail: "Re-fetches already-paid-for output from the provider rather than generating again.",
        },
        REGENERATE,
        DISCARD,
      ]),
      danglingUrls: dangling,
    };
  }

  if (input.hasBrief) {
    return {
      recoverability: "brief_only",
      explanation:
        (inFlight
          // Absence of media on an in-flight job is a NORMAL mid-render state, and
          // describing it as loss is what made "regenerate" look like the fix.
          ? "This job is still working. No media has been written yet, which is expected while it runs."
          : clipsPresent
            ? "Some clips are missing and the master is gone, so nothing can be re-assembled. Only the brief survives."
            : "All media for this job is gone. Only the brief survives.") + inFlightNote,
      actions: withoutRegenerate([REGENERATE, ARCHIVE, DISCARD]),
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

/** A reel job as the assessor needs it — the columns, nothing more. */
export interface AssessableJob {
  id: number;
  status: string;
  payload: string | null;
  mp4Url: string | null;
  clipUrlsJson: string | null;
  voUrl: string | null;
  musicUrl: string | null;
  error: string | null;
  updatedAt: Date | string | null;
}

export interface JobAssessment extends RecoveryAssessment {
  jobId: number;
  status: string;
  /** Why the pipeline stopped here, in the operator's words — not a status code. */
  holdReason: string;
  lastError: string | null;
  stalledHours: number | null;
}

/**
 * Assess a single job by PROBING its artifacts, then classifying.
 *
 * Every URL is fetched (HEAD) rather than trusted, because a recorded URL only
 * proves the pipeline once wrote one. The three jobs that prompted this all had a
 * populated mp4Url and no file behind it.
 */
export async function assessReelJob(
  job: AssessableJob,
  opts: { gateReason?: string } = {},
): Promise<JobAssessment> {
  let clipUrls: string[] = [];
  try {
    const parsed = JSON.parse(job.clipUrlsJson ?? "[]");
    if (Array.isArray(parsed)) clipUrls = parsed.filter((u): u is string => typeof u === "string");
  } catch {
    // A corrupt clip list means we cannot claim clips survive — treated as none,
    // which is the conservative direction (offers regeneration, not re-assembly).
  }

  let hasBrief = false;
  try {
    const p = JSON.parse(job.payload ?? "{}") as { storyboardBeats?: unknown };
    hasBrief = Array.isArray(p.storyboardBeats) && p.storyboardBeats.length > 0;
  } catch { /* unparseable payload => no usable brief */ }

  const [master, ...clips] = await Promise.all([
    probeUrl(job.mp4Url),
    ...clipUrls.map((u) => probeUrl(u)),
  ]);
  const [voiceover, music] = await Promise.all([probeUrl(job.voUrl), probeUrl(job.musicUrl)]);

  const assessment = classifyRecoverability({
    status: job.status,
    master,
    clips,
    voiceover,
    music,
    hasBrief,
  });

  const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : null;
  const stalledHours = updatedAt ? Math.round(((Date.now() - updatedAt) / 3_600_000) * 10) / 10 : null;

  return {
    ...assessment,
    jobId: job.id,
    status: job.status,
    // The gate reason is the SPECIFIC answer to "why is this not published"; the
    // recoverability explanation answers "what can still be done about it". A
    // hold the operator cannot read the reason for is indistinguishable from the
    // system having quietly stopped.
    holdReason: opts.gateReason || assessment.explanation,
    lastError: job.error,
    stalledHours,
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

/**
 * The ONE definition of "a reel job needs attention", so every screen agrees.
 *
 * HQ counted `status = "failed"` (61 rows in prod, going back to a leaked API key
 * months ago) while the Action Center listed only non-terminal states and excluded
 * failed entirely. HQ said 61, the Action Center said "nothing is stuck", and an
 * operator seeing two screens disagree stops trusting both.
 *
 * `failed` IS actionable — it can be regenerated or closed — but only while it is
 * still relevant. An ancient failure is history, not a task, so it is scoped to a
 * window rather than counted forever.
 */
export const ATTENTION_STATUSES = [
  "assembled", "publishing", "publish_ambiguous",
  "queued", "generating", "assets_ready", "assembling", "repair_rendering",
] as const;

/** Failures older than this are history, not a to-do. */
export const FAILED_ATTENTION_DAYS = 14;

/**
 * Failures the OPERATOR already closed. These stay `failed` forever (there is
 * no "closed" status), so without this they are re-counted as outstanding work
 * every time the badge polls — for the whole 14-day window.
 *
 * Measured 2026-08-01: the badge read "12 reel job(s) need attention" while 4 of
 * those 12 carried an explicit closure the operator had already written. A badge
 * that counts finished work as pending trains you to ignore it, which costs more
 * than the badge is worth.
 *
 * DELIBERATELY NARROW — matches only markers this codebase WRITES on an explicit
 * close, never a failure category. In particular it does NOT suppress
 * "Session expired": that root cause was fixed on 2026-07-31, but a FUTURE
 * expiry is real, urgent, and must show. Suppressing by cause would hide the
 * next outage; suppressing by explicit closure cannot.
 */
export const OPERATOR_CLOSED_MARKERS = [
  "discarded by operator",
  "superseded by regenerated job",
  // Written per-row when a failure's root cause has since been fixed and the job
  // itself is stale (topic aged out, cheaper to regenerate than resurrect).
  // Per-ROW and explicit on purpose: closing by CATEGORY would mean a rule like
  // "session-expired failures don't count", which would hide the next real
  // outage. A row with no marker still shows, however familiar its error text.
  "closed — root cause resolved",
] as const;

/**
 * Statuses where NO WORKER IS TOUCHING THE JOB, so paying to regenerate it is safe.
 *
 * This is an ALLOWLIST on purpose. The previous guard was a three-status denylist
 * (publishing / publish_ambiguous / posted), which let regenerate fire on a job
 * that was mid-render. Two things went wrong at once:
 *
 *   1. The operator paid twice for the same brief — the running worker keeps its
 *      provider spend, and a second job starts from scratch.
 *   2. The "closed" job came back. Nothing can cancel a worker already in flight,
 *      and its writebacks were unconditional on status, so it would set itself to
 *      `assets_ready`, walk on to `assembled`, and be CAS-claimed and PUBLISHED by
 *      the daily cron — from the job the operator had been told was superseded.
 *
 * A denylist has to predict every unsafe state. An allowlist only has to know the
 * safe ones, and a status added later is excluded by default rather than included
 * by omission — which is the difference that caused this.
 *
 * `assembled` is safe: rendering has finished, nothing is running, and the job is
 * waiting on the operator. Wanting a different reel is exactly the legitimate case.
 */
export const REGENERABLE_STATUSES = ["failed", "assembled", "archived", "rejected"] as const;

export function isRegenerable(status: string | null | undefined): boolean {
  return (REGENERABLE_STATUSES as readonly string[]).includes(String(status ?? ""));
}

/** Rows every attention surface should consider, newest first. */
export async function selectReelJobsNeedingAttention(database: DB, limit = 50) {
  const { reelJobs } = await import("../../drizzle/schema");
  const { desc } = await import("drizzle-orm");
  return database
    .select()
    .from(reelJobs)
    .where(await buildAttentionPredicate())
    .orderBy(desc(reelJobs.id))
    .limit(limit);
}

/**
 * THE definition of "needs attention", as a reusable SQL predicate.
 *
 * Exists because the badge count and the detail list previously each built their
 * own WHERE clause over the same idea, and drifted: HQ counted every failed job
 * ever (61) while the list excluded failed entirely and reported nothing stuck.
 * The shared constants closed half that gap; two hand-copied clauses kept the
 * other half open. One predicate, both callers — the drift cannot recur.
 */
export async function buildAttentionPredicate() {
  const { reelJobs } = await import("../../drizzle/schema");
  const { inArray, and, eq, gte, or, not, like, isNull } = await import("drizzle-orm");
  const cutoff = new Date(Date.now() - FAILED_ATTENTION_DAYS * 24 * 60 * 60 * 1000);

  // A failure the operator already closed is not outstanding work. There is no
  // "closed" status, so the closure lives in `error` — exclude those rather than
  // re-counting finished decisions for the whole 14-day window.
  //
  // `isNull` is load-bearing: NOT LIKE is NULL-unsafe in SQL, so without it every
  // failure with no error text would evaluate NULL and silently drop OUT of the
  // count — hiding exactly the failures nobody has diagnosed yet.
  const notOperatorClosed = and(
    ...OPERATOR_CLOSED_MARKERS.map((m) => or(isNull(reelJobs.error), not(like(reelJobs.error, `%${m}%`)))),
  );

  return or(
    inArray(reelJobs.status, [...ATTENTION_STATUSES]),
    and(eq(reelJobs.status, "failed"), gte(reelJobs.updatedAt, cutoff), notOperatorClosed),
  );
}
