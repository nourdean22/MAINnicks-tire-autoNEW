/**
 * smart-now · v10.0.348 · pick the "DO THIS NOW" suggestion for the
 * floating-home orb based on current context.
 *
 * Priority order (top wins):
 *   1. CRITICAL · system has fatal errors or cron failures · → health-grid
 *   2. PENDING · actionsPending > 0 · → /system/actions
 *   3. QUALITY · AI error rate spike > 30% · → /system/diagnostics
 *   4. TIME-OF-DAY · morning → /plan, afternoon → /tasks, evening → /journal
 *   5. DEFAULT · /chat (Nick is the daily-driver)
 *
 * Skips the suggestion entirely if the operator is already ON the
 * suggested target. The orb shouldn't suggest something the operator
 * is currently doing.
 *
 * Pure function · trivial to test · no side effects.
 */

import type { SystemPulse } from "@/lib/hooks/use-system-pulse";
import { hourET } from "@/lib/utils/datetime";

export type SmartNowUrgency = "high" | "medium" | "low";

export interface SmartNowSuggestion {
  href: string;
  label: string;
  reason: string;
  urgency: SmartNowUrgency;
  /** Optional emoji prefix · adds personality to the suggestion. */
  emoji?: string;
}

/**
 * Pick the best "do this now" suggestion or null if no actionable signal.
 */
export function pickSmartNow(args: {
  pathname: string;
  pulse: SystemPulse | null;
  hour?: number; // override for tests · default = current hour
}): SmartNowSuggestion | null {
  const { pathname, pulse } = args;
  const hour = args.hour ?? hourET();

  // ── 1. CRITICAL · fatal errors or cron failures ──
  if (pulse) {
    const fatalErrors = pulse.errorsFatal6h ?? pulse.errorsFatal24h ?? 0;
    const criticalCronFails = pulse.cronFails1h ?? 0;
    if (fatalErrors > 0 || criticalCronFails > 0) {
      const target = "/system/health";
      if (!pathname.startsWith(target)) {
        const issues = fatalErrors + criticalCronFails;
        return {
          href: target,
          label: `${issues} system issue${issues === 1 ? "" : "s"}`,
          reason: fatalErrors > 0 ? "fatal errors detected" : "cron failures",
          urgency: "high",
          emoji: "🚨",
        };
      }
    }
  }

  // ── 2. PENDING · actions awaiting approval ──
  if (pulse && pulse.actionsPending > 0) {
    const target = "/system/actions";
    if (!pathname.startsWith(target)) {
      return {
        href: target,
        label: `${pulse.actionsPending} pending`,
        reason: "actions awaiting approval",
        urgency: "high",
        emoji: "⏳",
      };
    }
  }

  // ── 3. QUALITY · AI error rate spike ──
  if (pulse) {
    const errorRate = pulse.aiErrorRate1h ?? pulse.aiErrorRate ?? 0;
    if (errorRate > 30) {
      const target = "/system/health";
      if (!pathname.startsWith(target)) {
        return {
          href: target,
          label: `${Math.round(errorRate)}% AI errors`,
          reason: "AI error rate spike",
          urgency: "medium",
          emoji: "⚠️",
        };
      }
    }
  }

  // ── 4. TIME-OF-DAY ──
  // Morning · 5am-10am → plan the day
  if (hour >= 5 && hour < 10) {
    const target = "/stats";
    if (!pathname.startsWith(target)) {
      return {
        href: target,
        label: "Plan today",
        reason: "morning planning window",
        urgency: "low",
        emoji: "🌅",
      };
    }
  }

  // Afternoon · 10am-5pm → execute tasks
  if (hour >= 10 && hour < 17) {
    const target = "/missions";
    if (!pathname.startsWith(target)) {
      return {
        href: target,
        label: "Active tasks",
        reason: "execution window",
        urgency: "low",
        emoji: "⚡",
      };
    }
  }

  // Evening · 5pm-10pm → journal + reflect
  if (hour >= 17 && hour < 22) {
    const target = "/journal";
    if (!pathname.startsWith(target)) {
      return {
        href: target,
        label: "Journal today",
        reason: "evening reflection",
        urgency: "low",
        emoji: "📓",
      };
    }
  }

  // Late night · 10pm-5am → /chat (default · won't suggest if already there)
  const target = "/chat";
  if (!pathname.startsWith(target)) {
    return {
      href: target,
      label: "Ask Nick",
      reason: "default daily-driver",
      urgency: "low",
      emoji: "💬",
    };
  }

  return null;
}
