/**
 * DEMO fixtures for Missions (/missions): the deck, the task list and the
 * mission list the page reads (task.deck, task.list, task.missions). Every
 * title and name is fictional and says so. The deck is typed against
 * MissionsDeck; the two lists against the ROUTER outputs as they arrive on the
 * wire (Wire<inferRouterOutputs<AppRouter>["task"]["list" | "missions"]>); the
 * mission list is additionally checked against the page's client Project
 * contract, which the page casts the router output to.
 *
 * The mix is deliberate: two active missions at different progress, a done
 * mission-task pair, a blocked (WAITING) task per mission, a task handed to
 * Nick, two domain lanes, two rhythms and a three-row triage airlock.
 * operator.commandCenterState is not stubbed: the page only reads the active
 * command id from it, and renders nothing when it is absent.
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { Project } from "@/components/actions/shared";
import type { MissionsDeck } from "@/lib/missions/deck";
import type { AppRouter } from "@/lib/trpc/root";

import type { Wire } from "./wire";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type WireTask = Wire<RouterOutputs["task"]["list"]>[number];
/**
 * listMissions' declared element type is the demo-store DemoMission; the Prisma
 * rows it really returns also carry systemKind and canonicalDomain (the GENERAL
 * lane markers isUserProject/isGeneralAnchor read), which the client Project
 * contract declares and the service type does not.
 */
export type WireMission = Wire<RouterOutputs["task"]["missions"]>[number] & Pick<Project, "systemKind" | "canonicalDomain">;

const ALPHA = "demo-mission-alpha";
const BRAVO = "demo-mission-bravo";
const LANE_ADMIN = "demo-lane-admin";
const LANE_HEALTH = "demo-lane-health";

export const ALPHA_TITLE = "Demo mission Alpha: supplier quote";
const BRAVO_TITLE = "Demo mission Bravo: shop floor layout";
/** The hero task of the deck; the smoke spec waits for this exact title. */
export const NEXT_MOVE_TITLE = "Demo task: send the demo supplier quote";

type Status = "READY" | "DOING" | "WAITING" | "DONE";

const MISSION_BASE: Omit<WireMission, "id" | "title" | "tasks" | "openTaskCount"> = {
  domain: "work",
  status: "ACTIVE",
  priority: 3,
  roiScore: 5,
  neglectCost: 2,
  successMetric: null,
  deadline: null,
  weeklyReviewNote: null,
  manualRankOverride: null,
  createdAt: "2026-10-01T14:00:00.000Z",
  updatedAt: "2026-10-15T15:20:00.000Z",
  rank: null,
  rankScore: null,
  rankExplanation: null,
  systemKind: null,
  canonicalDomain: null,
};

const missionLite = (id: string, title: string): Wire<WireTask["mission"]> => ({
  ...MISSION_BASE,
  id,
  title,
});

function task(id: string, missionId: string, missionTitle: string, title: string, status: Status, extra: Partial<WireTask> = {}): WireTask {
  return {
    id,
    title,
    missionId,
    status,
    nextPhysicalAction: `Demo first step: ${title.replace(/^Demo task: /, "")}`,
    effort: "M30",
    roiScore: 5,
    frictionScore: 2,
    energyRequired: "MEDIUM",
    context: "ANYWHERE",
    delegatable: false,
    waitingOn: null,
    dueDate: null,
    lastTouchedAt: null,
    driftRisk: 0,
    autoPriority: 50,
    manualPriorityOverride: null,
    autoPriorityExplanation: null,
    finishCondition: "",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-14T14:00:00.000Z",
    mission: missionLite(missionId, missionTitle),
    effectivePriority: 50,
    effectivePriorityExplanation: "demo: priority held at its default",
    missionRank: null,
    stale: false,
    originSource: null,
    ...extra,
  };
}

export const MISSION_TASKS: WireTask[] = [
  // Alpha: 2 done, 1 doing, 2 ready, 1 handed to Nick.
  task("demo-task-alpha-gather", ALPHA, ALPHA_TITLE, "Demo task: gather the demo part numbers", "DONE", { updatedAt: "2026-10-15T13:10:00.000Z" }),
  task("demo-task-alpha-call", ALPHA, ALPHA_TITLE, "Demo task: confirm the demo supplier call", "DONE", { updatedAt: "2026-10-15T15:20:00.000Z" }),
  task("demo-task-alpha-send", ALPHA, ALPHA_TITLE, NEXT_MOVE_TITLE, "DOING", {
    autoPriority: 82,
    effectivePriority: 82,
    dueDate: "2026-10-16T04:00:00.000Z",
    lastTouchedAt: "2026-10-15T14:40:00.000Z",
  }),
  task("demo-task-alpha-terms", ALPHA, ALPHA_TITLE, "Demo task: draft the demo payment terms", "READY", { effort: "H1", dueDate: "2026-10-20T04:00:00.000Z" }),
  task("demo-task-alpha-photos", ALPHA, ALPHA_TITLE, "Demo task: photograph the demo samples", "READY", { effort: "M15" }),
  task("demo-task-alpha-summary", ALPHA, ALPHA_TITLE, "Demo task: write the demo weekly summary", "WAITING", {
    waitingOn: "Nick",
    updatedAt: "2026-10-15T17:35:00.000Z",
  }),
  // Bravo: 1 done, 2 ready, 1 blocked on a person.
  task("demo-task-bravo-measure", BRAVO, BRAVO_TITLE, "Demo task: measure the demo floor", "DONE", { updatedAt: "2026-10-14T18:00:00.000Z" }),
  task("demo-task-bravo-plan", BRAVO, BRAVO_TITLE, "Demo task: review the demo floor plan", "READY", { dueDate: "2026-10-22T04:00:00.000Z" }),
  task("demo-task-bravo-shelving", BRAVO, BRAVO_TITLE, "Demo task: choose the demo shelving", "READY", { effort: "H1" }),
  task("demo-task-bravo-signoff", BRAVO, BRAVO_TITLE, "Demo task: get the demo floor plan signed off", "WAITING", {
    waitingOn: "Demo Contractor A",
    updatedAt: "2026-10-13T15:00:00.000Z",
  }),
  // Domain lanes (GENERAL anchors): classified work with no project of its own.
  task("demo-task-admin-license", LANE_ADMIN, "Demo lane: Admin", "Demo task: file the demo license form", "READY", {
    effort: "M15",
    updatedAt: "2026-10-09T14:00:00.000Z",
    stale: true,
  }),
  task("demo-task-admin-receipts", LANE_ADMIN, "Demo lane: Admin", "Demo task: sort the demo receipts", "READY"),
  task("demo-task-health-checkup", LANE_HEALTH, "Demo lane: Health", "Demo task: book the demo checkup", "READY", { effort: "M5" }),
  // Triage airlock: no mission yet.
  task("demo-task-triage-shelving", "", "Demo inbox", "Demo task: order demo shelving brackets", "READY", { autoPriority: null }),
  task("demo-task-triage-sign", "", "Demo inbox", "Demo task: reprint the demo door sign", "READY", { autoPriority: null }),
];

/**
 * NOT checked against the client Task contract: the wire's `dueDate` is
 * `string | null` (DemoTask) while components/actions/shared Task declares
 * `dueDate?: string`, and the page papers over it with `as Task[]`
 * (use-missions-data.ts). Found 2026-10-15 while typing these fixtures;
 * adjacent rot, reported, not fixed here.
 */

function mission(id: string, title: string, extra: Partial<WireMission> = {}): WireMission {
  const own = MISSION_TASKS.filter((t) => t.missionId === id).map((t) => ({ id: t.id, status: t.status }));
  return {
    ...MISSION_BASE,
    id,
    title,
    tasks: own,
    openTaskCount: own.filter((t) => t.status !== "DONE").length,
    ...extra,
  };
}

export const MISSIONS: WireMission[] = [
  mission(ALPHA, ALPHA_TITLE, { deadline: "2026-10-22T04:00:00.000Z", manualRankOverride: 1, rank: 1, rankScore: 80 }),
  mission(BRAVO, BRAVO_TITLE, { deadline: "2026-11-05T05:00:00.000Z", manualRankOverride: 2, rank: 2, rankScore: 60 }),
  mission(LANE_ADMIN, "Demo lane: Admin", { domain: "admin", systemKind: "GENERAL", canonicalDomain: "admin" }),
  mission(LANE_HEALTH, "Demo lane: Health", { domain: "health", systemKind: "GENERAL", canonicalDomain: "health" }),
];

/** The page casts task.missions to its client Project contract as well. */
export const MISSIONS_AS_CLIENT: Project[] = MISSIONS;

function ref(t: WireTask, score: number, why: string): NonNullable<MissionsDeck["nextMove"]>["task"] {
  return {
    id: t.id,
    title: t.title,
    nextPhysicalAction: t.nextPhysicalAction,
    effort: t.effort,
    effortMinutes: t.effort === "H1" ? 60 : t.effort === "M15" ? 15 : t.effort === "M5" ? 5 : 30,
    energyRequired: t.energyRequired,
    status: t.status,
    dueDate: t.dueDate,
    missionId: t.missionId,
    missionTitle: t.mission.title,
    score,
    why,
  };
}

const byId = (id: string): WireTask => {
  const found = MISSION_TASKS.find((t) => t.id === id);
  if (!found) throw new Error(`fixture task ${id} is not in MISSION_TASKS`);
  return found;
};

export const MISSIONS_DECK: MissionsDeck = {
  generatedAt: "2026-10-15T18:00:00.000Z",
  nextMove: {
    kind: "resume",
    task: ref(byId("demo-task-alpha-send"), 82, "picked because: the demo task is due tomorrow; 30 minutes left"),
    alternates: [
      ref(byId("demo-task-bravo-plan"), 61, "picked because: the demo plan is due in a week; low effort"),
      ref(byId("demo-task-admin-license"), 44, "picked because: the demo form has been ready for six days"),
    ],
    resumeNote: "Demo note: totals match, the shipping line is still blank",
    resumeRecord: {
      intendedOutcome: "Demo: the quote is sent to Demo Supplier A",
      lastVerifiedStep: "Demo: line totals match the demo part list",
      evidenceLinks: [],
      openQuestion: "Demo: is shipping included in the quote?",
      nextPhysicalAction: "Fill the demo shipping line, then send",
    },
    parkedAt: "2026-10-15T15:10:00.000Z",
    ledgerId: null,
  },
  capacity: { chosenMinutes: 95, chosenCount: 3 },
  triage: {
    rows: [
      { kind: "capture", id: "demo-capture-1", taskId: null, title: "Demo capture: call Demo Supplier A back", detail: "demo capture from 3h ago" },
      { kind: "classify", id: "demo-classify-1", taskId: "demo-task-triage-shelving", title: "Demo task: order demo shelving brackets", detail: "demo task, needs a mission" },
      { kind: "unattached", id: "demo-unattached-1", taskId: "demo-task-triage-sign", title: "Demo task: reprint the demo door sign", detail: null },
    ],
    totalCount: 3,
  },
  missions: [
    { id: ALPHA, title: ALPHA_TITLE, deadline: "2026-10-22T04:00:00.000Z", openCount: 4, doneCount: 2 },
    { id: BRAVO, title: BRAVO_TITLE, deadline: "2026-11-05T05:00:00.000Z", openCount: 3, doneCount: 1 },
  ],
  closed: {
    count: 2,
    rows: [
      { id: "demo-task-closed-1", title: "Demo task: in a stopped demo mission", missionState: "KILLED" },
      { id: "demo-task-closed-2", title: "Demo task: in a finished demo mission", missionState: "COMPLETE" },
    ],
  },
  taskOrder: [],
  focusOrder: [],
  lanes: [
    { id: LANE_ADMIN, title: "Demo lane: Admin", canonicalDomain: "admin", isShop: false, openCount: 2, oldestOpenDays: 6 },
    { id: LANE_HEALTH, title: "Demo lane: Health", canonicalDomain: "health", isShop: false, openCount: 1, oldestOpenDays: 2 },
  ],
  rhythms: [
    { id: "demo-rhythm-stretch", title: "Demo rhythm: morning stretch", loopKind: "DAILY", doneToday: true, windowDone: 6, windowOf: 7 },
    { id: "demo-rhythm-review", title: "Demo rhythm: weekly review", loopKind: "WEEKLY", doneToday: false, windowDone: 0, windowOf: 1 },
  ],
  // ageDays = floor((now - task.updatedAt) / day), as lib/missions/deck.ts daysBetween; pinned by the repo test.
  waiting: [
    { id: "demo-task-bravo-signoff", title: "Demo task: get the demo floor plan signed off", waitingOn: "Demo Contractor A", ageDays: 2, delegatedToNick: false },
    { id: "demo-task-alpha-summary", title: "Demo task: write the demo weekly summary", waitingOn: "Nick", ageDays: 0, delegatedToNick: true },
  ],
  evidence: {
    rows: [
      { id: "demo-task-alpha-gather", title: "Demo task: gather the demo part numbers", missionTitle: ALPHA_TITLE },
      { id: "demo-task-alpha-call", title: "Demo task: confirm the demo supplier call", missionTitle: ALPHA_TITLE },
    ],
    count: 2,
  },
  readiness: { state: "nominal", measuredDaysAgo: 0 },
  unmeasured: [],
};
