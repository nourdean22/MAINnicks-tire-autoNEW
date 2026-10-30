"use client";

/**
 * MaximLine · one plain maxim from every book pack under the Home brief (2026-10-29). The line holds still
 * for the hour (the pick is keyed on the ET date-hour server-side, and the query refetches every 10 minutes so
 * a Home left open still rotates); it leans toward today's top line when a tag matches, and says which topic.
 * Only the tags leave the page, never the headline text. Next steps through the list; Keep pins it so Nick can
 * use it in chat; Skip hides it for 30 days. A failed first read says so in one line; a failed Next keeps the
 * shown maxim and says the next one did not load.
 */
import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { tagsForText } from "@/lib/wisdom/maxims";

const VERB =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50";

/** Plain words for the causes the server names; never raw error text, never a bare "failed" for a known cause. */
export function maximErrorText(err: unknown): string {
  const e = err as { message?: string; data?: { code?: string } } | null;
  const code = e?.data?.code;
  if (code === "UNAUTHORIZED") return "Your session ended. Sign in again, then try once more.";
  if (code === "FORBIDDEN" && /NICK_MUTATION_LOCK/.test(e?.message ?? "")) {
    return "Changes are locked right now (the mutation lock is on). Nothing was saved.";
  }
  if (code === "FORBIDDEN") return "This needs the owner sign-in. Nothing was saved.";
  return "That did not save. Check the connection and try again.";
}

export function MaximLine({ context, ready }: { context: string | null; ready: boolean }) {
  const [step, setStep] = useState(0);
  const [kept, setKept] = useState<string | null>(null);
  // A Skip that succeeded hides its maxim even if the refetch after it fails.
  const [skipped, setSkipped] = useState<string | null>(null);
  const tags = useMemo(() => [...tagsForText(context ?? "")].sort(), [context]);
  const utils = trpc.useUtils();
  const maximQ = trpc.operator.maxim.useQuery(
    { step, tags },
    {
      enabled: ready,
      staleTime: 5 * 60_000,
      refetchInterval: 10 * 60_000,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    },
  );
  const keep = trpc.operator.maximKeep.useMutation({
    onSuccess: (res, vars) => {
      if (!res.ok) return void toast.error("That maxim is no longer in the list. Tap Next.");
      setKept(vars.id);
      toast.success("Kept. Nick can use it in chat.");
    },
    onError: (err) => toast.error(maximErrorText(err)),
  });
  const skip = trpc.operator.maximSkip.useMutation({
    onSuccess: (res, vars) => {
      if (!res.ok) return void toast.error("That maxim is no longer in the list. Tap Next.");
      setSkipped(vars.id);
      toast.success("Skipped for 30 days");
      void utils.operator.maxim.invalidate();
    },
    onError: (err) => toast.error(maximErrorText(err)),
  });

  const m = maximQ.data && maximQ.data.id !== skipped ? maximQ.data : null;
  if (!m) {
    if (!maximQ.isError) return null; // loading, or every maxim skipped
    return (
      <p role="status" className="mt-10 font-mono text-[11px] text-fg-tertiary">
        The maxim could not load. It will try again in a few minutes.
      </p>
    );
  }
  const stale = maximQ.isPlaceholderData;

  return (
    <section aria-label="Maxim" aria-busy={stale} className="mt-10 border-l-2 border-edge-strong pl-5 sm:pl-6">
      <p className="max-w-[56ch] text-[17px] leading-snug text-fg">{m.text}</p>
      <p className="mt-1.5 font-mono text-[11px] text-fg-tertiary">
        {m.source}
        {m.reason ? ` · ${m.reason}` : ""}
      </p>
      {maximQ.isError ? (
        <p role="status" className="mt-1 font-mono text-[11px] text-fg-tertiary">
          The next maxim did not load. This one stays.
        </p>
      ) : null}
      <div className="mt-1 -ml-2 flex items-center gap-1">
        <button type="button" className={VERB} onClick={() => setStep((s) => s + 1)} disabled={maximQ.isFetching}>
          Next
        </button>
        <button
          type="button"
          className={VERB}
          aria-pressed={kept === m.id}
          onClick={() => keep.mutate({ id: m.id })}
          disabled={stale || keep.isPending || kept === m.id}
        >
          {kept === m.id ? "Kept" : "Keep"}
        </button>
        <button type="button" className={VERB} onClick={() => skip.mutate({ id: m.id })} disabled={stale || skip.isPending}>
          Skip
        </button>
      </div>
    </section>
  );
}
