import type { Project, Task, GoalLineageEntry } from "@/components/actions/shared";

export interface RiskClassification {
  severity: "critical" | "high" | "medium";
  reason: string;
  label: string;
}

export interface HiddenRiskSummary {
  hiddenTasks: Array<{
    task: Task;
    risk: RiskClassification;
    hiddenBy: {
      search: boolean;
      kind: boolean;
      domain: boolean;
      executionMode: boolean;
    };
  }>;
  counts: {
    critical: number;
    high: number;
    medium: number;
    total: number;
  };
  categories: {
    hiddenBySearch: number;
    hiddenByKindFilter: number;
    hiddenByDomainFilter: number;
    hiddenByExecutionMode: number;
  };
  previewList: Array<{
    id: string;
    title: string;
    severity: "critical" | "high" | "medium";
    label: string;
    missionTitle?: string;
    domain?: string;
  }>;
}

function parseDateString(dateStr: string): Date {
  if (dateStr.includes("T")) {
    return new Date(dateStr);
  }
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month - 1, day);
    }
  }
  return new Date(dateStr);
}

function getDaysSince(dateStrOrObj: string | Date | undefined | null, now: Date): number {
  if (!dateStrOrObj) return 0;
  const t = typeof dateStrOrObj === "string" ? parseDateString(dateStrOrObj).getTime() : dateStrOrObj.getTime();
  return Math.floor((now.getTime() - t) / 86400000);
}

const getDayStart = (d: Date) => {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
};

export function classifyTaskRisk(
  task: Task,
  now: Date = new Date(),
  goalLineage?: Map<string, GoalLineageEntry>
): RiskClassification | null {
  const status = task.status;
  if (status === "DONE" || status === "ARCHIVED" || status === "CANCELLED") return null;

  const nowMs = now.getTime();
  const todayStartMs = getDayStart(now);

  // 1. Stuck DOING (status === "DOING" and startedAt > 2h)
  if (status === "DOING" && task.startedAt) {
    const startedMs = new Date(task.startedAt).getTime();
    const hoursSince = (nowMs - startedMs) / 3600000;
    if (hoursSince > 2) {
      return {
        severity: "critical",
        reason: "stuck_doing",
        label: "stuck doing",
      };
    }
  }

  // 2. Missed snooze resurface (status === "WAITING" and snoozedUntil in the past)
  if (status === "WAITING" && task.snoozedUntil) {
    const snoozeMs = new Date(task.snoozedUntil).getTime();
    if (snoozeMs < nowMs) {
      return {
        severity: "critical",
        reason: "missed_snooze",
        label: "missed resurface",
      };
    }
  }

  // WAITING with future snooze is NOT a risk unless other critical condition (overdue)
  const snoozeMs = task.snoozedUntil ? new Date(task.snoozedUntil).getTime() : null;
  const isFutureSnooze = status === "WAITING" && snoozeMs !== null && snoozeMs >= nowMs;

  if (isFutureSnooze) {
    if (task.dueDate) {
      const dueMs = getDayStart(parseDateString(task.dueDate));
      if (dueMs < todayStartMs) {
        return {
          severity: "critical",
          reason: "overdue",
          label: task.loopKind === "PROMISE" ? "promise overdue" : "overdue",
        };
      }
    }
    return null;
  }

  // 3. Due Date Overdue (dueDate before today)
  if (task.dueDate) {
    const dueMs = getDayStart(parseDateString(task.dueDate));
    if (dueMs < todayStartMs) {
      return {
        severity: "critical",
        reason: "overdue",
        label: task.loopKind === "PROMISE" ? "promise overdue" : "overdue",
      };
    }
  }

  // 4. Promise Due Date checks (today, within 3 days, missing)
  if (task.loopKind === "PROMISE") {
    if (task.dueDate) {
      const dueMs = getDayStart(parseDateString(task.dueDate));
      if (dueMs === todayStartMs) {
        return {
          severity: "high",
          reason: "promise_due_today",
          label: "promise due today",
        };
      } else if (dueMs > todayStartMs && dueMs <= todayStartMs + 3 * 86400000) {
        return {
          severity: "high",
          reason: "promise_due_soon",
          label: "promise due soon",
        };
      }
    } else {
      return {
        severity: "medium",
        reason: "promise_no_due_date",
        label: "promise no due date",
      };
    }
  }

  // 5. Due Date Today (non-promise)
  if (task.dueDate) {
    const dueMs = getDayStart(parseDateString(task.dueDate));
    if (dueMs === todayStartMs) {
      return {
        severity: "high",
        reason: "due_today",
        label: "due today",
      };
    }
  }

  // 6. Invalid WAITING or Blocked WAITING
  if (status === "WAITING") {
    if (!task.waitingOn) {
      return {
        severity: "high",
        reason: "invalid_waiting",
        label: "invalid waiting",
      };
    } else {
      return {
        severity: "medium",
        reason: "blocked",
        label: "blocked",
      };
    }
  }

  // 7. Goal pace behind/missed (if available)
  if (task.goalId && goalLineage) {
    const lineage = goalLineage.get(task.goalId);
    if (lineage && (lineage.paceKind === "behind" || lineage.paceKind === "missed")) {
      return {
        severity: "high",
        reason: "goal_behind",
        label: `goal ${lineage.paceKind}`,
      };
    }
  }

  // 8. Stale (days since activity >= 14d (high), task.stale (high/med), daysSince >= 7 (med))
  const lastActivityStr = task.lastTouchedAt || task.updatedAt || task.createdAt;
  const daysSinceActivity = lastActivityStr ? getDaysSince(lastActivityStr, now) : 0;

  if (task.stale) {
    return {
      severity: daysSinceActivity >= 14 ? "high" : "medium",
      reason: "stale_flag",
      label: `stale${daysSinceActivity > 0 ? ` ${daysSinceActivity}d` : ""}`,
    };
  }

  if (daysSinceActivity >= 14) {
    return {
      severity: "high",
      reason: "stale_14d",
      label: `stale ${daysSinceActivity}d`,
    };
  } else if (daysSinceActivity >= 7) {
    return {
      severity: "medium",
      reason: "stale_7d",
      label: `stale ${daysSinceActivity}d`,
    };
  }

  // 9. High autoPriority task (>= 80)
  if (task.autoPriority !== null && task.autoPriority !== undefined && task.autoPriority >= 80) {
    return {
      severity: "medium",
      reason: "high_autopriority",
      label: "high priority",
    };
  }

  return null;
}

export function computeHiddenRiskSummary({
  allTasks,
  visibleTaskIds,
  filtersActive,
  executionModeActive,
  now = new Date(),
  searchQuery = "",
  kindFilter = "all",
  domainFilter = null,
  missions = [],
  goalLineage,
}: {
  allTasks: Task[];
  visibleTaskIds: Set<string>;
  filtersActive: boolean;
  executionModeActive: boolean;
  now?: Date;
  searchQuery?: string;
  kindFilter?: string;
  domainFilter?: string | null;
  missions?: Project[];
  goalLineage?: Map<string, GoalLineageEntry>;
}): HiddenRiskSummary {
  const hiddenTasks: HiddenRiskSummary["hiddenTasks"] = [];
  const counts = { critical: 0, high: 0, medium: 0, total: 0 };
  const categories = {
    hiddenBySearch: 0,
    hiddenByKindFilter: 0,
    hiddenByDomainFilter: 0,
    hiddenByExecutionMode: 0,
  };

  const query = searchQuery.toLowerCase().trim();

  for (const task of allTasks) {
    // Classify risk
    const risk = classifyTaskRisk(task, now, goalLineage);
    if (!risk) continue;

    // Check visibility
    const isVisible = visibleTaskIds.has(task.id);
    if (isVisible) continue;

    const hiddenBy = {
      search: false,
      kind: false,
      domain: false,
      executionMode: false,
    };

    if (executionModeActive) {
      hiddenBy.executionMode = true;
      categories.hiddenByExecutionMode++;
    } else {
      const mission = missions.find((m) => m.id === task.missionId);
      const missionTitle = mission?.title.toLowerCase() || task.mission?.title.toLowerCase() || "";
      const domain = mission?.domain?.toLowerCase() || task.mission?.domain?.toLowerCase() || "other";

      let contributedToHidden = false;

      if (query) {
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesMission = missionTitle.includes(query);
        if (!matchesTitle && !matchesMission) {
          hiddenBy.search = true;
          categories.hiddenBySearch++;
          contributedToHidden = true;
        }
      }

      if (kindFilter !== "all" && task.loopKind !== kindFilter) {
        hiddenBy.kind = true;
        categories.hiddenByKindFilter++;
        contributedToHidden = true;
      }

      if (domainFilter && domain !== domainFilter.toLowerCase()) {
        hiddenBy.domain = true;
        categories.hiddenByDomainFilter++;
        contributedToHidden = true;
      }

      // If filters are active but none of the specific filters caught it, it might be hidden by
      // some other filter logic, or if no specific filter caught it but filters are active, we don't count it.
      if (!contributedToHidden && filtersActive) {
        // Safe fallback: hidden by whatever filters are active
        if (query) hiddenBy.search = true;
        if (kindFilter !== "all") hiddenBy.kind = true;
        if (domainFilter) hiddenBy.domain = true;
      }
    }

    hiddenTasks.push({ task, risk, hiddenBy });
    counts[risk.severity]++;
    counts.total++;
  }

  // Sort hidden tasks: critical -> high -> medium, then by title
  const sortedHidden = [...hiddenTasks].sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2 };
    const orderA = severityOrder[a.risk.severity];
    const orderB = severityOrder[b.risk.severity];
    if (orderA !== orderB) return orderA - orderB;
    return a.task.title.localeCompare(b.task.title);
  });

  // Create preview list (up to 3 items)
  const previewList = sortedHidden.slice(0, 3).map((item) => {
    const mission = missions.find((m) => m.id === item.task.missionId);
    return {
      id: item.task.id,
      title: item.task.title,
      severity: item.risk.severity,
      label: item.risk.label,
      missionTitle: mission?.title || item.task.mission?.title,
      domain: mission?.domain || item.task.mission?.domain,
    };
  });

  return {
    hiddenTasks: sortedHidden,
    counts,
    categories,
    previewList,
  };
}
