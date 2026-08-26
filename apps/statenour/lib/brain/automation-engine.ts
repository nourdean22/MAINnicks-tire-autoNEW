/**
 * Automation engine — rewritten 2026-08-26 so it can execute its own rules.
 *
 * IT HAD NEVER RUN. Zero importers, any spelling, anywhere. An audit found it
 * disagreed with its own stored rules at FOUR levels, and wiring it as it stood
 * would have fired zero useful actions while reading as done:
 *
 *   1 · ACTION SHAPE. The loop unconditionally built a DeviceCommand from
 *       `action.deviceId`/`action.command`. Every stored action is `notify` or
 *       `check` and has neither; both columns are NOT NULL with an FK, so every
 *       fire threw. `action.type` was never read. -> `planAction`.
 *   2 · TRIGGER SHAPE. Both device rules describe a CLASS of device
 *       (`{status:"OFFLINE", deviceType:"CAMERA"}`) but the matcher was
 *       `devices.find(d => d.id === trigger.deviceId)`, undefined for both.
 *       -> `matchesDeviceCondition`.
 *   3 · TRIGGER COVERAGE. No `composite` case and no `default:`, so one rule
 *       fell through the switch and never evaluated — silently. -> `default:`
 *       now returns a reason.
 *   4 · SEMANTICS, and the one that matters. The rules are EDGE-triggered
 *       ("camera went offline"); the engine was LEVEL-triggered ("a camera is
 *       offline"). Measured: 20 of 22 devices OFFLINE, last seen 2026-04-06..14
 *       — the integration died in April. At the stored 1-hour cooldown that is
 *       24 messages a day about a four-month-old fact.
 *
 * So a rule now fires when its MATCH SET CHANGES. `computeFingerprint` reduces
 * the match to a stable string, stored on the rule's `metadata`, and a repeat
 * fingerprint is silence. Ten cameras dropping is one alert; an eleventh is a
 * new one; nothing changing says nothing.
 *
 * STILL NOT WIRED TO A DISPATCHER, deliberately. `preview()` runs the whole
 * evaluation with no side effects so the rule set can be inspected against live
 * data before anything is armed. Arming is an operator decision, and the
 * measured facts they need are in that preview.
 */
import { prisma } from "@/lib/prisma";
import { hourET, weekdayET } from "@/lib/utils/datetime";
import { logger } from "@/lib/logger";
import { sendTelegram } from "@/lib/services/telegram";
import type { AutomationRule } from "@prisma/client";
import {
  evaluateTrigger,
  planAction,
  type ActionSpec,
  type DeviceView,
  type EvalContext,
  type TriggerSpec,
} from "./automation-rules";

export interface SystemContext extends EvalContext {
  time: Date;
}

export interface FiredRule {
  rule: AutomationRule;
  reason: string;
  fingerprint: string;
}

export interface ActionResult {
  ruleId: string;
  ruleName: string;
  notified: number;
  deviceCommands: number;
  unsupported: string[];
  success: boolean;
}

/** What a rule would do, with no side effects. */
export interface RulePreview {
  ruleName: string;
  enabled: boolean;
  fires: boolean;
  reason: string;
  /** True when the fingerprint matches the last fire — a repeat, so silent. */
  suppressedAsRepeat: boolean;
  actions: string[];
}

const log = logger.withContext({ service: "automation-engine" });

/** Freshness window for a `pattern` trigger's supporting memory. */
const PATTERN_WINDOW_MS = 60 * 60 * 1000;

function readFingerprint(rule: AutomationRule): string | null {
  const meta = rule.metadata as { lastFingerprint?: unknown } | null;
  return typeof meta?.lastFingerprint === "string" ? meta.lastFingerprint : null;
}

export class AutomationEngine {
  /** Gather everything the pure evaluator needs, in as few queries as possible. */
  async getContext(rules: AutomationRule[] = []): Promise<SystemContext> {
    const devices: DeviceView[] = await prisma.smartDevice.findMany({
      select: { id: true, status: true, currentState: true, deviceType: true },
    });

    // One query for every category any pattern rule cares about, rather than
    // one per rule inside the loop.
    const categories = new Set<string>();
    for (const r of rules) {
      const t = r.trigger as TriggerSpec | null;
      if (t?.type === "pattern" && typeof t.category === "string") categories.add(t.category);
    }
    const freshMemoryCategories = new Set<string>();
    if (categories.size > 0) {
      const rows = await prisma.brainMemory.findMany({
        where: {
          category: { in: [...categories] },
          lastSeen: { gte: new Date(Date.now() - PATTERN_WINDOW_MS) },
          deletedAt: null,
        },
        select: { category: true },
        distinct: ["category"],
      });
      for (const r of rows) freshMemoryCategories.add(r.category);
    }

    const now = new Date();
    return {
      devices,
      time: now,
      dayOfWeek: weekdayET(now),
      hour: hourET(now),
      freshMemoryCategories,
    };
  }

  async loadRules(): Promise<AutomationRule[]> {
    return prisma.automationRule.findMany({ where: { enabled: true } });
  }

  /**
   * Which rules fire right now. Cooldown is a floor; the fingerprint is the
   * real gate — an unchanged world produces nothing.
   */
  evaluate(rules: AutomationRule[], context: SystemContext): FiredRule[] {
    const fired: FiredRule[] = [];
    for (const rule of rules) {
      if (rule.lastFired && rule.cooldownMs) {
        if (Date.now() - rule.lastFired.getTime() < rule.cooldownMs) continue;
      }
      const verdict = evaluateTrigger((rule.trigger ?? {}) as TriggerSpec, context);
      if (!verdict.fires) continue;
      if (readFingerprint(rule) === verdict.fingerprint) continue; // unchanged world
      fired.push({ rule, reason: verdict.reason, fingerprint: verdict.fingerprint });
    }
    return fired;
  }

  /** Evaluate everything and report, touching nothing. */
  async preview(): Promise<RulePreview[]> {
    const rules = await prisma.automationRule.findMany();
    const context = await this.getContext(rules);
    return rules.map((rule) => {
      const verdict = evaluateTrigger((rule.trigger ?? {}) as TriggerSpec, context);
      const actions = ((rule.actions as ActionSpec[] | null) ?? []).map((a) => {
        const planned = planAction(a, rule.name);
        return planned.kind === "notify"
          ? "notify"
          : planned.kind === "device"
            ? `device:${planned.command}`
            : `UNSUPPORTED (${planned.detail})`;
      });
      return {
        ruleName: rule.name,
        enabled: rule.enabled,
        fires: verdict.fires,
        reason: verdict.reason,
        suppressedAsRepeat:
          verdict.fires && readFingerprint(rule) === verdict.fingerprint,
        actions,
      };
    });
  }

  /** Run the planned actions for rules that fired. */
  async execute(firedRules: FiredRule[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const { rule, reason, fingerprint } of firedRules) {
      const specs = (rule.actions as ActionSpec[] | null) ?? [];
      let notified = 0;
      let deviceCommands = 0;
      const unsupported: string[] = [];

      try {
        for (const spec of specs) {
          const planned = planAction(spec, rule.name);
          if (planned.kind === "notify") {
            const ok = await sendTelegram(planned.message);
            if (ok) notified++;
            else unsupported.push("telegram send returned false");
          } else if (planned.kind === "device") {
            await prisma.deviceCommand.create({
              data: {
                deviceId: planned.deviceId,
                command: planned.command,
                params: (planned.params ?? null) as never,
                status: "pending",
              },
            });
            deviceCommands++;
          } else {
            // Reported, never silently skipped — an unexecutable action that
            // logs nothing is how this whole subsystem stayed broken unnoticed.
            unsupported.push(planned.detail);
          }
        }

        await prisma.automationRule.update({
          where: { id: rule.id },
          data: {
            lastFired: new Date(),
            fireCount: { increment: 1 },
            metadata: {
              ...((rule.metadata as Record<string, unknown> | null) ?? {}),
              lastFingerprint: fingerprint,
            } as never,
          },
        });

        if (unsupported.length > 0) {
          log.warn("rule_fired_with_unsupported_actions", {
            rule: rule.name,
            unsupported,
          });
        }
        log.info("rule_fired", { rule: rule.name, reason, notified, deviceCommands });
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          notified,
          deviceCommands,
          unsupported,
          success: true,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error("rule_execution_failed", { rule: rule.name, error: msg.slice(0, 200) });
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          notified,
          deviceCommands,
          unsupported: [...unsupported, msg.slice(0, 120)],
          success: false,
        });
      }
    }

    return results;
  }

  /** Load, evaluate, execute. The entry a dispatcher would call. */
  async run(): Promise<ActionResult[]> {
    const rules = await this.loadRules();
    const context = await this.getContext(rules);
    return this.execute(this.evaluate(rules, context));
  }
}

export const automationEngine = new AutomationEngine();
