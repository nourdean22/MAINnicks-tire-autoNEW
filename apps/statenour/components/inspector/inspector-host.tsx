"use client";

/**
 * InspectorHost · mounted once in app/(mastery)/layout.tsx · 2026-09-15.
 *
 * Reads the OPEN inspector from the URL (`?inspect=`, Suspense-wrapped like
 * page-tabs.tsx) and the PEEK from the store, resolves a renderer, and draws
 * the frame: a docked panel at >= 1280px (reserving `--inspector-lane` so
 * <main> reflows) or a bottom sheet below. Inert until something is inspected
 * — on a fresh page it renders only the selection action bar (which is itself
 * null until rows are selected) and installs the single keyboard listener.
 *
 * Kinds the current page owns (`useInspectorOwnership`) are skipped: /people
 * answers `?inspect=person:` with its own dossier panel.
 */

import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useInspectorStore } from "@/lib/state/inspector-store";
import { readInspect } from "@/lib/ui/inspect-url";
import { formatEntityRef } from "@/lib/ui/entity-ref";
import { INSPECTOR_PANEL_WIDTH, InspectorFrame } from "@/components/inspector/inspector-frame";
import { InspectorNotice } from "@/components/inspector/inspector-notice";
import { EntityActionRow } from "@/components/inspector/entity-action-row";
import { SelectionActionBar } from "@/components/inspector/selection-action-bar";
import { inspectorFor } from "@/components/inspector/inspector-registry";
import { useInspector } from "@/hooks/use-inspector";
import { useMinWidth } from "@/hooks/use-min-width";
import { useSelectionKeyboard } from "@/hooks/use-selection-keyboard";

export const INSPECTOR_LANE_VAR = "--inspector-lane";
export const INSPECTOR_BREAKPOINT_PX = 1280;

/** Pure: reserve the lane on `root`, return the release. Testable without a DOM. */
export function reserveInspectorLane(root: {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}): () => void {
  root.style.setProperty(INSPECTOR_LANE_VAR, INSPECTOR_PANEL_WIDTH);
  return () => root.style.removeProperty(INSPECTOR_LANE_VAR);
}

function InspectorHostInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const open = useMemo(() => readInspect(searchParams.toString()), [searchParams]);
  const peek = useInspectorStore((s) => s.peek);
  const setPeek = useInspectorStore((s) => s.setPeek);
  const ownedKinds = useInspectorStore((s) => s.ownedKinds);
  const hydrate = useInspectorStore((s) => s.hydrate);
  const { closeInspector } = useInspector();
  const isWide = useMinWidth(INSPECTOR_BREAKPOINT_PX);

  useSelectionKeyboard();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // A route change ends a peek; the URL-backed open state travels on its own.
  useEffect(() => {
    setPeek(null);
  }, [pathname, setPeek]);

  const target = open ?? peek;
  const mode: "peek" | "inspect" = open ? "inspect" : "peek";
  const owned = target ? ownedKinds.includes(target.kind) : false;
  const showing = Boolean(target) && !owned;

  useEffect(() => {
    if (!showing || !isWide || typeof document === "undefined") return;
    return reserveInspectorLane(document.documentElement);
  }, [showing, isWide]);

  if (!target || owned) return <SelectionActionBar />;

  const renderer = inspectorFor(target.kind);
  const onClose = mode === "peek" ? () => setPeek(null) : closeInspector;

  return (
    <>
      <InspectorFrame
        kind={target.kind}
        mode={mode}
        presentation={isWide ? "panel" : "sheet"}
        onClose={onClose}
        actions={renderer ? undefined : <EntityActionRow entities={[target]} />}
      >
        {renderer ? (
          <renderer.Panel key={formatEntityRef(target)} entity={target} mode={mode} />
        ) : (
          <InspectorNotice state="unknown-kind" kind={target.kind} />
        )}
      </InspectorFrame>
      <SelectionActionBar />
    </>
  );
}

export function InspectorHost() {
  return (
    <Suspense fallback={null}>
      <InspectorHostInner />
    </Suspense>
  );
}
