/**
 * DEMO fixtures for Home (/), shaped like the real tRPC outputs. Every title,
 * name and number is fictional and says so ("Demo ..."). Typed against the
 * builders' own exported contracts, so a contract change breaks `tsc` here
 * (a failing type is a fixture bug, not something to cast away).
 *
 * Home's four reads: operator.brief, operator.waitingSummary, operator.maxim,
 * operator.nickRemembersContext. operator.briefChanges is not stubbed: it is
 * only requested once a last-visit cursor exists, and a fresh browser has none.
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { OperatorBrief } from "@/lib/home/operator-brief";
import type { WaitingSummary } from "@/lib/home/waiting-summary";
import type { AppRouter } from "@/lib/trpc/root";

import { NOW_ISO } from "./time";

// The builder's attention budget (lead CTA + alternatives + visibleCap judgment rows) is kept in
// the payload as a receipt. Since W2 the page composes its own cap of seven rows from this brief
// (lib/home/brief-rows.ts): lead, two pending approvals, one "more" row, commitment, follow-up,
// contradiction, with the horizon left over.
export const HOME_BRIEF: OperatorBrief = {
  generatedAt: NOW_ISO,
  state: {
    health: { state: "healthy", detail: "Demo fixture: every demo probe answered." },
    summary: "Demo state: three approvals wait, one mission is blocked, and the day is on track.",
    queues: { measured: true, clear: false, inbox: 4, captures: 2, approvals: 3 },
  },
  lead: {
    kind: "execute",
    headline: "Demo brief: send the demo supplier quote",
    body: "Demo mission Alpha is the closest to done. One focused half hour sends the quote and frees the demo order that waits behind it.",
    cta: { label: "Start the demo quote", href: "/missions" },
    taskId: "demo-task-alpha-send",
    ledgerId: null,
    alternatives: [
      { label: "Demo task: review the demo floor plan", why: "Demo reason: due in a week, low effort", href: "/missions" },
      { label: "Demo task: file the demo license form", why: "Demo reason: has sat ready for six days", href: "/missions" },
    ],
    reasoning: [
      "Demo reason: due tomorrow, ranked first of eleven open tasks",
      "Demo reason: 30 minutes of effort against a 95 minute day",
    ],
  },
  judgment: {
    items: [
      {
        kind: "approvals",
        count: 3,
        expired: 1,
        oldestAgeMin: 310,
        href: "/system/actions?tab=approvals",
        // W2: the two oldest live rows are approvable in place; the third live one and the expired one
        // stay behind the Review link as "2 more".
        pending: [
          { id: "demo-approval-1", source: "request", title: "Demo request: send Demo Supplier A the revised quote" },
          { id: "demo-approval-2", source: "action", title: "Demo action: archive the stale demo inbox items" },
        ],
      },
      {
        kind: "commitment",
        id: 9001,
        description: "Demo commitment: call Demo Supplier A back by Friday",
        domain: "work",
        evidence: "proposed from a demo conversation",
      },
      { kind: "followup", id: "demo-followup-1", title: "Demo follow-up: ask Demo Contractor A about the floor plan" },
      {
        kind: "contradiction",
        count: 4,
        href: "/brain?tab=memory#contradictions",
      },
    ],
    visibleCap: 3,
    totalCount: 4,
    failedSources: [],
  },
  horizon: {
    slots: [
      { scope: "now", label: "Demo task: send the demo supplier quote", href: "/missions", source: "MIT" },
      { scope: "today", label: "Demo call with Demo Supplier A at 4:00 PM", href: "/missions", source: "calendar" },
      { scope: "week", label: "Demo mission Alpha: supplier quote", href: "/missions", source: "due date" },
      { scope: "later", label: "Demo goal: finish the demo floor layout", href: "/stats?tab=goals", source: "goal horizon" },
    ],
    measured: true,
  },
  budget: { visibleActionables: 6, cap: 7 },
};

const WAITING_BASE = { consequence: null, href: "/missions" } as const;

export const HOME_WAITING: WaitingSummary = {
  measuredAt: NOW_ISO,
  scope: "rail",
  me: { items: [], count: 0 },
  others: {
    items: [
      {
        ...WAITING_BASE,
        key: "task:demo-wait-bravo",
        owner: "others",
        subject: "Demo mission Bravo: floor plan sign-off",
        who: "Demo Contractor A",
        since: "2026-10-13T15:00:00.000Z",
        ageMin: 3060,
        deadline: "2026-10-20",
        nextAction: "Nudge Demo Contractor A",
        source: "task:demo-wait-bravo",
      },
      {
        ...WAITING_BASE,
        key: "task:demo-wait-vendor",
        owner: "others",
        subject: "Demo order: shelving delivery date",
        who: "Demo Vendor B",
        since: "2026-10-15T13:00:00.000Z",
        ageMin: 300,
        deadline: null,
        nextAction: "Check in with Demo Vendor B",
        source: "task:demo-wait-vendor",
      },
    ],
    count: 2,
  },
  system: {
    items: [
      {
        ...WAITING_BASE,
        key: "attempt:demo-nick-1",
        owner: "system",
        subject: "Demo draft: the weekly summary",
        who: "Nick",
        since: "2026-10-15T17:35:00.000Z",
        ageMin: 25,
        deadline: null,
        nextAction: "Wait for Nick to finish the demo draft",
        source: "action_attempt:demo-nick-1",
      },
    ],
    count: 1,
  },
  failedSources: [],
  staleSources: [],
  partial: false,
};

/**
 * No anticipated questions and no follow-ups: the follow-up ledger sync
 * mutation never fires. Typed against the router's own output (plain strings,
 * so the wire and the type agree).
 */
export const HOME_REMEMBERS: inferRouterOutputs<AppRouter>["operator"]["nickRemembersContext"] = {
  anticipatedQuestions: [],
  followUps: [],
};

// A Demo maxim, shaped like operator.maxim's output. Fictional like every fixture string (v3-gate.test.ts);
// the topic is the one the real pick gives for HOME_BRIEF's lead line ("...supplier quote" -> customers).
export const HOME_MAXIM: inferRouterOutputs<AppRouter>["operator"]["maxim"] = {
  id: "demo-maxims:1",
  text: "Demo maxim: call the demo customer back the same day.",
  source: "Demo Book",
  topic: "customers",
  position: 3,
  total: 40,
};
