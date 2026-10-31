"use client";

/**
 * GoalPeopleLine · the people on a goal (people W4 S3, 2026-10-30), from its tasks'
 * personId (lib/services/people/people-on-goal.ts). Each name opens that person's dossier on
 * /people. No people renders nothing.
 */
import Link from "next/link";

export function GoalPeopleLine({ people }: { people: ReadonlyArray<{ id: string; name: string }> }) {
  if (people.length === 0) return null;
  return (
    <p className="mt-0.5 flex flex-wrap items-center text-[11px] text-fg-tertiary">
      With{" "}
      {people.map((p, i) => (
        <span key={p.id} className="inline-flex items-center">
          {i > 0 && <span aria-hidden="true">,</span>}
          <Link
            // The inspect URL loads the dossier by id, so a person past /people's first 100 rows still opens.
            href={`/people?inspect=person:${encodeURIComponent(p.id)}`}
            // The goal row is a role=button that takes Enter, Space and clicks; the link keeps its own.
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-[44px] min-w-[44px] items-center px-1 text-fg-secondary underline-offset-2 hover:underline"
          >
            {p.name}
          </Link>
        </span>
      ))}
    </p>
  );
}
