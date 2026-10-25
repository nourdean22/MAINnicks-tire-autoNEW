"use client";

/**
 * MasteryList: one ruled row list for the Mastery tab (bdnick wave E2, 2026-10-24; census 3I MERGE).
 *
 * It replaces three same-height cards (IdentityArcCard, RecurringEnemiesCard, GraduatedSkillsCard,
 * deleted) and the history half of the Journey panel. Three headed groups, the same reads as before:
 *   identity   operator.identityProjection (30 day projection per axis), operator.xpGrowthComparison
 *              (stats active within 180 days with 0 XP in 30), system.journeyLens identity (snapshot
 *              history, shared with the verdict's trend line, one request)
 *   enemies    systemBrain.antiPatterns, with the "log another return" action
 *   skills     operator.skills, graduated or fired 5+ times
 * Two of the old cards returned null on a failed read and the identity card printed 0% growth with
 * no prior month. Each group now says loading, failed (Retry), offline and stale in words
 * (lib/query-state.ts), and a group only says "none yet" when its read succeeded.
 */

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { isRetrying, readState, type ReadStateInput } from "@/lib/query-state";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";

type Q = ReadStateInput & { refetch: () => unknown };

/** The state line for one read: nothing when ready, words otherwise; stale sits above kept rows. */
function ReadLine({ q, label }: { q: Q; label: string }) {
  const state = readState(q);
  if (state === "loading") return <p className="py-2 text-[13px] text-fg-tertiary">Reading {label.toLowerCase()}.</p>;
  return <ReadStateNote state={state} label={label} onRetry={() => void q.refetch()} retrying={isRetrying(q)} className="py-1" />;
}

function Group({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  return (
    <div data-mastery-group={name} className="space-y-1">
      <h3 className="text-[13px] font-medium text-fg-secondary">{title}</h3>
      {children}
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-edge-subtle border-y border-edge-subtle">{children}</ul>;
}

const ROW = "flex min-h-11 items-center justify-between gap-3 py-2 text-[14px]";
const EMPTY = "py-2 text-[13px] text-fg-tertiary";

function deltaWord(delta: number): { text: string; tone: string } {
  if (delta === 0) return { text: "stable", tone: "text-fg-tertiary" };
  return delta > 0 ? { text: `+${delta}`, tone: "text-emerald-300" } : { text: String(delta), tone: "text-rose-300" };
}

function IdentityGroup() {
  const projQ = trpc.operator.identityProjection.useQuery({ days: 30 }, { staleTime: 60_000 });
  const growthQ = trpc.operator.xpGrowthComparison.useQuery(undefined, { staleTime: 60_000 });
  const journeyQ = trpc.system.journeyLens.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });

  const trajectories = projQ.data?.trajectories ?? [];
  const stalled = (growthQ.data ?? []).filter((g) => g.gained30d === 0 && g.gained180d > 0).slice(0, 3);
  // The Journey read's own state is said once, by the verdict's trend line; here only its rows.
  const history = journeyQ.data?.identity;
  const bothRead = readState(projQ) === "ready" && readState(growthQ) === "ready";

  return (
    <Group name="identity" title="Identity arc, next 30 days">
      <ReadLine q={projQ} label="The identity projection" />
      <ReadLine q={growthQ} label="Stalled stats" />
      {(trajectories.length > 0 || stalled.length > 0) && (
        <Rows>
          {trajectories.map((t) => {
            const d = deltaWord(t.delta30d);
            return (
              <li key={t.axis} className={ROW}>
                <span className="min-w-0 truncate text-fg">
                  {t.label}
                  {t.warning && <span className="ml-2 text-[13px] text-amber-300">! {t.warning.replace(/_/g, " ")}</span>}
                </span>
                <span className="shrink-0 font-mono text-[13px] tabular-nums text-fg-secondary">
                  {t.currentValue} to {t.projectedValue30d} <span className={d.tone}>{d.text}</span>
                </span>
              </li>
            );
          })}
          {stalled.map((g) => (
            <li key={g.stat} className={ROW}>
              <span className="min-w-0 truncate text-fg-secondary">{g.label}</span>
              <span className="shrink-0 text-[13px] text-amber-300">stalled: 0 XP in 30 days</span>
            </li>
          ))}
        </Rows>
      )}
      {bothRead && trajectories.length === 0 && stalled.length === 0 && (
        <p className={EMPTY}>No projection yet: it needs 14 days of identity snapshots.</p>
      )}
      {history?.enoughData && history.data.length > 0 && (
        <>
          <p className="pt-2 font-mono text-[13px] text-fg-tertiary">{history.since}</p>
          <Rows>
            {history.data.map((d) => {
              const w = deltaWord(d.delta);
              return (
                <li key={d.axis} className={ROW}>
                  <span className="min-w-0 truncate text-fg">{d.axis}</span>
                  <span className="shrink-0 font-mono text-[13px] tabular-nums text-fg-secondary">
                    {d.from} to {d.to} <span className={w.tone}>{w.text}</span>
                  </span>
                </li>
              );
            })}
          </Rows>
        </>
      )}
    </Group>
  );
}

function EnemiesGroup() {
  const utils = trpc.useUtils();
  const lessonsQ = trpc.systemBrain.antiPatterns.useQuery(undefined, { staleTime: 60_000 });
  const revisit = trpc.systemBrain.revisitAntiPattern.useMutation({
    onSuccess: () => utils.systemBrain.antiPatterns.invalidate(),
    onError: (err) => toast.error(err.message || "Could not log that return."),
  });
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const enemies = [...(lessonsQ.data?.items ?? [])]
    .filter((item) => item.revisitCount > 0)
    .sort((a, b) => b.revisitCount - a.revisitCount)
    .slice(0, 3);

  return (
    <Group name="enemies" title="Recurring enemies">
      <ReadLine q={lessonsQ} label="Recurring enemies" />
      {enemies.length > 0 && (
        <Rows>
          {enemies.map((enemy) => (
            <li key={enemy.key} className={ROW}>
              <span className="min-w-0">
                <span className="block truncate text-fg">
                  {enemy.key} <span className="font-mono text-[13px] text-fg-tertiary">{enemy.domain}</span>
                </span>
                <span className="block truncate text-[13px] text-fg-tertiary">{enemy.lesson}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[13px] tabular-nums text-amber-300">{enemy.revisitCount} returns</span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingKey(enemy.key);
                    revisit.mutate({ key: enemy.key }, { onSettled: () => setPendingKey(null) });
                  }}
                  disabled={pendingKey === enemy.key}
                  aria-label={`Log another return of ${enemy.key}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] font-medium text-fg-secondary underline-offset-4 transition-colors duration-[var(--motion-state)] hover:text-fg hover:underline disabled:opacity-50"
                >
                  {pendingKey === enemy.key ? "Logging" : "Log"}
                </button>
              </span>
            </li>
          ))}
        </Rows>
      )}
      {readState(lessonsQ) === "ready" && enemies.length === 0 && (
        <p className={EMPTY}>None recurring: no anti-pattern has come back yet.</p>
      )}
    </Group>
  );
}

function SkillsGroup() {
  const skillsQ = trpc.operator.skills.useQuery(undefined, { staleTime: 60_000 });
  const graduated = [...(skillsQ.data?.active ?? [])]
    .filter((s) => s.times_fired >= 5 || s.graduated)
    .sort((a, b) => b.times_fired - a.times_fired)
    .slice(0, 3);

  return (
    <Group name="skills" title="Graduated skills">
      <ReadLine q={skillsQ} label="Graduated skills" />
      {graduated.length > 0 && (
        <Rows>
          {graduated.map((s) => (
            <li key={s.trigger} className={ROW}>
              <span className="min-w-0 truncate text-fg">
                {s.trigger}{" "}
                <span className="font-mono text-[13px] text-fg-tertiary">{s.polarity === "avoid" ? "avoid" : "do"}</span>
              </span>
              <span className={cn("shrink-0 font-mono text-[13px] tabular-nums", s.times_fired > 0 ? "text-emerald-300" : "text-fg-tertiary")}>
                {s.times_fired > 0
                  ? `${Math.round((s.times_succeeded / s.times_fired) * 100)}% success, ${s.times_fired} reps`
                  : "no reps yet"}
              </span>
            </li>
          ))}
        </Rows>
      )}
      {readState(skillsQ) === "ready" && graduated.length === 0 && (
        <p className={EMPTY}>None graduated yet: a skill graduates after 5 reps.</p>
      )}
    </Group>
  );
}

export function MasteryList() {
  return (
    <section data-mastery-list aria-label="Mastery" className="space-y-5">
      <MasterySectionLabel label="Mastery · identity, enemies, skills" />
      <IdentityGroup />
      <EnemiesGroup />
      <SkillsGroup />
    </section>
  );
}
