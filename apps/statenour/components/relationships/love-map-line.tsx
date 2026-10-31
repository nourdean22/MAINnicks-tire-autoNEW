"use client";

/**
 * LoveMapLine · one question a day on Home about a person Nour has written nothing about
 * (people W2c, 2026-10-30; picker in lib/services/people/love-map.ts). The answer is appended to
 * that person's notes, so the /people "needs info" count falls as he answers. Save or Skip ends the
 * question for the day on this device. A failed read says so instead of vanishing (skill
 * empty-vs-error); no one left to ask about renders nothing.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { maximErrorText } from "@/components/wisdom/maxim-line";

const VERB =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg disabled:opacity-50";

const doneKey = (dayKey: string) => `people-love-map-done:${dayKey}`;

function readDone(dayKey: string): boolean {
  try {
    return localStorage.getItem(doneKey(dayKey)) === "1";
  } catch {
    return false;
  }
}

function writeDone(dayKey: string): void {
  try {
    localStorage.setItem(doneKey(dayKey), "1");
  } catch {
    // shortcut: private mode or blocked storage, the question just comes back on the next visit.
  }
}

export function LoveMapLine() {
  const q = trpc.task.loveMapQuestion.useQuery(undefined, { staleTime: 10 * 60_000, refetchOnWindowFocus: false });
  const [answer, setAnswer] = useState("");
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const save = trpc.task.answerLoveMap.useMutation({
    onSuccess: (res) => {
      if (!res.ok) {
        return void toast.error(
          res.reason === "too_long"
            ? "The notes for this person are full. Shorten them on /people first."
            : "That person is no longer on your list.",
        );
      }
      if (q.data) finish(q.data.dayKey);
      toast.success("Saved to their notes on /people.");
    },
    onError: (err) => toast.error(maximErrorText(err)),
  });

  function finish(dayKey: string) {
    writeDone(dayKey);
    setDoneFor(dayKey);
    setAnswer("");
  }

  if (q.isError) {
    return (
      <p role="status" className="mt-10 font-mono text-[11px] text-fg-tertiary">
        Couldn&apos;t read today&apos;s people question. Who is missing notes is unknown right now, not empty.
      </p>
    );
  }
  const m = q.data;
  if (!m || doneFor === m.dayKey || readDone(m.dayKey)) return null;

  return (
    <section aria-label="People question" className="mt-10 border-l-2 border-edge-strong pl-5 sm:pl-6">
      <p className="max-w-[56ch] text-[17px] leading-snug text-fg">{m.question}</p>
      <form
        className="mt-2 flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!answer.trim()) return;
          save.mutate({ personId: m.personId, question: m.question, answer: answer.trim() });
        }}
      >
        <label className="sr-only" htmlFor="love-map-answer">
          Answer
        </label>
        <input
          id="love-map-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={1000}
          placeholder="A few words is enough"
          className="min-h-[44px] min-w-0 flex-1 rounded-control border border-edge-default bg-transparent px-3 text-[16px] text-fg placeholder:text-fg-tertiary focus:border-edge-strong focus:outline-none"
        />
        <button type="submit" className={VERB} disabled={save.isPending || !answer.trim()}>
          Save
        </button>
        <button type="button" className={VERB} onClick={() => finish(m.dayKey)}>
          Skip today
        </button>
      </form>
    </section>
  );
}
