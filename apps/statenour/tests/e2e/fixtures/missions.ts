/**
 * DEMO fixtures for Missions (/missions): the deck, the task list and the
 * mission list the page reads (task.deck, task.list, task.missions). Every
 * title and name is fictional and says so. The deck is typed against
 * MissionsDeck; the lists against the page's own client contract
 * (components/actions/shared Task and Project, which the page casts the
 * router output to), plus the fields decorateMissions adds.
 *
 * The mix is deliberate: two active missions at different progress, a done
 * mission-task pair, a blocked (WAITING) task per mission, a task handed to
 * Nick, two domain lanes, two rhythms and a three-row triage airlock.
 * operator.commandCenterState is not stubbed: the page only reads the active
 * command id from it, and renders nothing when it is absent.
 */
import type { Project, Task } from "@/components/actions/shared";
import type { MissionsDeck } from "@/lib/missions/deck";

const ALPHA = "demo-mission-alpha";
const BRAVO = "demo-mission-bravo";
const LANE_ADMIN = "demo-lane-admin";
const LANE_HEALTH = "demo-lane-health";

export const ALPHA_TITLE = "Demo mission Alpha: supplier quote";
const BRAVO_TITLE = "Demo mission Bravo: shop floor layout";
/** The hero task of the deck; the smoke spec waits for this exact title. */
export const NEXT_MOVE_TITLE = "Demo task: send the demo supplier quote";

type Status = "READY" | "DOING" | "WAITING" | "DONE";

function task(id: string, missionId: string, title: string, status: Status, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    status,
    nextPhysicalAction: `Demo first step: ${title.replace(/^Demo task: /, "")}`,
    missionId,
    effort: "M30",
    energyRequired: "MEDIUM",
    autoPriority: 50,
    autoPriorityExplanation: null,
    loopKind: "ONCE",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-14T14:00:00.000Z",
    ...extra,
  };
}

export const MISSION_TASKS: Task[] = [
  // Alpha: 2 done, 1 doing, 2 ready, 1 handed to Nick.
  task("demo-task-alpha-gather", ALPHA, "Demo task: gather the demo part numbers", "DONE", { updatedAt: "2026-10-15T13:10:00.000Z" }),
  task("demo-task-alpha-call", ALPHA, "Demo task: confirm the demo supplier call", "DONE", { updatedAt: "2026-10-15T15:20:00.000Z" }),
  task("demo-task-alpha-send", ALPHA, NEXT_MOVE_TITLE, "DOING", {
    autoPriority: 82,
    dueDate: "2026-10-16T04:00:00.000Z",
    startedAt: "2026-10-15T14:40:00.000Z",
    effort: "M30",
  }),
  task("demo-task-alpha-terms", ALPHA, "Demo task: draft the demo payment terms", "READY", { effort: "H1", dueDate: "2026-10-20T04:00:00.000Z" }),
  task("demo-task-alpha-photos", ALPHA, "Demo task: photograph the demo samples", "READY", { effort: "M15" }),
  task("demo-task-alpha-summary", ALPHA, "Demo task: write the demo weekly summary", "WAITING", {
    waitingOn: "Nick",
    updatedAt: "2026-10-15T17:35:00.000Z",
  }),
  // Bravo: 1 done, 2 ready, 1 blocked on a person.
  task("demo-task-bravo-measure", BRAVO, "Demo task: measure the demo floor", "DONE", { updatedAt: "2026-10-14T18:00:00.000Z" }),
  task("demo-task-bravo-plan", BRAVO, "Demo task: review the demo floor plan", "READY", { effort: "M30", dueDate: "2026-10-22T04:00:00.000Z" }),
  task("demo-task-bravo-shelving", BRAVO, "Demo task: choose the demo shelving", "READY", { effort: "H1" }),
  task("demo-task-bravo-signoff", BRAVO, "Demo task: get the demo floor plan signed off", "WAITING", {
    waitingOn: "Demo Contractor A",
    updatedAt: "2026-10-13T15:00:00.000Z",
  }),
  // Domain lanes (GENERAL anchors): classified work with no project of its own.
  task("demo-task-admin-license", LANE_ADMIN, "Demo task: file the demo license form", "READY", { effort: "M15", updatedAt: "2026-10-09T14:00:00.000Z" }),
  task("demo-task-admin-receipts", LANE_ADMIN, "Demo task: sort the demo receipts", "READY", { effort: "M30" }),
  task("demo-task-health-checkup", LANE_HEALTH, "Demo task: book the demo checkup", "READY", { effort: "M5" }),
  // Triage airlock: no mission yet.
  task("demo-task-triage-shelving", "", "Demo task: order demo shelving brackets", "READY", { autoPriority: null }),
  task("demo-task-triage-sign", "", "Demo task: reprint the demo door sign", "READY", { autoPriority: null }),
];

export type MissionFixture = Project & {
  tasks: { id: string; status: string }[];
  openTaskCount: number;
  rank: number | null;
  rankScore: number | null;
  rankExplanation: string | null;
  createdAt: string;
  updatedAt: string;
};

function mission(
  id: string,
  title: string,
  extra: Partial<MissionFixture>,
): MissionFixture {
  const own = MISSION_TASKS.filter((t) => t.missionId === id).map((t) => ({ id: t.id, status: t.status }));
  return {
    id,
    title,
    status: "ACTIVE",
    description: null,
    deadline: null,
    manualRankOverride: null,
    systemKind: null,
    canonicalDomain: null,
    tasks: own,
    openTaskCount: own.filter((t) => t.status !== "DONE").length,
    rank: null,
    rankScore: null,
    rankExplanation: null,
    createdAt: "2026-10-01T14:00:00.000Z",
    updatedAt: "2026-10-15T15:20:00.000Z",
    ...extra,
  };
}

export const MISSIONS: MissionFixture[] = [
  mission(ALPHA, ALPHA_TITLE, { deadline: "2026-10-22T04:00:00.000Z", manualRankOverride: 1 }),
  mission(BRAVO, BRAVO_TITLE, { deadline: "2026-11-05T05:00:00.000Z", manualRankOverride: 2 }),
  mission(LANE_ADMIN, "Demo lane: Admin", { systemKind: "GENERAL", canonicalDomain: "admin" }),
  mission(LANE_HEALTH, "Demo lane: Health", { systemKind: "GENERAL", canonicalDomain: "health" }),
];

function ref(t: Task, missionTitle: string | null, score: number, why: string): NonNullable<MissionsDeck["nextMove"]>["task"] {
  return {
    id: t.id,
    title: t.title,
    nextPhysicalAction: t.nextPhysicalAction,
    effort: t.effort ?? null,
    effortMinutes: t.effort === "H1" ? 60 : t.effort === "M15" ? 15 : 30,
    energyRequired: t.energyRequired ?? null,
    status: t.status,
    dueDate: t.dueDate ?? null,
    missionId: t.missionId,
    missionTitle,
    score,
    why,
  };
}

const byId = (id: string): Task => {
  const found = MISSION_TASKS.find((t) => t.id === id);
  if (!found) throw new Error(`fixture task ${id} is not in MISSION_TASKS`);
  return found;
};

export const MISSIONS_DECK: MissionsDeck = {
  generatedAt: "2026-10-15T18:00:00.000Z",
  nextMove: {
    kind: "resume",
    task: ref(byId("demo-task-alpha-send"), ALPHA_TITLE, 82, "picked because: the demo task is due tomorrow; 30 minutes left"),
    alternates: [
      ref(byId("demo-task-bravo-plan"), BRAVO_TITLE, 61, "picked because: the demo plan is due in a week; low effort"),
      ref(byId("demo-task-admin-license"), "Demo lane: Admin", 44, "picked because: the demo form has been ready for six days"),
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
  missionSlotsOpen: 1,
  lanes: [
    { id: LANE_ADMIN, title: "Demo lane: Admin", canonicalDomain: "admin", isShop: false, openCount: 2, oldestOpenDays: 6 },
    { id: LANE_HEALTH, title: "Demo lane: Health", canonicalDomain: "health", isShop: false, openCount: 1, oldestOpenDays: 2 },
  ],
  rhythms: [
    { id: "demo-rhythm-stretch", title: "Demo rhythm: morning stretch", loopKind: "DAILY", doneToday: true, windowDone: 6, windowOf: 7 },
    { id: "demo-rhythm-review", title: "Demo rhythm: weekly review", loopKind: "WEEKLY", doneToday: false, windowDone: 0, windowOf: 1 },
  ],
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
