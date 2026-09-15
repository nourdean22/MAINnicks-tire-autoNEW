/**
 * ExperienceEpisode — a real (or synthetic) customer situation, made
 * replayable. The Experience Gym's unit of scar tissue.
 *
 * An episode is a GOAL with a BUDGET and a SUCCESS ORACLE, not a click script.
 * The deterministic runner (tests/e2e/episodes.spec.ts) executes `steps` — the
 * cheapest path a real person found — and judges the page against the oracle
 * within the budget. When it fails, the failure record is what
 * scripts/proof/promote-episode.mjs turns into the NEXT episode.
 *
 * Origins, in order of authority: a real customer's traced session beats a
 * synthetic probe; an incident beats a hunch.
 */
export type EpisodeOrigin = "real_customer" | "operator_failure" | "production_incident" | "synthetic_probe";

export interface EpisodeStep {
  action: "click" | "fill" | "press" | "scroll_to";
  /** Playwright role + accessible name (preferred), or a CSS selector. */
  role?: string;
  name?: string | RegExp;
  selector?: string;
  value?: string;
}

export interface SuccessOracle {
  /** All listed checks must hold. */
  visibleText?: string[];
  urlMatches?: string;
  visibleRole?: Array<{ role: string; name?: string }>;
}

export interface ExperienceEpisode {
  id: string;
  version: number;
  origin: EpisodeOrigin;
  /** customer_events / ledger keys this episode was distilled from, if any. */
  triggeringEvents: string[];
  task: string;
  startPath: string;
  viewport: { width: number; height: number };
  budget: { taps: number; ms: number };
  steps: EpisodeStep[];
  success: SuccessOracle;
  /** Things that must NOT be required to succeed — e.g. "opening the FAQ". */
  guardrails: string[];
}

/**
 * Hidden holdout (2026-09-15). `HO-xxx` episodes never live in the tree: they
 * are a GitHub secret the proof workflow unpacks into the runner's temp dir,
 * so the optimising agent (Night Shift) cannot read them and cannot fit to
 * them. The visible episodes are what it optimises; the holdout is how we
 * find out whether it optimised the page or the test. In holdout mode the
 * runner names an episode by id only and withholds every oracle value from
 * titles, assertion labels and failure records — a report or a CI annotation
 * must not become the leak.
 */
export function isHoldoutId(id: string): boolean {
  return /^HO-\d{3,}$/.test(id);
}

/** The test title: id + task normally; id only for a holdout. */
export function episodeTitle(ep: Pick<ExperienceEpisode, "id" | "task">, holdout: boolean): string {
  return holdout ? `${ep.id} · holdout` : `${ep.id} · ${ep.task}`;
}

/** An assertion label: the oracle's kind AND value normally; kind only for a holdout. */
export function oracleLabel(kind: string, value: string, holdout: boolean): string {
  return holdout ? `holdout ${kind}` : `${kind}: ${value}`;
}

/** The error text a failure record carries; a holdout's is a fixed phrase, never the assertion. */
export function failureErrorText(err: unknown, holdout: boolean): string {
  if (holdout) return "holdout: step or oracle failed (details withheld by design)";
  return err instanceof Error ? err.message : String(err);
}

export function assertEpisode(e: unknown, file: string): ExperienceEpisode {
  const x = e as Partial<ExperienceEpisode>;
  const fail = (msg: string): never => {
    throw new Error(`${file}: ${msg}`);
  };
  if (!x || typeof x !== "object") fail("not an object");
  if (!/^(EP|HO)-\d{3,}$/.test(String(x.id))) fail("id must look like EP-001 (or HO-001 for a hidden holdout)");
  if (!["real_customer", "operator_failure", "production_incident", "synthetic_probe"].includes(String(x.origin))) fail("bad origin");
  if (typeof x.task !== "string" || x.task.length < 10) fail("task too short");
  if (typeof x.startPath !== "string" || !x.startPath.startsWith("/")) fail("startPath must be a route");
  if (!x.viewport || !(x.viewport.width > 0) || !(x.viewport.height > 0)) fail("viewport");
  if (!x.budget || !(x.budget.taps >= 0) || !(x.budget.ms > 0)) fail("budget");
  if (!Array.isArray(x.steps)) fail("steps");
  if (x.steps.filter((s) => s.action === "click").length > (x.budget?.taps ?? 0)) fail("steps exceed the tap budget");
  if (!x.success || (!x.success.visibleText && !x.success.urlMatches && !x.success.visibleRole)) fail("success oracle is empty");
  return x as ExperienceEpisode;
}
