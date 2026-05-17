/**
 * ClickUp — Project management and task tracking.
 * Free tier: unlimited tasks, 100MB storage.
 * Used for: shop task management, employee assignments, project tracking.
 */

interface ClickUpTask {
  id: string;
  name: string;
  status: string;
  priority?: number;
  assignees: string[];
  dueDate?: string;
  description?: string;
  url: string;
}

interface ClickUpSpace {
  id: string;
  name: string;
}

function getApiKey(): string {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) throw new Error("CLICKUP_API_KEY not configured");
  return key;
}

async function clickupRequest(endpoint: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<unknown> {
  const res = await fetch(`https://api.clickup.com/api/v2/${endpoint}`, {
    method,
    headers: {
      Authorization: getApiKey(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`ClickUp API error ${res.status}: ${err}`);
  }

  return res.json();
}

/**
 * Get all spaces (workspaces).
 */
export async function getSpaces(teamId: string): Promise<ClickUpSpace[]> {
  const data = (await clickupRequest(`team/${teamId}/space`)) as { spaces: Array<{ id: string; name: string }> };
  return data.spaces.map((s) => ({ id: s.id, name: s.name }));
}

/**
 * Create a task in a list.
 */
export async function createTask(listId: string, params: {
  name: string;
  description?: string;
  priority?: 1 | 2 | 3 | 4;
  dueDate?: Date;
  assignees?: string[];
}): Promise<ClickUpTask> {
  const body: Record<string, unknown> = {
    name: params.name,
    description: params.description || "",
  };
  if (params.priority) body.priority = params.priority;
  if (params.dueDate) body.due_date = params.dueDate.getTime();
  if (params.assignees) body.assignees = params.assignees;

  const data = (await clickupRequest(`list/${listId}/task`, "POST", body)) as Record<string, unknown>;

  return {
    id: String(data.id),
    name: String(data.name),
    status: String((data.status as Record<string, unknown>)?.status || "open"),
    priority: data.priority ? Number((data.priority as Record<string, unknown>)?.id) : undefined,
    assignees: Array.isArray(data.assignees) ? data.assignees.map((a: Record<string, unknown>) => String(a.username || a.id)) : [],
    dueDate: data.due_date ? new Date(Number(data.due_date)).toISOString() : undefined,
    description: data.description ? String(data.description) : undefined,
    url: String(data.url || ""),
  };
}

/**
 * Get tasks from a list.
 */
export async function getTasks(listId: string, params?: { statuses?: string[]; limit?: number }): Promise<ClickUpTask[]> {
  let endpoint = `list/${listId}/task?page=0`;
  if (params?.statuses) {
    endpoint += params.statuses.map((s) => `&statuses[]=${encodeURIComponent(s)}`).join("");
  }

  const data = (await clickupRequest(endpoint)) as { tasks: Array<Record<string, unknown>> };

  return (data.tasks || []).slice(0, params?.limit || 50).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    status: String((t.status as Record<string, unknown>)?.status || "unknown"),
    priority: t.priority ? Number((t.priority as Record<string, unknown>)?.id) : undefined,
    assignees: Array.isArray(t.assignees) ? t.assignees.map((a: Record<string, unknown>) => String(a.username || a.id)) : [],
    dueDate: t.due_date ? new Date(Number(t.due_date)).toISOString() : undefined,
    url: String(t.url || ""),
  }));
}

/**
 * Update a task's status.
 */
export async function updateTaskStatus(taskId: string, status: string): Promise<void> {
  await clickupRequest(`task/${taskId}`, "PUT", { status });
}
