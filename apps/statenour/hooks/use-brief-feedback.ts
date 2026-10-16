"use client";

/**
 * useBriefFeedback (UI v3 W2, 2026-10-16): the device-local Keep / Less map for the Home brief,
 * as React state. SSR and the first client render see an unhydrated map; the component waits for
 * `hydrated` before painting the list, so a row about to vanish is never tappable for a frame.
 * Even `window.localStorage` can throw (Safari with "Block All Cookies"), so every touch of it is
 * inside a try, like hooks/use-local-storage-state.ts. Expiry is computed by the caller at render
 * (lib/ui/brief-feedback.ts hiddenKinds), not frozen at mount.
 */
import { useCallback, useEffect, useState } from "react";

import {
  clearBriefFeedback,
  readBriefFeedback,
  writeBriefVerdict,
  type BriefFeedbackMap,
  type BriefVerdict,
  type FeedbackStorage,
} from "@/lib/ui/brief-feedback";

function storage(): FeedbackStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useBriefFeedback(): {
  feedback: BriefFeedbackMap;
  hydrated: boolean;
  setVerdict: (kind: string, verdict: BriefVerdict) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{ map: BriefFeedbackMap; hydrated: boolean }>({ map: {}, hydrated: false });

  useEffect(() => {
    const t = setTimeout(() => {
      const s = storage();
      setState({ map: s ? readBriefFeedback(s) : {}, hydrated: true });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const setVerdict = useCallback((kind: string, verdict: BriefVerdict) => {
    const at = Date.now();
    const s = storage();
    setState((prev) => ({ map: s ? writeBriefVerdict(s, kind, verdict, at) : { ...prev.map, [kind]: { verdict, at } }, hydrated: true }));
  }, []);

  const clear = useCallback(() => {
    const s = storage();
    if (s) clearBriefFeedback(s);
    setState({ map: {}, hydrated: true });
  }, []);

  return { feedback: state.map, hydrated: state.hydrated, setVerdict, clear };
}
