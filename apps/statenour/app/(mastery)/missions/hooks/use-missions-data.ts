import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { Project, Task } from "@/components/actions/shared";

export function useMissionsData(taskIdParam?: string | null) {
  const utils = trpc.useUtils();
  
  const tasksQuery = trpc.task.list.useQuery(
    {},
    {
      refetchInterval: 15_000,
      refetchOnWindowFocus: false,
    },
  );
  
  const missionsQuery = trpc.task.missions.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  
  const healthQuery = trpc.system.healthSummary.useQuery(undefined, {
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  });
  
  const statsQuery = trpc.operator.characterSheet.useQuery(undefined, {
    staleTime: 60_000,
  });
  
  const ccStateQuery = trpc.operator.commandCenterState.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const tasks = useMemo<Task[]>(
    () => (tasksQuery.data ?? []) as Task[],
    [tasksQuery.data],
  );
  
  const missions = useMemo<Project[]>(
    () => (missionsQuery.data ?? []) as Project[],
    [missionsQuery.data],
  );

  const taskDetailQuery = trpc.task.byId.useQuery(
    { id: taskIdParam ?? "" },
    { enabled: !!taskIdParam && !tasksQuery.isLoading && !tasks.some((t) => t.id === taskIdParam) }
  );

  return {
    utils,
    tasksQuery,
    missionsQuery,
    healthQuery,
    statsQuery,
    ccStateQuery,
    taskDetailQuery,
    tasks,
    missions,
  };
}
