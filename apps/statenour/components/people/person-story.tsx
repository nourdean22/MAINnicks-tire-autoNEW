/**
 * The dossier's story panel (W8b, 2026-11-03): the journal entries that name this person and the goals they relate
 * to. The hooked wrapper reads trpc; the view is pure so its three states are testable.
 */
"use client";

import Link from "next/link";
import type { PersonStory } from "@/lib/services/people/person-story";
import { etDaysBetween } from "@/lib/brain/goal-pace";
import { trpc } from "@/lib/trpc/client";

function daysLabel(iso: string): string {
  const d = Math.max(0, etDaysBetween(Date.parse(iso), Date.now()));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}

export function PersonStoryView({ story }: { story: PersonStory | "loading" | "error" }) {
  return (
    <section aria-labelledby="person-story-heading" className="rounded-surface border border-edge-subtle bg-content p-4 space-y-3">
      <h3 id="person-story-heading" className="text-[15px] font-semibold text-fg">
        Their story
      </h3>
      {story === "loading" ? (
        <p className="text-[13px] text-fg-tertiary">Loading…</p>
      ) : story === "error" ? (
        <p role="status" className="text-[13px] text-amber-200">
          The journal and goals couldn&apos;t load. Unknown, not empty.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="font-mono text-[11px] text-fg-tertiary">journal</p>
            {story.entries.length === 0 ? (
              <p className="text-[13px] text-fg-tertiary">No journal entry names them yet.</p>
            ) : (
              <ul className="space-y-1">
                {story.entries.map((e) => (
                  <li key={e.id}>
                    <Link href={e.href} className="inline-flex min-h-[44px] items-center text-[13px] text-fg-secondary hover:text-fg">
                      <span className="mr-2 shrink-0 font-mono text-[11px] tabular-nums text-fg-tertiary">{daysLabel(e.at)}</span>
                      <span className="line-clamp-2">{e.excerpt}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {story.entriesTruncated && (
              <Link href="/journal" className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-fg underline-offset-4 hover:underline">
                more in the journal
              </Link>
            )}
          </div>
          <div className="space-y-1">
            <p className="font-mono text-[11px] text-fg-tertiary">goals</p>
            {story.goals.length === 0 ? (
              <p className="text-[13px] text-fg-tertiary">No goal relates to them yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-x-4">
                {story.goals.map((g) => (
                  <li key={g.id}>
                    <Link href={g.href} className="inline-flex min-h-[44px] items-center text-[13px] text-fg-secondary hover:text-fg">
                      {g.title}
                      <span className="ml-1 font-mono text-[11px] text-fg-tertiary">{g.via === "tasks" ? "· their task" : "· a moment"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function PersonStoryPanel({ personId }: { personId: string }) {
  const q = trpc.task.personStory.useQuery({ personId });
  return <PersonStoryView story={q.isError ? "error" : q.data === undefined ? "loading" : q.data} />;
}
