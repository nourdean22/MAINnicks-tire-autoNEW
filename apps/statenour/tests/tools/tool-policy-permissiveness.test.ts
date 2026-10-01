/**
 * Q-20 · tool-policy permissiveness diff + invariants (estate master
 * architecture §10 S12).
 *
 * tool-policy.test.ts is example-based: it pins a few (tool, request) pairs.
 * A policy edit, a registry edit, or a new regex branch in the dynamic
 * resolver can loosen some OTHER pair and every example stays green. This
 * file closes that gap in two ways, both over the WHOLE request space:
 *
 * 1. Permissiveness diff (the Cedar-analyzer pattern, no Cedar dependency).
 *    Every registry tool plus a probe for every branch of the dynamic
 *    resolver is evaluated under every combination of the request flags
 *    and every action type the policy distinguishes. The result is
 *    compared with the committed baseline
 *    `tool-policy-permissiveness.baseline.json`, and any drift is sorted
 *    into LOOSENED (a cell now needs less human involvement) or CHANGED
 *    (tighter, or a sideways swap). A loosened cell names the tool, the
 *    action and the flags, so a reviewer sees exactly what became allowed.
 *
 * 2. Invariants, checked exhaustively rather than by sampling. The request
 *    space is boolean flags times a handful of action types, so it is small
 *    enough to enumerate completely, which is strictly stronger than
 *    fast-check's random sampling for this domain (and adds no dependency).
 *    Free-text inputs (tool ids) get a seeded pseudo-random sweep on top.
 *
 * Regenerating the baseline after an INTENDED policy change:
 *   UPDATE_TOOL_POLICY_BASELINE=1 pnpm exec vitest run tests/tools/tool-policy-permissiveness.test.ts
 * The run prints every loosened cell; paste that list into the PR body.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as featureFlags from "@/lib/feature-flags";
import {
  getToolCapabilities,
  getToolCapability,
  type ToolCapability,
} from "../../lib/tools/tool-registry";
import {
  evaluateToolAction,
  type ToolActionRequest,
  type ToolDecision,
  type ToolDecisionType,
} from "../../lib/tools/tool-policy";

type FlagMode = "off" | "on" | "throw";
let flagMode: FlagMode = "off";

vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof featureFlags>();
  return {
    ...actual,
    getFlag: vi.fn((key: string) => {
      if (flagMode === "throw") throw new Error("flag store unreachable");
      if (key === "NICK_MUTATION_LOCK") {
        return { key, isOn: flagMode === "on" };
      }
      return { key, isOn: false };
    }),
  };
});

const BASELINE_PATH = path.join(__dirname, "tool-policy-permissiveness.baseline.json");

/** Boolean request fields, in bit order. Bit i of a combo index sets FLAGS[i]. */
const FLAGS = [
  "externalMutation",
  "memoryWriteRequested",
  "destructive",
  "containsExternalContent",
  "basedOnInferredMemory",
  "hasPriorApproval",
] as const;
type Flag = (typeof FLAGS)[number];
const COMBOS = 1 << FLAGS.length;

/** "execute" is what approval-gate.ts sends; the other three are the browser branch. */
const ACTION_TYPES = ["execute", "read", "click", "submit", "type"] as const;

/**
 * One probe per branch of generateDynamicCapability (tool-registry.ts), plus
 * near-miss verbs that a write regex does NOT match. Those near-misses are
 * where a dynamic id quietly resolves as a read, so they belong in the diff.
 */
const DYNAMIC_PROBES = [
  "task.create",
  "loop.close",
  "commitment.update",
  "decision.record",
  "score.recompute",
  "alert.ack",
  "habit.log",
  "simulation.run",
  "mission.run",
  "person.lookup",
  "person.delete",
  "memory.search",
  "memory.write_note",
  "memory.resolve_conflict",
  "system.restart",
  "shop.lookup_customer",
  "shop.send_sms",
  "shop.refund",
  "shop.cancel_appointment",
  "google.list_events",
  "google.create_event",
  "gmail.read",
  "gmail.send",
  "gmail.forward",
  "telegram.send",
  "camera.snapshot",
  "arsenal.browser_open",
  "arsenal.run_python",
  "arsenal.runjs",
  "arsenal.websearch",
  "arsenal.transcribe",
];

/** Ids that must resolve to nothing, so the policy must deny them. */
const UNKNOWN_IDS = [
  "",
  ".",
  "..",
  "shop",
  "gmail",
  "SHOP.send_sms",
  "Gmail.send",
  "unknown.tool",
  "local",
  "web.search.unregistered",
  " task.create",
  "task",
];

const DECISION_CODE: Record<ToolDecisionType, string> = {
  allow: "A",
  require_approval: "P",
  require_screenshot_approval: "S",
  require_memory_review: "M",
  require_owner: "O",
  deny: "D",
};

/**
 * Higher = more restrictive. S, M and O share a rank: each is a specific
 * human gate, and none is a weaker form of another. Memory review is the
 * stricter path for a pure memory write (quarantine + contradiction check),
 * so memory.pin going from O to M under untrusted content is by design
 * (tool-policy.test.ts and sink-policy.test.ts pin it). What memory review
 * must never gate is an external side effect: that has its own invariant.
 */
const RANK: Record<string, number> = { A: 0, P: 1, S: 2, M: 2, O: 2, D: 3 };

/** What an external side effect in an untrusted turn may get. */
const SINK_DECISIONS: ReadonlySet<ToolDecisionType> = new Set([
  "require_owner",
  "require_screenshot_approval",
  "deny",
]);

/** Fails loudly on a decision this file does not know, instead of encoding "undefined". */
function code(decision: string): string {
  const c = DECISION_CODE[decision as ToolDecisionType];
  if (!c) throw new Error(`unknown tool-policy decision "${decision}": add it to DECISION_CODE and RANK`);
  return c;
}

function comboFlags(combo: number): Record<Flag, boolean> {
  const out = {} as Record<Flag, boolean>;
  FLAGS.forEach((f, i) => {
    out[f] = (combo & (1 << i)) !== 0;
  });
  return out;
}

function describeCombo(combo: number): string {
  const on = FLAGS.filter((_, i) => (combo & (1 << i)) !== 0);
  return on.length ? on.join("+") : "(no flags)";
}

function request(toolId: string, actionType: string, combo: number): ToolActionRequest {
  return { toolId, actionType, ...comboFlags(combo) };
}

function allToolIds(): string[] {
  const ids = new Set<string>(getToolCapabilities().map((c) => c.id));
  for (const probe of DYNAMIC_PROBES) ids.add(probe);
  return [...ids].sort();
}

interface Cell {
  toolId: string;
  cap: ToolCapability | null;
  actionType: string;
  combo: number;
  flags: Record<Flag, boolean>;
  decision: ToolDecision;
}

function* everyCell(ids: string[]): Generator<Cell> {
  for (const toolId of ids) {
    const cap = getToolCapability(toolId);
    for (const actionType of ACTION_TYPES) {
      for (let combo = 0; combo < COMBOS; combo++) {
        yield {
          toolId,
          cap,
          actionType,
          combo,
          flags: comboFlags(combo),
          decision: evaluateToolAction(request(toolId, actionType, combo)),
        };
      }
    }
  }
}

type PermissivenessMap = Record<string, Record<string, string>>;

function computeMap(): PermissivenessMap {
  const map: PermissivenessMap = {};
  for (const toolId of allToolIds()) {
    map[toolId] = {};
    for (const actionType of ACTION_TYPES) {
      let row = "";
      for (let combo = 0; combo < COMBOS; combo++) {
        row += code(evaluateToolAction(request(toolId, actionType, combo)).decision);
      }
      map[toolId][actionType] = row;
    }
  }
  return map;
}

interface Drift {
  loosened: string[];
  changed: string[];
}

/** A tool missing from one side counts as all-deny there, so a new tool's permissions are loosening. */
function diff(base: PermissivenessMap, now: PermissivenessMap): Drift {
  const loosened: string[] = [];
  const changed: string[] = [];
  const denyRow = "D".repeat(COMBOS);
  const ids = [...new Set([...Object.keys(base), ...Object.keys(now)])].sort();
  for (const toolId of ids) {
    for (const actionType of ACTION_TYPES) {
      const b = base[toolId]?.[actionType] ?? denyRow;
      const n = now[toolId]?.[actionType] ?? denyRow;
      for (let combo = 0; combo < COMBOS; combo++) {
        if (b[combo] === n[combo]) continue;
        const line = `${toolId} · ${actionType} · ${describeCombo(combo)}: ${b[combo]} -> ${n[combo]}`;
        (RANK[n[combo]] < RANK[b[combo]] ? loosened : changed).push(line);
      }
    }
  }
  return { loosened, changed };
}

function isMutation(cell: Cell): boolean {
  const cap = cell.cap;
  return Boolean(
    cell.flags.destructive ||
      cell.flags.externalMutation ||
      cell.flags.memoryWriteRequested ||
      cap?.writeAccess ||
      cap?.externalMutation ||
      cap?.memoryWriteAllowed,
  );
}

// Every required env var present: the most permissive environment, so the
// baseline records the loosest reachable decision for each cell.
beforeAll(() => {
  for (const cap of getToolCapabilities()) {
    for (const key of cap.requiredEnv) vi.stubEnv(key, "test-value");
  }
  flagMode = "off";
});

afterAll(() => {
  vi.unstubAllEnvs();
  flagMode = "off";
});

describe("tool-policy permissiveness diff", () => {
  it("matches the committed baseline, and names every loosened cell", () => {
    const now = computeMap();

    if (process.env.UPDATE_TOOL_POLICY_BASELINE === "1") {
      const base: PermissivenessMap = fs.existsSync(BASELINE_PATH)
        ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).tools
        : {};
      const drift = diff(base, now);
      const doc = {
        _about:
          "Generated by tests/tools/tool-policy-permissiveness.test.ts. One string per tool and action type; " +
          "character i is the decision for flag combo i (bit order in 'flags'). " +
          "A=allow P=require_approval S=require_screenshot_approval M=require_memory_review O=require_owner D=deny. " +
          "Env: every requiredEnv present; NICK_MUTATION_LOCK off.",
        flags: FLAGS,
        actionTypes: ACTION_TYPES,
        tools: now,
      };
      fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
      console.info(
        `[tool-policy baseline] rewritten. loosened=${drift.loosened.length} changed=${drift.changed.length}\n` +
          drift.loosened.map((l) => `  LOOSENED ${l}`).join("\n"),
      );
      return;
    }

    const committed = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    expect(committed.flags).toEqual(FLAGS);
    expect(committed.actionTypes).toEqual(ACTION_TYPES);

    const drift = diff(committed.tools, now);
    expect(
      drift.loosened,
      "tool policy LOOSENED: these cells now need less human involvement than the baseline. " +
        "If intended, regenerate the baseline (see file header) and list them in the PR.",
    ).toEqual([]);
    expect(
      drift.changed,
      "tool policy tightened or changed: regenerate the baseline (see file header).",
    ).toEqual([]);
  });

  it("the diff classifies a loosened cell as loosened (positive control)", () => {
    const base: PermissivenessMap = { t: { execute: "O".repeat(COMBOS) } };
    const now: PermissivenessMap = { t: { execute: "A" + "O".repeat(COMBOS - 1) } };
    expect(diff(base, now).loosened).toEqual(["t · execute · (no flags): O -> A"]);
    expect(diff(now, base).changed).toEqual(["t · execute · (no flags): A -> O"]);
    // A brand-new tool is compared against all-deny.
    expect(diff({}, now).loosened).toHaveLength(COMBOS);
  });
});

describe("tool-policy invariants (exhaustive)", () => {
  const ids = allToolIds();

  it("enumerates the whole space (the instrument fires)", () => {
    let n = 0;
    let allows = 0;
    for (const cell of everyCell(ids)) {
      n++;
      if (cell.decision.decision === "allow") allows++;
    }
    expect(n).toBe(ids.length * ACTION_TYPES.length * COMBOS);
    // If nothing were ever allowed, "never allowed" invariants below would be vacuous.
    expect(allows).toBeGreaterThan(0);
  });

  it("default deny: an id that resolves to no capability is denied, whatever the request", () => {
    // Seeded LCG, so a failure reproduces.
    let seed = 20260930;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const alphabet = "abcdefghijklmnopqrstuvwxyz._-ABCXYZ019 ";
    const random: string[] = [];
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 24);
      let s = "";
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
      random.push(s);
    }
    const unresolved = [...UNKNOWN_IDS, ...random].filter((id) => getToolCapability(id) === null);
    expect(unresolved.length).toBeGreaterThan(UNKNOWN_IDS.length);
    for (const toolId of unresolved) {
      for (const actionType of ACTION_TYPES) {
        for (let combo = 0; combo < COMBOS; combo++) {
          const d = evaluateToolAction(request(toolId, actionType, combo));
          expect(d.decision, `${JSON.stringify(toolId)} ${actionType} ${describeCombo(combo)}`).toBe("deny");
        }
      }
    }
  });

  it("a destructive request is always denied", () => {
    for (const cell of everyCell(ids)) {
      if (!cell.flags.destructive) continue;
      expect(cell.decision.decision, `${cell.toolId} ${cell.actionType}`).toBe("deny");
    }
  });

  it("untrusted content + an external side effect goes to the owner, a screenshot approval, or deny", () => {
    let checked = 0;
    for (const cell of everyCell(ids)) {
      const external = cell.flags.externalMutation || cell.cap?.externalMutation;
      if (!external || !cell.flags.containsExternalContent) continue;
      checked++;
      expect(
        SINK_DECISIONS.has(cell.decision.decision),
        `${cell.toolId} ${cell.actionType} ${describeCombo(cell.combo)} -> ${cell.decision.decision}`,
      ).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("an external side effect never goes to memory review (Q-20: memory review is not a send approval)", () => {
    let checked = 0;
    for (const cell of everyCell(ids)) {
      if (!(cell.flags.externalMutation || cell.cap?.externalMutation)) continue;
      checked++;
      expect(cell.decision.decision, `${cell.toolId} ${cell.actionType} ${describeCombo(cell.combo)}`).not.toBe(
        "require_memory_review",
      );
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("an external side effect is never allowed outright", () => {
    for (const cell of everyCell(ids)) {
      if (!(cell.flags.externalMutation || cell.cap?.externalMutation)) continue;
      expect(cell.decision.decision, `${cell.toolId} ${cell.actionType} ${describeCombo(cell.combo)}`).not.toBe(
        "allow",
      );
    }
  });

  it("a memory write based on untrusted content or a model inference is never allowed", () => {
    for (const cell of everyCell(ids)) {
      const memoryWrite = cell.flags.memoryWriteRequested || cell.cap?.memoryWriteAllowed;
      if (!memoryWrite) continue;
      if (!(cell.flags.containsExternalContent || cell.flags.basedOnInferredMemory)) continue;
      expect(cell.decision.decision, `${cell.toolId} ${cell.actionType} ${describeCombo(cell.combo)}`).not.toBe(
        "allow",
      );
    }
  });

  it("a critical-risk tool is never allowed", () => {
    for (const cell of everyCell(ids)) {
      if (cell.cap?.riskClass !== "critical") continue;
      expect(cell.decision.decision, `${cell.toolId} ${cell.actionType}`).not.toBe("allow");
    }
  });

  it("a blocked, inert, scaffolded or local tool is always denied", () => {
    for (const cell of everyCell(ids)) {
      const cap = cell.cap;
      if (!cap) continue;
      const parked =
        cap.status === "blocked" || cap.status === "inert" || cap.status === "scaffolded" || cap.category === "local";
      if (!parked) continue;
      expect(cell.decision.decision, `${cell.toolId} ${cell.actionType}`).toBe("deny");
    }
  });

  it("hasPriorApproval grants nothing: flipping it never changes a decision", () => {
    const bit = 1 << FLAGS.indexOf("hasPriorApproval");
    for (const toolId of ids) {
      for (const actionType of ACTION_TYPES) {
        for (let combo = 0; combo < COMBOS; combo++) {
          if (combo & bit) continue;
          const without = evaluateToolAction(request(toolId, actionType, combo)).decision;
          const withIt = evaluateToolAction(request(toolId, actionType, combo | bit)).decision;
          expect(withIt, `${toolId} ${actionType} ${describeCombo(combo)}`).toBe(without);
        }
      }
    }
  });

  it("monotone: turning on any risk flag never makes a decision more permissive", () => {
    for (const toolId of ids) {
      for (const actionType of ACTION_TYPES) {
        for (let combo = 0; combo < COMBOS; combo++) {
          const before = code(evaluateToolAction(request(toolId, actionType, combo)).decision);
          FLAGS.forEach((flag, i) => {
            if (flag === "hasPriorApproval" || combo & (1 << i)) return;
            const after = code(evaluateToolAction(request(toolId, actionType, combo | (1 << i))).decision);
            expect(
              RANK[after] >= RANK[before],
              `${toolId} ${actionType} ${describeCombo(combo)} +${flag}: ${before} -> ${after}`,
            ).toBe(true);
          });
        }
      }
    }
  });

  it("any required env var missing -> never allowed", () => {
    const withEnv = getToolCapabilities().filter((c) => c.requiredEnv.length > 0);
    expect(withEnv.length).toBeGreaterThan(0);
    try {
      for (const cap of withEnv) {
        vi.stubEnv(cap.requiredEnv[0], "");
        for (let combo = 0; combo < COMBOS; combo++) {
          for (const actionType of ACTION_TYPES) {
            const d = evaluateToolAction(request(cap.id, actionType, combo));
            expect(d.decision, `${cap.id} ${actionType} ${describeCombo(combo)}`).toBe("deny");
          }
        }
        vi.stubEnv(cap.requiredEnv[0], "test-value");
      }
    } finally {
      for (const cap of withEnv) for (const key of cap.requiredEnv) vi.stubEnv(key, "test-value");
    }
  });

  it("NICK_MUTATION_LOCK on, or unresolvable, denies every mutation and leaves every read unchanged", () => {
    const reads = new Map<string, ToolDecisionType>();
    for (const cell of everyCell(ids)) {
      if (!isMutation(cell)) reads.set(`${cell.toolId}|${cell.actionType}|${cell.combo}`, cell.decision.decision);
    }
    expect(reads.size).toBeGreaterThan(0);
    try {
      for (const mode of ["on", "throw"] as const) {
        flagMode = mode;
        let mutations = 0;
        for (const cell of everyCell(ids)) {
          const where = `${mode} ${cell.toolId} ${cell.actionType} ${describeCombo(cell.combo)}`;
          if (isMutation(cell)) {
            mutations++;
            expect(cell.decision.decision, where).toBe("deny");
          } else {
            expect(cell.decision.decision, where).toBe(reads.get(`${cell.toolId}|${cell.actionType}|${cell.combo}`));
          }
        }
        expect(mutations).toBeGreaterThan(0);
      }
    } finally {
      flagMode = "off";
    }
  });
});
