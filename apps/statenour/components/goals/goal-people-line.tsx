/**
 * GoalPeopleLine · the people on a goal (people W4 S3, 2026-10-30), from its tasks'
 * personId (lib/services/people/people-on-goal.ts). Each name opens that person's row on
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
            href={`/people#person-${p.id}`}
            className="inline-flex min-h-[44px] min-w-[44px] items-center px-1 text-fg-secondary underline-offset-2 hover:underline"
          >
            {p.name}
          </Link>
        </span>
      ))}
    </p>
  );
}
