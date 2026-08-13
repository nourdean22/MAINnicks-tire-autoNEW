"use client";

/**
 * AppBadge — BDN-205 (2026-08-13).
 *
 * Pending-approval count on the installed PWA's home-screen icon via
 * the Badge API (navigator.setAppBadge). The queue is invisible when
 * the app is closed; the badge is the $0, zero-UI surface for it —
 * and the count matches the header pill (home-identity-header.tsx:32:
 * ApprovalRequest pending + AutonomousAction queue rows).
 *
 * Renders nothing. Feature-detected: iOS 16.4+ standalone PWAs support
 * setAppBadge (notification permission required on iOS — when it's not
 * granted the call silently no-ops, which is the correct degradation).
 * Badge is cleared, never left stale, when the count reaches zero or
 * the component unmounts.
 */

import { useEffect } from "react";
import { trpc } from "@/lib/trpc/client";

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
  const count = (pendingQ.data?.length ?? 0) + (approvalsQ.data?.rows?.length ?? 0);

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
