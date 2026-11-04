"use client";

import { useSearchParams } from "next/navigation";

import { goalFilterHref } from "@/lib/missions/task-goal";

/** goalFilterHref merged into the page's current query, so ?inspect= survives a goal chip tap (W8c item 7). */
export function useGoalFilterHref(): (goalId: string | null) => string {
  const params = useSearchParams();
  return (goalId) => goalFilterHref(goalId, params?.toString() ?? null);
}
