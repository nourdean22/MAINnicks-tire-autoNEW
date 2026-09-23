/**
 * Which generation's tool calls actually reached the operator?
 *
 * WHY THIS EXISTS. `app/api/ai/chat/alternate-paths.ts` runs several lanes.
 * Three of them pass `tools` to the model (they spread `genBase`), but only the
 * pre-flush lane captured `r.toolCalls`. Regen and self-consistency returned
 * `r.text` and threw the receipts away, so both declared themselves BLIND and
 * `tool.chosen` under-reported every turn they handled — a turn that really did
 * invoke tools recorded `observed: false`.
 *
 * ⚠ THE TRAP THIS GUARDS. Regen generates up to twice; self-consistency samples
 * three times. Exactly ONE generation becomes the reply. Recording the UNION of
 * every sample's calls would report tools that never reached the operator — the
 * mirror image of the measured-zero problem this workstream exists to remove,
 * and harder to spot because an over-count looks like richer data.
 *
 * So attribution is by identity: the winning text selects its own generation.
 * When no sample matches — a synthesised or post-processed answer — the lane
 * stays blind. **Blind is a valid answer; a guess is not.**
 */

export interface LaneSample {
  /** The generation's text, which is also its identity. */
  text: string;
  /** Tool names that generation invoked, in call order. */
  calls: string[];
}

export interface LaneAttribution {
  toolNames: string[];
  receiptsAvailable: true;
}

/**
 * Sample text is NOT a stable identity on its own.
 *
 * `self-consistency.ts` TRIMS every sample before voting, so `sc.answer` is a
 * trimmed string while the raw `r.text` recorded at generation time may carry
 * leading or trailing whitespace. An exact `===` therefore misses in the common
 * case and the lane silently stays blind — the fix would have been a no-op on
 * the very lane it was written for.
 */
function normalise(text: string): string {
  return text.trim();
}

/**
 * @returns the winning generation's calls, or `null` when the lane must stay
 *   blind (no samples, already attributed by a lane that saw its own result,
 *   or no sample whose text is the winner).
 */
export function attributeWinningSample(args: {
  samples: ReadonlyArray<LaneSample>;
  winningText: string;
  /** True when a lane already captured its own receipts (pre-flush). */
  alreadyAvailable: boolean;
}): LaneAttribution | null {
  if (args.alreadyAvailable) return null;
  if (args.samples.length === 0) return null;

  // Identity match, not similarity. A "closest" match would reintroduce the
  // guess this function exists to refuse.
  const target = normalise(args.winningText);
  const matches = args.samples.filter((s) => normalise(s.text) === target);
  if (matches.length === 0) return null;

  // ⚠ TEXT IS NOT UNIQUE. Parallel samples can return the same answer having
  // called different tools, and samples are recorded in COMPLETION order while
  // the chooser works in invocation order — so a tie cannot be resolved by
  // position either. When matching samples disagree about what they called,
  // there is no way to know which one became the reply: stay BLIND rather than
  // pick. Identical call lists are not a tie, because either answer is right.
  const first = JSON.stringify(matches[0].calls);
  const ambiguous = matches.some((m) => JSON.stringify(m.calls) !== first);
  if (ambiguous) return null;

  return { toolNames: [...matches[0].calls], receiptsAvailable: true };
}
