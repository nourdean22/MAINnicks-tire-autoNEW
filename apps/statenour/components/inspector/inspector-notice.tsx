"use client";

/**
 * The inspector's honest non-content states · 2026-09-15.
 *
 * Four states that must never look alike (the "empty is not error" house
 * rule, components/ui/empty-state.tsx): a kind with no renderer yet, a read
 * that failed, an id that resolves to nothing, and a read in flight. The
 * provenance chip on each one is what tells the operator which it is.
 */

import { AlertTriangle, SearchX, Wrench } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { ENTITY_KIND_LABEL, isEntityKind } from "@/lib/ui/entity-ref";

export type InspectorNoticeState = "unknown-kind" | "error" | "not-found" | "loading";

export interface InspectorNoticeProps {
  state: InspectorNoticeState;
  kind: string;
  /** A compact error code — never the raw message (it is a user-visible sink). */
  code?: string;
}

export function InspectorNotice({ state, kind, code }: InspectorNoticeProps) {
  const noun = isEntityKind(kind) ? ENTITY_KIND_LABEL[kind] : kind;

  if (state === "loading") {
    return (
      <div className="space-y-2" data-inspector-state="loading" aria-busy="true">
        <ShimmerSkeleton className="h-5 w-3/4" />
        <ShimmerSkeleton className="h-3 w-1/2" />
        <ShimmerSkeleton className="h-3 w-full" />
        <ShimmerSkeleton className="h-3 w-5/6" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div data-inspector-state="error">
        <EmptyState
          provenance="ERROR"
          tone="warning"
          icon={AlertTriangle}
          title={`Could not read this ${noun}`}
          why={`The read failed${code ? ` (${code})` : ""}. Its state is unknown — not empty, not missing.`}
          unlock="Try again, or open it on its page."
        />
      </div>
    );
  }

  if (state === "not-found") {
    return (
      <div data-inspector-state="not-found">
        <EmptyState
          provenance="ZERO"
          icon={SearchX}
          title={`No ${noun} with this id`}
          why="The read succeeded and found nothing: deleted, expired, or the link is stale."
        />
      </div>
    );
  }

  return (
    <div data-inspector-state="unknown-kind">
      <EmptyState
        provenance="UNMEASURED"
        icon={Wrench}
        title={`No inspector for "${noun}" yet`}
        why="This kind is in the registry but has no renderer. Nothing was read."
        unlock="Open it on its page from the actions below."
      />
    </div>
  );
}
