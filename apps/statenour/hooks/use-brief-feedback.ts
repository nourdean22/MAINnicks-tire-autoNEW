"use client";

/**
 * useBriefFeedback (UI v3 W2, 2026-10-16): the device-local Keep / Less map for the Home brief,
 * as React state. SSR and the first client render see nothing hidden; the map loads from
 * localStorage after mount (the use-local-storage-state precedent, so Home stays hydration-safe).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  clearBriefFeedback,
  hiddenKinds,
  readBriefFeedback,
  writeBriefVerdict,
  type BriefFeedbackMap,
  type BriefVerdict,
} from "@/lib/ui/brief-feedback";

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

export function useBriefFeedback(): {
  feedback: BriefFeedbackMap;
  hidden: ReadonlySet<string>;
  setVerdict: (kind: string, verdict: BriefVerdict) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{ map: BriefFeedbackMap; now: number }>({ map: {}, now: 0 });

  useEffect(() => {
    const s = storage();
    if (!s) return;
    const t = setTimeout(() => setState({ map: readBriefFeedback(s), now: Date.now() }), 0);
    return () => clearTimeout(t);
  }, []);

  const hidden = useMemo(() => new Set(hiddenKinds(state.map, state.now)), [state]);

  const setVerdict = useCallback((kind: string, verdict: BriefVerdict) => {
    const at = Date.now();
    const s = storage();
    setState((prev) => ({ map: s ? writeBriefVerdict(s, kind, verdict, at) : { ...prev.map, [kind]: { verdict, at } }, now: at }));
  }, []);

  const clear = useCallback(() => {
    const s = storage();
    if (s) clearBriefFeedback(s);
    setState({ map: {}, now: Date.now() });
  }, []);

  return { feedback: state.map, hidden, setVerdict, clear };
}
