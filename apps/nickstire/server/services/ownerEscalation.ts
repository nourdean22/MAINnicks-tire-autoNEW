/**
 * Owner escalation — the one shape of thing Nick's Tire hands to StateNour.
 *
 * Contract (docs/ADMIN-LOOPS-ARCHAEOLOGY-BOUNDARY-2026-09-01.md §3.2): StateNour
 * holds the OBLIGATION and links back; the operational record stays here. The
 * receiver already exists — `POST /api/sync/nour-os` with `module: "open_loop"`
 * turns the event into a Task in the Inbox mission (title, description,
 * priority, source, domain). This module is the only nickstire code that
 * should post that shape, so the fields the contract requires are enforced
 * in one place.
 *
 * Never throws, never blocks: fire-and-forget with a 5s timeout, no-op when
 * STATENOUR_SYNC_KEY is unset. Carries no customer PII — an escalation names
 * the decision and where to make it, not the customer.
 */
import { createLogger } from "../lib/logger";
import { bridgeKey, IDEMPOTENCY_KEY_HEADER } from "./bridgeKeys";

const log = createLogger("owner-escalation");

export interface OwnerEscalation {
  /** The rule that fired, snake_case, stable (e.g. "campaign_draft_awaiting_send"). */
  trigger: string;
  /** One sentence. No customer names or phones. */
  summary: string;
  /** The exact choice being asked for. */
  decisionRequested: string;
  /** What happens on each choice, and on no choice by the deadline. */
  consequence: string;
  /** ISO time, shop TZ already applied by the caller, or null when open-ended. */
  deadline: string | null;
  /** Deep links back into /admin — the registry's ids/aliases are stable. */
  evidenceLinks: string[];
  /** Tier from docs/eval-rubrics/autonomous-action-tiers.md and who may decide. */
  authorization: { tier: 0 | 1 | 2 | 3; role: "owner" | "manager" };
  /** The nickstire mutation that consumes the decision — an escalation without one is a notification. */
  writeBack: string;
  priority?: "low" | "medium" | "high";
  /**
   * What the obligation is ABOUT (a draft id, a set of ids) — never a customer
   * name or phone. With `trigger` it forms the idempotency key
   * `v1:obligation.opened:<trigger>:<subjectId>` (ADR-0019 §4), so escalating
   * the same subject again is the same obligation and StateNour opens one
   * task, not one per call. Omitted, the post carries no key (legacy path).
   */
  subjectId?: string | number | { opaque: string };
}

function statenourTarget(): { url: string; key: string } | null {
  const key = process.env.STATENOUR_SYNC_KEY || "";
  if (!key) return null;
  const url = process.env.STATENOUR_SYNC_URL || "https://statenour-web-production.up.railway.app";
  return { url, key };
}

/**
 * Pure: the payload the receiver's `open_loop` case reads. Not exported — the
 * knip orphan gate treats a test-only export as unconsumed, and the test
 * reads the payload through escalateToOwner's fetch instead.
 */
function buildOpenLoopPayload(e: OwnerEscalation) {
  const links = e.evidenceLinks.length ? `\nOpen: ${e.evidenceLinks.join(" · ")}` : "";
  const deadline = e.deadline ? `\nDeadline: ${e.deadline}` : "";
  return {
    module: "open_loop" as const,
    data: {
      title: `[Nick's Tire] ${e.decisionRequested}`.slice(0, 150),
      description:
        `${e.summary}\n\nConsequence: ${e.consequence}${deadline}${links}` +
        `\nAuthorization: Tier ${e.authorization.tier}, ${e.authorization.role}` +
        `\nWrite-back: ${e.writeBack}` +
        `\nTrigger: ${e.trigger}`,
      priority: e.priority ?? (e.authorization.tier === 0 ? "high" : "medium"),
      source: "nickstire",
      domain: "shop",
    },
  };
}

export function escalateToOwner(e: OwnerEscalation, fetchImpl: typeof fetch = fetch): void {
  const target = statenourTarget();
  if (!target) {
    log.info("escalation not sent — STATENOUR_SYNC_KEY unset", { trigger: e.trigger });
    return;
  }
  const payload = buildOpenLoopPayload(e);
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-sync-key": target.key };
  const key = e.subjectId === undefined ? null : bridgeKey("obligation.opened", e.trigger, e.subjectId);
  if (key) headers[IDEMPOTENCY_KEY_HEADER] = key;
  else log.info("escalation sent without an idempotency key", { trigger: e.trigger, hasSubject: e.subjectId !== undefined });
  void fetchImpl(`${target.url}/api/sync/nour-os`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  })
    .then((res) => {
      if (!res.ok) log.warn("escalation rejected by StateNour", { trigger: e.trigger, status: res.status });
    })
    .catch((err) => log.warn("escalation failed", { trigger: e.trigger, err: err instanceof Error ? err.message : String(err) }));
}
