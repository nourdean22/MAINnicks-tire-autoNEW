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
import { authedFetch } from "@/hooks/use-authed-fetch";

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

  // Resolve (or create) the Inbox mission.
  const missionsRaw = await authedFetch("/api/missions").then((r): Promise<unknown> => r.json()).catch((): null => null);
  const missions = (missionsRaw as { data?: unknown } | null)?.data ?? missionsRaw;
  let inboxId: string | null = null;
  if (Array.isArray(missions)) {
    const inbox = missions.find((m: { title: string; id: string }) => m.title === "Inbox");
    inboxId = inbox?.id ?? null;
  }
  if (!inboxId) {
    const created = await authedFetch("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Inbox", description: "Quick tasks", status: "ACTIVE" }),
    }).then((r): Promise<unknown> => r.json()).catch((): null => null);
    inboxId = (created as { data?: { id?: string }; id?: string } | null)?.data?.id ?? (created as { id?: string } | null)?.id ?? null;
  }
  if (!inboxId) {
    toast.error("Couldn't find or create Inbox");
    return { handled: true, status: "error" };
  }

  const res = await authedFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: args,
      missionId: inboxId,
      nextPhysicalAction: args,
      effort: "M15",
      roiScore: 50,
      frictionScore: 30,
      energyRequired: "MEDIUM",
      context: "ANYWHERE",
      finishCondition: "Done",
    }),
  });

  if (!res.ok) {
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

  // Fetch active tasks, find closest fuzzy match.
  const raw = await authedFetch("/api/tasks").then((r): Promise<unknown> => r.json()).catch((): null => null);
  const tasks: Task[] = ((raw as { data?: unknown } | null)?.data ?? raw) as Task[];
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
  const res = await authedFetch(`/api/tasks/${match.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "DONE" }),
  });
  if (!res.ok) {
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
  const res = await authedFetch("/api/commitments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: args, to_whom: "self" }),
  });
  if (!res.ok) {
    toast.error("Failed to add commitment");
    return { handled: true, status: "error" };
  }
  toast.success(`Commitment added · ${args.slice(0, 40)}${args.length > 40 ? "…" : ""}`);
  notifyDataChanged("commitments", { source: "chat-direct", detail: "add" });
  return { handled: true, status: "ok" };
}
