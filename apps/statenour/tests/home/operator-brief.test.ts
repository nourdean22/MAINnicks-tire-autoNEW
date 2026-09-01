/**
 * operator-brief · the Command Surface intelligence layer's pure decisions.
 *
 * The heavy composition (buildOperatorBrief) is guarded per-source and
 * exercised live; what gets pinned here are the DECISIONS — lead mapping,
 * the attention-budget arithmetic, the state sentence, horizon dedupe —
 * via __testInternals (the operator-state.ts precedent). Canary discipline:
 * each rule is exercised with a fixture that would VIOLATE it if the code
 * regressed, not just a happy path.
 */
import { describe, it, expect } from "vitest";

import {
  __testInternals,
  ATTENTION_CAP,
  JUDGMENT_VISIBLE_CAP,
  type BriefLeadSection,
} from "@/lib/home/operator-brief";
import { deriveBriefing, type BriefingInputs } from "@/lib/home/derive-briefing";

const { mapLead, composeStateSummary, buildHorizon, startOfEtDay } = __testInternals;

const baseInputs: BriefingInputs = {
  loading: false,
  unreadable: false,
  doingTask: null,
  resumeTask: null,
  pendingDecisions: 0,
  findingsCount: 0,
  inboxCount: 0,
  criticalFew: [],
};

const CRITICAL = [
  { id: "t1", title: "Ship the homepage", roiScore: 90, effort: "M60", energyRequired: "HIGH", domain: "BUSINESS", lane: "focus" as const, reason: "highest computed priority" },
  { id: "t2", title: "Lift financial axis", roiScore: 70, effort: "M30", energyRequired: "MED", domain: "FINANCE", lane: "weakest" as const, reason: "lifts weakest axis" },
  { id: "t3", title: "Reply to Dania", roiScore: 40, effort: "M5", energyRequired: "LOW", domain: "PERSONAL", lane: "quick" as const, reason: "low effort momentum" },
];

const leadFor = (inputs: Partial<BriefingInputs>, ctx?: Partial<Parameters<typeof mapLead>[1]>) =>
  mapLead(deriveBriefing({ ...baseInputs, ...inputs }), {
    activeRaw: null,
    resumeRaw: null,
    nextMove: { weakestDomain: null, rationale: null, suggestions: [], criticalFew: CRITICAL },
    pendingDecisions: 0,
    ...ctx,
  });

describe("attention budget — the hard rule", () => {
  it("the constants themselves cannot exceed the cap (1 CTA + 2 alts + visible judgment ≤ 7)", () => {
    // If someone raises JUDGMENT_VISIBLE_CAP or the alternatives bound
    // without rethinking the budget, this is the tripwire.
    expect(1 + 2 + JUDGMENT_VISIBLE_CAP).toBeLessThanOrEqual(ATTENTION_CAP);
  });

  it("no arm ever emits more than 2 alternatives, even with a long ranked list", () => {
    const arms: Array<Partial<BriefingInputs>> = [
      { criticalFew: CRITICAL },                          // nominal target
      { doingTask: { title: "deep work", loopKind: "ONCE" } }, // active
      { resumeTask: { title: "old loop", loopKind: "ONCE" } }, // resume
      { pendingDecisions: 4 },                            // decide
      { findingsCount: 5 },                               // hygiene
      { inboxCount: 9 },                                  // triage
      {},                                                  // suggestions/idle
      { unreadable: true },                               // error
    ];
    for (const arm of arms) {
      const lead = leadFor(arm, {
        activeRaw: arm.doingTask ? { id: "a", title: "deep work", loopKind: "ONCE", startedAt: null, updatedAt: new Date() } : null,
        resumeRaw: arm.resumeTask ? { id: "r", title: "old loop", loopKind: "ONCE", startedAt: null, updatedAt: new Date() } : null,
        pendingDecisions: arm.pendingDecisions ?? 0,
      });
      expect(lead.alternatives.length, JSON.stringify(arm)).toBeLessThanOrEqual(2);
      // ≤ 1 CTA is structural (the type), but pin the arithmetic anyway:
      expect((lead.cta ? 1 : 0) + lead.alternatives.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("lead mapping — receipts, not confidence theater", () => {
  it("the nominal target carries the scorer's REAL reason and no invented percentage", () => {
    const lead = leadFor({ criticalFew: CRITICAL });
    expect(lead.kind).toBe("execute");
    expect(lead.cta?.href).toBe("/missions#task-t1");
    expect(lead.reasoning.join(" ")).toContain("highest computed priority");
    // No fabricated confidence anywhere in the visible strings.
    const visible = [lead.headline, lead.body, ...lead.reasoning, ...lead.alternatives.map((a) => a.why)].join(" ");
    expect(visible).not.toMatch(/\d+\s?% confidence/i);
  });

  it("alternatives exclude the lead task itself (no self-alternative)", () => {
    const lead = leadFor({ criticalFew: CRITICAL });
    expect(lead.alternatives.map((a) => a.label)).not.toContain("Ship the homepage");
    expect(lead.alternatives.length).toBe(2);
  });

  it("an active engagement deep-links the DOING task and offers ranked alternatives", () => {
    const lead = leadFor(
      { doingTask: { title: "deep work", loopKind: "ONCE" }, criticalFew: CRITICAL },
      { activeRaw: { id: "a9", title: "deep work", loopKind: "ONCE", startedAt: null, updatedAt: new Date() } },
    );
    expect(lead.kind).toBe("execute");
    expect(lead.taskId).toBe("a9");
    expect(lead.cta?.href).toBe("/missions#task-a9");
  });

  it("the decide arm routes to /system/actions — Home never re-hosts approval verdicts", () => {
    const lead = leadFor({ pendingDecisions: 3 }, { pendingDecisions: 3 });
    expect(lead.kind).toBe("decide");
    expect(lead.cta?.href).toBe("/system/actions");
  });

  it("the error arm refuses to recommend and says why", () => {
    const lead = leadFor({ unreadable: true });
    expect(lead.kind).toBe("error");
    expect(lead.alternatives).toEqual([]);
    expect(lead.reasoning.join(" ")).toContain("unreadable");
  });
});

describe("state sentence — measured claims only", () => {
  const healthy = { state: "healthy" as const, detail: "" };
  const unknown = { state: "unknown" as const, detail: "" };
  const nominal = deriveBriefing({ ...baseInputs, criticalFew: CRITICAL });

  it("'operationally clear' requires measured-clear queues AND healthy system", () => {
    const s = composeStateSummary({
      briefing: nominal, health: healthy, queuesMeasured: true, queuesClear: true,
      judgmentCount: 0, activeTitle: null,
    });
    expect(s).toContain("operationally clear");
  });

  it("clear queues + UNMEASURED health must NOT claim clear — it says health is unmeasured", () => {
    const s = composeStateSummary({
      briefing: nominal, health: unknown, queuesMeasured: true, queuesClear: true,
      judgmentCount: 0, activeTitle: null,
    });
    expect(s).not.toContain("operationally clear");
    expect(s.toLowerCase()).toContain("not yet measured");
  });

  it("unmeasured queues never read as quiet", () => {
    const s = composeStateSummary({
      briefing: nominal, health: healthy, queuesMeasured: false, queuesClear: false,
      judgmentCount: 0, activeTitle: null,
    });
    expect(s.toLowerCase()).toContain("could not be read");
  });

  it("an unreadable board overrides everything", () => {
    const err = deriveBriefing({ ...baseInputs, unreadable: true });
    const s = composeStateSummary({
      briefing: err, health: healthy, queuesMeasured: true, queuesClear: true,
      judgmentCount: 0, activeTitle: null,
    });
    expect(s.toLowerCase()).toContain("unreadable");
  });
});

describe("horizon — one pointer per scope, deduped against the lead", () => {
  const start = new Date("2026-09-01T04:00:00.000Z"); // midnight ET
  const end = new Date(start.getTime() + 86_400_000);

  const emptyLead: BriefLeadSection = {
    kind: "suggestions", headline: "", body: "", cta: null, taskId: null, alternatives: [], reasoning: [],
  };

  it("MIT outranks calendar and due-tasks for the TODAY slot", () => {
    const h = buildHorizon({
      lead: emptyLead,
      mitText: "Finish the homepage",
      dueTasks: [{ id: "d1", title: "Call vendor", dueDate: new Date(start.getTime() + 3600_000) }],
      weekGoals: [], laterGoals: [],
      calendarUpcoming: [{ content: "Event: Gym session\nWhen: x", metadata: { start: new Date(start.getTime() + 7200_000).toISOString() } }],
      startOfToday: start, endOfToday: end, measured: true,
    });
    const today = h.slots.find((s) => s.scope === "today");
    expect(today?.label).toBe("Finish the homepage");
    expect(today?.source).toBe("MIT");
  });

  it("a task already claimed by TODAY never repeats in WEEK; LATER falls to the furthest goal", () => {
    const h = buildHorizon({
      lead: emptyLead,
      mitText: null,
      dueTasks: [
        { id: "d1", title: "Call vendor", dueDate: new Date(start.getTime() + 3600_000) },
        { id: "d2", title: "Hiring review", dueDate: new Date(start.getTime() + 3 * 86_400_000) },
      ],
      weekGoals: [{ id: "g1", title: "Call vendor", deadline: null }], // same title — must be skipped
      laterGoals: [{ id: "g2", title: "Open the second location", horizon: "YEAR", deadline: null }],
      calendarUpcoming: [],
      startOfToday: start, endOfToday: end, measured: true,
    });
    expect(h.slots.find((s) => s.scope === "today")?.label).toBe("Call vendor");
    expect(h.slots.find((s) => s.scope === "week")?.label).toBe("Hiring review");
    expect(h.slots.find((s) => s.scope === "later")?.label).toBe("Open the second location");
    // No label appears twice across scopes.
    const labels = h.slots.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("all-reads-failed renders as unmeasured, not as an empty (quiet) horizon", () => {
    const h = buildHorizon({
      lead: emptyLead, mitText: null, dueTasks: [], weekGoals: [], laterGoals: [],
      calendarUpcoming: [], startOfToday: start, endOfToday: end, measured: false,
    });
    expect(h.measured).toBe(false);
  });

  it("a task the LEAD already recommends never repeats in a horizon slot", () => {
    const leadOnTask: BriefLeadSection = {
      kind: "execute",
      headline: "Ship the homepage", // nominal arm puts the task title here
      body: "",
      cta: { label: "Start", href: "/missions#task-t1" },
      taskId: "t1",
      alternatives: [],
      reasoning: [],
    };
    const h = buildHorizon({
      lead: leadOnTask,
      mitText: null,
      dueTasks: [{ id: "t1", title: "Ship the homepage", dueDate: new Date(start.getTime() + 3600_000) }],
      weekGoals: [], laterGoals: [], calendarUpcoming: [],
      startOfToday: start, endOfToday: end, measured: true,
    });
    expect(h.slots.find((s) => s.label === "Ship the homepage")).toBeUndefined();
  });

  it("day boundaries are ET-anchored UTC instants, not server-local midnight", () => {
    // 2026-09-01T12:00Z is 8am EDT (UTC-4): the ET day started at 04:00Z.
    const noonZ = new Date("2026-09-01T12:00:00.000Z");
    expect(startOfEtDay(noonZ).toISOString()).toBe("2026-09-01T04:00:00.000Z");
    // 2026-09-02T02:00Z is still Sep 1 in ET (10pm EDT) — the ET day is
    // unchanged. A naive UTC setHours(0,0,0,0) would have rolled to Sep 2.
    const lateZ = new Date("2026-09-02T02:00:00.000Z");
    expect(startOfEtDay(lateZ).toISOString()).toBe("2026-09-01T04:00:00.000Z");
  });

  it("a malformed calendar row (no metadata.start) is skipped, not crashed on", () => {
    const h = buildHorizon({
      lead: emptyLead, mitText: null, dueTasks: [], weekGoals: [], laterGoals: [],
      calendarUpcoming: [
        { content: "Event: broken", metadata: null },
        { content: "Event: Standup\nWhen: x", metadata: { start: new Date(start.getTime() + 3600_000).toISOString() } },
      ],
      startOfToday: start, endOfToday: end, measured: true,
    });
    expect(h.slots.find((s) => s.scope === "today")?.label).toContain("Standup");
  });
});
