import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { gatewayState } from "@/lib/gatewayState";
import { deriveCronIssues } from "./cron-issues";
import { cameraProblemSeverity, isExpectedCameraState, summarizeCameraFleet, type CameraFleetInputCamera } from "@shared/cameraFleetHealth";

/** Every check below that can fail to run. The "could not run" banner divides by this. */
export const SETTINGS_STATUS_CHECK_COUNT = 9;

export interface OpenIssue {
  key: string;
  severity: "alert" | "warning" | "info";
  title: string;
  detail: string;
  actionHref?: string;
  actionLabel?: string;
  whyText?: string;
}

export function useSettingsStatus() {
  // 1. Execute tRPC queries
  const { data: dashStats, isLoading: isDashStatsLoading, isError: isDashStatsError } = trpc.adminDashboard.stats.useQuery(undefined, { staleTime: 60_000 });
  const { data: flags, isLoading: isFlagsLoading, isError: isFlagsError } = trpc.featureFlags.list.useQuery(undefined, { staleTime: 120_000 });
  const { data: funnel, isLoading: isFunnelLoading, isError: isFunnelError } = trpc.trafficFunnel.overview.useQuery({ range: "30d" }, { staleTime: 120_000 });
  const { data: algStatus, isLoading: isAlgLoading, isError: isAlgError } = trpc.autoLabor.status.useQuery(undefined, { staleTime: 30_000 });
  const { data: smsGwHealth, isLoading: isSmsGwLoading, isError: isSmsGwError } = trpc.sms.gatewayHealth.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: smsStatus, isLoading: isSmsStatusLoading, isError: isSmsStatusError } = trpc.sms.status.useQuery(undefined, { staleTime: 60_000 });
  const { data: vapiStatus, isLoading: isVapiLoading, isError: isVapiError } = trpc.vapi.status.useQuery(undefined, { staleTime: 60_000 });
  const { data: cronHealth, isLoading: isCronLoading, isError: isCronError } = trpc.nickActions.cronHealth.useQuery(undefined, { staleTime: 30_000 });
  const { data: lotHealth, isLoading: isLotHealthLoading, isError: isLotHealthError } = trpc.lot.health.useQuery(undefined, { staleTime: 60_000 });

  // 2. Aggregate loading states
  const isLoading =
    isDashStatsLoading ||
    isFlagsLoading ||
    isFunnelLoading ||
    isAlgLoading ||
    isSmsGwLoading ||
    isSmsStatusLoading ||
    isVapiLoading ||
    isCronLoading ||
    isLotHealthLoading;

  /**
   * WHICH CHECKS COULD NOT RUN? Every rule below silently skips when its
   * query failed (undefined data falls through `?? []` / optional chains), so
   * with all eight queries down this hook used to return zero issues and the
   * tab printed "All clear" — the health screen at its greenest exactly when
   * it was blindest. A check that could not run is a fact the operator must
   * see, distinct from a check that ran and passed.
   */
  const failedChecks = [
    isDashStatsError && "shop stats",
    isFlagsError && "feature flags",
    isFunnelError && "traffic funnel",
    isAlgError && "auto-labor",
    // Q-23 phase 10 · the vendor API not answering (readable:false) is this
    // same check failing to run, not the phone being offline.
    // Q-23 phase 12 · so is our own query failing. gatewayState keeps the
    // cached read for display, but a failed refetch still means the check did
    // not run this time, the same test as the 7 checks around it.
    (isSmsGwError || gatewayState(smsGwHealth) === "unknown") && "SMS gateway health",
    isSmsStatusError && "SMS status",
    isVapiError && "voice (VAPI) status",
    isCronError && "cron health",
    // A camera read that failed — or answered but left nothing judgeable (no commissioned
    // camera, unreadable payload: fleet UNKNOWN) — is a check that did not run, never
    // "cameras healthy".
    (isLotHealthError ||
      (lotHealth !== undefined &&
        summarizeCameraFleet(
          lotHealth.ok === true
            ? { ok: true, cameras: lotHealth.cameras as unknown as CameraFleetInputCamera[] }
            : { ok: false },
        ).state === "UNKNOWN")) && "camera health",
  ].filter((name): name is string => Boolean(name));

  // 3. Compose open-issues stack (moved from view layer to state controller)
  const openIssues = useMemo<OpenIssue[]>(() => {
    const issues: OpenIssue[] = [];

    // RULE 1 · F25e gateway offline → alert
    const shopGwConfigured = smsStatus?.shopGateway?.configured ?? false;
    // Only a phone the vendor API reported as stale is offline. A failed read
    // is listed in failedChecks above; alerting on it blamed the device.
    const gwState = gatewayState(smsGwHealth);
    if (shopGwConfigured && (gwState === "offline" || gwState === "not_configured")) {
      issues.push({
        key: "f25e-offline",
        severity: "alert",
        title: "F25e shop SMS gateway offline",
        // server/sms.ts queues every text while a configured gateway is
        // offline and never falls back to Twilio on that path.
        detail: "Customer texts from 216-862-0005 wait in the queue until the gateway checks back in (after-hours auto-replies are dropped instead). None go out meanwhile.",
        whyText: "The F25e device on Verizon hasn't checked in to the Capevace cloud relay in the last 30 minutes. Check battery + Wi-Fi/LTE + that the SMS Gateway app is open and Cloud Server toggle is ON.",
        actionHref: "/admin?tab=outreach&outreachTab=sms",
        actionLabel: "Open SMS",
      });
    }

    // RULE 2 · disabled feature flags with impact → warning
    const flagsArr = Array.isArray(flags) ? flags : [];
    const highImpactDisabled = flagsArr.filter(
      (f) => f && f.value === false && /(declined|recovery|sms_)/i.test(f.key || ""),
    );
    for (const f of highImpactDisabled.slice(0, 4)) {
      issues.push({
        key: `flag-${f.key}`,
        severity: "warning",
        title: `Feature flag OFF · ${f.key}`,
        detail: f.description || "Customer-contacting automation is disabled. Flipping it on activates the workflow.",
        whyText: "Feature flags gate revenue-affecting workflows so they can be rolled out gradually. This one was left OFF either because it ships in dry-run by default OR because the operator hasn't verified it yet.",
        actionHref: "/admin?tab=settings&settingsTab=shopdriver",
        actionLabel: "Review flag",
      });
    }

    // RULE 3 · bleeding SEO pages (high impr · low CTR) → warning
    const topPages = (funnel?.topPages ?? []).slice(0, 10);
    const bleeders = topPages.filter(
      (p) =>
          p.impressions >= 10_000 &&
          (p.clicks ?? 0) <= (p.impressions * 0.005), // CTR ≤ 0.5%
    );
    for (const p of bleeders.slice(0, 3)) {
      issues.push({
        key: `bleed-${p.page}`,
        severity: "warning",
        title: `${p.page.replace("https://nickstire.org", "")} · ${(p.ctr ?? 0).toFixed(2)}% CTR`,
        detail: `${p.impressions.toLocaleString()} impressions over 30d · only ${p.clicks ?? 0} clicks. Meta title/description likely failing the SERP click test.`,
        whyText: "Pages ranking but not converting impressions to clicks usually have a weak meta description, a buried H1, or a SERP snippet that competes against stronger options. Rewriting title + meta-description is typically a 15-min fix.",
        actionHref: p.page,
        actionLabel: "Open page",
      });
    }

    // RULE 4 · real cron signals (failing jobs + data-accuracy findings like the
    // 2388 missing phones). Previously omitted, which let the "All clear" banner
    // sit green over genuine problems. Latest-run-per-job, deduped in the helper.
    issues.push(...deriveCronIssues(cronHealth ?? []));

    // RULE 5 · commissioned camera not HEALTHY (or its interaction worker down). Before
    // 2026-10-02 no rule read lot.health, so this tab said "All clear" while the sign camera
    // was CAMERA_OFFLINE and the office worker STALE. The camera alert cron pages rather
    // than fails, so RULE 4 never saw it either.
    if (lotHealth?.ok === true) {
      const fleet = summarizeCameraFleet({
        ok: true,
        cameras: lotHealth.cameras as unknown as CameraFleetInputCamera[],
      });
      for (const p of fleet.problems) {
        issues.push({
          key: `camera-${p.camera}`,
          // An EXPECTED state (the solar sign camera dark on its battery overnight) is a warning
          // with its own wording, never an alert: nobody is paged for it and nothing is broken.
          severity: cameraProblemSeverity(p.state),
          title: `Camera · ${p.label}: ${p.state}`,
          detail: isExpectedCameraState(p.state)
            ? "The solar sign camera is dark on its battery between civil dusk and about two hours after sunrise. The lot is unwatched until it wakes; nobody is paged, and daytime loss would show as PRODUCER_OFFLINE instead."
            : "Lot arrivals, bay truth or office capture from this camera cannot be trusted until it is HEALTHY again.",
          whyText: "Per-camera state comes from lot.health (camera_runtime heartbeats + derived health lattice). Only commissioned cameras and unregistered producers are counted.",
          actionHref: "/admin?tab=lot",
          actionLabel: "Open Lot",
        });
      }
    }

    return issues;
  }, [flags, funnel, smsStatus, smsGwHealth, cronHealth, lotHealth]);

  const alertCount = useMemo(() => openIssues.filter((i) => i.severity === "alert").length, [openIssues]);
  const warningCount = useMemo(() => openIssues.filter((i) => i.severity === "warning").length, [openIssues]);

  // KPI calculations — revenue/invoice counts removed (separate register system)
  const totalCustomers = dashStats?.shopFloor?.totalCustomers ?? "—";
  const vipCustomers = dashStats?.shopFloor?.vipCustomers ?? 0;

  return {
    isLoading,
    failedChecks,
    dashStats,
    flags,
    funnel,
    algStatus,
    smsGwHealth,
    /** Q-23 phase 10 · online / offline / unknown / not_configured / checking. */
    smsGwState: gatewayState(smsGwHealth, isSmsGwError),
    smsStatus,
    vapiStatus,
    cronHealth,
    openIssues,
    alertCount,
    warningCount,

    totalCustomers,
    vipCustomers,
  };
}
