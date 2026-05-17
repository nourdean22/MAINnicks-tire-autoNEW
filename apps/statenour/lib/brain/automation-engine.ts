import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AutomationRule } from "@prisma/client";

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
          // { type: "pattern", category: "anomaly", minConfidence: 0.7 }
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
      dayOfWeek: now.getDay(),
      hour: now.getHours(),
    };
  }
}

export const automationEngine = new AutomationEngine();
