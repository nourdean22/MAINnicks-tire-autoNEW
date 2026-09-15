/**
 * useWebExperimentArm — which arm of a registered web experiment this visitor
 * sees, and the exposure receipt that makes the visit measurable.
 *
 * · Assignment is DETERMINISTIC on the visitor id (localStorage
 *   `nick_session_id`) — the same visitor sees the same arm on every load,
 *   and `assignByKey` is the hash the server resolver re-derives.
 * · Control is the answer whenever the experiment is not active, the visitor
 *   id is unavailable (private mode), or the server is unreachable — and in
 *   those cases NO exposure is logged, so the resolver never counts a session
 *   that could not have been randomised.
 * · Exposure is logged once per mount through useConversionTracking, so it
 *   lands in customer_events beside the conversion it will be joined to.
 */
import { useEffect, useMemo, useRef } from "react";
import { assignByKey } from "@shared/experimentKernel";
import { EXPERIMENT_EXPOSURE_EVENT, webExperimentById } from "@shared/webExperiments";
import { trpc } from "@/lib/trpc";
import { getSessionId } from "@/lib/session";
import { useConversionTracking } from "./useConversionTracking";

export function useWebExperimentArm(experimentId: string): { armId: string; active: boolean } {
  const def = webExperimentById(experimentId);
  const track = useConversionTracking();
  const { data } = trpc.experiments.active.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 });
  const active = !!def && !!data?.active.includes(experimentId);

  const armId = useMemo(() => {
    if (!def || !active) return "control";
    const sid = typeof window === "undefined" ? null : getSessionId();
    if (!sid) return "control";
    return assignByKey(def.arms.map((a) => a.armId), `${sid}:${experimentId}`);
  }, [def, active, experimentId]);

  const logged = useRef(false);
  useEffect(() => {
    if (!active || logged.current) return;
    if (typeof window === "undefined" || !getSessionId()) return;
    logged.current = true;
    track({ type: EXPERIMENT_EXPOSURE_EVENT, element: experimentId, props: { armId } });
  }, [active, armId, experimentId, track]);

  return { armId, active };
}
