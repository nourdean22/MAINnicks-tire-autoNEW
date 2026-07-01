import { useState, useMemo } from "react";
import type { Task, Project } from "@/components/actions/shared";
import { isUserProject } from "@/lib/services/mission-helpers";

export type KindFilter = "all" | "ONCE" | "DAILY" | "PROMISE";

export function useMissionFilters(tasks: Task[], missions: Project[]) {
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState("");
  const [filterEditMode, setFilterEditMode] = useState(false);

  const filteredTasks = useMemo(() => {
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

  const filteredMissions = useMemo(() => {
    const hasActiveFilter = !!(searchQuery.trim() || domainFilter || kindFilter !== "all");
    if (!hasActiveFilter) return missions;

    return missions.filter((m) => {
      if (m.status !== "ACTIVE" || !isUserProject(m)) return false;

      if (domainFilter && m.domain?.toLowerCase() !== domainFilter.toLowerCase()) {
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

  const filtersActive = !!(searchQuery.trim() || kindFilter !== "all" || domainFilter);

  const handleClearFilters = () => {
    setSearchQuery("");
    setKindFilter("all");
    setDomainFilter(null);
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
