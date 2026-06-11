import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Project, Task, GoalLineageEntry } from "@/components/actions/shared";
import { classifyTaskRisk, computeHiddenRiskSummary } from "@/lib/tasks/hidden-risk";
import { HiddenRiskWarning } from "@/components/missions/hidden-risk-warning";

// Mock Lucide icons to avoid ESM resolution issues in Node test environment
vi.mock("lucide-react", () => ({
  AlertTriangle: () => null,
  ChevronDown: () => null,
  ChevronUp: () => null,
  Play: () => null,
}));

const m = (id: string, overrides: Partial<Project> = {}): Project => ({
  id,
  title: id,
  status: "ACTIVE",
  ...overrides,
});

const t = (
  id: string,
  missionId: string,
  status: string = "READY",
  overrides: Partial<Task> = {}
): Task => ({
  id,
  title: id,
  status,
  nextPhysicalAction: "",
  missionId,
  autoPriority: 0,
  autoPriorityExplanation: null,
  ...overrides,
});

describe("Hidden Risk Logic - classifyTaskRisk", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  it("returns null for DONE, ARCHIVED, or CANCELLED tasks", () => {
    expect(classifyTaskRisk(t("t1", "m1", "DONE"), now)).toBeNull();
    expect(classifyTaskRisk(t("t2", "m1", "ARCHIVED"), now)).toBeNull();
    expect(classifyTaskRisk(t("t3", "m1", "CANCELLED"), now)).toBeNull();
  });

  it("flags overdue due dates as critical", () => {
    const task = t("t1", "m1", "READY", { dueDate: "2026-06-09" });
    const risk = classifyTaskRisk(task, now);
    expect(risk).not.toBeNull();
    expect(risk?.severity).toBe("critical");
    expect(risk?.reason).toBe("overdue");
  });

  it("flags due date today as high risk", () => {
    const task = t("t1", "m1", "READY", { dueDate: "2026-06-10" });
    const risk = classifyTaskRisk(task, now);
    expect(risk).not.toBeNull();
    expect(risk?.severity).toBe("high");
    expect(risk?.reason).toBe("due_today");
  });

  it("flags promise overdue as critical and promise due soon/today as high", () => {
    // Overdue promise
    const overduePromise = t("t1", "m1", "READY", { loopKind: "PROMISE", dueDate: "2026-06-09" });
    const risk1 = classifyTaskRisk(overduePromise, now);
    expect(risk1?.severity).toBe("critical");
    expect(risk1?.label).toBe("promise overdue");

    // Due today promise
    const todayPromise = t("t2", "m1", "READY", { loopKind: "PROMISE", dueDate: "2026-06-10" });
    const risk2 = classifyTaskRisk(todayPromise, now);
    expect(risk2?.severity).toBe("high");
    expect(risk2?.label).toBe("promise due today");

    // Due soon promise (within 3 days)
    const soonPromise = t("t3", "m1", "READY", { loopKind: "PROMISE", dueDate: "2026-06-12" });
    const risk3 = classifyTaskRisk(soonPromise, now);
    expect(risk3?.severity).toBe("high");
    expect(risk3?.label).toBe("promise due soon");

    // Promise with no due date
    const nodatePromise = t("t4", "m1", "READY", { loopKind: "PROMISE" });
    const risk4 = classifyTaskRisk(nodatePromise, now);
    expect(risk4?.severity).toBe("medium");
    expect(risk4?.label).toBe("promise no due date");
  });

  it("flags stuck DOING task as critical if active > 2h", () => {
    const normalDoing = t("t1", "m1", "DOING", { startedAt: "2026-06-10T11:00:00.000Z" });
    expect(classifyTaskRisk(normalDoing, now)).toBeNull();

    const stuckDoing = t("t2", "m1", "DOING", { startedAt: "2026-06-10T09:00:00.000Z" });
    const risk = classifyTaskRisk(stuckDoing, now);
    expect(risk?.severity).toBe("critical");
    expect(risk?.label).toBe("stuck doing");
  });

  it("handles WAITING tasks correctly based on snooze/waitingOn", () => {
    // WAITING with past snooze -> critical missed resurface
    const pastSnooze = t("t1", "m1", "WAITING", { snoozedUntil: "2026-06-10T11:00:00.000Z" });
    const risk1 = classifyTaskRisk(pastSnooze, now);
    expect(risk1?.severity).toBe("critical");
    expect(risk1?.label).toBe("missed resurface");

    // WAITING with future snooze -> not risk
    const futureSnooze = t("t2", "m1", "WAITING", { snoozedUntil: "2026-06-10T13:00:00.000Z" });
    expect(classifyTaskRisk(futureSnooze, now)).toBeNull();

    // Future snooze with critical condition (overdue due date) -> critical
    const futureSnoozeOverdue = t("t3", "m1", "WAITING", {
      snoozedUntil: "2026-06-10T13:00:00.000Z",
      dueDate: "2026-06-09",
    });
    const risk2 = classifyTaskRisk(futureSnoozeOverdue, now);
    expect(risk2?.severity).toBe("critical");

    // WAITING with waitingOn -> medium blocked
    const blockedTask = t("t4", "m1", "WAITING", { waitingOn: "Partner name" });
    const risk3 = classifyTaskRisk(blockedTask, now);
    expect(risk3?.severity).toBe("medium");
    expect(risk3?.label).toBe("blocked");

    // WAITING without waitingOn or snooze -> high invalid waiting
    const invalidWaiting = t("t5", "m1", "WAITING");
    const risk4 = classifyTaskRisk(invalidWaiting, now);
    expect(risk4?.severity).toBe("high");
    expect(risk4?.label).toBe("invalid waiting");
  });

  it("flags stale tasks based on age since last activity", () => {
    // stale >= 14d -> high
    const stale14 = t("t1", "m1", "READY", { createdAt: "2026-05-20T12:00:00.000Z" });
    const risk1 = classifyTaskRisk(stale14, now);
    expect(risk1?.severity).toBe("high");
    expect(risk1?.label).toBe("stale 21d");

    // stale >= 7d -> medium
    const stale7 = t("t2", "m1", "READY", { createdAt: "2026-06-02T12:00:00.000Z" });
    const risk2 = classifyTaskRisk(stale7, now);
    expect(risk2?.severity).toBe("medium");
    expect(risk2?.label).toBe("stale 8d");

    // fresh -> null
    const fresh = t("t3", "m1", "READY", { createdAt: "2026-06-09T12:00:00.000Z" });
    expect(classifyTaskRisk(fresh, now)).toBeNull();

    // task.stale === true overrides
    const staleOverride = t("t4", "m1", "READY", { stale: true, createdAt: "2026-06-09T12:00:00.000Z" });
    const risk3 = classifyTaskRisk(staleOverride, now);
    expect(risk3?.severity).toBe("medium");
    expect(risk3?.label).toBe("stale 1d");
  });
});

describe("Hidden Risk Logic - computeHiddenRiskSummary", () => {
  const now = new Date("2026-06-10T12:00:00.000Z");

  it("correctly identifies why high-risk tasks are hidden", () => {
    const tasks = [
      t("task-visible", "m-active", "READY", { dueDate: "2026-06-09" }), // high risk but visible
      t("task-search-hidden", "m-active", "READY", { dueDate: "2026-06-09", title: "Review Greene" }),
      t("task-kind-hidden", "m-active", "READY", { loopKind: "PROMISE", dueDate: "2026-06-09", title: "Finish contract" }),
      t("task-domain-hidden", "m-personal", "READY", { dueDate: "2026-06-09", title: "Buy groceries" }),
    ];

    const missions = [
      m("m-active", { title: "Work Mission", domain: "work" }),
      m("m-personal", { title: "Personal Mission", domain: "personal" }),
    ];

    const visibleTaskIds = new Set(["task-visible"]);

    const summary = computeHiddenRiskSummary({
      allTasks: tasks,
      visibleTaskIds,
      filtersActive: true,
      executionModeActive: false,
      now,
      searchQuery: "contract", // hides task-search-hidden (Work) and task-domain-hidden (Personal)
      kindFilter: "PROMISE", // hides task-search-hidden (not promise)
      domainFilter: "work", // hides task-domain-hidden (Personal)
      missions,
    });

    expect(summary.counts.total).toBe(3);
    expect(summary.counts.critical).toBe(3); // All overdue dueDate is critical

    // Find the attributions
    const searchHidden = summary.hiddenTasks.find(h => h.task.id === "task-search-hidden");
    expect(searchHidden?.hiddenBy.search).toBe(true);
    expect(searchHidden?.hiddenBy.kind).toBe(true); // also not promise
    expect(searchHidden?.hiddenBy.domain).toBe(false); // is work domain

    const domainHidden = summary.hiddenTasks.find(h => h.task.id === "task-domain-hidden");
    expect(domainHidden?.hiddenBy.domain).toBe(true);
    expect(domainHidden?.hiddenBy.search).toBe(true); // title does not match contract

    // Preview list size
    expect(summary.previewList.length).toBe(3);
  });

  it("attributes to execution mode when active", () => {
    const tasks = [
      t("task-focused", "m1", "DOING"),
      t("task-hidden-risk", "m1", "READY", { dueDate: "2026-06-09" }),
    ];

    const summary = computeHiddenRiskSummary({
      allTasks: tasks,
      visibleTaskIds: new Set(["task-focused"]),
      filtersActive: false,
      executionModeActive: true,
      now,
    });

    expect(summary.counts.total).toBe(1);
    expect(summary.categories.hiddenByExecutionMode).toBe(1);
    expect(summary.hiddenTasks[0].hiddenBy.executionMode).toBe(true);
  });

  it("verifies all test cases requested by the user", () => {
    // 1. overdue dueDate hidden by domain filter = critical hidden
    const t1 = t("t1", "m1", "READY", { dueDate: "2026-06-09" });
    const summary1 = computeHiddenRiskSummary({
      allTasks: [t1],
      visibleTaskIds: new Set(),
      filtersActive: true,
      executionModeActive: false,
      now,
      domainFilter: "personal", // hides it
      missions: [m("m1", { domain: "work" })],
    });
    expect(summary1.counts.critical).toBe(1);
    expect(summary1.categories.hiddenByDomainFilter).toBe(1);

    // 2. stale 8d hidden by search = medium hidden
    const t2 = t("t2", "m1", "READY", { createdAt: "2026-06-02T12:00:00.000Z" }); // 8d stale
    const summary2 = computeHiddenRiskSummary({
      allTasks: [t2],
      visibleTaskIds: new Set(),
      filtersActive: true,
      executionModeActive: false,
      now,
      searchQuery: "something-else",
      missions: [m("m1")],
    });
    expect(summary2.counts.medium).toBe(1);
    expect(summary2.categories.hiddenBySearch).toBe(1);

    // 3. promise overdue hidden = critical
    const t3 = t("t3", "m1", "READY", { loopKind: "PROMISE", dueDate: "2026-06-09" });
    const summary3 = computeHiddenRiskSummary({
      allTasks: [t3],
      visibleTaskIds: new Set(),
      filtersActive: true,
      executionModeActive: false,
      now,
      searchQuery: "something-else",
      missions: [m("m1")],
    });
    expect(summary3.counts.critical).toBe(1);

    // 4. promise due soon hidden = high
    const t4 = t("t4", "m1", "READY", { loopKind: "PROMISE", dueDate: "2026-06-12" });
    const summary4 = computeHiddenRiskSummary({
      allTasks: [t4],
      visibleTaskIds: new Set(),
      filtersActive: true,
      executionModeActive: false,
      now,
      searchQuery: "something-else",
      missions: [m("m1")],
    });
    expect(summary4.counts.high).toBe(1);

    // 5. DOING started >2h hidden by Execution Mode = critical/stuck
    const t5 = t("t5", "m1", "DOING", { startedAt: "2026-06-10T09:00:00.000Z" });
    const summary5 = computeHiddenRiskSummary({
      allTasks: [t5],
      visibleTaskIds: new Set(),
      filtersActive: false,
      executionModeActive: true,
      now,
    });
    expect(summary5.counts.critical).toBe(1);
    expect(summary5.categories.hiddenByExecutionMode).toBe(1);
  });
});

describe("HiddenRiskWarning UI Component", () => {
  const dummySummary = {
    hiddenTasks: [],
    counts: { critical: 1, high: 2, medium: 0, total: 3 },
    categories: { hiddenBySearch: 1, hiddenByKindFilter: 1, hiddenByDomainFilter: 1, hiddenByExecutionMode: 0 },
    previewList: [
      { id: "t-overdue", title: "Fix leak", severity: "critical" as const, label: "overdue" },
      { id: "t-promise", title: "Respond client", severity: "high" as const, label: "promise due today" },
    ],
  };

  it("adapts warning copy and actions in normal filtered mode", () => {
    const html = renderToStaticMarkup(
      <HiddenRiskWarning
        summary={dummySummary}
        executionModeActive={false}
        filterKey="filter-key"
        onClearFilters={() => {}}
        onExitFocusMode={() => {}}
        onQueueNext={() => {}}
      />
    );
    expect(html).toContain("high-risk tasks hidden by filters");
    expect(html).toContain("Clear filters");
    expect(html).not.toContain("Exit to review");
  });

  it("adapts warning copy and actions in Execution Mode", () => {
    const executionSummary = {
      ...dummySummary,
      counts: { critical: 0, high: 1, medium: 1, total: 2 },
      categories: { hiddenBySearch: 0, hiddenByKindFilter: 0, hiddenByDomainFilter: 0, hiddenByExecutionMode: 2 },
    };
    const html = renderToStaticMarkup(
      <HiddenRiskWarning
        summary={executionSummary}
        executionModeActive={true}
        filterKey="filter-key"
        onClearFilters={() => {}}
        onExitFocusMode={() => {}}
        onQueueNext={() => {}}
      />
    );
    expect(html).toContain("risk tasks outside this focus");
    expect(html).toContain("Exit to review");
    expect(html).not.toContain("Clear filters");
  });
});
