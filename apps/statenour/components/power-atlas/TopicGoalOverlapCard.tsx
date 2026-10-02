"use client";

/**
 * <TopicGoalOverlapCard> · 2026-05-27 · Power Atlas Phase 3 polish
 *
 * Renders the topic × LifeGoal overlap sourced from
 * PersonProfile.metadata.topicGoalOverlap · written weekly by
 * `topic-goal-overlap-compute` cron (Mon 05:30 UTC).
 *
 * goalAlignmentScore is 0.0–1.0 from the AI · displayed as 0-100
 * integer in monospace. Topics render as inline tags. Each matched
 * goal renders its title + the matched topics that overlapped.
 *
 * No emojis. Serif heading. Monospace alignment score. 1px borders.
 * Mounts in the detail-panel left column below LedgerTimeline.
 */

interface GoalMatch {
  goalId: string;
  goalTitle: string;
  matchedTopics: string[];
}

interface TopicGoalOverlapShape {
  topics: string[];
  goalAlignmentScore: number;
  goalMatches: GoalMatch[];
}

interface TopicGoalOverlapCardProps {
  metadata: unknown;
}

function parseOverlap(raw: unknown): TopicGoalOverlapShape | null {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as { topicGoalOverlap?: unknown };
  const o = meta.topicGoalOverlap;
  if (!o || typeof o !== "object") return null;
  const candidate = o as Partial<TopicGoalOverlapShape>;
  if (
    !Array.isArray(candidate.topics) ||
    typeof candidate.goalAlignmentScore !== "number" ||
    !Array.isArray(candidate.goalMatches)
  ) {
    return null;
  }
  return {
    topics: candidate.topics.filter((t): t is string => typeof t === "string"),
    goalAlignmentScore: candidate.goalAlignmentScore,
    goalMatches: candidate.goalMatches
      .map((m): GoalMatch | null => {
        if (!m || typeof m !== "object") return null;
        const cm = m as Partial<GoalMatch>;
        if (typeof cm.goalId !== "string" || typeof cm.goalTitle !== "string") {
          return null;
        }
        return {
          goalId: cm.goalId,
          goalTitle: cm.goalTitle,
          matchedTopics: Array.isArray(cm.matchedTopics)
            ? cm.matchedTopics.filter((t): t is string => typeof t === "string")
            : [],
        };
      })
      .filter((m): m is GoalMatch => m !== null),
  };
}

export default function TopicGoalOverlapCard({
  metadata,
}: TopicGoalOverlapCardProps) {
  const overlap = parseOverlap(metadata);

  if (!overlap) {
    return (
      <section
        className="rounded-surface border border-edge-subtle bg-content p-4"
      >
        <h3 className="text-[15px] font-semibold text-fg mb-2">
          Topic × goal overlap
        </h3>
        <p className="text-xs text-fg-tertiary">
          Needs ≥5 chat mentions + active goals to compute · scoring runs
          weekly.
        </p>
      </section>
    );
  }

  const score100 = Math.round(overlap.goalAlignmentScore * 100);

  return (
    <section
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[15px] font-semibold text-fg">
          Topic × goal overlap
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            alignment
          </span>
          <span className="font-mono tabular-nums text-base text-fg">
            {score100}
          </span>
          <span className="text-[11px] text-fg-tertiary">/100</span>
        </div>
      </div>

      {overlap.topics.length > 0 && (
        <div className="mb-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mb-1.5">
            topics
          </div>
          <div className="flex flex-wrap gap-1.5">
            {overlap.topics.map((t, i) => (
              <span
                key={`${t}:${i}`}
                className="text-[11px] px-1.5 py-0.5 rounded-micro border border-edge-subtle text-fg-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {overlap.goalMatches.length > 0 ? (
        <div
          className="border-t border-edge-subtle pt-3 space-y-2"
        >
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            goal matches · {overlap.goalMatches.length}
          </div>
          {overlap.goalMatches.map((m) => (
            <div key={m.goalId} className="text-xs">
              <p className="text-fg-secondary leading-snug">
                {m.goalTitle}
              </p>
              {m.matchedTopics.length > 0 && (
                <p className="mt-0.5 text-[11px] text-fg-tertiary">
                  via: {m.matchedTopics.join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p
          className="border-t border-edge-subtle pt-3 text-xs italic text-fg-tertiary"
        >
          No active goals matched.
        </p>
      )}
    </section>
  );
}
