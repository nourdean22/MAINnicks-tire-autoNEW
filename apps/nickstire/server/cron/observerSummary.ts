/**
 * Reads the string runCronFailureObserver (server/cron/observer.ts) writes into cron_log.details, so the
 * Settings tab can show the stuck queues and the lane shapes the observer measured instead of one raw line.
 *
 * The tokens read here are emitted by observer.ts (`scanned: N failing jobs`, `shapes: N actionable of M judged
 * (loop=verdict, ...)`, `undeclared loops: K`, `queue-age: loop=stuck(Am>Mm), ...`); observerSummary.test.ts pins
 * those literals against observer.ts, so a changed token there fails a test here instead of reading as healthy.
 * A part that does not match is null or empty, never a fabricated 0; `raw` always carries the original text.
 */
export interface ObserverSummary {
  /** Failing jobs the observer saw; null when the string has no `scanned:` part. */
  failing: number | null;
  /** The M in "N actionable of M judged"; null when the shape pass did not run or was inhibited. */
  shapesJudged: number | null;
  /** Lanes the observer judged out of spec, one per `loop=verdict`. */
  shapes: Array<{ job: string; shape: string }>;
  undeclaredLoops: number | null;
  /** Queues whose oldest due row is older than the loop's cadence explains. */
  queuesStuck: Array<{ loop: string; ageMinutes: number; maxAgeMinutes: number }>;
  raw: string;
}

const SCANNED = /scanned: (\d+) failing jobs/;
const SHAPES = /shapes: (\d+) actionable of (\d+) judged \(([^)]*)\)/;
const UNDECLARED = /undeclared loops: (\d+)/;
const QUEUE_CLAUSE = /queue-age: (.*)$/;
const STUCK = /([A-Za-z0-9_:.-]+)=stuck\((\d+)m>(\d+)m\)/g;

export function parseObserverDetails(details: string): ObserverSummary {
  const scanned = SCANNED.exec(details);
  const shapeMatch = SHAPES.exec(details);
  const undeclared = UNDECLARED.exec(details);
  const queueClause = QUEUE_CLAUSE.exec(details)?.[1] ?? "";

  const shapes: ObserverSummary["shapes"] = [];
  if (shapeMatch) {
    for (const token of shapeMatch[3].split(", ")) {
      const eq = token.indexOf("=");
      if (eq > 0) shapes.push({ job: token.slice(0, eq), shape: token.slice(eq + 1) });
    }
  }

  const queuesStuck: ObserverSummary["queuesStuck"] = [];
  for (const m of queueClause.matchAll(STUCK)) {
    queuesStuck.push({ loop: m[1], ageMinutes: Number(m[2]), maxAgeMinutes: Number(m[3]) });
  }

  return {
    failing: scanned ? Number(scanned[1]) : null,
    shapesJudged: shapeMatch ? Number(shapeMatch[2]) : null,
    shapes,
    undeclaredLoops: undeclared ? Number(undeclared[1]) : null,
    queuesStuck,
    raw: details,
  };
}
