import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Plus, Swords, Target, Trash2, Trophy, Zap, HandshakeIcon,
  Flame, ChevronRight, Search, Brain, ListChecks, DollarSign, Users, Activity,
  Eye, TrendingUp, BookOpen, Loader2, Clock, Archive, Pin, NotebookPen,
  AlertTriangle, RotateCcw, Cog, Wrench, HeartPulse, Scale, BarChart3, Sun, Moon,
  Calendar, Mail, Send, Star, Terminal, Globe, MessageSquare,
} from "lucide-react";

interface ToolConfig {
  label: string;
  doneLabel: string;
  runningLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: "gold" | "emerald" | "blue" | "purple" | "red" | "amber";
  link?: { href: string; label: string };
  /**
   * v10.0.529.91 · Wave 35 · entity-aware deep link. If present AND
   * returns a value, OVERRIDES the static `link` field with a per-
   * output href + label. Used to point at the exact row the tool
   * just touched (e.g. /tasks#task-row-<id>) instead of the surface
   * root. PageContextBridge picks the hash up on navigation and
   * populates the matching context anchor (lastTaskId / lastPinId /
   * etc) so the next chat turn already knows the entity.
   *
   * Return null to fall back to the static `link`.
   */
  linkFn?: (out: unknown) => { href: string; label: string } | null;
  /** Extract a subtitle from the output object. */
  subtitle?: (out: unknown) => string | null;
  /**
   * Optional rich body — rendered below the subtitle when the tool
   * returns structured data that deserves more than a one-liner.
   * Returns JSX or null. Used for getRevenueAging (aging bar chart),
   * getCustomerLTV (top customers), getBlindSpots (severity pills),
   * etc.
   */
  renderRich?: (out: unknown) => React.ReactNode | null;
}

export const TOOL_CONFIG: Record<string, ToolConfig> = {
  addTasksToProject: {
    label: "Creating tasks",
    doneLabel: "Tasks created",
    runningLabel: "Creating tasks…",
    icon: Plus,
    color: "gold",
    link: { href: "/missions", label: "View in Actions" },
    subtitle: (out) => {
      const o = out as { count?: number; missionId?: string } | null;
      return o?.count ? `${o.count} tasks created` : null;
    },
  },
  createTask: {
    label: "Creating task",
    doneLabel: "Task created",
    runningLabel: "Creating task…",
    icon: Plus,
    color: "gold",
    link: { href: "/missions", label: "View in Actions" },
    // v10.0.529.91 · Wave 35 · deep-link to the exact task row · the
    // /tasks page already supports #task-row-<id> ring-highlight (see
    // tasks/page.tsx:1147). PageContextBridge then picks up the hash
    // and seeds lastTaskId for the next chat turn.
    linkFn: (out) => {
      const o = out as { taskId?: string } | null;
      return o?.taskId ? { href: `/missions#task-row-${o.taskId}`, label: "View task" } : null;
    },
    subtitle: (out) => {
      const o = out as { title?: string; task?: { title?: string } } | null;
      return o?.title || o?.task?.title || null;
    },
  },
  completeTask: {
    label: "Completing task",
    doneLabel: "Task done",
    runningLabel: "Completing…",
    icon: CheckCircle2,
    color: "emerald",
    link: { href: "/missions", label: "Actions" },
    linkFn: (out) => {
      const o = out as { taskId?: string } | null;
      return o?.taskId ? { href: `/missions#task-row-${o.taskId}`, label: "View task" } : null;
    },
    subtitle: (out) => {
      const o = out as { title?: string; task?: { title?: string } } | null;
      return o?.title || o?.task?.title || null;
    },
  },
  updateTask: {
    label: "Updating task",
    doneLabel: "Task updated",
    runningLabel: "Updating…",
    icon: Zap,
    color: "blue",
    link: { href: "/missions", label: "Actions" },
    linkFn: (out) => {
      const o = out as { taskId?: string } | null;
      return o?.taskId ? { href: `/missions#task-row-${o.taskId}`, label: "View task" } : null;
    },
    subtitle: (out) => {
      const o = out as { title?: string; fieldsChanged?: string[] } | null;
      if (o?.fieldsChanged?.length) {
        return `${o.title ?? "task"} · ${o.fieldsChanged.join(" · ")}`;
      }
      return o?.title || null;
    },
  },
  // v10.0.529.86 · Wave 30 · the 4 Wave 29 tools without visual cards.
  // Each gets a compact confirmation in the chat thread so the operator
  // sees what happened beyond Nick's text reply.
  snoozeTask: {
    label: "Snoozing task",
    doneLabel: "Task snoozed",
    runningLabel: "Snoozing…",
    icon: Clock,
    color: "blue",
    link: { href: "/missions", label: "View in tasks" },
    linkFn: (out) => {
      const o = out as { taskId?: string } | null;
      return o?.taskId ? { href: `/missions#task-row-${o.taskId}`, label: "View task" } : null;
    },
    subtitle: (out) => {
      const o = out as { title?: string; label?: string; snoozedUntil?: string } | null;
      if (o?.title && o?.label) return `"${o.title}" · back ${o.label}`;
      if (o?.title && o?.snoozedUntil) {
        return `"${o.title}" · back ${new Date(o.snoozedUntil).toLocaleDateString()}`;
      }
      return o?.title ?? null;
    },
  },
  archiveGoal: {
    label: "Archiving goal",
    doneLabel: "Goal archived",
    runningLabel: "Archiving…",
    icon: Archive,
    color: "amber",
    link: { href: "/missions?mode=PLAN", label: "View goals" },
    subtitle: (out) => {
      const o = out as { title?: string } | null;
      return o?.title ? `"${o.title}" · history preserved` : null;
    },
  },
  "person.create": {
    label: "Adding contact",
    doneLabel: "Contact added",
    runningLabel: "Adding contact…",
    icon: Users,
    color: "purple",
    link: { href: "/people", label: "View people" },
    linkFn: (out) => {
      const o = out as { id?: string } | null;
      return o?.id ? { href: `/people#person-${o.id}`, label: "View contact" } : null;
    },
    subtitle: (out) => {
      const o = out as { name?: string; note?: string } | null;
      return o?.name ? `${o.name} · ${o.note ?? "Added to people"}` : null;
    },
  },
  logGoalProgress: {
    label: "Logging progress",
    doneLabel: "Progress logged",
    runningLabel: "Logging…",
    icon: TrendingUp,
    color: "emerald",
    link: { href: "/missions?mode=PLAN", label: "View goals" },
    subtitle: (out) => {
      const o = out as {
        title?: string;
        currentValue?: number;
        progress?: number;
        achieved?: boolean;
      } | null;
      if (o?.achieved) return `"${o.title}" · achieved 🎯`;
      if (o?.title && typeof o.progress === "number") {
        return `"${o.title}" · ${o.progress}%`;
      }
      return o?.title ?? null;
    },
  },
  pinMemory: {
    label: "Pinning to memory",
    doneLabel: "Pinned to brain",
    runningLabel: "Pinning…",
    icon: Pin,
    color: "gold",
    link: { href: "/pins", label: "Pins" },
    // v10.0.529.91 · Wave 35 · /pins is the dedicated surface for
    // pinned_user BrainMemory rows · /brain shows raw memory. The
    // pin tool returns the BrainMemory.id which /pins page renders
    // under that key.
    linkFn: (out) => {
      const o = out as { id?: string } | null;
      return o?.id ? { href: `/pins#pin-${o.id}`, label: "View pin" } : null;
    },
    subtitle: (out) => {
      const o = out as { content?: string } | null;
      return o?.content ? o.content.slice(0, 80) : null;
    },
  },
  deleteTask: {
    label: "Deleting task",
    doneLabel: "Task deleted",
    runningLabel: "Deleting…",
    icon: Trash2,
    color: "red",
    subtitle: (out) => {
      const o = out as { title?: string } | null;
      return o?.title || null;
    },
  },
  setMit: {
    label: "Setting MIT",
    doneLabel: "MIT locked",
    runningLabel: "Locking MIT…",
    icon: Swords,
    color: "gold",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { text?: string; mit?: string } | null;
      return o?.text || o?.mit || null;
    },
  },
  clearMit: {
    label: "Clearing MIT",
    doneLabel: "MIT cleared",
    runningLabel: "Clearing…",
    icon: Swords,
    color: "amber",
  },
  addCommitment: {
    label: "Adding commitment",
    doneLabel: "Commitment added",
    runningLabel: "Adding…",
    icon: HandshakeIcon,
    color: "purple",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { description?: string; title?: string } | null;
      return o?.description || o?.title || null;
    },
  },
  markCommitment: {
    label: "Marking commitment",
    doneLabel: "Commitment logged",
    runningLabel: "Logging…",
    icon: HandshakeIcon,
    color: "purple",
    subtitle: (out) => {
      const o = out as { action?: string; description?: string } | null;
      return o?.description || (o?.action ? `marked ${o.action}` : null);
    },
  },
  // Apr 19 · logScore retired alongside DailyScore. Card left out of
  // the registry so any leftover tool call renders as the generic
  // fallback instead of a bespoke "Score logged" pill.
  toggleHabit: {
    label: "Toggling habit",
    doneLabel: "Habit toggled",
    runningLabel: "Toggling…",
    icon: Flame,
    color: "amber",
    link: { href: "/", label: "Ultron" },
    subtitle: (out) => {
      const o = out as { habit?: string; label?: string; completed?: boolean } | null;
      if (!o) return null;
      const name = o.label || o.habit;
      if (!name) return null;
      return `${name}${o.completed ? " · done" : ""}`;
    },
  },
  // Apr 18: addOpenLoop / resolveOpenLoop renamed → createLoop / closeLoop
  // (rename-only refactor; both wrote Task INBOX rows under the hood).
  // v10.0.75: createLoop + closeLoop themselves retired from the live
  // tool catalog (canonical: createTask / completeTask). The render
  // configs below stay so old chat-message history that already used
  // the legacy names still renders proper tool cards instead of falling
  // back to "Unknown tool". When all stored chat older than the v10.0.75
  // cutoff has aged out, these can be removed.
  createLoop: {
    label: "Creating task",
    doneLabel: "Task added",
    runningLabel: "Adding to INBOX…",
    icon: Target,
    color: "blue",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { title?: string } | null;
      return o?.title || null;
    },
  },
  closeLoop: {
    label: "Closing task",
    doneLabel: "Task closed",
    runningLabel: "Closing…",
    icon: CheckCircle2,
    color: "emerald",
  },

  // ── READ tools — show shimmer card so Nour sees what Nick is
  // looking at, not just a pulsing name. Progressive feedback during
  // multi-step tool chains. ──

  searchMemories: {
    label: "Searching memories",
    doneLabel: "Memories found",
    runningLabel: "Searching your brain memory…",
    icon: Brain,
    color: "purple",
    link: { href: "/brain", label: "Brain" },
    subtitle: (out) => {
      const o = out as { count?: number; results?: unknown[]; memories?: unknown[] } | null;
      const n = o?.count ?? o?.results?.length ?? o?.memories?.length;
      return typeof n === "number" ? `${n} match${n === 1 ? "" : "es"}` : null;
    },
  },
  searchColdMemory: {
    label: "Reaching back into cold memory",
    doneLabel: "Cold memory hits",
    runningLabel: "Semantic search across Drive + archive…",
    icon: Search,
    color: "blue",
    // v10.0.529.88 · Wave 32 · /system/audit doesn't exist · was 404.
    link: { href: "/system/coverage", label: "Corpus" },
    subtitle: (out) => {
      const o = out as {
        count?: number;
        matches?: Array<{ category?: string; hybridScore?: number; driveTitle?: string }>;
      } | null;
      const n = o?.count ?? o?.matches?.length ?? 0;
      if (n === 0) return "no matches — try widening scope";
      const topTitle = o?.matches?.[0]?.driveTitle;
      const topCat = o?.matches?.[0]?.category;
      const topScore = o?.matches?.[0]?.hybridScore;
      const scorePart = typeof topScore === "number" ? ` · ${(topScore * 100).toFixed(0)}%` : "";
      if (topTitle) return `${n} hits · top: "${topTitle.slice(0, 40)}"${scorePart}`;
      if (topCat) return `${n} hits · top: [${topCat}]${scorePart}`;
      return `${n} match${n === 1 ? "" : "es"}`;
    },
  },
  syncDriveMemory: {
    label: "Syncing Drive",
    doneLabel: "Drive synced",
    runningLabel: "Pulling latest docs from Drive…",
    icon: Zap,
    color: "gold",
    // v10.0.529.88 · Wave 32 · /system/audit doesn't exist · was 404.
    link: { href: "/system/chat-health", label: "Chat health" },
    subtitle: (out) => {
      const o = out as { ok?: boolean; stored?: number; skipped?: number } | null;
      if (!o) return null;
      if (!o.ok) return "sync failed — check audit log";
      return `${o.stored ?? 0} new · ${o.skipped ?? 0} skipped`;
    },
  },
  searchReflections: {
    label: "Searching reflections",
    doneLabel: "Reflections found",
    runningLabel: "Reading past reflections…",
    icon: Eye,
    color: "emerald",
    link: { href: "/journal", label: "Journal" },
    subtitle: (out) => {
      const o = out as { count?: number; results?: unknown[]; reflections?: unknown[] } | null;
      const n = o?.count ?? o?.results?.length ?? o?.reflections?.length;
      return typeof n === "number" ? `${n} match${n === 1 ? "" : "es"}` : null;
    },
  },
  getRecentReflections: {
    label: "Loading reflections",
    doneLabel: "Reflections loaded",
    runningLabel: "Pulling recent reflections…",
    icon: Eye,
    color: "emerald",
    // v10.0.529.87 · Wave 31 · audit found this card had no link
    // while its sibling searchReflections did. Inconsistent landing
    // when Nick fans the operator toward past reflections.
    link: { href: "/journal", label: "Journal" },
  },
  // v10.0.529.87 · Wave 31 · journal-mutating tools. Audit found
  // 5 tools fell through to the unknown-tool fallback pill (bare
  // spinner / no link). All 5 now route the operator at /journal
  // so they can see the just-captured entry in context.
  logSituation: {
    label: "Logging situation",
    doneLabel: "Situation logged",
    runningLabel: "Capturing situation context…",
    icon: AlertTriangle,
    color: "amber",
    link: { href: "/journal", label: "Journal" },
    subtitle: (out) => {
      const o = out as { id?: string; severity?: string; title?: string } | null;
      if (!o) return null;
      if (o.title) return `"${o.title.slice(0, 60)}"`;
      if (o.severity) return `severity · ${o.severity}`;
      return o.id ? "captured" : null;
    },
  },
  journalDecision: {
    label: "Logging decision",
    doneLabel: "Decision logged",
    runningLabel: "Recording decision · reasoning · alternatives…",
    icon: NotebookPen,
    color: "purple",
    link: { href: "/system/quality?view=decisions", label: "Decisions" },
    // v10.0.529.91 · Wave 35 · deep-link to the decision detail page ·
    // /decisions/<id> exists and PageContextBridge auto-extracts
    // lastDecisionId from that route.
    linkFn: (out) => {
      const o = out as { id?: string } | null;
      return o?.id ? { href: `/decisions/${o.id}`, label: "Open decision" } : null;
    },
    subtitle: (out) => {
      const o = out as { id?: string; title?: string; replayDate?: string } | null;
      if (!o) return null;
      if (o.title) return `"${o.title.slice(0, 50)}"${o.replayDate ? ` · replay ${o.replayDate}` : ""}`;
      return o.id ? "decision filed" : null;
    },
  },
  reviewDecisionReplay: {
    label: "Reviewing decision",
    doneLabel: "Decision reviewed",
    runningLabel: "Replaying past decision…",
    icon: RotateCcw,
    color: "purple",
    link: { href: "/system/quality?view=decisions", label: "Decisions" },
    subtitle: (out) => {
      const o = out as { outcome?: string; lesson?: string } | null;
      if (o?.outcome) return `outcome · ${o.outcome.slice(0, 60)}`;
      if (o?.lesson) return `lesson · ${o.lesson.slice(0, 60)}`;
      return null;
    },
  },
  getDecisionReplays: {
    label: "Loading decisions",
    doneLabel: "Decisions loaded",
    runningLabel: "Pulling past decisions…",
    icon: NotebookPen,
    color: "purple",
    link: { href: "/system/quality?view=decisions", label: "Decisions" },
    subtitle: (out) => {
      const o = out as { count?: number; decisions?: unknown[] } | null;
      const n = o?.count ?? o?.decisions?.length;
      return typeof n === "number" ? `${n} decision${n === 1 ? "" : "s"}` : null;
    },
  },
  getDecisionsDueForReplay: {
    label: "Checking replays due",
    doneLabel: "Replays checked",
    runningLabel: "Scanning decisions due for review…",
    icon: Clock,
    color: "amber",
    link: { href: "/system/quality?view=decisions", label: "Decisions" },
    subtitle: (out) => {
      const o = out as { count?: number; due?: unknown[] } | null;
      const n = o?.count ?? o?.due?.length;
      if (typeof n !== "number") return null;
      return n === 0 ? "nothing due" : `${n} due for replay`;
    },
  },
  // v10.0.529.87 · Wave 31 · settings read-only diagnostic. No write
  // path exposed via chat by design (threat-modeling: chat-driven cron
  // kill would silence 41 scheduled jobs with one utterance). Read-
  // only summary card so the operator gets a formatted result instead
  // of raw JSON dump.
  getCronStatus: {
    label: "Reading cron status",
    doneLabel: "Cron status loaded",
    runningLabel: "Pulling cron health…",
    icon: Cog,
    color: "blue",
    // v10.0.529.88 · Wave 32 · authoritative cron deck is /system/crons.
    link: { href: "/system/crons", label: "Crons" },
    subtitle: (out) => {
      const o = out as {
        total?: number;
        killed?: number;
        failing?: number;
        crons?: unknown[];
      } | null;
      if (!o) return null;
      const total = o.total ?? o.crons?.length;
      if (typeof total !== "number") return null;
      const killed = o.killed ?? 0;
      const failing = o.failing ?? 0;
      return `${total} jobs · ${killed} killed · ${failing} failing`;
    },
  },
  // v10.0.529.88 · Wave 32 · /life · /plan · /mastery write-tool cards.
  // Audit found Nick could mutate these surfaces from chat but the
  // operator only saw an unknown-tool pill · no formatted result, no
  // tap target. Now each routes at the right landing page.
  setLifeGoal: {
    label: "Setting life goal",
    doneLabel: "Life goal set",
    runningLabel: "Recording life goal…",
    icon: Target,
    color: "gold",
    link: { href: "/stats", label: "Mastery" },
    subtitle: (out) => {
      const o = out as { id?: string; title?: string; horizon?: string; domain?: string } | null;
      if (!o) return null;
      if (o.title) return `"${o.title.slice(0, 60)}"${o.horizon ? ` · ${o.horizon}` : ""}`;
      return o.id ? "goal saved" : null;
    },
  },
  updateMasteryScore: {
    label: "Updating mastery score",
    doneLabel: "Score updated",
    runningLabel: "Recording mastery score…",
    icon: TrendingUp,
    color: "emerald",
    link: { href: "/stats", label: "Mastery" },
    subtitle: (out) => {
      const o = out as { domain?: string; score?: number; delta?: number } | null;
      if (!o) return null;
      if (typeof o.score === "number" && o.domain) {
        const deltaStr = typeof o.delta === "number" ? ` (${o.delta >= 0 ? "+" : ""}${o.delta})` : "";
        return `${o.domain} · ${o.score}${deltaStr}`;
      }
      return o.domain ? `${o.domain} updated` : null;
    },
  },
  createMissionPlan: {
    label: "Building mission plan",
    doneLabel: "Plan generated",
    runningLabel: "Drafting mission plan…",
    icon: Trophy,
    color: "gold",
    link: { href: "/stats", label: "Plan" },
    subtitle: (out) => {
      const o = out as { missionId?: string; title?: string; steps?: unknown[]; count?: number } | null;
      if (!o) return null;
      const n = o.count ?? o.steps?.length;
      if (o.title && typeof n === "number") return `"${o.title.slice(0, 40)}" · ${n} steps`;
      if (o.title) return `"${o.title.slice(0, 60)}"`;
      return typeof n === "number" ? `${n} steps` : null;
    },
  },
  setOKRs: {
    label: "Setting OKRs",
    doneLabel: "OKRs set",
    runningLabel: "Recording objectives + key results…",
    icon: Target,
    color: "blue",
    link: { href: "/stats", label: "Plan" },
    subtitle: (out) => {
      const o = out as { count?: number; okrs?: unknown[]; objective?: string } | null;
      if (!o) return null;
      const n = o.count ?? o.okrs?.length;
      if (o.objective) return `"${o.objective.slice(0, 50)}"${typeof n === "number" ? ` · ${n} KR` : ""}`;
      return typeof n === "number" ? `${n} OKR${n === 1 ? "" : "s"}` : null;
    },
  },
  setWeeklyTargets: {
    label: "Setting weekly targets",
    doneLabel: "Targets set",
    runningLabel: "Locking this week's targets…",
    icon: ListChecks,
    color: "gold",
    link: { href: "/stats", label: "Plan" },
    subtitle: (out) => {
      const o = out as { count?: number; targets?: unknown[] } | null;
      const n = o?.count ?? o?.targets?.length;
      return typeof n === "number" ? `${n} target${n === 1 ? "" : "s"}` : null;
    },
  },
  // v10.0.529.88 · Wave 32 · /system telemetry cards. Read-only
  // tools but the operator was getting raw JSON dumps before · now
  // formatted summaries + landing-page tap targets.
  toolHealth: {
    label: "Checking tool health",
    doneLabel: "Tool health checked",
    runningLabel: "Reading tool catalog + env probes…",
    icon: Wrench,
    color: "amber",
    link: { href: "/system/tools", label: "Tools" },
    subtitle: (out) => {
      const o = out as {
        totalTools?: number;
        missingEnv?: number;
        catalogCount?: number;
        envMissing?: string[];
      } | null;
      if (!o) return null;
      const total = o.totalTools ?? o.catalogCount;
      const missing = o.missingEnv ?? o.envMissing?.length ?? 0;
      if (typeof total !== "number") return null;
      return missing === 0
        ? `${total} tools · all env present`
        : `${total} tools · ${missing} env missing`;
    },
  },
  getBrainHealth: {
    label: "Reading brain health",
    doneLabel: "Brain health loaded",
    runningLabel: "Pulling brain velocity + signals…",
    icon: HeartPulse,
    color: "emerald",
    link: { href: "/brain?tab=health", label: "Brain health" },
    subtitle: (out) => {
      const o = out as { velocity?: number; status?: string; healthScore?: number } | null;
      if (!o) return null;
      if (typeof o.healthScore === "number") return `health · ${o.healthScore}/100`;
      if (o.status) return o.status;
      if (typeof o.velocity === "number") return `velocity · ${o.velocity}`;
      return null;
    },
  },
  // v10.0.74: searchBrainDumps tool retired (canonical: searchReflections,
  // which now covers both Reflection rows + BrainDump entries with date
  // range). Render config kept for old chat-history rendering — see the
  // createLoop / closeLoop note above for the same backwards-compat
  // pattern.
  searchBrainDumps: {
    label: "Searching journal",
    doneLabel: "Journal searched",
    runningLabel: "Searching your journal…",
    icon: BookOpen,
    color: "amber",
    link: { href: "/journal", label: "Journal" },
  },
  searchConversations: {
    label: "Searching chats",
    doneLabel: "Chats searched",
    runningLabel: "Searching past conversations…",
    icon: Search,
    color: "blue",
  },
  rankNextActions: {
    label: "Ranking actions",
    doneLabel: "Actions ranked",
    runningLabel: "Ranking your next moves…",
    icon: ListChecks,
    color: "gold",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { count?: number; actions?: unknown[]; top?: { title?: string } } | null;
      if (o?.top?.title) return o.top.title;
      const n = o?.count ?? o?.actions?.length;
      return typeof n === "number" ? `${n} action${n === 1 ? "" : "s"}` : null;
    },
  },
  getBlindSpots: {
    label: "Checking blind spots",
    doneLabel: "Blind spots checked",
    runningLabel: "Scanning for what you're missing…",
    icon: Eye,
    color: "red",
    link: { href: "/brain", label: "Brain · blind spots" },
    subtitle: (out) => {
      const o = out as { count?: number; blindSpots?: unknown[] } | null;
      const n = o?.count ?? o?.blindSpots?.length;
      return typeof n === "number" ? `${n} signal${n === 1 ? "" : "s"}` : null;
    },
    renderRich: (out) => {
      const o = out as {
        blindSpots?: Array<{
          title?: string;
          severity?: string;
          summary?: string;
          category?: string;
        }>;
      } | null;
      const spots = o?.blindSpots?.slice(0, 4);
      if (!spots || spots.length === 0) return null;
      return (
        <div className="flex flex-col gap-1 mt-1.5">
          {spots.map((s, i) => {
            const sev = (s.severity || "medium").toLowerCase();
            const sevColor =
              sev === "critical"
                ? "bg-red-500/20 text-red-300 border-red-500/40"
                : sev === "high"
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : sev === "medium"
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                : "bg-zinc-500/20 text-zinc-300 border-zinc-500/40";
            return (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={cn(
                    "text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0",
                    sevColor
                  )}
                >
                  {sev}
                </span>
                <p className="text-[10px] text-[var(--text-secondary)] leading-snug flex-1 min-w-0">
                  <span className="text-[var(--text-primary)] font-medium">
                    {s.title || s.category || "Blind spot"}
                  </span>
                  {s.summary && (
                    <span className="text-[var(--text-tertiary)]"> · {s.summary.slice(0, 120)}</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      );
    },
  },
  getRevenueAging: {
    label: "Checking aging",
    doneLabel: "Aging checked",
    runningLabel: "Checking estimates aging out…",
    icon: DollarSign,
    color: "amber",
    link: { href: "/revenue", label: "Revenue" },
    subtitle: (out) => {
      const o = out as { totalAtRisk?: number; count?: number } | null;
      if (o?.totalAtRisk && o?.count) return `$${o.totalAtRisk} at risk · ${o.count} stale`;
      return null;
    },
    renderRich: (out) => {
      const o = out as {
        buckets?: Array<{ label: string; count: number; totalValue: number }>;
        buckets30Plus?: { count: number; totalValue: number };
        buckets7Plus?: { count: number; totalValue: number };
        buckets1Plus?: { count: number; totalValue: number };
      } | null;
      // Accept either a buckets array OR named bucket fields
      const buckets: Array<{ label: string; count: number; totalValue: number }> = [];
      if (Array.isArray(o?.buckets)) {
        for (const b of o.buckets) buckets.push(b);
      } else {
        if (o?.buckets1Plus) buckets.push({ label: "1-6d", ...o.buckets1Plus });
        if (o?.buckets7Plus) buckets.push({ label: "7-29d", ...o.buckets7Plus });
        if (o?.buckets30Plus) buckets.push({ label: "30d+", ...o.buckets30Plus });
      }
      if (buckets.length === 0) return null;
      const maxValue = Math.max(...buckets.map((b) => b.totalValue), 1);
      return (
        <div className="w-full mt-1.5 space-y-1">
          {buckets.map((b) => {
            const pct = Math.min(100, (b.totalValue / maxValue) * 100);
            const isHot = b.label.includes("30");
            return (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-[var(--text-tertiary)] w-10 shrink-0">
                  {b.label}
                </span>
                <div className="flex-1 h-1.5 bg-[var(--bg-void)] rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      isHot ? "bg-red-500" : "bg-amber-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] font-mono text-[var(--text-secondary)] tabular-nums w-20 text-right shrink-0">
                  ${b.totalValue.toLocaleString()} · {b.count}
                </span>
              </div>
            );
          })}
        </div>
      );
    },
  },
  // Apr 19 · getDailyScores retired alongside DailyScore.
  // v10.0.529.89 · Wave 33 · dailyPulse card moved to the bottom of
  // TOOL_CONFIG with a richer subtitle (habits hit · MIT preview).
  getCustomerLTV: {
    label: "Loading customers",
    doneLabel: "Customers loaded",
    runningLabel: "Ranking customer value…",
    icon: Users,
    color: "purple",
    link: { href: "https://nickstire.org/admin", label: "Admin" },
    subtitle: (out) => {
      const o = out as {
        count?: number;
        totalLifetimeValue?: number;
        customers?: unknown[];
      } | null;
      if (o?.totalLifetimeValue && o?.count)
        return `$${o.totalLifetimeValue.toLocaleString()} across ${o.count} customers`;
      const n = o?.count ?? o?.customers?.length;
      return typeof n === "number" ? `${n} customer${n === 1 ? "" : "s"}` : null;
    },
    renderRich: (out) => {
      const o = out as {
        customers?: Array<{
          name?: string;
          lifetimeValue?: number;
          visitCount?: number;
          lastVisit?: string;
        }>;
      } | null;
      const top = o?.customers?.slice(0, 4);
      if (!top || top.length === 0) return null;
      const maxLtv = Math.max(...top.map((c) => c.lifetimeValue || 0), 1);
      return (
        <div className="flex flex-col gap-1 mt-1.5">
          {top.map((c, i) => {
            const pct = Math.min(100, ((c.lifetimeValue || 0) / maxLtv) * 100);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-primary)] font-medium w-20 truncate shrink-0">
                  {c.name || "—"}
                </span>
                <div className="flex-1 h-1.5 bg-[var(--bg-void)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-400 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[9px] font-mono text-[var(--text-secondary)] tabular-nums w-24 text-right shrink-0">
                  ${(c.lifetimeValue || 0).toLocaleString()}
                  {c.visitCount ? ` · ${c.visitCount}v` : ""}
                </span>
              </div>
            );
          })}
        </div>
      );
    },
  },
  findCustomer: {
    label: "Looking up customer",
    doneLabel: "Customer found",
    runningLabel: "Looking up customer…",
    icon: Users,
    color: "blue",
  },
  getForecast: {
    label: "Running forecast",
    doneLabel: "Forecast ready",
    runningLabel: "Running the forecast engine…",
    icon: TrendingUp,
    color: "amber",
    link: { href: "/brain", label: "Brain · blind spots" },
  },
  syncKnowledge: {
    label: "Syncing knowledge",
    doneLabel: "Knowledge synced",
    runningLabel: "Syncing your knowledge layer…",
    icon: Brain,
    color: "gold",
    // 2026-08-16 · reverting the Wave-32 re-point. Its premise — "/knowledge
    // is the actual file/category browser" — was already false when written:
    // that page had rendered zero files since the monorepo import. /brain is
    // where syncKnowledge's writes actually land.
    link: { href: "/brain", label: "Brain" },
    subtitle: (out) => {
      const o = out as { classified?: number; chatPromoted?: number; tasksRebalanced?: number } | null;
      if (!o) return null;
      const parts: string[] = [];
      if (o.classified) parts.push(`${o.classified} classified`);
      if (o.chatPromoted) parts.push(`${o.chatPromoted} promoted`);
      if (o.tasksRebalanced) parts.push(`${o.tasksRebalanced} rebalanced`);
      return parts.join(" · ") || null;
    },
  },
  // ingestThought tool card removed Apr 15 — brain-dump capture is now
  // handled by the NL interceptor in /api/ai/chat which streams a
  // confirmation message directly, so no tool-card is ever rendered.
  // v10.0.529.89 · Wave 33 · /body + /financial read-only cards. All
  // 5 tools never mutate · the cards exist to give Nick's data lookups
  // a formatted result + landing-page tap target. Pre-Wave-33 the
  // operator saw a bare unknown-tool spinner.
  getBodyData: {
    label: "Reading body data",
    doneLabel: "Body data loaded",
    runningLabel: "Pulling latest body metrics…",
    icon: Scale,
    color: "emerald",
    link: { href: "/stats#body", label: "Body" },
    subtitle: (out) => {
      const o = out as { weight?: number; bodyFat?: number; entries?: unknown[]; count?: number } | null;
      if (!o) return null;
      const parts: string[] = [];
      if (typeof o.weight === "number") parts.push(`${o.weight} lb`);
      if (typeof o.bodyFat === "number") parts.push(`${o.bodyFat}% BF`);
      const n = o.count ?? o.entries?.length;
      if (parts.length === 0 && typeof n === "number") return `${n} entries`;
      return parts.join(" · ") || null;
    },
  },
  getFinancialSnapshot: {
    label: "Reading finances",
    doneLabel: "Finances loaded",
    runningLabel: "Pulling latest financial snapshot…",
    icon: DollarSign,
    color: "emerald",
    link: { href: "/business?tab=money", label: "Financial" },
    subtitle: (out) => {
      const o = out as { netWorth?: number; cashOnHand?: number; runwayMonths?: number } | null;
      if (!o) return null;
      const parts: string[] = [];
      if (typeof o.netWorth === "number") parts.push(`net $${(o.netWorth / 1000).toFixed(1)}k`);
      if (typeof o.cashOnHand === "number") parts.push(`cash $${(o.cashOnHand / 1000).toFixed(1)}k`);
      if (typeof o.runwayMonths === "number") parts.push(`${o.runwayMonths.toFixed(1)}mo runway`);
      return parts.join(" · ") || null;
    },
  },
  getProjections: {
    label: "Reading projections",
    doneLabel: "Projections loaded",
    runningLabel: "Calculating financial projections…",
    icon: TrendingUp,
    color: "blue",
    link: { href: "/business?tab=money", label: "Financial" },
    subtitle: (out) => {
      const o = out as { horizon?: string; projected?: number; months?: number } | null;
      if (!o) return null;
      if (typeof o.projected === "number" && o.horizon) {
        return `${o.horizon} · $${(o.projected / 1000).toFixed(1)}k`;
      }
      return null;
    },
  },
  compareLiveRevenue: {
    label: "Comparing live revenue",
    doneLabel: "Revenue compared",
    runningLabel: "Pulling live revenue vs target…",
    icon: BarChart3,
    color: "gold",
    link: { href: "/business?tab=money", label: "Financial" },
    subtitle: (out) => {
      const o = out as { mtd?: number; target?: number; pct?: number } | null;
      if (!o) return null;
      if (typeof o.pct === "number") return `MTD · ${o.pct.toFixed(0)}% of target`;
      if (typeof o.mtd === "number") return `MTD · $${(o.mtd / 1000).toFixed(1)}k`;
      return null;
    },
  },
  getMarketingAttribution: {
    label: "Reading attribution",
    doneLabel: "Attribution loaded",
    runningLabel: "Resolving channel attribution…",
    icon: TrendingUp,
    color: "purple",
    link: { href: "/business?tab=money", label: "Financial" },
    subtitle: (out) => {
      const o = out as { topChannel?: string; topChannelPct?: number } | null;
      if (!o) return null;
      if (o.topChannel && typeof o.topChannelPct === "number") {
        return `${o.topChannel} · ${o.topChannelPct.toFixed(0)}%`;
      }
      return o.topChannel ?? null;
    },
  },
  // v10.0.529.89 · Wave 33 · weekly + daily review cards. These tools
  // produce rich text but had no card · the chat rendered raw output.
  // Now formatted with a tap target back to the dashboard.
  analyzeWeek: {
    label: "Analyzing the week",
    doneLabel: "Week analyzed",
    runningLabel: "Pulling 7-day signals · habits · revenue · streaks…",
    icon: BarChart3,
    color: "gold",
    link: { href: "/", label: "Home" },
    subtitle: (out) => {
      const o = out as { topWin?: string; topLeak?: string; weekScore?: number } | null;
      if (!o) return null;
      if (typeof o.weekScore === "number") return `week · ${o.weekScore}/100`;
      if (o.topWin) return `top win · ${o.topWin.slice(0, 50)}`;
      return null;
    },
  },
  weeklyReview: {
    label: "Running weekly review",
    doneLabel: "Review complete",
    runningLabel: "Surfacing what worked + what slipped this week…",
    icon: Trophy,
    color: "gold",
    link: { href: "/", label: "Home" },
    subtitle: (out) => {
      const o = out as { wins?: number; misses?: number; reframes?: number } | null;
      if (!o) return null;
      const parts: string[] = [];
      if (typeof o.wins === "number") parts.push(`${o.wins} wins`);
      if (typeof o.misses === "number") parts.push(`${o.misses} misses`);
      if (typeof o.reframes === "number") parts.push(`${o.reframes} reframes`);
      return parts.join(" · ") || null;
    },
  },
  endOfDay: {
    label: "Ending the day",
    doneLabel: "Day closed",
    runningLabel: "Closing today · habits · score · tomorrow's MIT…",
    icon: Moon,
    color: "blue",
    link: { href: "/", label: "Home" },
    subtitle: (out) => {
      const o = out as { tasksDone?: number; mitTomorrow?: string; score?: number } | null;
      if (!o) return null;
      if (typeof o.score === "number") return `today · ${o.score}/100`;
      if (typeof o.tasksDone === "number") return `${o.tasksDone} done today`;
      if (o.mitTomorrow) return `tomorrow · "${o.mitTomorrow.slice(0, 50)}"`;
      return null;
    },
  },
  dailyPulse: {
    label: "Reading daily pulse",
    doneLabel: "Pulse loaded",
    runningLabel: "Sensing today's tempo · habits · MIT · open work…",
    icon: Sun,
    color: "gold",
    link: { href: "/", label: "Home" },
    subtitle: (out) => {
      const o = out as { habitsHit?: number; habitsTotal?: number; mit?: string } | null;
      if (!o) return null;
      const parts: string[] = [];
      if (typeof o.habitsHit === "number" && typeof o.habitsTotal === "number") {
        parts.push(`habits · ${o.habitsHit}/${o.habitsTotal}`);
      }
      if (o.mit) parts.push(`MIT · "${o.mit.slice(0, 40)}"`);
      return parts.join(" · ") || null;
    },
  },
  "google.getSchedule": {
    label: "Reading calendar",
    doneLabel: "Schedule loaded",
    runningLabel: "Fetching Google Calendar events…",
    icon: Calendar,
    color: "blue",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { count?: number; events?: unknown[] } | null;
      const count = o?.count ?? o?.events?.length;
      return typeof count === "number" ? `${count} event${count === 1 ? "" : "s"} found` : null;
    },
  },
  "google.proposeEvent": {
    label: "Scheduling event",
    doneLabel: "Event proposed",
    runningLabel: "Scheduling Google Calendar event…",
    icon: Calendar,
    color: "gold",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { summary?: string; created?: boolean } | null;
      if (o?.summary) return `${o.created ? "booked" : "draft link generated"} · "${o.summary}"`;
      return null;
    },
  },
  "gmail.draftReply": {
    label: "Drafting reply",
    doneLabel: "Reply drafted",
    runningLabel: "Creating email draft reply…",
    icon: Mail,
    color: "blue",
    subtitle: (out) => {
      const o = out as { id?: string } | null;
      return o?.id ? `draft ID: ${o.id.slice(0, 10)}…` : null;
    },
  },
  "gmail.createDraft": {
    label: "Creating draft",
    doneLabel: "Draft created",
    runningLabel: "Creating email draft…",
    icon: Mail,
    color: "blue",
    subtitle: (out) => {
      const o = out as { id?: string; to?: string } | null;
      return o?.to ? `to: ${o.to}` : null;
    },
  },
  "gmail.sendDraft": {
    label: "Sending email",
    doneLabel: "Email sent",
    runningLabel: "Sending email draft…",
    icon: Send,
    color: "emerald",
    subtitle: (out) => {
      const o = out as { id?: string } | null;
      return o?.id ? `message ID: ${o.id.slice(0, 10)}…` : null;
    },
  },
  "google.getReviewStats": {
    label: "Loading review stats",
    doneLabel: "Review stats loaded",
    runningLabel: "Fetching review aggregates…",
    icon: Star,
    color: "gold",
    link: { href: "/business", label: "Business" },
    subtitle: (out) => {
      const o = out as { averageRating?: number; totalCount?: number } | null;
      return o?.averageRating ? `${o.averageRating}★ average rating (${o.totalCount} reviews)` : null;
    },
  },
  "google.getUnrespondedReviews": {
    label: "Fetching reviews",
    doneLabel: "Unresponded reviews loaded",
    runningLabel: "Scanning reviews needing attention…",
    icon: MessageSquare,
    color: "amber",
    link: { href: "/business", label: "Business" },
    subtitle: (out) => {
      const o = out as { count?: number } | null;
      return typeof o?.count === "number" ? `${o.count} review${o.count === 1 ? "" : "s"} need response` : null;
    },
  },
  "google.draftReviewResponse": {
    label: "Drafting review response",
    doneLabel: "Response drafted",
    runningLabel: "Drafting response with Grok…",
    icon: MessageSquare,
    color: "gold",
    link: { href: "/missions", label: "Actions" },
    subtitle: (out) => {
      const o = out as { reviewerName?: string; rating?: number } | null;
      return o?.reviewerName ? `drafted for ${o.reviewerName} (${o.rating}★)` : null;
    },
  },
  "google.markReviewResponded": {
    label: "Marking review responded",
    doneLabel: "Review marked responded",
    runningLabel: "Marking review…",
    icon: CheckCircle2,
    color: "emerald",
    subtitle: (out) => {
      const o = out as { reviewId?: string } | null;
      return o?.reviewId ? `marked responded in local DB` : null;
    },
  },
  "arsenal.runPython": {
    label: "Running code",
    doneLabel: "Code executed",
    runningLabel: "Running Python script in sandbox…",
    icon: Terminal,
    color: "blue",
    subtitle: (out) => {
      const o = out as { error?: string; returnCode?: number; ok?: boolean } | null;
      return o?.error ? `Failed: ${o.error}` : "Executed successfully";
    },
  },
  "arsenal.browserCreateSession": {
    label: "Starting browser",
    doneLabel: "Browser started",
    runningLabel: "Creating headless browser session…",
    icon: Globe,
    color: "blue",
    subtitle: (out) => {
      const o = out as { sessionId?: string } | null;
      return o?.sessionId ? `session: ${o.sessionId.slice(0, 8)}…` : null;
    },
  },
  "arsenal.browserCloseSession": {
    label: "Closing browser",
    doneLabel: "Browser closed",
    runningLabel: "Closing browser session…",
    icon: Globe,
    color: "amber",
  },
  "arsenal.browserNavigate": {
    label: "Navigating browser",
    doneLabel: "Navigated successfully",
    runningLabel: "Navigating to URL…",
    icon: Globe,
    color: "blue",
    subtitle: (out) => {
      const o = out as { url?: string } | null;
      return o?.url ? `to ${o.url.slice(0, 40)}…` : null;
    },
  },
  "arsenal.browserAct": {
    label: "Browser action",
    doneLabel: "Action completed",
    runningLabel: "Interacting with page elements…",
    icon: Globe,
    color: "blue",
  },
  "arsenal.browserExtract": {
    label: "Extracting data",
    doneLabel: "Data extracted",
    runningLabel: "Extracting structured text…",
    icon: Globe,
    color: "purple",
  },
  "arsenal.browserObserve": {
    label: "Observing page",
    doneLabel: "Page observed",
    runningLabel: "Scanning interactive elements…",
    icon: Globe,
    color: "blue",
    subtitle: (out) => {
      const o = out as { elementsCount?: number } | null;
      return o?.elementsCount ? `${o.elementsCount} elements observed` : null;
    },
  },
};

export const COLORS: Record<
  ToolConfig["color"],
  { border: string; bg: string; icon: string; link: string }
> = {
  gold: {
    border: "border-l-[var(--gold)]",
    bg: "bg-[var(--gold)]/5",
    icon: "text-[var(--gold)]",
    link: "text-[var(--gold)] hover:text-[var(--gold)]/80",
  },
  emerald: {
    border: "border-l-emerald-500",
    bg: "bg-emerald-500/5",
    icon: "text-emerald-400",
    link: "text-emerald-400 hover:text-emerald-300",
  },
  blue: {
    border: "border-l-blue-500",
    bg: "bg-blue-500/5",
    icon: "text-blue-400",
    link: "text-blue-400 hover:text-blue-300",
  },
  purple: {
    border: "border-l-violet-500",
    bg: "bg-violet-500/5",
    icon: "text-violet-400",
    link: "text-violet-400 hover:text-violet-300",
  },
  red: {
    border: "border-l-red-500",
    bg: "bg-red-500/5",
    icon: "text-red-400",
    link: "text-red-400 hover:text-red-300",
  },
  amber: {
    border: "border-l-amber-500",
    bg: "bg-amber-500/5",
    icon: "text-amber-400",
    link: "text-amber-400 hover:text-amber-300",
  },
};

export function isKnownToolName(toolName: string): boolean {
  return toolName in TOOL_CONFIG;
}
