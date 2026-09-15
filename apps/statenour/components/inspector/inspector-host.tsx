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

import { Suspense, ViewTransition, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useInspectorStore } from "@/lib/state/inspector-store";
import { readInspect } from "@/lib/ui/inspect-url";
import { formatEntityRef } from "@/lib/ui/entity-ref";
import { routeOwnsKind } from "@/lib/ui/entity-actions";
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

/**
 * The lane <main> and the fixed chrome keep clear of while the panel is
 * docked: the panel's own width plus the Nick pane's when that is open
 * (the panel docks to the LEFT of the pane, `right: var(--nick-pane-open-w)`
 * in inspector-frame.tsx), so content reflows instead of sitting under it.
 */
export const INSPECTOR_LANE_VALUE = `calc(${INSPECTOR_PANEL_WIDTH} + var(--nick-pane-open-w, 0px))`;

/** Pure: reserve the lane on `root`, return the release. Testable without a DOM. */
export function reserveInspectorLane(root: {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}): () => void {
  root.style.setProperty(INSPECTOR_LANE_VAR, INSPECTOR_LANE_VALUE);
  return () => root.style.removeProperty(INSPECTOR_LANE_VAR);
}

const subscribeNoop = () => () => {};

/**
 * The `enter` / `exit` classes of the ONE `<ViewTransition>` in the app
 * (docs/DESIGN.md Motion philosophy: row -> inspector, never every route).
 * Their keyframes live in app/styles/effects.css — React puts these class
 * names on the browser's transition pseudo-elements, which hang off <html>,
 * so a component-scoped style block could never reach them.
 */
const INSPECTOR_TRANSITION = {
  panelIn: "inspector-panel-in",
  panelOut: "inspector-panel-out",
  sheetOut: "inspector-sheet-out",
} as const;

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
  // The width is unknown on the server, so a `?inspect=` URL would SSR the
  // phone sheet (scrim and all) and swap to the dock after hydration. The
  // inspector is a client layer: render nothing until mounted.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

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
  const owned = target ? ownedKinds.includes(target.kind) || routeOwnsKind(pathname, target.kind) : false;
  const showing = mounted && Boolean(target) && !owned;

  useEffect(() => {
    if (!showing || !isWide || typeof document === "undefined") return;
    return reserveInspectorLane(document.documentElement);
  }, [showing, isWide]);

  if (!mounted) return null;
  if (!target || owned) return <SelectionActionBar />;

  const renderer = inspectorFor(target.kind);
  const onClose = mode === "peek" ? () => setPeek(null) : closeInspector;
  const presentation = isWide ? "panel" : "sheet";

  // Only Transition updates animate. The URL-backed OPEN and CLOSE travel
  // through the router (a transition), so the dock slides in and out and the
  // sheet gets the exit it never had (its entrance stays the CSS keyframe,
  // hence `enter="none"` there). The store-backed PEEK is a synchronous
  // update and stays instant by design — Space while arrowing must not wait
  // on an animation. `update="none"`: arrowing between rows swaps the
  // panel's content without a cross-fade.
  return (
    <>
      <ViewTransition
        enter={presentation === "panel" ? INSPECTOR_TRANSITION.panelIn : "none"}
        exit={presentation === "panel" ? INSPECTOR_TRANSITION.panelOut : INSPECTOR_TRANSITION.sheetOut}
        update="none"
        default="none"
      >
        <InspectorFrame
          kind={target.kind}
          mode={mode}
          presentation={presentation}
          onClose={onClose}
          actions={renderer ? undefined : <EntityActionRow entities={[target]} />}
        >
          {renderer ? (
            <renderer.Panel key={formatEntityRef(target)} entity={target} mode={mode} />
          ) : (
            <InspectorNotice state="unknown-kind" kind={target.kind} />
          )}
        </InspectorFrame>
      </ViewTransition>
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
