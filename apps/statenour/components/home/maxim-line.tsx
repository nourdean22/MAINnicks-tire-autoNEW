"use client";

/**
 * MaximLine · one plain maxim from every book pack under the Home brief (2026-10-29). The line holds still
 * for the hour (the pick is keyed on the ET date-hour server-side); it leans toward today's top line when a
 * tag matches, and says so in a few words. Next steps through the list; Keep pins it so Nick can use it in
 * chat; Skip hides it for 30 days. A failed or empty read renders nothing: a maxim is never worth an error
 * panel on Home.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";

const VERB =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50";

export function MaximLine({ context, ready }: { context: string | null; ready: boolean }) {
  const [step, setStep] = useState(0);
  const [kept, setKept] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const maximQ = trpc.operator.maxim.useQuery(
    { step, context },
    { enabled: ready, staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );
  const keep = trpc.operator.maximKeep.useMutation({
    onSuccess: (res, vars) => {
      if (!res.ok) return void toast.error("Could not keep that maxim");
      setKept(vars.id);
      toast.success("Kept. Nick can use it in chat.");
    },
    onError: () => toast.error("Could not keep that maxim"),
  });
  const skip = trpc.operator.maximSkip.useMutation({
    onSuccess: (res) => {
      if (!res.ok) return void toast.error("Could not skip that maxim");
      toast.success("Skipped for 30 days");
      void utils.operator.maxim.invalidate();
    },
    onError: () => toast.error("Could not skip that maxim"),
  });

  const m = maximQ.data;
  if (!m) return null;

  return (
    <section aria-label="Maxim" className="mt-10 border-l-2 border-edge-strong pl-5 sm:pl-6">
      <p className="max-w-[56ch] text-[17px] leading-snug text-fg">{m.text}</p>
      <p className="mt-1.5 font-mono text-[11px] text-fg-tertiary">
        {m.source}
        {m.reason ? ` · ${m.reason}` : ""}
      </p>
      <div className="mt-1 -ml-2 flex items-center gap-1">
        <button type="button" className={VERB} onClick={() => setStep((s) => s + 1)} disabled={maximQ.isFetching}>
          Next
        </button>
        <button
          type="button"
          className={VERB}
          aria-pressed={kept === m.id}
          onClick={() => keep.mutate({ id: m.id })}
          disabled={keep.isPending || kept === m.id}
        >
          {kept === m.id ? "Kept" : "Keep"}
        </button>
        <button type="button" className={VERB} onClick={() => skip.mutate({ id: m.id })} disabled={skip.isPending}>
          Skip
        </button>
      </div>
    </section>
  );
}
