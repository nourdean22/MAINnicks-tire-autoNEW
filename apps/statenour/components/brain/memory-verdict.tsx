"use client";

/**
 * MemoryVerdict: the Memory tab's lead (wave D round 5, 2026-10-24). The tab's one decision is
 * "correct what the brain believes", so it opens on the one fact that decides it: how many claims
 * disagree with the record, in display type, with the way in. Same shape as the System control tower
 * (app/(mastery)/system/page.tsx: a ruled block, an eyebrow, one verdict, then a mono vitals line).
 *
 * Reads the maturity rollup the line below already reads (same query key, one fetch). Its
 * `contradictions.open` is the open claim-vs-record rows from the contradictions table, the
 * contradiction panel's own total (lib/services/brain-domain.ts). States, per empty-vs-error:
 *   - the read failed or never answered: "couldn't be read", never a clean ledger;
 *   - paused offline: the offline note, no verdict;
 *   - `open === null` (that one subsystem read failed): unknown, not zero;
 *   - 0: a measured zero, said as such.
 */

import { StaleNote } from "@/components/brain/brain-fold";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { isRetrying, readState } from "@/lib/query-state";

interface MaturityLead {
  components: { contradictions: { open: number | null }; beliefs: { active: number | null } };
  failedReads?: string[];
}

type Tone = "attention" | "nominal" | "unknown";

function verdict(data: MaturityLead | null, state: ReturnType<typeof readState>): { tone: Tone; line: string } {
  if (!data) {
    if (state === "loading") return { tone: "unknown", line: "Reading what the brain believes." };
    return { tone: "unknown", line: "Memory couldn't be read, so what the brain believes is unknown." };
  }
  const open = data.components.contradictions.open;
  if (open == null) return { tone: "unknown", line: "Contradictions couldn't be read, so it is unknown whether any claim disagrees with the record." };
  if (open === 0) return { tone: "nominal", line: "Nothing the brain believes disagrees with the record." };
  return { tone: "attention", line: `${open} claim${open === 1 ? "" : "s"} disagree${open === 1 ? "s" : ""} with the record.` };
}

export function MemoryVerdict() {
  const maturityQuery = trpc.brain.maturity.useQuery(undefined);
  const data = (maturityQuery.data as MaturityLead | undefined) ?? null;
  const state = readState(maturityQuery);
  const { tone, line } = verdict(data, state);
  const open = data?.components.contradictions.open ?? null;
  const beliefs = data?.components.beliefs.active ?? null;
  const failed = data?.failedReads?.length ?? 0;

  return (
    <section
      aria-labelledby="memory-verdict-heading"
      data-memory-verdict={tone}
      data-read-failed={!data && state === "error" ? "" : undefined}
      className={cn(
        "border-l-2 pl-5 sm:pl-6",
        tone === "attention" ? "border-amber-400" : tone === "nominal" ? "border-emerald-400/70" : "border-edge",
      )}
    >
      <h2 id="memory-verdict-heading" className="vt-eyebrow text-fg-secondary">
        What the brain believes
      </h2>
      <p
        className={cn(
          "vt-verdict mt-3 max-w-[18ch]",
          tone === "attention" ? "text-amber-200" : tone === "unknown" ? "text-fg-secondary" : "text-fg",
        )}
      >
        {line}
      </p>
      {data && <StaleNote q={maturityQuery} label="Memory" className="mt-3" />}
      {!data && (state === "error" || state === "offline") && (
        <ReadStateNote
          state={state}
          label="Memory"
          onRetry={() => void maturityQuery.refetch()}
          retrying={isRetrying(maturityQuery)}
          className="mt-3"
        />
      )}
      {open != null && open > 0 && (
        <Link
          href="#contradictions"
          className="mt-5 inline-flex min-h-[44px] items-center rounded-control border border-amber-400/50 px-4 text-[15px] font-medium text-amber-100 transition-colors duration-[var(--motion-state)] hover:bg-amber-400/10"
        >
          Settle them
        </Link>
      )}
      {data && (
        <p className="mt-5 font-mono text-[13px] text-fg-tertiary">
          beliefs active {beliefs ?? "?"} · contradictions open {open ?? "?"}
          {failed > 0 && ` · ${failed} subsystem read${failed === 1 ? "" : "s"} failed`}
        </p>
      )}
    </section>
  );
}
