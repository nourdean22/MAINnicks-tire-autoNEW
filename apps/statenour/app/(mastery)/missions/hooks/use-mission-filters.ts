import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { LoopKind, Task, Project } from "@/components/actions/shared";
import { isUserProject, isGeneralAnchor } from "@/lib/services/mission-helpers";
import { filterByGoal, goalFilterHref, type GoalTask } from "@/lib/missions/task-goal";

// #1897 review · derived from LoopKind instead of a hand-copied union. The
// copy had drifted (no WEEKLY, which the Prisma enum has carried all along)
// and the two KindFilter declarations disagreed the moment shared.ts was
// corrected. A derived type cannot drift again.
export type KindFilter = "all" | LoopKind;

export function useMissionFilters(tasks: GoalTask[], missions: Project[]) {
  // 2026-11-02 · the goal filter lives in the URL (?goalId=) so the goal card can deep-link here.
  const router = useRouter();
  const searchParams = useSearchParams();
  const goalFilter = searchParams.get("goalId") || null;
  // W8c · merge, not replace: ?inspect= (the open task inspector) survives a filter change.
  const setGoalFilter = (id: string | null) => router.replace(goalFilterHref(id, searchParams.toString()), { scroll: false });
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState("");
  const [filterEditMode, setFilterEditMode] = useState(false);

  const baseTasks = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return tasks.filter((t) => {
      const mission = missions.find((m) => m.id === t.missionId);
      const missionTitle = mission?.title.toLowerCase() || t.mission?.title.toLowerCase() || "";
      const domain = mission?.domain?.toLowerCase() || t.mission?.domain?.toLowerCase() || "other";

      if (query) {
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesMission = missionTitle.includes(query);
        if (!matchesTitle && !matchesMission) return false;
      }

      if (kindFilter !== "all" && t.loopKind !== kindFilter) return false;

      if (domainFilter) {
        if (domain !== domainFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [tasks, missions, searchQuery, kindFilter, domainFilter]);

  const baseMissions = useMemo(() => {
    const hasActiveFilter = !!(searchQuery.trim() || domainFilter || kindFilter !== "all");
    if (!hasActiveFilter) return missions;

    return missions.filter((m) => {
      // truth-substrate audit P1 (#19): keep GENERAL domain anchors too, not just
      // user projects: MissionFeed needs them to render domain-routed task buckets.
      // Without this, an active filter dropped every anchor and the tasks the
      // classifier routed to them regressed back into "unattached". MissionFeed's
      // own isUserProject filter still keeps anchors OUT of the project cards, so
      // this only feeds the domain-bucket path. (filteredMissions has one consumer.)
      if (m.status !== "ACTIVE" || (!isUserProject(m) && !isGeneralAnchor(m))) return false;

      // Anchors are domain-scoped by canonicalDomain; match either field.
      if (
        domainFilter &&
        m.domain?.toLowerCase() !== domainFilter.toLowerCase() &&
        m.canonicalDomain?.toLowerCase() !== domainFilter.toLowerCase()
      ) {
        return false;
      }

      const query = searchQuery.toLowerCase().trim();
      const missionTasks = tasks.filter((t) => t.missionId === m.id);

      const missionMatchesSearch = !query || m.title.toLowerCase().includes(query);

      const hasMatchingTask = missionTasks.some((t) => {
        if (query && !t.title.toLowerCase().includes(query)) return false;
        if (kindFilter !== "all" && t.loopKind !== kindFilter) return false;
        return true;
      });

      return missionMatchesSearch || hasMatchingTask;
    });
  }, [missions, tasks, searchQuery, domainFilter, kindFilter]);

  // Goal last: a mission stays when it is linked to the goal or holds a task that is (lib/missions/task-goal).
  const { tasks: filteredTasks, missions: filteredMissions } = useMemo(
    () => filterByGoal(baseTasks, baseMissions, goalFilter),
    [baseTasks, baseMissions, goalFilter],
  );

  const activeTasks = useMemo(() => tasks.filter((t) => t.status !== "DONE" && t.status !== "ARCHIVED"), [tasks]);
  const onceCount = useMemo(() => activeTasks.filter((t) => !t.loopKind || t.loopKind === "ONCE").length, [activeTasks]);
  const dailyCount = useMemo(() => activeTasks.filter((t) => t.loopKind === "DAILY").length, [activeTasks]);
  const promiseCount = useMemo(() => activeTasks.filter((t) => t.loopKind === "PROMISE").length, [activeTasks]);
  const activeCount = activeTasks.length;

  const activeDomains = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of activeTasks) {
      const mission = missions.find((m) => m.id === t.missionId);
      const d = mission?.domain?.toLowerCase() || t.mission?.domain?.toLowerCase() || "other";
      counts[d] = (counts[d] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [activeTasks, missions]);

  const filtersActive = !!(searchQuery.trim() || kindFilter !== "all" || domainFilter || goalFilter);

  const handleClearFilters = () => {
    setSearchQuery("");
    setKindFilter("all");
    setDomainFilter(null);
    if (goalFilter) setGoalFilter(null);
  };

  return {
    showFilters,
    setShowFilters,
    searchQuery,
    setSearchQuery,
    domainFilter,
    setDomainFilter,
    kindFilter,
    setKindFilter,
    goalFilter,
    setGoalFilter,
    addingDomain,
    setAddingDomain,
    newDomainInput,
    setNewDomainInput,
    filterEditMode,
    setFilterEditMode,
    filteredTasks,
    filteredMissions,
    onceCount,
    dailyCount,
    promiseCount,
    activeCount,
    activeDomains,
    filtersActive,
    handleClearFilters,
  };
}
