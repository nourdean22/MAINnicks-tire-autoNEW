"use client";

/**
 * /system/digest (Wire 3) — read-only surface for the truth/intelligence
 * services that were previously chat-command / API-only:
 *   · What Changed (F2 system change digest, honest deploy status)
 *   · Truth Scoreboard (memory-eval report)
 *   · Recent Receipts (F4 action receipt feed)
 * No mutation, no new logic — just renders existing services. Each card links to
 * the chat command that drills in. Not a duplicate of /brain/continuity (that's
 * the raw activity firehose; this is glanceable summaries).
 */

import { useState } from "react";
import { FileText, Telescope, ListChecks, Receipt, Import, Plus, Trash2, CheckSquare, Square, Check, AlertCircle, Loader2 } from "lucide-react";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { trpc } from "@/lib/trpc/client";

function Card({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-amber-200/90">
        <Icon className="h-4 w-4" />
        <h2 className="text-sm font-medium uppercase tracking-wide">{title}</h2>
        {action && <span className="ml-auto text-xs text-zinc-600">{action}</span>}
      </div>
      <div className="space-y-1 text-sm text-zinc-300">{children}</div>
    </section>
  );
}

const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "ok" | "warn" }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-zinc-500">{k}</span>
    <span className={cn("text-right", tone === "warn" ? "text-rose-300" : tone === "ok" ? "text-emerald-300" : "text-zinc-200")}>{v}</span>
  </div>
);

interface ParsedTask {
  title: string;
  selected: boolean;
}

interface ParsedImport {
  metadata: {
    branch?: string;
    worktree?: string;
    pr?: string;
    linesCount: number;
  };
  tasks: ParsedTask[];
}

function parseSessionLog(text: string): ParsedImport {
  const lines = text.split("\n");
  const tasks: ParsedTask[] = [];
  let branch: string | undefined;
  let worktree: string | undefined;
  let pr: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check branch
    const branchMatch = trimmed.match(/(?:branch|on branch|checkout)\s+([a-zA-Z0-9_\-\/]+)/i);
    if (branchMatch && !branch) {
      branch = branchMatch[1];
    }
    
    // Check worktree
    const worktreeMatch = trimmed.match(/(?:worktree|working directory|cwd)\s+at\s+([^\s]+)/i) || trimmed.match(/C:\\Users\\[^\s]+/i);
    if (worktreeMatch && !worktree) {
      worktree = worktreeMatch[0];
    }

    // Check PR
    const prMatch = trimmed.match(/(?:PR|Pull Request)\s+#([0-9]+)/i);
    if (prMatch && !pr) {
      pr = `#${prMatch[1]}`;
    }

    // Parse tasks
    const taskMatch = trimmed.match(/^(?:-|\*)\s*\[\s*\]\s*(.+)$/) || trimmed.match(/^\[\s*\]\s*(.+)$/) || trimmed.match(/^TODO:\s*(.+)$/i);
    if (taskMatch) {
      const title = taskMatch[1].trim();
      if (title && !tasks.some(t => t.title === title)) {
        tasks.push({ title, selected: true });
      }
    }
  }

  // Fallback pattern matching if no bullet checkboxes found
  if (tasks.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().includes("todo:") || trimmed.toLowerCase().includes("task:")) {
        const cleaned = trimmed.replace(/^(?:TODO|TASK):\s*/i, "").trim();
        if (cleaned && !tasks.some(t => t.title === cleaned)) {
          tasks.push({ title: cleaned, selected: true });
        }
      }
    }
  }

  return {
    metadata: {
      branch,
      worktree,
      pr,
      linesCount: lines.length,
    },
    tasks,
  };
}

export default function SystemDigestPage() {
  const changed = trpc.system.changeDigest.useQuery(undefined, { refetchInterval: 120_000 });
  const evals = trpc.system.memoryEvals.useQuery(undefined, { refetchInterval: 300_000 });
  const receipts = trpc.system.receiptFeed.useQuery(undefined, { refetchInterval: 120_000 });

  const { data: missionsData } = trpc.task.missions.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const createTasksMutation = trpc.task.createImportedTasks.useMutation();

  const [logText, setLogText] = useState("");
  const [parsedData, setParsedData] = useState<ParsedImport | null>(null);
  const [taskMissions, setTaskMissions] = useState<Record<number, string>>({});
  const [taskTitles, setTaskTitles] = useState<Record<number, string>>({});
  const [newtaskTitle, setNewTaskTitle] = useState("");

  const handleImport = () => {
    if (!logText.trim()) return;
    const parsed = parseSessionLog(logText);
    setParsedData(parsed);
    
    const initialMissions: Record<number, string> = {};
    const initialTitles: Record<number, string> = {};
    const defaultMission = missionsData?.find(m => m.id === "m-inbox" || m.title.toLowerCase().includes("inbox"))?.id 
      || missionsData?.[0]?.id 
      || "m-inbox";

    parsed.tasks.forEach((t, index) => {
      initialMissions[index] = defaultMission;
      initialTitles[index] = t.title;
    });
    setTaskMissions(initialMissions);
    setTaskTitles(initialTitles);
  };

  const toggleTaskSelected = (index: number) => {
    if (!parsedData) return;
    const nextTasks = [...parsedData.tasks];
    nextTasks[index] = { ...nextTasks[index], selected: !nextTasks[index].selected };
    setParsedData({
      ...parsedData,
      tasks: nextTasks,
    });
  };

  const removeTask = (index: number) => {
    if (!parsedData) return;
    const nextTasks = parsedData.tasks.filter((_, i) => i !== index);
    const nextTitles: Record<number, string> = {};
    const nextMissions: Record<number, string> = {};
    
    nextTasks.forEach((t, i) => {
      const oldIdx = i >= index ? i + 1 : i;
      nextTitles[i] = taskTitles[oldIdx];
      nextMissions[i] = taskMissions[oldIdx];
    });

    setParsedData({
      ...parsedData,
      tasks: nextTasks,
    });
    setTaskTitles(nextTitles);
    setTaskMissions(nextMissions);
  };

  const handleAddTask = () => {
    if (!newtaskTitle.trim() || !parsedData) return;
    const newIndex = parsedData.tasks.length;
    const defaultMission = missionsData?.find(m => m.id === "m-inbox" || m.title.toLowerCase().includes("inbox"))?.id 
      || missionsData?.[0]?.id 
      || "m-inbox";

    setParsedData({
      ...parsedData,
      tasks: [...parsedData.tasks, { title: newtaskTitle.trim(), selected: true }],
    });
    setTaskTitles({ ...taskTitles, [newIndex]: newtaskTitle.trim() });
    setTaskMissions({ ...taskMissions, [newIndex]: defaultMission });
    setNewTaskTitle("");
  };

  const handleApprove = async () => {
    if (!parsedData) return;
    const tasksToCreate = parsedData.tasks
      .map((t, idx) => {
        if (!t.selected) return null;
        return {
          title: taskTitles[idx] || t.title,
          missionId: taskMissions[idx] || "m-inbox",
        };
      })
      .filter((t): t is { title: string; missionId: string } => t !== null && t.title.trim().length > 0);

    if (tasksToCreate.length === 0) {
      return;
    }

    try {
      await createTasksMutation.mutateAsync(tasksToCreate);
      setParsedData(null);
      setLogText("");
      setTaskMissions({});
      setTaskTitles({});
    } catch (err) {
      console.error(err);
    }
  };

  const cd = changed.data;
  const me = evals.data;
  const rf = receipts.data;
  const icon = (s: string) => (s === "success" ? "✓" : s === "failed" ? "✗" : "•");

  return (
    <StandardPage eyebrow="System / digest" title="Digest" description="What changed · truth scoreboard · recent receipts — read-only.">
      <div className="grid gap-4 md:grid-cols-3">
        <Card icon={Telescope} title="What Changed" action="/what-changed">
          {cd ? (
            <>
              {cd.latestWave && (
                <Row k="Last wave" v={`${cd.latestWave.date ?? "?"} · ${cd.latestWave.ships.length} ships`} />
              )}
              <Row k="Truth evals" v={`${cd.truth.evals.passed}/${cd.truth.evals.total}`} tone={cd.truth.evals.failed ? "warn" : "ok"} />
              <Row k="Stale docs" v={`${cd.truth.staleCriticalInKeyDocs} critical`} tone={cd.truth.staleCriticalInKeyDocs ? "warn" : "ok"} />
              <Row k="Deploy" v={cd.deployment.status} tone={cd.deployment.status === "production" ? "ok" : undefined} />
              <p className="pt-1 text-xs text-zinc-500">{cd.nextOwnerDecision}</p>
            </>
          ) : (
            <span className="text-zinc-600">{changed.isError ? "unavailable" : "loading…"}</span>
          )}
        </Card>

        <Card icon={ListChecks} title="Truth Scoreboard" action="eval:memory">
          {me ? (
            <>
              <Row k="Pass" v={`${me.passed}/${me.total}`} tone={me.failed ? "warn" : "ok"} />
              {me.failed > 0 && <Row k="Fail" v={me.failed} tone="warn" />}
              <Row k="Manual" v={me.manual} />
              <Row k="Grounding docs" v={`${me.sourcesFound}/${me.sourcesExpected}`} />
              <Row k="Dataset" v={me.datasetIssues.length ? `${me.datasetIssues.length} issue(s)` : "valid"} tone={me.datasetIssues.length ? "warn" : "ok"} />
            </>
          ) : (
            <span className="text-zinc-600">{evals.isError ? "unavailable" : "loading…"}</span>
          )}
        </Card>

        <Card icon={Receipt} title="Recent Receipts" action="/receipts">
          {rf ? (
            rf.items.length === 0 ? (
              <span className="text-zinc-600">No recent actions.</span>
            ) : (
              <>
                <Row k="Actions" v={`${rf.counts.total} · ${rf.counts.success} ok · ${rf.counts.failed} failed`} tone={rf.counts.failed ? "warn" : "ok"} />
                <ul className="space-y-0.5 pt-1 text-xs">
                  {rf.items.slice(0, 6).map((r) => (
                    <li key={r.receiptId} className={cn(r.status === "failed" ? "text-rose-300" : "text-zinc-400")}>
                      {icon(r.status)} {r.userVisibleSummary}
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : (
            <span className="text-zinc-600">{receipts.isError ? "unavailable" : "loading…"}</span>
          )}
        </Card>
      </div>

      {/* Session Importer Section */}
      <div className="mt-6 rounded-2xl border border-zinc-800/70 bg-zinc-950/40 p-6">
        <div className="flex items-center gap-2 text-amber-200/90 mb-4">
          <Import className="h-4 w-4 text-[var(--gold)]" />
          <h2 className="text-sm font-semibold uppercase tracking-wider">Session Importer</h2>
          <span className="ml-auto text-xs text-zinc-500">Claude Code log parsing</span>
        </div>

        {!parsedData ? (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400">
              Paste your Claude Code session log or task output below to parse suggested follow-up tasks, PRs, and branch metadata.
            </p>
            <textarea
              className="w-full h-40 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 transition-all resize-y"
              placeholder="Paste terminal logs or markdown notes here..."
              value={logText}
              onChange={(e) => setLogText(e.target.value)}
            />
            <button
              onClick={handleImport}
              disabled={!logText.trim()}
              className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Parse Session Log
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Metadata Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-zinc-900/20 border border-zinc-800/50 text-xs">
              <div>
                <span className="text-zinc-500 block">Lines Parsed</span>
                <span className="text-zinc-200 font-mono">{parsedData.metadata.linesCount}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Branch</span>
                <span className="text-amber-300 font-mono truncate block" title={parsedData.metadata.branch}>
                  {parsedData.metadata.branch || "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">Worktree</span>
                <span className="text-zinc-300 font-mono truncate block" title={parsedData.metadata.worktree}>
                  {parsedData.metadata.worktree || "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block">PR Reference</span>
                <span className="text-zinc-200 font-mono">{parsedData.metadata.pr || "—"}</span>
              </div>
            </div>

            {/* Checklist of Suggested Tasks */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Suggested Tasks ({parsedData.tasks.filter(t => t.selected).length} selected)
                </h3>
                <button
                  onClick={() => setParsedData(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Clear & Reset
                </button>
              </div>

              {parsedData.tasks.length === 0 ? (
                <p className="text-xs text-zinc-500 italic p-4 border border-dashed border-zinc-800 rounded-lg text-center">
                  No task patterns detected. Add tasks manually below or try parsing a different log.
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {parsedData.tasks.map((task, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border transition-all text-xs",
                        task.selected
                          ? "bg-zinc-900/30 border-zinc-800"
                          : "bg-transparent border-zinc-900 opacity-40"
                      )}
                    >
                      <button
                        onClick={() => toggleTaskSelected(idx)}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                      >
                        {task.selected ? (
                          <CheckSquare className="h-4 w-4 text-amber-300" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                      
                      <input
                        type="text"
                        className="bg-transparent border-none focus:outline-none focus:ring-0 text-zinc-200 w-full"
                        value={taskTitles[idx] ?? ""}
                        onChange={(e) => setTaskTitles({ ...taskTitles, [idx]: e.target.value })}
                        disabled={!task.selected}
                      />

                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-400 focus:outline-none focus:border-amber-500/30"
                          value={taskMissions[idx] ?? ""}
                          onChange={(e) => setTaskMissions({ ...taskMissions, [idx]: e.target.value })}
                          disabled={!task.selected}
                        >
                          {missionsData?.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.title}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => removeTask(idx)}
                          className="text-zinc-600 hover:text-rose-400 p-1 rounded transition-colors"
                          title="Remove from list"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Manual Task Form */}
              <div className="flex items-center gap-2 pt-2 border-t border-zinc-900">
                <input
                  type="text"
                  placeholder="Add custom task suggestion..."
                  className="bg-zinc-900/30 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-amber-500/30 w-full"
                  value={newtaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTask();
                    }
                  }}
                />
                <button
                  onClick={handleAddTask}
                  disabled={!newtaskTitle.trim()}
                  className="p-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Approval Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-zinc-900">
              {createTasksMutation.isSuccess && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                  <Check className="h-4 w-4" />
                  <span>Tasks created successfully!</span>
                </div>
              )}
              {createTasksMutation.isError && (
                <div className="flex items-center gap-1.5 text-rose-400 text-xs">
                  <AlertCircle className="h-4 w-4" />
                  <span>Error: {createTasksMutation.error.message}</span>
                </div>
              )}
              {!createTasksMutation.isSuccess && !createTasksMutation.isError && <div />}

              <button
                onClick={handleApprove}
                disabled={createTasksMutation.isPending || parsedData.tasks.filter(t => t.selected).length === 0}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold rounded-lg text-xs transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createTasksMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3" />
                    <span>Approve & Create Tasks</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        <FileText className="mr-1 inline h-3 w-3" />
        Read-only. These run the same services as the chat commands · the API routes under /api/system/*.
      </p>
    </StandardPage>
  );
}
