/**
 * Direct-action slash commands — client-side handlers that bypass
 * the AI round-trip for known write operations.
 *
 * When Nour types one of these commands the chat page should call
 * runDirectAction() *instead of* sendMessage(). The handler:
 *   1. Parses the command + args
 *   2. Hits the relevant API route directly
 *   3. Shows a toast confirmation
 *   4. Fires the data-change event so HQ, /tasks, and NourState refresh
 *
 * Nick never sees these — they're instant local writes, not prompts.
 * Use them when you know exactly what you want and don't need the
 * reasoning layer.
 *
 * Supported commands:
 *   /add <title>              Create a task in the Inbox mission
 *   /done <fuzzy title>       Mark the closest matching task complete
 *   /mit <text>               Set today's locked MIT
 *   /score <e> <f> <d>        Log daily score (energy, focus, discipline)
 *   /commit <description>     Add a new commitment
 */

import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice. This file
// is a NON-React module — its handlers are plain async functions
// dispatched from the chat send path, NOT components or hooks — so it
// CANNOT use the React-hooks tRPC client. It uses the vanilla (non-
// hook) client, the same imperative path `ClientErrorTelemetry` uses:
//   · /api/missions GET   → trpcVanilla.task.missions
//   · /api/missions POST  → trpcVanilla.task.createMission
//   · /api/tasks POST     → trpcVanilla.task.create
//   · /api/tasks GET      → trpcVanilla.task.list
//   · /api/tasks/[id] PATCH → trpcVanilla.task.update
//   · /api/commitments POST → trpcVanilla.operator.createCommitment
// Every procedure delegates to the SAME service its legacy REST route
// calls · drift impossible. The vanilla client's `.query()`/`.mutate()`
// throw on failure (no `.ok` to check) — the handlers' try/catch turns
// a throw into the `status: "error"` toast.
import { trpcVanilla } from "@/lib/trpc/vanilla-client";

export interface DirectActionResult {
  /** true if the message was handled locally; false means pass to Nick */
  handled: boolean;
  /** Optional status string for the caller to display */
  status?: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
}

// ─── Command registry ────────────────────────────────────

const COMMANDS: Record<string, (args: string) => Promise<DirectActionResult>> = {
  "/add": addTask,
  "/done": markTaskDone,
  "/mit": setMit,
  "/commit": addCommitment,
};

const COMMAND_LIST = Object.keys(COMMANDS);

/**
 * Returns the list of commands so the slash-menu can show them
 * alongside the prompt commands. Called from the chat page.
 */
export function directActionCommands() {
  return COMMAND_LIST.map((cmd) => ({
    cmd,
    label: HELP[cmd].label,
    icon: HELP[cmd].icon,
    description: HELP[cmd].description,
  }));
}

const HELP: Record<string, { label: string; icon: string; description: string }> = {
  "/add": { label: "Add Task (direct)", icon: "➕", description: "Create a task instantly — no AI" },
  "/done": { label: "Mark Done", icon: "✅", description: "Complete a task by fuzzy match" },
  "/mit": { label: "Set MIT", icon: "⚔", description: "Lock today's Most Important Thing" },
  "/commit": { label: "Add Commitment", icon: "🤝", description: "Log a new commitment" },
};

/**
 * Try to handle a chat input as a direct action. Returns
 * { handled: true } if it was dispatched locally, or
 * { handled: false } if the input should flow to Nick as a prompt.
 */
export async function runDirectAction(input: string): Promise<DirectActionResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  // Split on first whitespace — command + rest.
  const spaceIdx = trimmed.indexOf(" ");
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  const handler = COMMANDS[cmd];
  if (!handler) return { handled: false };

  try {
    return await handler(args);
  } catch {
    toast.error(`Direct action failed: ${cmd}`);
    return { handled: true, status: "error" };
  }
}

// ─── Handlers ────────────────────────────────────────────

async function addTask(args: string): Promise<DirectActionResult> {
  if (!args) {
    toast.error("/add needs a title — try '/add fix the tire'");
    return { handled: true };
  }

  // Resolve (or create) the Inbox mission. `task.missions` returns the
  // mission array directly (no envelope); `task.create` itself defaults
  // to the Inbox mission on a missing missionId, but the explicit
  // lookup preserves the legacy "named Inbox" semantics + lets us
  // create it if it genuinely doesn't exist.
  let inboxId: string | null = null;
  try {
    const missions = await trpcVanilla.task.missions.query();
    const inbox = missions.find(
      (m: { title: string; id: string }) => m.title === "Inbox",
    );
    inboxId = inbox?.id ?? null;
  } catch {
    inboxId = null;
  }
  if (!inboxId) {
    try {
      const created = await trpcVanilla.task.createMission.mutate({
        title: "Inbox",
        description: "Quick tasks",
        status: "ACTIVE",
      });
      inboxId = (created as { id?: string } | null)?.id ?? null;
    } catch {
      inboxId = null;
    }
  }
  if (!inboxId) {
    toast.error("Couldn't find or create Inbox");
    return { handled: true, status: "error" };
  }

  try {
    await trpcVanilla.task.create.mutate({
      title: args,
      missionId: inboxId,
      nextPhysicalAction: args,
      effort: "M15",
      roiScore: 50,
      frictionScore: 30,
      energyRequired: "MEDIUM",
      context: "ANYWHERE",
      finishCondition: "Done",
    });
  } catch {
    toast.error("Failed to add task");
    return { handled: true, status: "error" };
  }
  toast.success(`Task added · ${args.slice(0, 40)}${args.length > 40 ? "…" : ""}`);
  notifyDataChanged("tasks", { source: "chat-direct", detail: "add" });
  return { handled: true, status: "ok" };
}

async function markTaskDone(args: string): Promise<DirectActionResult> {
  if (!args) {
    toast.error("/done needs a task title — try '/done bloodwork'");
    return { handled: true };
  }

  // Fetch active tasks, find closest fuzzy match. `task.list` returns
  // the task view-model array directly (no envelope).
  let tasks: Task[];
  try {
    tasks = (await trpcVanilla.task.list.query({})) as unknown as Task[];
  } catch {
    toast.error("Couldn't load tasks");
    return { handled: true, status: "error" };
  }
  if (!Array.isArray(tasks)) {
    toast.error("Couldn't load tasks");
    return { handled: true, status: "error" };
  }

  const needle = args.toLowerCase();
  const open = tasks.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status));
  // Score each task: +2 for exact substring, +1 for word overlap.
  const scored = open
    .map((t) => {
      const title = t.title.toLowerCase();
      let score = 0;
      if (title.includes(needle)) score += 2;
      for (const word of needle.split(/\s+/)) {
        if (word && title.includes(word)) score += 1;
      }
      return { task: t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    toast.error(`No open task matches "${args}"`);
    return { handled: true, status: "error" };
  }

  const match = scored[0].task;
  // `task.update`'s input is { id, fields } · `fields` is the shared
  // `taskUpdateSchema` (partial) — `{ status: "DONE" }` is a valid
  // partial. Throws TRPCError on failure (caught below).
  try {
    await trpcVanilla.task.update.mutate({
      id: match.id,
      fields: { status: "DONE" },
    });
  } catch {
    toast.error("Failed to complete task");
    return { handled: true, status: "error" };
  }
  toast.success(`Done: ${match.title.slice(0, 40)}${match.title.length > 40 ? "…" : ""}`);
  notifyDataChanged("tasks", { source: "chat-direct", detail: "complete", id: match.id });
  return { handled: true, status: "ok" };
}

async function setMit(args: string): Promise<DirectActionResult> {
  if (!args) {
    toast.error("/mit needs text — try '/mit close the Smith estimate'");
    return { handled: true };
  }
  if (typeof window === "undefined") return { handled: true };

  // Write directly to localStorage using the same shape as MitContract.
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const next: {
    date: string;
    text: string;
    linkedMissionId: string | null;
    setAt: number;
    completed: boolean;
    completedAt: number | null;
  } = {
    date: todayKey,
    text: args.slice(0, 140),
    linkedMissionId: null,
    setAt: Date.now(),
    completed: false,
    completedAt: null,
  };
  try {
    window.localStorage.setItem("nour:mit-contract", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("nour:mit-updated", { detail: next }));
    notifyDataChanged("mit", { source: "chat-direct", detail: "set" });
    toast.success(`MIT locked: ${next.text.slice(0, 50)}${next.text.length > 50 ? "…" : ""}`);
  } catch {
    toast.error("Failed to set MIT");
    return { handled: true, status: "error" };
  }
  return { handled: true, status: "ok" };
}

async function addCommitment(args: string): Promise<DirectActionResult> {
  if (!args) {
    toast.error("/commit needs a description — try '/commit no impulse purchases this week'");
    return { handled: true };
  }
  // `operator.createCommitment` delegates to the `commitments.create
  // Commitment` service the legacy POST /api/commitments create branch
  // was slimmed to call · `toWhom` defaults to "self" in the service.
  try {
    await trpcVanilla.operator.createCommitment.mutate({ description: args });
  } catch {
    toast.error("Failed to add commitment");
    return { handled: true, status: "error" };
  }
  toast.success(`Commitment added · ${args.slice(0, 40)}${args.length > 40 ? "…" : ""}`);
  notifyDataChanged("commitments", { source: "chat-direct", detail: "add" });
  return { handled: true, status: "ok" };
}
