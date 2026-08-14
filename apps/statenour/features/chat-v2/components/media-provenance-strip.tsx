"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  buildMediaProvenance,
  type MediaProvenanceInput,
} from "@/lib/media/media-evidence";

/**
 * MediaProvenanceStrip (BDN-313) — media plan item #4, display half.
 *
 * Renders the capability ladder (playable → transcribed → analyzed →
 * cited → saved) plus the trust read, from the pure model in
 * lib/media/media-evidence.ts.
 *
 * HONEST-STATE CONTRACT
 * A state that has not been reached renders as DIM, not as an error and
 * not omitted. "No transcript" and "transcription failed" are different
 * facts; this strip only ever asserts the first, because the second is
 * not knowable from what it is given. The same doctrine as the Home
 * header's "QUEUES CLEAR" fix — never let absence of measurement render
 * as a positive claim.
 *
 * There is deliberately NO green "verified" badge. The only affirmative
 * signal is `canSupportAlone`, which is a statement about the evidence
 * ladder, not about whether the content is true.
 */
export function MediaProvenanceStrip({ input }: { input: MediaProvenanceInput }) {
  const view = buildMediaProvenance(input);

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {view.states.map((s) => (
          <span
            key={s}
            className="rounded border border-glass px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-fg-secondary"
          >
            {s}
          </span>
        ))}
        {view.missing.map((s) => (
          <span
            key={s}
            className="rounded border border-dashed border-glass px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-fg-tertiary opacity-50"
            title={`Not ${s} — not attempted, not failed`}
          >
            {s}
          </span>
        ))}
        <span
          className="ml-0.5 inline-flex items-center gap-1 text-[9px] text-fg-tertiary"
          title={`Evidence class: ${view.evidenceClass}`}
        >
          {view.trust === "TRUSTED" ? <ShieldCheck size={10} /> : <AlertTriangle size={10} />}
          {view.trust.toLowerCase()}
        </span>
      </div>

      {view.caveats.length > 0 ? (
        <ul className="space-y-0.5">
          {view.caveats.map((c) => (
            <li key={c} className="text-[9px] leading-snug text-fg-tertiary">
              {c}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
