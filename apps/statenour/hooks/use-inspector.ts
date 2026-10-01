"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useInspectorStore, type InspectorPageAction } from "@/lib/state/inspector-store";
import type { EntityKind, EntityRef } from "@/lib/ui/entity-ref";
import { INSPECT_TRANSITION_TYPES, inspectHref, readInspect } from "@/lib/ui/inspect-url";

/**
 * `useInspector()` · open / close the universal inspector · 2026-09-15.
 *
 * The OPEN inspector is the URL (`?inspect=`). Opening pushes a history
 * entry so Back closes it; closing replaces so Back does not re-open it —
 * the page-tabs.tsx convention. Moving from one object to another while the
 * inspector is already open REPLACES (arrowing through twenty rows must not
 * leave twenty history entries). The transient PEEK layer lives in the store
 * and is cleared by any real open.
 *
 * Reads `window.location.search` at call time instead of `useSearchParams`
 * so a row inside a static subtree does not need a Suspense boundary just to
 * own an onClick.
 */
export function useInspector() {
  const router = useRouter();
  const pathname = usePathname();
  const setPeek = useInspectorStore((s) => s.setPeek);

  const openInspector = useCallback(
    (ref: EntityRef, opts?: { replace?: boolean }) => {
      if (typeof window === "undefined") return;
      const search = window.location.search;
      const path = pathname ?? window.location.pathname;
      const href = inspectHref(path, search, ref);
      setPeek(null);
      const alreadyOpen = readInspect(search) !== null;
      if (alreadyOpen || opts?.replace) {
        router.replace(href, {
          scroll: false,
          transitionTypes: [INSPECT_TRANSITION_TYPES.swap],
        });
      } else {
        router.push(href, {
          scroll: false,
          transitionTypes: [INSPECT_TRANSITION_TYPES.open],
        });
      }
    },
    [router, pathname, setPeek],
  );

  const closeInspector = useCallback(() => {
    if (typeof window === "undefined") return;
    const path = pathname ?? window.location.pathname;
    router.replace(inspectHref(path, window.location.search, null), {
      scroll: false,
      transitionTypes: [INSPECT_TRANSITION_TYPES.close],
    });
  }, [router, pathname]);

  return { openInspector, closeInspector };
}

/**
 * A page that renders its OWN panel for a kind (e.g. /people's dossier
 * `DetailPanel`) declares it here so the global host stays silent for that
 * kind on that page. The URL contract is shared either way — the page just
 * answers it itself.
 */
export function useInspectorOwnership(kinds: readonly EntityKind[]): void {
  const ownKinds = useInspectorStore((s) => s.ownKinds);
  const releaseKinds = useInspectorStore((s) => s.releaseKinds);
  const key = kinds.join(",");
  useEffect(() => {
    const list = key ? (key.split(",") as EntityKind[]) : [];
    if (list.length === 0) return;
    ownKinds(list);
    return () => releaseKinds(list);
  }, [key, ownKinds, releaseKinds]);
}

/**
 * Lend the current page's actions for a kind to the inspector (complete /
 * snooze from the Missions dispatch, resolve / mute from the alerts page).
 * Pass a MEMOISED array — the registration is keyed on its identity, and a
 * fresh array per render would re-register per render.
 */
export function useRegisterInspectorActions(kind: EntityKind, actions: InspectorPageAction[]): void {
  const register = useInspectorStore((s) => s.registerPageActions);
  useEffect(() => register(kind, actions), [register, kind, actions]);
}
