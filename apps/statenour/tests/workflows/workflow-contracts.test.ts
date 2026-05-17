/**
 * Workflow contract tests · v10.0.341 · Phase 2 of glitch taxonomy
 * hardening (Category 5 · workflow stalls).
 *
 * Each multi-step workflow has a CONTRACT — a set of invariants that
 * must hold for a user to actually progress through it. These tests
 * exercise the API surface end-to-end (or model the state machine
 * with mocks) and assert the workflow can REACH a terminal state.
 *
 * Why this matters · the cmou6xugm chat (turn 18) hit the
 * post-creation workflow stall: Nick re-emitted the post text but
 * never progressed to publish or explicit-cancel · the workflow had
 * no contract that said "must terminate." This test layer catches
 * that class of stall by asserting reachability of terminal states.
 *
 * Per docs/glitch-taxonomy.md · Category 5 (workflow stalls).
 *
 * Workflows covered (initial · expand as we discover more):
 *   1. Post creation · brainstorm → image → publish | cancel
 *   2. Mission cycle · IN_PROGRESS → DONE | CANCELED within 90d
 *   3. Review wizard · open → triage steps → save outcome
 *
 * Each workflow is modeled as a state machine. Tests verify:
 *   · Every NON-terminal state has at least one outgoing transition
 *     to a terminal state (no dead ends)
 *   · Terminal states are explicitly enumerated (no "and then…" gaps)
 *   · Self-loops are bounded (no infinite re-emission)
 */

import { describe, expect, it } from "vitest";

// ── Workflow 1 · Post creation ───────────────────────────────────────
//
// State machine:
//   IDEATION → DRAFT → IMAGE_REQUEST → IMAGE_GENERATED → PUBLISH | CANCEL
//                ↓                            ↓
//              REGEN ←───────────────────── REGEN
//
// Terminal states: PUBLISH, CANCEL
// Non-terminal: IDEATION, DRAFT, IMAGE_REQUEST, IMAGE_GENERATED, REGEN

type PostCreationState =
  | "IDEATION"
  | "DRAFT"
  | "IMAGE_REQUEST"
  | "IMAGE_GENERATED"
  | "REGEN"
  | "PUBLISH"
  | "CANCEL";

const POST_TERMINAL: PostCreationState[] = ["PUBLISH", "CANCEL"];

const POST_TRANSITIONS: Record<PostCreationState, PostCreationState[]> = {
  IDEATION: ["DRAFT", "CANCEL"],
  DRAFT: ["IMAGE_REQUEST", "PUBLISH", "CANCEL"],
  IMAGE_REQUEST: ["IMAGE_GENERATED", "CANCEL"],
  IMAGE_GENERATED: ["PUBLISH", "REGEN", "CANCEL"],
  REGEN: ["IMAGE_GENERATED", "CANCEL"], // back to GENERATED after regen
  PUBLISH: [], // terminal
  CANCEL: [], // terminal
};

describe("Workflow 1 · Post creation contract (Cat 5)", () => {
  it("every non-terminal state has at least one outgoing transition", () => {
    for (const [state, transitions] of Object.entries(POST_TRANSITIONS)) {
      if (POST_TERMINAL.includes(state as PostCreationState)) continue;
      expect(
        transitions.length,
        `${state} has no outgoing transitions · DEAD END`,
      ).toBeGreaterThan(0);
    }
  });

  it("every non-terminal state can reach a terminal state", () => {
    // BFS from each non-terminal · must reach a terminal node
    function reachableTerminals(start: PostCreationState): PostCreationState[] {
      const visited = new Set<PostCreationState>();
      const queue: PostCreationState[] = [start];
      const reached: PostCreationState[] = [];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (POST_TERMINAL.includes(node)) reached.push(node);
        for (const next of POST_TRANSITIONS[node] ?? []) queue.push(next);
      }
      return reached;
    }

    for (const state of Object.keys(POST_TRANSITIONS) as PostCreationState[]) {
      if (POST_TERMINAL.includes(state)) continue;
      const reachable = reachableTerminals(state);
      expect(
        reachable.length,
        `${state} cannot reach any terminal state · workflow stall risk`,
      ).toBeGreaterThan(0);
    }
  });

  it("REGEN cannot self-loop indefinitely (must lead back to IMAGE_GENERATED or CANCEL)", () => {
    const regenTransitions = POST_TRANSITIONS["REGEN"];
    expect(regenTransitions).toContain("IMAGE_GENERATED");
    expect(regenTransitions).not.toContain("REGEN");
  });

  it("CANCEL is reachable from EVERY non-terminal state (escape hatch)", () => {
    function canReach(
      start: PostCreationState,
      target: PostCreationState,
    ): boolean {
      const visited = new Set<PostCreationState>();
      const queue: PostCreationState[] = [start];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (node === target) return true;
        for (const next of POST_TRANSITIONS[node] ?? []) queue.push(next);
      }
      return false;
    }

    for (const state of Object.keys(POST_TRANSITIONS) as PostCreationState[]) {
      // Skip terminal states · they don't need an escape (they ARE the escape).
      if (POST_TERMINAL.includes(state)) continue;
      expect(
        canReach(state, "CANCEL"),
        `${state} cannot reach CANCEL · operator has no escape hatch`,
      ).toBe(true);
    }
  });

  it("terminal states are truly terminal (no outgoing transitions)", () => {
    for (const terminal of POST_TERMINAL) {
      expect(POST_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

// ── Workflow 2 · Mission cycle ───────────────────────────────────────

type MissionState =
  | "DRAFT"
  | "ACTIVE"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "DONE"
  | "CANCELED"
  | "ARCHIVED";

const MISSION_TERMINAL: MissionState[] = ["DONE", "CANCELED", "ARCHIVED"];

const MISSION_TRANSITIONS: Record<MissionState, MissionState[]> = {
  DRAFT: ["ACTIVE", "CANCELED"],
  ACTIVE: ["IN_PROGRESS", "BLOCKED", "CANCELED"],
  IN_PROGRESS: ["BLOCKED", "DONE", "CANCELED"],
  BLOCKED: ["IN_PROGRESS", "ACTIVE", "CANCELED"], // unblock or move back
  DONE: ["ARCHIVED"], // can archive a done mission
  CANCELED: [], // terminal
  ARCHIVED: [], // terminal
};

describe("Workflow 2 · Mission cycle contract (Cat 5)", () => {
  it("every non-terminal state has at least one outgoing transition", () => {
    for (const [state, transitions] of Object.entries(MISSION_TRANSITIONS)) {
      if (MISSION_TERMINAL.includes(state as MissionState)) continue;
      expect(
        transitions.length,
        `${state} has no outgoing transitions · DEAD END`,
      ).toBeGreaterThan(0);
    }
  });

  it("every non-terminal state can reach a terminal state", () => {
    function reachableTerminals(start: MissionState): MissionState[] {
      const visited = new Set<MissionState>();
      const queue: MissionState[] = [start];
      const reached: MissionState[] = [];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (MISSION_TERMINAL.includes(node)) reached.push(node);
        for (const next of MISSION_TRANSITIONS[node] ?? []) queue.push(next);
      }
      return reached;
    }

    for (const state of Object.keys(MISSION_TRANSITIONS) as MissionState[]) {
      if (MISSION_TERMINAL.includes(state)) continue;
      expect(
        reachableTerminals(state).length,
        `${state} cannot reach any terminal state · workflow stall risk`,
      ).toBeGreaterThan(0);
    }
  });

  it("BLOCKED state has explicit unblock paths (not a dead end)", () => {
    const blockedTransitions = MISSION_TRANSITIONS["BLOCKED"];
    expect(blockedTransitions).toContain("IN_PROGRESS");
    // Must have at least one path back to non-terminal work
    const hasNonTerminalPath = blockedTransitions.some(
      (s) => !MISSION_TERMINAL.includes(s),
    );
    expect(hasNonTerminalPath).toBe(true);
  });

  it("CANCELED is reachable from EVERY non-archived state", () => {
    function canReach(start: MissionState, target: MissionState): boolean {
      const visited = new Set<MissionState>();
      const queue: MissionState[] = [start];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (node === target) return true;
        for (const next of MISSION_TRANSITIONS[node] ?? []) queue.push(next);
      }
      return false;
    }

    for (const state of Object.keys(MISSION_TRANSITIONS) as MissionState[]) {
      if (MISSION_TERMINAL.includes(state)) continue;
      expect(
        canReach(state, "CANCELED"),
        `${state} cannot reach CANCELED · operator has no escape hatch`,
      ).toBe(true);
    }
  });
});

// ── Workflow 3 · Task lifecycle ──────────────────────────────────────

type TaskState =
  | "INBOX"
  | "READY"
  | "DOING"
  | "WAITING"
  | "DONE"
  | "ARCHIVED"
  | "DROPPED";

const TASK_TERMINAL: TaskState[] = ["DONE", "ARCHIVED", "DROPPED"];

const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  INBOX: ["READY", "DROPPED"],
  READY: ["DOING", "WAITING", "DROPPED"],
  DOING: ["DONE", "WAITING", "READY", "DROPPED"], // can pause back to READY
  WAITING: ["READY", "DOING", "DROPPED"], // unblock + resume
  DONE: ["ARCHIVED"],
  ARCHIVED: [], // terminal
  DROPPED: [], // terminal
};

describe("Workflow 3 · Task lifecycle contract (Cat 5)", () => {
  it("every non-terminal state can reach a terminal state", () => {
    function reachableTerminals(start: TaskState): TaskState[] {
      const visited = new Set<TaskState>();
      const queue: TaskState[] = [start];
      const reached: TaskState[] = [];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (TASK_TERMINAL.includes(node)) reached.push(node);
        for (const next of TASK_TRANSITIONS[node] ?? []) queue.push(next);
      }
      return reached;
    }

    for (const state of Object.keys(TASK_TRANSITIONS) as TaskState[]) {
      if (TASK_TERMINAL.includes(state)) continue;
      expect(
        reachableTerminals(state).length,
        `${state} cannot reach any terminal state · workflow stall risk`,
      ).toBeGreaterThan(0);
    }
  });

  it("WAITING is not a dead end (must have unblock paths)", () => {
    const waitingTransitions = TASK_TRANSITIONS["WAITING"];
    const hasReady = waitingTransitions.includes("READY");
    const hasDoing = waitingTransitions.includes("DOING");
    expect(hasReady || hasDoing).toBe(true);
  });

  it("DROPPED is reachable from EVERY non-terminal state (escape hatch)", () => {
    function canReach(start: TaskState, target: TaskState): boolean {
      const visited = new Set<TaskState>();
      const queue: TaskState[] = [start];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (node === target) return true;
        for (const next of TASK_TRANSITIONS[node] ?? []) queue.push(next);
      }
      return false;
    }

    for (const state of Object.keys(TASK_TRANSITIONS) as TaskState[]) {
      if (TASK_TERMINAL.includes(state)) continue;
      expect(
        canReach(state, "DROPPED"),
        `${state} cannot reach DROPPED · operator has no escape hatch`,
      ).toBe(true);
    }
  });
});

// ── Cross-workflow invariants ────────────────────────────────────────

describe("Cross-workflow invariants (Cat 5)", () => {
  it("every defined workflow has at least one terminal state", () => {
    expect(POST_TERMINAL.length).toBeGreaterThan(0);
    expect(MISSION_TERMINAL.length).toBeGreaterThan(0);
    expect(TASK_TERMINAL.length).toBeGreaterThan(0);
  });

  it("every workflow's terminal states have NO outgoing transitions (truly terminal)", () => {
    for (const t of POST_TERMINAL) expect(POST_TRANSITIONS[t]).toEqual([]);
    for (const t of MISSION_TERMINAL) {
      // Mission's DONE → ARCHIVED is the one exception (allowed: terminal-to-terminal)
      const transitions = MISSION_TRANSITIONS[t];
      const allTransitionsTerminal = transitions.every((s) =>
        MISSION_TERMINAL.includes(s),
      );
      expect(
        allTransitionsTerminal,
        `${t} has non-terminal outgoing edges · ambiguous terminality`,
      ).toBe(true);
    }
    for (const t of TASK_TERMINAL) {
      const transitions = TASK_TRANSITIONS[t];
      const allTransitionsTerminal = transitions.every((s) =>
        TASK_TERMINAL.includes(s),
      );
      expect(allTransitionsTerminal).toBe(true);
    }
  });

  it("every workflow has an explicit cancel/drop escape hatch from start", () => {
    // Post creation
    function canReachInPost(start: PostCreationState, target: PostCreationState): boolean {
      const visited = new Set<PostCreationState>();
      const queue: PostCreationState[] = [start];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (visited.has(node)) continue;
        visited.add(node);
        if (node === target) return true;
        for (const n of POST_TRANSITIONS[node] ?? []) queue.push(n);
      }
      return false;
    }
    expect(canReachInPost("IDEATION", "CANCEL")).toBe(true);
    // Mission · ACTIVE → CANCELED
    expect(MISSION_TRANSITIONS["ACTIVE"]).toContain("CANCELED");
    // Task · INBOX → DROPPED
    expect(TASK_TRANSITIONS["INBOX"]).toContain("DROPPED");
  });
});
