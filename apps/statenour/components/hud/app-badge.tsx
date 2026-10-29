"use client";

/**
 * AppBadge — BDN-205 (2026-08-13).
 *
 * Pending-approval count on the installed PWA's home-screen icon via
 * the Badge API (navigator.setAppBadge). The queue is invisible when
 * the app is closed; the badge is the $0, zero-UI surface for it —
 * and the count matches Home's approvals line and /system/actions (live
 * ApprovalRequest rows + live AutonomousAction queue rows, countLiveDecisions).
 *
 * Renders nothing. Feature-detected: iOS 16.4+ standalone PWAs support
 * setAppBadge (notification permission required on iOS — when it's not
 * granted the call silently no-ops, which is the correct degradation).
 * Badge is cleared, never left stale, when the count reaches zero or
 * the component unmounts.
 */

import { useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { countLiveDecisions } from "@/lib/automation/live-decisions";

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function AppBadge() {
  const pendingQ = trpc.systemAutomation.getPendingApprovals.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const approvalsQ = trpc.systemAutomation.approvals.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const loaded = pendingQ.data !== undefined || approvalsQ.data !== undefined;
  // 2026-09-07 (D12) · expired authorizations are listed but not "waiting on
  // you" — the icon badge counts what can still be approved.
  // Narrow to the one field we read: the tRPC-inferred row types are deep
  // enough that filtering on them directly trips TS2589.
  const requests: ReadonlyArray<{ expired?: boolean }> = pendingQ.data ?? [];
  const actions: ReadonlyArray<{ expired?: boolean }> = approvalsQ.data?.rows ?? [];
  // The same live count Home and /system/actions show (lib/automation/live-decisions.ts).
  const count = countLiveDecisions(requests, actions).live;

  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (typeof nav.setAppBadge !== "function") return;
    // Don't stamp anything until at least one query has ANSWERED —
    // clearing on "loading" would erase a real badge on every app open.
    if (!loaded) return;
    if (count > 0) {
      void nav.setAppBadge(count).catch(() => {});
    } else {
      void nav.clearAppBadge?.().catch(() => {});
    }
  }, [count, loaded]);

  useEffect(() => {
    return () => {
      const nav = navigator as BadgeNavigator;
      void nav.clearAppBadge?.().catch(() => {});
    };
  }, []);

  return null;
}
