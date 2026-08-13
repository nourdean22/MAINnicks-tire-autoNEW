/**
 * SMS autonomy census — NT-004 (2026-08-13).
 *
 * Registry-derived declared-vs-live readout, ported from the statenour wiring
 * census whose FIRST live run found 17 severed rules where hand-inspection had
 * found 2. The mechanism that made it work is the only rule here: derive lanes
 * from the CODE REGISTRY that governs dispatch (SMS_AUTOMATION_REGISTRY),
 * never a hand-list — a hand-list is a third copy that rots.
 *
 * For every orchestrator-governed lane this reads the LIVE rollout mode (the
 * same getRolloutMode the dispatcher consults) and compares it against the
 * declared autonomy ceiling. The census reports STATE, not judgment: an "off"
 * lane may be intentionally dormant — the operator decides. The one thing it
 * flags as a defect is `over_ceiling`: a live mode above the declared ladder
 * level, which the setRolloutMode guard is supposed to make impossible — if it
 * ever appears, either the guard was bypassed or the registry was edited after
 * the flip. Fail-loud: a lane whose mode cannot be READ is reported as
 * unreadable, never skipped (a census that silently drops rows is the thing it
 * exists to catch — the BDN-105 lesson).
 *
 * DISCLOSED BLIND SPOTS (rendered on the panel, keep in sync):
 *  - direct_sendSms / campaign_router lanes are governed by feature flags and
 *    env (`armedBy` free text) — this census lists their declarations but does
 *    NOT live-read those switches.
 *  - "mode live" ≠ "has ever fired" — firing history is cron_log/sms_messages
 *    territory, not covered here.
 */
import {
  SMS_AUTOMATION_REGISTRY,
  maxRolloutModeForLevel,
  rolloutModeRank,
  type RolloutMode,
  type SmsAutomationPolicy,
} from "./smsAutonomy";
import { createLogger } from "../lib/logger";

const log = createLogger("services:sms-autonomy-census");

export type LaneStatus = "within_ceiling" | "over_ceiling" | "unreadable" | "not_live_read";

export interface CensusLane {
  key: string;
  path: SmsAutomationPolicy["path"];
  level: SmsAutomationPolicy["level"];
  sendClass: SmsAutomationPolicy["sendClass"];
  declaredCeiling: RolloutMode;
  liveMode: RolloutMode | null;
  status: LaneStatus;
  armedBy: string | null;
  detail: string;
}

export interface AutonomyCensus {
  /**
   * false = the census could not reach the DB. The dispatcher's own reader
   * falls back to legacy_passthrough in that state, so every orchestrator
   * lane's ladder is UNENFORCEABLE right now — the lane rows say so and the
   * panel banners it. Reported, never hidden: a census that shrugs at its own
   * substrate being down is the failure class it exists to catch.
   */
  dbAvailable: boolean;
  lanes: CensusLane[];
  summary: {
    total: number;
    liveRead: number;
    overCeiling: number;
    unreadable: number;
    notLiveRead: number;
  };
  blindSpots: string[];
  generatedAt: string;
}

/**
 * Pure classification for one lane — exported so the over-ceiling and
 * unreadable arms are pinned by tests without a DB.
 */
export function classifyLane(policy: SmsAutomationPolicy, liveMode: RolloutMode | null | "error"): CensusLane {
  const declaredCeiling = maxRolloutModeForLevel(policy.level);
  const base = {
    key: policy.key,
    path: policy.path,
    level: policy.level,
    sendClass: policy.sendClass,
    declaredCeiling,
    armedBy: policy.armedBy ?? null,
  };
  if (policy.path !== "orchestrator") {
    return {
      ...base,
      liveMode: null,
      status: "not_live_read",
      detail: `governed by ${policy.armedBy ?? "flags/env"} — declaration listed, switch not live-read (disclosed blind spot)`,
    };
  }
  if (liveMode === "error" || liveMode === null) {
    return {
      ...base,
      liveMode: null,
      status: "unreadable",
      detail: "live rollout mode could not be read — treat as UNKNOWN, not off",
    };
  }
  if (rolloutModeRank(liveMode) > rolloutModeRank(declaredCeiling)) {
    return {
      ...base,
      liveMode,
      status: "over_ceiling",
      detail: `LIVE mode '${liveMode}' exceeds declared level-${policy.level} ceiling '${declaredCeiling}' — the setRolloutMode guard should make this impossible`,
    };
  }
  return {
    ...base,
    liveMode,
    status: "within_ceiling",
    detail: liveMode === "off" ? "off (may be intentionally dormant — operator's call)" : `live at '${liveMode}', ceiling '${declaredCeiling}'`,
  };
}

export async function runSmsAutonomyCensus(): Promise<AutonomyCensus> {
  const { getRolloutMode } = await import("./smsOrchestrator");
  // Same-reader principle with the reader's failure mode made EXPLICIT:
  // getRolloutMode returns "legacy_passthrough" when the DB is unreachable —
  // that IS the dispatcher's true effective state (the ladder cannot gate
  // anything), but rendered bare it is indistinguishable from an operator
  // choice. Pre-check the substrate so the reading carries its own caveat.
  let dbAvailable = true;
  try {
    const { getDbTyped } = await import("../db");
    dbAvailable = (await getDbTyped()) != null;
  } catch {
    dbAvailable = false;
  }
  const lanes: CensusLane[] = [];
  for (const policy of SMS_AUTOMATION_REGISTRY) {
    if (policy.path !== "orchestrator") {
      lanes.push(classifyLane(policy, null));
      continue;
    }
    try {
      const mode = await getRolloutMode(policy.key);
      const lane = classifyLane(policy, mode);
      lanes.push(
        dbAvailable
          ? lane
          : {
              ...lane,
              detail: `${lane.detail} · DB UNREACHABLE — dispatcher falls back to legacy_passthrough; the ladder is unenforceable right now`,
            },
      );
    } catch (err) {
      log.warn("census: rollout mode read failed", {
        key: policy.key,
        err: err instanceof Error ? err.message : String(err),
      });
      lanes.push(classifyLane(policy, "error"));
    }
  }
  const summary = {
    total: lanes.length,
    liveRead: lanes.filter((l) => l.liveMode !== null).length,
    overCeiling: lanes.filter((l) => l.status === "over_ceiling").length,
    unreadable: lanes.filter((l) => l.status === "unreadable").length,
    notLiveRead: lanes.filter((l) => l.status === "not_live_read").length,
  };
  return {
    dbAvailable,
    lanes,
    summary,
    blindSpots: [
      "direct_sendSms / campaign_router lanes: armedBy flags & env are declared, not live-read",
      "'mode live' does not mean 'has ever fired' — firing history is not covered",
    ],
    generatedAt: new Date().toISOString(),
  };
}
