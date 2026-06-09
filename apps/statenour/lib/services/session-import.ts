/**
 * Claude session importer (F1) — turn a pasted Claude Code session log into a
 * clean, structured digest instead of leaving it as messy text.
 *
 * `parseSessionLog` is PURE (no IO) and is the heavily-tested core. `importSession`
 * is a thin wrapper that persists the digest to the EXISTING SessionReport table
 * (no new table) and returns suggested follow-up tasks — it NEVER creates tasks
 * silently; task creation is a separate, explicit confirmation step in the route.
 *
 * See docs/project/NEXT-INTELLIGENCE-WAVE.md (F1).
 */

import { prisma } from "@/lib/prisma";

export interface ParsedSession {
  title: string;
  repo: string | null;
  branch: string | null;
  worktree: string | null;
  /** Short or long commit SHAs found (deduped, in order). */
  commits: string[];
  /** Conventional-commit subjects (feat/fix/chore/docs ...) found. */
  commitSubjects: string[];
  phasesCompleted: string[];
  filesChanged: string[];
  checksRun: string[];
  blockers: string[];
  migrations: string[];
  prodActionsNeeded: string[];
  warnings: string[];
  nextSteps: string[];
  /** Detected flags the operator most cares about. */
  needsOwnerApproval: boolean;
  prodMigrationOrDeployPending: boolean;
  /** Suggested follow-up tasks (suggestion-only — never auto-created). */
  followUpSuggestions: FollowUpSuggestion[];
}

export interface FollowUpSuggestion {
  title: string;
  reason: string;
  requiresApproval: boolean;
}

const SHA_RE = /\b[0-9a-f]{7,40}\b/g;
const CONVENTIONAL_RE = /\b(?:feat|fix|chore|docs|refactor|test|perf|build|ci|style)(?:\([^)]*\))?:\s*.+/i;

const APPROVAL_RE = /\b(needs?\s+owner\s+approval|owner\s+(?:decision|sign-?off|approval)|awaiting\s+(?:owner|approval|sign-?off)|requires?\s+approval|pending\s+approval|operator\s+(?:decision|approval))\b/i;
const PROD_PENDING_RE = /\b(migration[^.\n]*\b(?:pending|not\s+applied|unapplied|awaiting)|(?:deploy|deployment|rollout|push)[^.\n]*\b(?:pending|blocked|awaiting|not\s+(?:done|deployed|pushed))|not\s+(?:yet\s+)?(?:deployed|pushed)|awaiting\s+deploy)\b/i;

// Line-bucket cues. First match wins for mutually-exclusive buckets; some lines
// legitimately land in multiple (e.g. a blocker that is also a next step).
const CUES = {
  phase: /\b(phase\s+\d|shipped|committed|completed|✅|landed|merged)\b/i,
  check: /\b(typecheck|tsc\b|vitest|\d+\s+tests?\b|pnpm\s+(?:test|build|check)|build\s+green|check:[a-z-]+|eval:memory|lint\b|coverage)\b/i,
  blocker: /\b(blocked|blocker|fail(?:ed|ing|ure)?\b|❌|error\b|broke|broken|regression|RED\b|cannot|can't|couldn't)\b/i,
  migration: /\b(migration|prisma\s+migrate|schema\s+change|db\s+push|\bDDL\b|applied\s+to\s+prod)\b/i,
  prodAction: /\b(deploy|rollout|push\s+to\s+main|railway|prod(?:uction)?\b|awaiting|needs?\s+owner|sign-?off)\b/i,
  warning: /\b(⚠|warning|risk\b|caveat|gotcha|careful|watch\s+out|caution|fragile)\b/i,
  next: /\b(next\s+steps?|next\b|TODO\b|deferred|follow-?up|remaining|to-?do)\b/i,
};

const FILE_RE = /(?:^|[\s`(])((?:app|lib|components|scripts|config|prisma|tests|docs|src)\/[\w./-]+\.\w+|[\w./-]+\.(?:ts|tsx|js|jsx|md|prisma|json|sql))/g;

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function cleanLine(line: string): string {
  return line
    .replace(/^[\s>*\-+#•·✅❌⚠🔴🟢]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(lines: string[]): string {
  const heading = lines.find((l) => /^#{1,3}\s+\S/.test(l.trim()));
  if (heading) return cleanLine(heading).slice(0, 120);
  const labelled = lines.find((l) => /^\s*(session|title|wave)\s*[:=]/i.test(l));
  if (labelled) return cleanLine(labelled.replace(/^\s*\w+\s*[:=]\s*/, "")).slice(0, 120);
  const firstReal = lines.map(cleanLine).find((l) => l.length > 0);
  return (firstReal ?? "Imported session").slice(0, 120);
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] ?? m[0] : null;
}

/** A markdown heading line or a bold-only label line ("**Next steps**"). */
function isHeading(raw: string): boolean {
  const t = raw.trim();
  return /^#{1,6}\s+\S/.test(t) || /^\*\*[^*]+\*\*:?\s*$/.test(t);
}

/** Map a heading's text to a section bucket (null = not a tracked section). */
function classifyHeading(h: string): string | null {
  const t = h.toLowerCase();
  if (/next\s+step|^next\b|to-?do|deferred|follow-?up|remaining/.test(t)) return "next";
  if (/blocker|failure|fail\b|problem|issue/.test(t)) return "blocker";
  if (/migration|schema\s+change/.test(t)) return "migration";
  if (/production|deploy|rollout|prod\b/.test(t)) return "prodAction";
  if (/risk|warning|caveat|gotcha/.test(t)) return "warning";
  if (/check|test|verif|gate/.test(t)) return "check";
  if (/phase|shipped|commit|completed|^done\b/.test(t)) return "phase";
  if (/files?\s+changed|changed\s+files/.test(t)) return "files";
  return null;
}

/**
 * Parse a raw pasted Claude Code session log into a structured digest. Pure.
 */
export function parseSessionLog(raw: string): ParsedSession {
  const text = raw ?? "";
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(cleanLine).filter((l) => l.length > 0);

  const repo = firstMatch(text, /\b([\w-]+\/[\w.-]+)(?=\s|`|$|\.git)/) // owner/repo
    ?? firstMatch(text, /repo(?:sitory)?\s*[:=]\s*`?([\w/.-]+)`?/i);
  const branch = firstMatch(text, /\bbranch\s*[:=]?\s*`?([\w./-]+)`?/i)
    ?? firstMatch(text, /\bon\s+branch\s+`?([\w./-]+)`?/i);
  const worktree = firstMatch(text, /worktree[^\n`]*`([^`]+)`/i)
    ?? firstMatch(text, /\.worktrees\/([\w./-]+)/i);

  const commits = uniq((text.match(SHA_RE) ?? []).filter((s) => s.length >= 7 && s.length <= 12));
  const commitSubjects = uniq(
    lines.filter((l) => CONVENTIONAL_RE.test(l)).map((l) => {
      const m = l.match(CONVENTIONAL_RE);
      return (m ? m[0] : l).slice(0, 140);
    }),
  );

  const files = uniq(
    [...text.matchAll(FILE_RE)].map((m) => m[1]).filter((f) => !/^https?:/.test(f)),
  ).slice(0, 60);

  const buckets: Record<string, string[]> = {
    phase: [], check: [], blocker: [], migration: [], prodAction: [], warning: [], next: [],
  };
  const push = (k: string, line: string) => buckets[k].push(line.slice(0, 160));

  // Section-aware: a heading like "## Next steps" sets the active bucket for the
  // bullets under it (real logs list bullets WITHOUT the cue word). Per-line
  // cues run additively, so a "Deploy ..." next-step also counts as a prod action.
  let section: string | null = null;
  for (const raw of rawLines) {
    if (isHeading(raw)) {
      section = classifyHeading(cleanLine(raw));
      continue;
    }
    const line = cleanLine(raw);
    if (!line) continue;
    if (section && buckets[section]) push(section, line);
    if (CUES.check.test(line)) push("check", line);
    if (CUES.blocker.test(line)) push("blocker", line);
    if (CUES.migration.test(line)) push("migration", line);
    if (CUES.warning.test(line)) push("warning", line);
    if (CUES.next.test(line)) push("next", line);
    if (CUES.prodAction.test(line)) push("prodAction", line);
    if (CUES.phase.test(line)) push("phase", line);
  }
  const { phase: phasesCompleted, check: checksRun, blocker: blockers, migration: migrations, prodAction: prodActionsNeeded, warning: warnings, next: nextSteps } = buckets;

  const needsOwnerApproval = APPROVAL_RE.test(text);
  const prodMigrationOrDeployPending = PROD_PENDING_RE.test(text);

  // Follow-up suggestions: derived from next-steps + any pending prod action.
  // Suggestion-only; sensitive ones (deploy/migrate) require approval.
  const followUpSuggestions: FollowUpSuggestion[] = uniq(nextSteps)
    .slice(0, 8)
    .map((step) => {
      const sensitive = /\b(deploy|push|migrat|prod|delete|send)\b/i.test(step);
      return {
        title: step.replace(/^(next\s+steps?|next|todo|deferred|follow-?up)\s*[:\-]?\s*/i, "").slice(0, 100) || step.slice(0, 100),
        reason: "From the session's next steps",
        requiresApproval: sensitive,
      };
    })
    .filter((s) => s.title.length > 3);

  return {
    title: extractTitle(rawLines),
    repo: repo && repo.includes("/") ? repo : null,
    branch,
    worktree,
    commits,
    commitSubjects: commitSubjects.slice(0, 30),
    phasesCompleted: uniq(phasesCompleted).slice(0, 30),
    filesChanged: files,
    checksRun: uniq(checksRun).slice(0, 30),
    blockers: uniq(blockers).slice(0, 30),
    migrations: uniq(migrations).slice(0, 20),
    prodActionsNeeded: uniq(prodActionsNeeded).slice(0, 20),
    warnings: uniq(warnings).slice(0, 30),
    nextSteps: uniq(nextSteps).slice(0, 30),
    needsOwnerApproval,
    prodMigrationOrDeployPending,
    followUpSuggestions,
  };
}

export interface SessionImportResult {
  digest: ParsedSession;
  stored: boolean;
  reportId: string | null;
  /** Suggested follow-up tasks — NOT created. The caller confirms explicitly. */
  suggestedTasks: FollowUpSuggestion[];
}

/** YYYY-MM-DD for SessionReport.sessionDate (defaults to today, ET-agnostic UTC date). */
function sessionDateFrom(digest: ParsedSession, now: Date): string {
  const dated = digest.title.match(/\d{4}-\d{2}-\d{2}/) ?? null;
  return dated ? dated[0] : now.toISOString().slice(0, 10);
}

/**
 * Parse + persist a session digest to the existing SessionReport table, and
 * return suggested follow-up tasks. Does NOT create tasks. `store: false`
 * yields a parse-only dry run (no DB write).
 */
export async function importSession(
  raw: string,
  opts: { store?: boolean; now?: Date } = {},
): Promise<SessionImportResult> {
  const digest = parseSessionLog(raw);
  const store = opts.store ?? true;
  if (!store) {
    return { digest, stored: false, reportId: null, suggestedTasks: digest.followUpSuggestions };
  }

  const sessionDate = sessionDateFrom(digest, opts.now ?? new Date());
  const data = {
    sessionDate,
    summary: digest.title,
    filesChanged: digest.filesChanged,
    commits: digest.commits,
    decisions: digest.phasesCompleted,
    blockers: digest.blockers,
    nextSteps: digest.nextSteps,
    agentModel: "claude-code",
  };

  // Avoid duplicate spam: update the existing report for this date if present.
  const existing = await prisma.sessionReport.findFirst({ where: { sessionDate, agentModel: "claude-code" } });
  const row = existing
    ? await prisma.sessionReport.update({ where: { id: existing.id }, data })
    : await prisma.sessionReport.create({ data });

  return { digest, stored: true, reportId: row.id, suggestedTasks: digest.followUpSuggestions };
}
