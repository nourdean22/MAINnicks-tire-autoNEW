"use client";

/**
 * GoalPeopleMemories: the Memory tab's goal and person filters (job 2026-11-02-nour-os-interconnect W6; research
 * map gap 7, "/brain tabs read no goal or person"). Goal moments are the check-ins and achieved or missed goals
 * lib/brain/goal-brain.ts writes; a person's rows are any memory whose metadata names them (the dossier mirror and
 * the rest). Same quiet list style as the other Memory blocks; a failed read says so, never "nothing here".
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { readState } from "@/lib/query-state";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { ReadingUnavailable, StaleNote } from "@/components/brain/brain-fold";
import { cn } from "@/lib/utils";

type By = "goal" | "person";
const LABEL = "Goal and people memories";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

export function GoalPeopleMemories() {
  const [by, setBy] = useState<By>("goal");
  const [pick, setPick] = useState<Record<By, string>>({ goal: "", person: "" });
  const id = pick[by];
  const q = trpc.brain.goalPeopleMemories.useQuery(id ? { by, id } : { by }, { refetchOnWindowFocus: false, staleTime: 60_000 });
  const state = readState(q);
  const data = q.data;

  return (
    <section aria-label={LABEL} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the brain by">
        {(["goal", "person"] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={by === b}
            onClick={() => setBy(b)}
            className={cn(
              "min-h-[44px] border-b-2 px-3 text-sm transition-colors duration-[var(--motion-state)]",
              by === b ? "border-gold text-fg" : "border-transparent text-fg-secondary hover:text-fg",
            )}
          >
            {b === "goal" ? "Goal moments" : "About a person"}
          </button>
        ))}
        {data && data.options.length > 0 && (
          <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-fg-secondary">
            <span>{by === "goal" ? "Goal" : "Person"}</span>
            <select
              value={id}
              onChange={(e) => setPick((p) => ({ ...p, [by]: e.target.value }))}
              className="min-h-[44px] max-w-[60vw] border border-edge bg-elevated px-2 text-sm text-fg"
            >
              <option value="">{by === "goal" ? "All goals" : "Pick a person"}</option>
              {data.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {state === "error" && <ReadingUnavailable label={LABEL} />}
      {state === "offline" && <ReadStateNote state="offline" label={LABEL} />}
      {state === "loading" && <p className="text-[13px] text-fg-tertiary">Reading the brain</p>}
      {data && <StaleNote q={q} label={LABEL} />}
      {data && data.needsPick && <p className="text-[13px] text-fg-secondary">Pick a person to see what the brain holds about them.</p>}
      {data && !data.needsPick && data.rows.length === 0 && (
        <p className="text-[13px] text-fg-secondary">
          {by === "goal"
            ? "No goal moments in the brain yet. A check-in, or a goal reaching its target, adds one."
            : "Nothing in the brain names this person yet. Saving their dossier on /people adds one."}
        </p>
      )}
      {data && data.rows.length > 0 && (
        <ul className="space-y-2">
          {data.rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 border-l-2 border-edge py-1 pl-4 text-[13px]">
              <span className="mt-0.5 w-14 shrink-0 font-mono text-fg-tertiary">{day(r.at)}</span>
              <p className="flex-1 leading-snug text-fg-secondary">
                {r.content.slice(0, 280)}
                {r.kind && <span className="ml-2 text-fg-tertiary">{r.kind.replace("_", " ")}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
