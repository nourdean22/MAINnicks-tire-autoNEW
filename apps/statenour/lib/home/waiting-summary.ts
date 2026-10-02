/**
 * lib/home/waiting-summary.ts · 2026-10-02 · full-circle Lane B
 *
 * WHO IS WAITING ON WHOM — one projection over the state that already exists.
 * Nothing here is stored; every item names the row it rests on.
 *
 *   me      the next action is the operator's: a live approval, an action attempt
 *           parked on approval, a proposed commitment to accept or decline, a
 *           promise owed to someone else, a customer waiting on the shop (a
 *           callback or an urgent lead read through the Nick's Tire bridge)
 *   others  the operator asked someone and waits: a task whose `waitingOn`
 *           names a person or vendor (the Missions deck's own blocked lane)
 *   system  the machine owns the next step: a task delegated to Nick, an action
 *           attempt still executing
 *
 * Rules (the empty-vs-error skill, same as lib/system/owner-panel.ts):
 *   · a failed read is named in `failedSources` and every bucket it feeds has
 *     `count: null` — unknown is not zero;
 *   · a bridge answer that is itself an error (`{ error: "No DB" }` inside a 200)
 *     is a failed read, not an empty shop;
 *   · a bridge answer older than BRIDGE_STALE_MS is listed in `staleSources`;
 *   · `since` is the best time the source carries: a task's last update (the deck
 *     uses the same approximation), an approval's creation, a callback's
 *     creation; it is never invented;
 *   · nothing here decides priority — it tells the truth about ownership and age
 *     so Home and Missions can rank from the same facts.
 *
 * Canary: tests/home/waiting-summary.test.ts.
 */

export type WaitingOwner = "me" | "others" | "system";

export interface WaitingItem {
  key: string;
  owner: WaitingOwner;
  /** What is waiting. */
  subject: string;
  /** Who holds the next action: "you", a person or vendor, "Nick", a tool. */
  who: string;
  since: string | null;
  ageMin: number | null;
  /** A hard date when the source has one (approval expiry ISO, commitment deadline YYYY-MM-DD). */
  deadline: string | null;
  /** Why it matters, taken from the source — never invented. */
  consequence: string | null;
  nextAction: string;
  href: string | null;
  /** Table + row the item rests on, so it can be checked by hand. */
  source: string;
}

export interface WaitingBucket {
  items: WaitingItem[];
  /** null when a source feeding this bucket failed: the count is unknown, not zero. */
  count: number | null;
}

export interface WaitingSummary {
  measuredAt: string;
  scope: string;
  me: WaitingBucket;
  others: WaitingBucket;
  system: WaitingBucket;
  failedSources: string[];
  staleSources: string[];
  partial: boolean;
}

export interface WaitingTaskLite {
  id: string;
  title: string;
  status: string;
  waitingOn: string | null;
  updatedAt: Date;
  dueDate: Date | null;
}
export interface WaitingApprovalRequestLite {
  id: string;
  actionType: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
}
export interface WaitingPendingActionLite {
  id: string;
  ruleName: string;
  actionType: string;
  createdAt: Date;
  expired: boolean;
}
export interface WaitingCommitmentLite {
  id: number;
  description: string;
  toWhom: string;
  deadline: string | null;
  status: string;
  dateMade: string;
}
export interface WaitingActionAttemptLite {
  id: string;
  tool: string;
  operationKey: string;
  state: string;
  reason: string | null;
  startedAt: Date;
}
export interface BridgeCallbackRow {
  id: string | number;
  name: string | null;
  phone: string | null;
  reason: string | null;
  createdAt: string | Date | null;
}
export interface BridgeLeadRow {
  id: string | number;
  name: string | null;
  phone: string | null;
  urgencyScore: number | null;
  urgencyReason: string | null;
  createdAt: string | Date | null;
}
/** One bridge query, normalised: the shop answered with rows, or the read failed. */
export type BridgeRead<T> =
  | { ok: true; rows: T[]; timestamp: string | null }
  | { ok: false; error: string };

/** null = that read FAILED. [] = it succeeded and found nothing. */
export interface WaitingInput {
  now: Date;
  /** Today in ET, YYYY-MM-DD — commitment deadlines are ET calendar dates. */
  todayYmd: string;
  /** Open tasks (not DONE / ARCHIVED, not deleted) with a non-empty `waitingOn`. */
  tasks: WaitingTaskLite[] | null;
  /** LIVE approval requests only (expiresAt in the future). */
  approvalRequests: WaitingApprovalRequestLite[] | null;
  pendingActions: WaitingPendingActionLite[] | null;
  /** Commitments in proposed / accepted / active, not deleted. */
  commitments: WaitingCommitmentLite[] | null;
  /** Attempts in WAITING_APPROVAL or EXECUTING. */
  actionAttempts: WaitingActionAttemptLite[] | null;
  /** null = the bridge itself was unreachable (no key, timeout, transport failure). */
  bridge: { callbacks: BridgeRead<BridgeCallbackRow>; urgentLeads: BridgeRead<BridgeLeadRow> } | null;
}

export const SCOPE =
  "statenour approvals · action attempts · commitments · tasks with waitingOn · Nick's Tire bridge (callbacks_pending, leads_urgent)";
/** A shop answer older than this is listed as stale: a callback queue is a minutes-fresh fact. */
export const BRIDGE_STALE_MS = 15 * 60_000;
export const BUCKET_CAP = 50;

const clip = (s: string | null | undefined, n = 120): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length === 0 ? null : t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

function item(now: Date, base: Omit<WaitingItem, "ageMin" | "since"> & { since: Date | null }): WaitingItem {
  return {
    ...base,
    since: base.since ? base.since.toISOString() : null,
    ageMin: base.since ? Math.max(0, Math.round((now.getTime() - base.since.getTime()) / 60_000)) : null,
  };
}

const isSelf = (toWhom: string): boolean => {
  const t = toWhom.trim().toLowerCase();
  return t === "" || t === "self" || t === "me" || t === "myself";
};

export function composeWaitingSummary(input: WaitingInput): WaitingSummary {
  const { now } = input;
  const failedSources: string[] = [];
  const staleSources: string[] = [];
  const me: WaitingItem[] = [];
  const others: WaitingItem[] = [];
  const system: WaitingItem[] = [];
  // Which buckets a failed source makes unknowable.
  let meUnknown = false;
  let othersUnknown = false;
  let systemUnknown = false;

  // ── approvals → me ──────────────────────────────────────────────────
  if (input.approvalRequests === null || input.pendingActions === null) {
    failedSources.push("approvals");
    meUnknown = true;
  } else {
    for (const r of input.approvalRequests) {
      if (r.expiresAt.getTime() <= now.getTime()) continue; // expired between the read and now: the Owner Panel owns that
      me.push(
        item(now, {
          key: `request:${r.id}`,
          owner: "me",
          subject: `approve ${r.actionType}?`,
          who: "you",
          since: r.createdAt,
          deadline: r.expiresAt.toISOString(),
          consequence: clip(r.reason),
          nextAction: "approve or dismiss on /system/actions",
          href: "/system/actions",
          source: `approval_requests ${r.id}`,
        }),
      );
    }
    for (const a of input.pendingActions) {
      if (a.expired) continue;
      me.push(
        item(now, {
          key: `action:${a.id}`,
          owner: "me",
          subject: `approve ${a.actionType}?`,
          who: "you",
          since: a.createdAt,
          deadline: null,
          consequence: `rule ${a.ruleName}`,
          nextAction: "approve or dismiss on /system/actions",
          href: "/system/actions",
          source: `autonomous_actions ${a.id}`,
        }),
      );
    }
  }

  // ── action attempts → me (parked on approval) or system (executing) ──
  if (input.actionAttempts === null) {
    failedSources.push("action attempts");
    meUnknown = true;
    systemUnknown = true;
  } else {
    for (const a of input.actionAttempts) {
      if (a.state === "WAITING_APPROVAL") {
        me.push(
          item(now, {
            key: `attempt:${a.id}`,
            owner: "me",
            subject: `approve ${a.tool}?`,
            who: "you",
            since: a.startedAt,
            deadline: null,
            consequence: clip(a.reason),
            nextAction: "approve or dismiss on /system/actions",
            href: "/system/actions",
            source: `action_attempts ${a.id}`,
          }),
        );
      } else if (a.state === "EXECUTING") {
        system.push(
          item(now, {
            key: `attempt:${a.id}`,
            owner: "system",
            subject: `${a.tool} is executing`,
            who: a.tool,
            since: a.startedAt,
            deadline: null,
            consequence: clip(a.reason) ?? clip(a.operationKey, 80),
            nextAction: "nothing yet; the Owner Panel flags it if still executing after 30 min",
            href: "/system/logs",
            source: `action_attempts ${a.id}`,
          }),
        );
      }
    }
  }

  // ── tasks with waitingOn → others, or system when delegated to Nick ──
  if (input.tasks === null) {
    failedSources.push("tasks");
    othersUnknown = true;
    systemUnknown = true;
  } else {
    for (const t of input.tasks) {
      const who = (t.waitingOn ?? "").trim();
      if (!who || t.status === "DONE" || t.status === "ARCHIVED") continue;
      const due = t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null;
      if (who.toLowerCase() === "nick") {
        system.push(
          item(now, {
            key: `task:${t.id}`,
            owner: "system",
            subject: clip(t.title, 100) ?? t.id,
            who: "Nick",
            since: t.updatedAt,
            deadline: due,
            consequence: null,
            nextAction: "check Nick's desk on /missions",
            href: "/missions",
            source: `tasks ${t.id} · since its last update`,
          }),
        );
      } else {
        others.push(
          item(now, {
            key: `task:${t.id}`,
            owner: "others",
            subject: clip(t.title, 100) ?? t.id,
            who,
            since: t.updatedAt,
            deadline: due,
            consequence: due && due < input.todayYmd ? `due ${due}, already past` : null,
            nextAction: `nudge ${who}, or unblock it yourself`,
            href: "/missions",
            source: `tasks ${t.id} · since its last update`,
          }),
        );
      }
    }
  }

  // ── commitments → me: proposed (decide) or a promise owed to someone ──
  if (input.commitments === null) {
    failedSources.push("commitments");
    meUnknown = true;
  } else {
    for (const c of input.commitments) {
      const desc = clip(c.description, 100) ?? `#${c.id}`;
      const overdue = Boolean(c.deadline && /^\d{4}-\d{2}-\d{2}$/.test(c.deadline) && c.deadline < input.todayYmd);
      if (c.status === "proposed") {
        me.push(
          item(now, {
            key: `commitment:${c.id}`,
            owner: "me",
            subject: `accept or decline: ${desc}`,
            who: "you",
            since: toDate(c.dateMade),
            deadline: c.deadline,
            consequence: isSelf(c.toWhom) ? null : `proposed to ${c.toWhom}`,
            nextAction: "accept, renegotiate or decline",
            href: null,
            source: `commitments #${c.id}`,
          }),
        );
        continue;
      }
      if (c.status !== "active" && c.status !== "accepted") continue;
      if (isSelf(c.toWhom)) continue; // a promise to yourself is Missions' work, not someone waiting on you
      me.push(
        item(now, {
          key: `commitment:${c.id}`,
          owner: "me",
          subject: `promise to ${c.toWhom}: ${desc}`,
          who: "you",
          since: toDate(c.dateMade),
          deadline: c.deadline,
          consequence: overdue ? `overdue since ${c.deadline}` : null,
          nextAction: overdue ? `deliver or renegotiate with ${c.toWhom}` : `deliver by ${c.deadline ?? "the agreed date"}`,
          href: null,
          source: `commitments #${c.id}`,
        }),
      );
    }
  }

  // ── Nick's Tire bridge → me: customers waiting on the shop ──────────
  if (input.bridge === null) {
    failedSources.push("nickstire bridge");
    meUnknown = true;
  } else {
    const { callbacks, urgentLeads } = input.bridge;
    if (!callbacks.ok) {
      failedSources.push(`nickstire callbacks_pending (${callbacks.error})`);
      meUnknown = true;
    } else {
      if (isStale(callbacks.timestamp, now)) staleSources.push("nickstire callbacks_pending");
      for (const r of callbacks.rows) {
        const name = clip(r.name, 60) ?? "a customer";
        me.push(
          item(now, {
            key: `callback:${r.id}`,
            owner: "me",
            subject: `call back ${name}`,
            who: "you",
            since: toDate(r.createdAt),
            deadline: null,
            consequence: clip(r.reason) ?? "customer asked for a call",
            nextAction: r.phone ? `call ${r.phone}` : "call the customer from the shop admin",
            href: null,
            source: `nickstire callback_requests ${r.id}`,
          }),
        );
      }
    }
    if (!urgentLeads.ok) {
      failedSources.push(`nickstire leads_urgent (${urgentLeads.error})`);
      meUnknown = true;
    } else {
      if (isStale(urgentLeads.timestamp, now)) staleSources.push("nickstire leads_urgent");
      for (const r of urgentLeads.rows) {
        const name = clip(r.name, 60) ?? "a lead";
        me.push(
          item(now, {
            key: `lead:${r.id}`,
            owner: "me",
            subject: `urgent lead · ${name}${r.urgencyScore != null ? ` (urgency ${r.urgencyScore})` : ""}`,
            who: "you",
            since: toDate(r.createdAt),
            deadline: null,
            consequence: clip(r.urgencyReason) ?? "flagged urgent by the shop",
            nextAction: r.phone ? `call ${r.phone}` : "follow up from the shop admin",
            href: null,
            source: `nickstire leads ${r.id}`,
          }),
        );
      }
    }
  }

  // me: the hard deadline first, then the oldest; others/system: the oldest first.
  const byAge = (a: WaitingItem, b: WaitingItem) => (b.ageMin ?? -1) - (a.ageMin ?? -1);
  me.sort((a, b) => {
    if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : byAge(a, b);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return byAge(a, b);
  });
  others.sort(byAge);
  system.sort(byAge);

  const bucket = (items: WaitingItem[], unknown: boolean): WaitingBucket => ({
    items: items.slice(0, BUCKET_CAP),
    count: unknown ? null : items.length,
  });

  return {
    measuredAt: now.toISOString(),
    scope: SCOPE,
    me: bucket(me, meUnknown),
    others: bucket(others, othersUnknown),
    system: bucket(system, systemUnknown),
    failedSources,
    staleSources,
    partial: failedSources.length > 0,
  };
}

function isStale(timestamp: string | null, now: Date): boolean {
  const t = toDate(timestamp);
  return t !== null && now.getTime() - t.getTime() > BRIDGE_STALE_MS;
}

/**
 * Normalise one `queryNick` answer. The shop's handlers return `{ error: "No DB" }`
 * INSIDE a 200 when their database is down, so an error in `data` is a failed
 * read too — never an empty queue.
 */
export function normalizeBridgeRead<T>(raw: unknown, rowsKey: string): BridgeRead<T> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "no answer" };
  const r = raw as Record<string, unknown>;
  if (typeof r.error === "string") return { ok: false, error: r.error };
  const data = r.data;
  if (!data || typeof data !== "object") return { ok: false, error: "no data" };
  const d = data as Record<string, unknown>;
  if (typeof d.error === "string") return { ok: false, error: d.error };
  const rows = d[rowsKey];
  if (!Array.isArray(rows)) return { ok: false, error: `no ${rowsKey} array` };
  return { ok: true, rows: rows as T[], timestamp: typeof r.timestamp === "string" ? r.timestamp : null };
}
