/**
 * Personal command shortcuts (F5) — a SMALL command registry (not a framework)
 * for daily-use slash commands that call the services built in this wave. Pure
 * routing + thin handlers; NO logic duplicated in the chat route.
 *
 * Commands: /today /rescue /what-changed /import-session /receipts /stale
 * /convert.
 *
 * parseCommand + resolveCommand are pure (testable). runCommand executes a
 * command via injectable deps (real services by default; stubbed in tests).
 * Exposed end-to-end via POST /api/system/command; an optional chat-interceptor
 * hook is a documented follow-up (kept out of the chat route this wave).
 *
 * See docs/project/NEXT-INTELLIGENCE-WAVE.md (F5).
 */

import { buildSystemChangeDigest, type SystemChangeDigest } from "@/lib/services/system-change-digest";
import { buildTaskRescue, type RescueResult } from "@/lib/services/task-rescue";
import { buildActionReceiptFeed, type ReceiptFeedResult } from "@/lib/services/action-receipt-feed";
import { buildTodayCompound, type TodayCompound } from "@/lib/services/today-compound";
import { parseSessionLog, type ParsedSession } from "@/lib/services/session-import";
import { convertToAction, type ActionSuggestion, type ConvertInput } from "@/lib/knowledge/action-converter";
import {
  fireMorningPush,
  fireAfternoonPush,
  fireEveningPush,
  fireSlotForCurrentHour,
  type PushPreview,
} from "@/lib/brain/proactive-pushes";
import { prisma } from "@/lib/prisma";
import { runManifestCron } from "@/lib/services/cron-control";

export interface CommandResult {
  text: string;
  data?: unknown;
}

/** Services a command may call — injectable so the registry is unit-testable. */
export interface CommandDeps {
  changeDigest: () => Promise<SystemChangeDigest>;
  taskRescue: () => Promise<RescueResult>;
  receiptFeed: () => Promise<ReceiptFeedResult>;
  today: () => Promise<TodayCompound>;
  parseSession: (raw: string) => ParsedSession;
  convert: (input: ConvertInput) => ActionSuggestion;
  proactivePreview: (slot: string, now?: Date) => Promise<PushPreview[]>;
  triagePrune: (cutoff: Date) => Promise<number>;
  dbVacuum: () => Promise<void>;
  runCron: (jobName: string) => Promise<any>;
}

export interface CommandSpec {
  name: string;
  description: string;
  aliases?: string[];
  run: (args: string, deps: CommandDeps) => Promise<CommandResult>;
}

// ── pure formatters (exported for tests) ──────────────────────────────

export function formatChangeDigest(d: SystemChangeDigest): string {
  const w = d.latestWave;
  const wave = w ? `Last wave ${w.date}: ${w.title ?? "(untitled)"} — ${w.ships.length} ship(s)${w.ships[0] ? ` (${w.ships.slice(0, 3).join(", ")})` : ""}.` : "No reconciliation entry found.";
  const evals = `Truth evals: ${d.truth.evals.passed}/${d.truth.evals.total} pass${d.truth.evals.failed ? `, ${d.truth.evals.failed} FAIL` : ""}.`;
  const stale = `Stale-doc (key docs): ${d.truth.staleCriticalInKeyDocs} critical, ${d.truth.staleWarnInKeyDocs} warn.`;
  const deploy = `Deploy: ${d.deployment.status} — ${d.deployment.note}`;
  return [wave, evals, stale, deploy, `Next: ${d.nextOwnerDecision}`].join("\n");
}

export function formatRescue(r: RescueResult): string {
  if (r.findings.length === 0) return `Task rescue: scanned ${r.scanned}, nothing needs attention.`;
  const top = r.findings.slice(0, 5).map((f) => `• [${f.issue}] ${f.title} — ${f.suggestedFix} (conf ${f.confidence})`);
  const counts = Object.entries(r.byIssue).map(([k, n]) => `${k}:${n}`).join(" · ");
  return [`Task rescue: ${r.findings.length} of ${r.scanned} need attention (${counts}).`, ...top].join("\n");
}

export function formatReceipts(f: ReceiptFeedResult): string {
  if (f.items.length === 0) return "No recent actions recorded.";
  const icon = (s: string) => (s === "success" ? "✓" : s === "failed" ? "✗" : "•");
  const top = f.items.slice(0, 8).map((r) => `${icon(r.status)} ${r.userVisibleSummary}`);
  return [`Recent actions: ${f.counts.total} (${f.counts.success} ok, ${f.counts.failed} failed).`, ...top].join("\n");
}

export function formatToday(t: TodayCompound, topWarning: string | null): string {
  const top = t.topMastery ? `Top domain: ${t.topMastery.domain} (${t.topMastery.score}, ${t.topMastery.delta >= 0 ? "+" : ""}${t.topMastery.delta}).` : "No mastery movement yet.";
  return [
    `Today (${t.date}): ${t.tasksDone} done · ${t.tasksOpen} open · ${t.focusedMinutes}m focused.`,
    top,
    `⚠ ${topWarning ?? "No rescue flags — task list is clean."}`,
  ].join("\n");
}

export function formatSessionDigest(p: ParsedSession): string {
  const flags = [
    p.needsOwnerApproval ? "NEEDS OWNER APPROVAL" : null,
    p.prodMigrationOrDeployPending ? "PROD MIGRATION/DEPLOY PENDING" : null,
  ].filter(Boolean);
  return [
    `Session: ${p.title}`,
    `${p.commits.length} commit(s)${p.commits[0] ? ` (${p.commits.slice(0, 4).join(", ")})` : ""} · ${p.filesChanged.length} file(s) · ${p.blockers.length} blocker(s).`,
    flags.length ? `Flags: ${flags.join(" · ")}.` : "Flags: none.",
    p.followUpSuggestions.length ? `Suggested follow-ups (not created): ${p.followUpSuggestions.length}.` : "No follow-ups suggested.",
  ].join("\n");
}

export function formatActionSuggestion(s: ActionSuggestion): string {
  const lines = [
    `[${s.kind}] ${s.title}  (conf ${s.confidence.toFixed(2)} · risk ${s.riskLevel})`,
    s.explanation,
  ];
  if (s.kind === "task" && s.nextPhysicalAction) lines.push(`Next: ${s.nextPhysicalAction}`);
  if (s.suggestedDomain) lines.push(`Domain: ${s.suggestedDomain}`);
  lines.push(
    s.requiresApproval
      ? "⚠ Sensitive — needs your explicit approval before acting. Suggestion only; nothing was created."
      : "Suggestion only — nothing was created. Act on it yourself if it's right.",
  );
  return lines.join("\n");
}

// ── registry ──────────────────────────────────────────────────────────

export function formatPushPreview(p: PushPreview): string {
  const status = p.wouldSend ? "🟢 WOULD SEND" : "🔴 WOULD SKIP";
  const dedup = p.dedupBlocked ? " [DEDUP BLOCKED]" : "";
  const quiet = p.quietHoursBlocked ? " [QUIET HOURS BLOCKED]" : "";
  const title = `Slot: ${p.slot.toUpperCase()} · ${status}${dedup}${quiet}`;
  const details = `  Reason: ${p.reason}\n  Source: ${p.sourceFunction}\n  Risk flags: ${p.riskFlags.join(", ") || "none"}`;
  
  const whyBlock = p.sources && p.sources.length > 0
    ? `  Why / Sources:\n` + p.sources.map(s => `    - [${s.category}] ${s.title} — ${s.confidence} confidence\n      Reason: ${s.reason}`).join("\n")
    : `  Why / Sources: None`;

  const message = p.messageText ? `  Message:\n  """\n  ${p.messageText.replace(/\n/g, "\n  ")}\n  """` : "  Message: (None)";
  return `${title}\n${details}\n${whyBlock}\n${message}`;
}

export const COMMANDS: CommandSpec[] = [
  {
    name: "preview-pushes",
    description: "Preview what STATENOUR would proactively send (dry-run).",
    aliases: ["pushes"],
    run: async (args, deps) => {
      const slot = args.trim().toLowerCase() || "all";
      const previews = await deps.proactivePreview(slot);
      const text = [
        "⚠️ Dry-run only. No Telegram messages were sent and no BrainMemory markers were written.",
        ...previews.map(formatPushPreview),
      ].join("\n\n");
      return { text, data: previews };
    },
  },
  {
    name: "today",
    description: "Today's snapshot: done/open, top mastery domain, one warning.",
    run: async (_args, deps) => {
      const [t, rescue] = await Promise.all([deps.today(), deps.taskRescue()]);
      const topWarning = rescue.findings[0] ? `${rescue.findings[0].title} — ${rescue.findings[0].suggestedFix}` : null;
      return { text: formatToday(t, topWarning), data: { today: t, topWarning } };
    },
  },
  {
    name: "rescue",
    description: "Tasks that are misfiled, stale, or low-confidence (read-only).",
    run: async (_args, deps) => {
      const r = await deps.taskRescue();
      return { text: formatRescue(r), data: r };
    },
  },
  {
    name: "what-changed",
    description: "What changed since the last reconciliation (+ honest deploy status).",
    aliases: ["changed", "whatchanged"],
    run: async (_args, deps) => {
      const d = await deps.changeDigest();
      return { text: formatChangeDigest(d), data: d };
    },
  },
  {
    name: "import-session",
    description: "Parse a pasted Claude Code session log into a digest (suggestion-only).",
    aliases: ["import"],
    run: async (args, deps) => {
      if (!args.trim()) {
        return { text: "Paste the session log after the command, e.g. `/import-session <log>` — or POST it to /api/system/session-import to also store it." };
      }
      const p = deps.parseSession(args);
      return { text: formatSessionDigest(p), data: p };
    },
  },
  {
    name: "receipts",
    description: "Recent write actions (with failures) — what Nick/system actually did.",
    run: async (_args, deps) => {
      const f = await deps.receiptFeed();
      return { text: formatReceipts(f), data: f };
    },
  },
  {
    name: "convert",
    description: "Turn a thought into a suggested next move (task/rule/decision/...) — suggestion only.",
    aliases: ["action"],
    run: async (args, deps) => {
      if (!args.trim()) {
        return { text: "Give me a thought to convert, e.g. `/convert I need to call the vendor about the rims`." };
      }
      const s = deps.convert({ sourceType: "chat", text: args });
      return { text: formatActionSuggestion(s), data: s };
    },
  },
  {
    name: "stale",
    description: "Stale docs + stale tasks summary.",
    run: async (_args, deps) => {
      const [d, rescue] = await Promise.all([deps.changeDigest(), deps.taskRescue()]);
      const staleTasks = rescue.byIssue.stale ?? 0;
      return {
        text: [
          `Stale docs (key): ${d.truth.staleCriticalInKeyDocs} critical, ${d.truth.staleWarnInKeyDocs} warn.`,
          `Stale tasks: ${staleTasks}.`,
          d.truth.staleCriticalInKeyDocs > 0 || staleTasks > 0 ? "Run /rescue or check:stale-docs for detail." : "Nothing stale.",
        ].join("\n"),
        data: { staleCriticalDocs: d.truth.staleCriticalInKeyDocs, staleWarnDocs: d.truth.staleWarnInKeyDocs, staleTasks },
      };
    },
  },
  {
    name: "triage-prune",
    description: "Archive tasks untouched for >14 days.",
    run: async (_args, deps) => {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const count = await deps.triagePrune(cutoff);
      return {
        text: `Triage prune completed. Archived ${count} task(s) untouched for >14 days.`,
        data: { count },
      };
    },
  },
  {
    name: "db-vacuum",
    description: "Run VACUUM on the database to reclaim space.",
    run: async (_args, deps) => {
      const started = Date.now();
      await deps.dbVacuum();
      return {
        text: `Database VACUUM completed successfully in ${Date.now() - started}ms.`,
      };
    },
  },
  {
    name: "run-cron",
    description: "Run a cron job manually by name.",
    run: async (args, deps) => {
      const jobName = args.trim();
      if (!jobName) {
        return {
          text: "Please specify a cron job name, e.g. `/run-cron ingest-gmail`.",
        };
      }
      const started = Date.now();
      try {
        const result = await deps.runCron(jobName);
        if (result && result.ok) {
          return {
            text: `Cron job "${jobName}" completed successfully in ${result.durationMs}ms (status: ${result.status}).`,
            data: result,
          };
        } else {
          return {
            text: `Cron job "${jobName}" failed: ${result?.error ?? "unknown error"} (status: ${result?.status ?? 0}).`,
            data: result,
          };
        }
      } catch (err) {
        return {
          text: `Failed to trigger cron job "${jobName}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
];

const BY_NAME: Map<string, CommandSpec> = (() => {
  const m = new Map<string, CommandSpec>();
  for (const c of COMMANDS) {
    m.set(c.name, c);
    for (const a of c.aliases ?? []) m.set(a, c);
  }
  return m;
})();

export interface ParsedCommand {
  name: string;
  args: string;
}

/** Parse a leading slash command. Pure. Returns null if the text isn't a command. */
export function parseCommand(text: string): ParsedCommand | null {
  const m = (text ?? "").trim().match(/^\/([a-z][\w-]*)\b[ \t]*([\s\S]*)$/i);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: m[2] ?? "" };
}

export interface ResolvedCommand {
  command: CommandSpec | null;
  args: string;
  /** When the command is unknown — suggested names. */
  suggestions: string[];
}

/** Resolve a slash-command string to a spec (or suggestions when unknown). Pure. */
export function resolveCommand(text: string): ResolvedCommand {
  const parsed = parseCommand(text);
  if (!parsed) return { command: null, args: "", suggestions: COMMANDS.map((c) => c.name) };
  const command = BY_NAME.get(parsed.name) ?? null;
  if (command) return { command, args: parsed.args, suggestions: [] };
  // Unknown — suggest by substring overlap, else all.
  const names = COMMANDS.map((c) => c.name);
  const overlap = names.filter((n) => n.includes(parsed.name) || parsed.name.includes(n) || n[0] === parsed.name[0]);
  return { command: null, args: parsed.args, suggestions: (overlap.length ? overlap : names).slice(0, 6) };
}

const DEFAULT_DEPS: CommandDeps = {
  changeDigest: () => buildSystemChangeDigest(),
  taskRescue: () => buildTaskRescue(),
  receiptFeed: () => buildActionReceiptFeed(),
  today: () => buildTodayCompound(),
  parseSession: (raw) => parseSessionLog(raw),
  convert: (input) => convertToAction(input),
  proactivePreview: async (slot: string, now?: Date) => {
    const dryRun = true;
    const date = now ?? new Date();
    const previews: PushPreview[] = [];
    if (slot === "morning") {
      const r = await fireMorningPush({ dryRun, now: date });
      previews.push(r as PushPreview);
    } else if (slot === "afternoon") {
      const r = await fireAfternoonPush({ dryRun, now: date });
      previews.push(r as PushPreview);
    } else if (slot === "evening") {
      const r = await fireEveningPush({ dryRun, now: date });
      previews.push(r as PushPreview);
    } else if (slot === "auto") {
      const r = await fireSlotForCurrentHour({ dryRun, now: date });
      if (r.kind === "preview") previews.push(r);
    } else {
      const m = await fireMorningPush({ dryRun, now: date });
      const a = await fireAfternoonPush({ dryRun, now: date });
      const e = await fireEveningPush({ dryRun, now: date });
      previews.push(m as PushPreview, a as PushPreview, e as PushPreview);
    }
    return previews;
  },
  triagePrune: async (cutoff: Date) => {
    return await prisma.$executeRaw`
      UPDATE "Task"
      SET "status" = 'ARCHIVED', "updatedAt" = NOW()
      WHERE "status" != 'ARCHIVED'
        AND "deletedAt" IS NULL
        AND (
          ("lastTouchedAt" IS NOT NULL AND "lastTouchedAt" < ${cutoff}) OR
          ("lastTouchedAt" IS NULL AND "createdAt" < ${cutoff})
        )
    `;
  },
  dbVacuum: async () => {
    await prisma.$executeRawUnsafe("VACUUM");
  },
  runCron: async (jobName: string) => {
    return await runManifestCron(jobName);
  },
};

export interface CommandOutcome {
  handled: boolean;
  command: string | null;
  result: CommandResult;
}

/** Resolve + run a slash command. Real services by default; override in tests. */
export async function runCommand(text: string, overrides: Partial<CommandDeps> = {}): Promise<CommandOutcome> {
  const { command, args, suggestions } = resolveCommand(text);
  if (!command) {
    const parsed = parseCommand(text);
    const head = parsed ? `Unknown command /${parsed.name}.` : "Not a command (must start with /).";
    return {
      handled: false,
      command: null,
      result: { text: `${head} Try: ${suggestions.map((s) => `/${s}`).join(" ")}`, data: { suggestions } },
    };
  }
  const deps: CommandDeps = { ...DEFAULT_DEPS, ...overrides };
  const result = await command.run(args, deps);
  return { handled: true, command: command.name, result };
}
