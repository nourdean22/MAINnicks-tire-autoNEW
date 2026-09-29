/**
 * Customer-contact holdout assignment (Q-21).
 *
 * This is deliberately narrower than "every SMS": only explicit proactive
 * marketing lanes with a stable variantKey are eligible. Customer-initiated
 * replies, confirmations, warranty/status notices, payment obligations, and
 * lanes that already have their own holdout design never enter this system.
 *
 * Safety / truth rules:
 * - every flag defaults OFF;
 * - assignment is deterministic and durable before a control is withheld;
 * - if DB/assignment truth is unavailable, SEND NORMALLY (treatment) and mark
 *   the measurement unavailable — never silently withhold an unrecorded control;
 * - the 15% control share matches the repo's established recovery experiment;
 * - experiment version is part of the identity, so a future design change does
 *   not silently reassign a running cohort.
 */
import { and, eq, sql } from "drizzle-orm";
import { contactExperimentAssignments } from "../../drizzle/schema";
import { assignByKey } from "../../shared/experimentKernel";
import { getDbTyped } from "../db";
import { createLogger } from "../lib/logger";
import { normalizePhone } from "../lib/phone";
import { isEnabled, type FlagKey } from "./featureFlags";

const log = createLogger("contact-experiment");

export const CONTACT_HOLDOUT_VERSION = "v1";
export const CONTACT_HOLDOUT_CONTROL_PCT = 15;

/** 3 control buckets / 20 total = exactly 15%. Uses the canonical experiment hash. */
const HOLDOUT_BUCKETS = [
  "control", "control", "control",
  "treatment", "treatment", "treatment", "treatment", "treatment",
  "treatment", "treatment", "treatment", "treatment", "treatment",
  "treatment", "treatment", "treatment", "treatment", "treatment",
  "treatment", "treatment",
] as const;

export type ContactExperimentArm = "control" | "treatment";

export interface ContactLaneDefinition {
  laneKey: string;
  experimentId: string;
  flagKey: FlagKey;
  sourceVariantKey: string;
}

export interface ContactExperimentDecision {
  eligible: boolean;
  armed: boolean;
  measurable: boolean;
  laneKey: string | null;
  experimentId: string | null;
  armId: ContactExperimentArm | null;
  reason: string;
}

function lane(
  laneKey: string,
  sourceVariantKey: string,
  flagKey: FlagKey,
): ContactLaneDefinition {
  return {
    laneKey,
    experimentId: `contact:${laneKey}:${CONTACT_HOLDOUT_VERSION}`,
    flagKey,
    sourceVariantKey,
  };
}

/**
 * Pure mapping from existing sms_messages.variantKey semantics to experiment
 * lanes. Copy-test suffixes are folded into the parent lane so a customer is
 * not re-randomised because message copy changed.
 */
export function contactLaneForVariant(
  rawVariantKey: string | null | undefined,
): ContactLaneDefinition | null {
  const variantKey = rawVariantKey?.trim();
  if (!variantKey) return null;

  if (/^declined_/i.test(variantKey) || variantKey === "cross_sell") {
    // Both already have an independent holdout/control design.
    return null;
  }

  if (/^retention_d\d+(?:_v\d+)?$/i.test(variantKey)) {
    const parent = variantKey.replace(/_v\d+$/i, "");
    return lane(parent, variantKey, "contact_holdout_retention");
  }
  if (variantKey === "winback") {
    return lane("winback", variantKey, "contact_holdout_winback");
  }
  if (variantKey === "drip") {
    return lane("drip", variantKey, "contact_holdout_drip");
  }
  if (/^weather_[a-z0-9_-]+$/i.test(variantKey)) {
    return lane(variantKey, variantKey, "contact_holdout_weather");
  }
  if (variantKey === "review_request") {
    return lane("review_request", variantKey, "contact_holdout_review_requests");
  }
  if (/^campaign:\d+$/i.test(variantKey)) {
    // Each campaign is its own experiment. Comparing unrelated offers/copy in
    // one control pool would confound the result.
    return lane(variantKey, variantKey, "contact_holdout_campaigns");
  }

  return null;
}

function normalisedSubjectKey(phone: string): string | null {
  const normalized = normalizePhone(phone);
  const digits = (normalized ?? phone).replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

export function contactArmForSubject(
  experimentId: string,
  subjectKey: string,
): ContactExperimentArm {
  return assignByKey(HOLDOUT_BUCKETS, `${experimentId}:${subjectKey}`) as ContactExperimentArm;
}

/**
 * Resolve/persist the no-contact arm. A treatment result means "continue the
 * normal send". A control result is safe to withhold only when measurable=true.
 */
export async function resolveContactExperiment(
  phone: string,
  variantKey: string | null | undefined,
): Promise<ContactExperimentDecision> {
  const definition = contactLaneForVariant(variantKey);
  if (!definition) {
    return {
      eligible: false,
      armed: false,
      measurable: false,
      laneKey: null,
      experimentId: null,
      armId: null,
      reason: "lane_not_registered_for_holdout",
    };
  }

  if (!(await isEnabled("contact_holdouts_enabled"))) {
    return {
      eligible: true,
      armed: false,
      measurable: false,
      laneKey: definition.laneKey,
      experimentId: definition.experimentId,
      armId: null,
      reason: "master_flag_off",
    };
  }
  if (!(await isEnabled(definition.flagKey))) {
    return {
      eligible: true,
      armed: false,
      measurable: false,
      laneKey: definition.laneKey,
      experimentId: definition.experimentId,
      armId: null,
      reason: `${definition.flagKey}_off`,
    };
  }

  const subjectKey = normalisedSubjectKey(phone);
  if (!subjectKey) {
    return {
      eligible: true,
      armed: true,
      measurable: false,
      laneKey: definition.laneKey,
      experimentId: definition.experimentId,
      armId: "treatment",
      reason: "invalid_subject_key_send_normally",
    };
  }

  try {
    const db = await getDbTyped();
    if (!db) {
      return {
        eligible: true,
        armed: true,
        measurable: false,
        laneKey: definition.laneKey,
        experimentId: definition.experimentId,
        armId: "treatment",
        reason: "db_unavailable_send_normally",
      };
    }

    const existing = await db
      .select({ armId: contactExperimentAssignments.armId })
      .from(contactExperimentAssignments)
      .where(and(
        eq(contactExperimentAssignments.experimentId, definition.experimentId),
        eq(contactExperimentAssignments.subjectKey, subjectKey),
      ))
      .limit(1);

    if (existing[0]) {
      const armId = existing[0].armId === "control" ? "control" : "treatment";
      return {
        eligible: true,
        armed: true,
        measurable: true,
        laneKey: definition.laneKey,
        experimentId: definition.experimentId,
        armId,
        reason: "existing_durable_assignment",
      };
    }

    const assigned = contactArmForSubject(definition.experimentId, subjectKey);

    // Race-safe. The unique(experiment_id, subject_key) constraint is the
    // authority; a concurrent writer wins and we read the durable row back.
    await db.execute(sql`
      INSERT IGNORE INTO contact_experiment_assignments
        (experiment_id, lane_key, subject_key, arm_id, assignment_version, source_variant_key)
      VALUES
        (${definition.experimentId}, ${definition.laneKey}, ${subjectKey},
         ${assigned}, ${CONTACT_HOLDOUT_VERSION}, ${definition.sourceVariantKey})
    `);

    const persisted = await db
      .select({ armId: contactExperimentAssignments.armId })
      .from(contactExperimentAssignments)
      .where(and(
        eq(contactExperimentAssignments.experimentId, definition.experimentId),
        eq(contactExperimentAssignments.subjectKey, subjectKey),
      ))
      .limit(1);

    if (!persisted[0]) {
      log.error("Contact holdout assignment insert had no readable durable row", {
        experimentId: definition.experimentId,
        laneKey: definition.laneKey,
        subjectSuffix: subjectKey.slice(-4),
      });
      return {
        eligible: true,
        armed: true,
        measurable: false,
        laneKey: definition.laneKey,
        experimentId: definition.experimentId,
        armId: "treatment",
        reason: "assignment_not_readable_send_normally",
      };
    }

    const armId = persisted[0].armId === "control" ? "control" : "treatment";
    return {
      eligible: true,
      armed: true,
      measurable: true,
      laneKey: definition.laneKey,
      experimentId: definition.experimentId,
      armId,
      reason: "durable_assignment_created",
    };
  } catch (err) {
    // Fail open to the existing send behavior. An experiment infrastructure
    // fault must never become an accidental customer suppression policy.
    log.error("Contact holdout assignment unavailable; sending normally", {
      experimentId: definition.experimentId,
      laneKey: definition.laneKey,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    });
    return {
      eligible: true,
      armed: true,
      measurable: false,
      laneKey: definition.laneKey,
      experimentId: definition.experimentId,
      armId: "treatment",
      reason: "assignment_error_send_normally",
    };
  }
}
