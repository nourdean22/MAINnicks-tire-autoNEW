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
  const won = args.samples.find((s) => s.text === args.winningText);
  if (!won) return null;

  return { toolNames: [...won.calls], receiptsAvailable: true };
}
