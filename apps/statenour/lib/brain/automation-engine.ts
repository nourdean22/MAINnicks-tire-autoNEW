/**
 * DO NOT WIRE THIS WITHOUT READING THIS BLOCK. Audited 2026-08-26 against the
 * live rule set; the engine and its own data disagree at THREE levels, and
 * wiring it as-is fires zero useful actions while looking like it works.
 *
 * It has never run. Zero importers, any spelling, anywhere in the repo.
 * `automationEngine` at the bottom is a singleton nothing constructs a caller
 * for. That is the only reason none of the below has caused an incident.
 *
 * PROD STATE: 8 rules, ALL 8 enabled. `device_commands` holds 12 rows, newest
 * 2026-04-01 — nothing has been issued in five months.
 *
 * 1 · ACTION SHAPE. The action loop unconditionally builds a DeviceCommand from
 *     `action.deviceId` / `action.command`. Not one stored action has either
 *     field: six are `{type:"notify", channel:"telegram", message}` and two are
 *     `{type:"check", target, message}`. `action.type` is never read. Both
 *     columns are NOT NULL with an FK, so every fire THROWS into the catch
 *     below. Result: no notification, no device command, one logged failure.
 *
 * 2 · TRIGGER SHAPE. Both `device_state` rules describe a CLASS of device —
 *     `{status:"OFFLINE", deviceType:"CAMERA"}`, `{runningHours:6}` — with no
 *     `deviceId`. The matcher is `devices.find(d => d.id === trigger.deviceId)`,
 *     which is `undefined` for both, so they never fire. The rules mean "any
 *     camera"; the engine only implements "this one device".
 *
 * 3 · TRIGGER COVERAGE. There is no `composite` case and no `default:`. The
 *     "Late night motion + lights off" rule falls straight through the switch
 *     with `shouldFire` still false — it does not error, it does not log, it
 *     simply never evaluates. A fourth trigger type would do the same.
 *
 * WHAT WOULD ACTUALLY BE NEEDED: an action executor that reads `action.type`
 * (notify -> sendTelegram, check -> ?), class-matching for `device_state`, a
 * `composite` evaluator, and a `default:` that is loud. That is a rewrite of the
 * executor plus a decision about rules referencing cameras, motion events and
 * `runningHours` whose backing data was never confirmed to exist — not a wiring
 * change. Doing it blind would arm outbound Telegram on triggers nobody has
 * validated.
 *
 * The `hourET`/`weekdayET` context below is CORRECT post-clock-fix: the three
 * time rules target hours 18/14/8, which read naturally as 6pm/2pm/8am ET.
 */
import { prisma } from "@/lib/prisma";
import { hourET, weekdayET } from "@/lib/utils/datetime";
import { logger } from "@/lib/logger";
import type { AutomationRule } from "@prisma/client";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface SystemContext {
  devices: { id: string; status: string; currentState: unknown; deviceType: string }[];
  time: Date;
  dayOfWeek: number; // 0=Sunday
  hour: number;
}

export interface FiredRule {
  rule: AutomationRule;
  reason: string;
}

export interface ActionResult {
  ruleId: string;
  ruleName: string;
  actions: { deviceId: string; command: string; status: string }[];
  success: boolean;
}

const log = logger.withContext({ service: "automation-engine" });

export class AutomationEngine {
  /**
   * Evaluate all active rules against current system context.
   * Returns rules that should fire.
   */
  async evaluate(context: SystemContext): Promise<FiredRule[]> {
    const rules = await prisma.automationRule.findMany({
      where: { enabled: true },
      orderBy: { priority: "asc" },
    });

    const firedRules: FiredRule[] = [];

    for (const rule of rules) {
      // Check cooldown
      if (rule.lastFired) {
        const elapsed = Date.now() - rule.lastFired.getTime();
        if (elapsed < rule.cooldownMs) continue;
      }

      const trigger = rule.trigger as any;
      if (!trigger?.type) continue;

      let shouldFire = false;
      let reason = "";

      switch (trigger.type) {
        case "time": {
          // { type: "time", hour: 22, minute?: 0, days?: [1,2,3,4,5] }
          const matchHour = context.hour === trigger.hour;
          const matchMinute = trigger.minute === undefined || new Date().getMinutes() === trigger.minute;
          const matchDay = !trigger.days || trigger.days.includes(context.dayOfWeek);
          shouldFire = matchHour && matchMinute && matchDay;
          reason = `Time trigger: ${trigger.hour}:${trigger.minute ?? "00"}`;
          break;
        }
        case "device_state": {
          // { type: "device_state", deviceId: "...", condition: { status: "OFFLINE" } }
          const device = context.devices.find((d) => d.id === trigger.deviceId);
          if (device && trigger.condition) {
            shouldFire = Object.entries(trigger.condition).every(
              ([k, v]) => (device as any)[k] === v
            );
            reason = `Device ${device.id} matches condition`;
          }
          break;
        }
        case "pattern": {
          // { type: "pattern", category: BRAIN_CATEGORIES.ANOMALY, minConfidence: 0.7 }
          // Check if any recent brain memory matches.
          // v10.0.65 · soft-delete bypass fix · pre-fix this query
          // matched soft-deleted memories too, so a memory the
          // operator pruned could still trigger an automation rule
          // until the row was hard-deleted by data-cleanup cron.
          const memories = await prisma.brainMemory.findMany({
            where: {
              category: trigger.category,
              confidence: { gte: trigger.minConfidence ?? 0.5 },
              lastSeen: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
              deletedAt: null,
            },
            take: 1,
          });
          shouldFire = memories.length > 0;
          reason = `Pattern match: ${trigger.category} (confidence ≥ ${trigger.minConfidence})`;
          break;
        }
      }

      if (shouldFire) {
        firedRules.push({ rule, reason });
      }
    }

    return firedRules;
  }

  /**
   * Execute actions from fired rules.
   * Creates DeviceCommand entries for the local agent to pick up.
   */
  async execute(firedRules: FiredRule[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const { rule, reason } of firedRules) {
      const actions = (rule.actions as any[]) ?? [];
      const actionResults: { deviceId: string; command: string; status: string }[] = [];

      try {
        for (const action of actions) {
          // Create a device command for the local agent
          await prisma.deviceCommand.create({
            data: {
              deviceId: action.deviceId,
              command: action.command,
              params: action.params ?? null,
              status: "pending",
            },
          });
          actionResults.push({
            deviceId: action.deviceId,
            command: action.command,
            status: "queued",
          });
        }

        // Update rule fire count and timestamp
        await prisma.automationRule.update({
          where: { id: rule.id },
          data: {
            lastFired: new Date(),
            fireCount: { increment: 1 },
          },
        });

        log.info(`Rule fired: ${rule.name}`, { ruleId: rule.id, reason, actions: actionResults.length });
        results.push({ ruleId: rule.id, ruleName: rule.name, actions: actionResults, success: true });
      } catch (error) {
        log.error(`Rule failed: ${rule.name}`, { ruleId: rule.id, error: String(error) });
        results.push({ ruleId: rule.id, ruleName: rule.name, actions: actionResults, success: false });
      }
    }

    return results;
  }

  /**
   * Get current system context for rule evaluation.
   */
  async getContext(): Promise<SystemContext> {
    const devices = await prisma.smartDevice.findMany({
      select: { id: true, status: true, currentState: true, deviceType: true },
    });

    const now = new Date();
    return {
      devices,
      time: now,
      dayOfWeek: weekdayET(now),
      hour: hourET(now),
    };
  }
}

export const automationEngine = new AutomationEngine();
