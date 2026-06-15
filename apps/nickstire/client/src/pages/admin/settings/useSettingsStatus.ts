import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

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
  const { data: dashStats, isLoading: isDashStatsLoading } = trpc.adminDashboard.stats.useQuery(undefined, { staleTime: 60_000 });
  const { data: flags, isLoading: isFlagsLoading } = trpc.featureFlags.list.useQuery(undefined, { staleTime: 120_000 });
  const { data: funnel, isLoading: isFunnelLoading } = trpc.trafficFunnel.overview.useQuery({ range: "30d" }, { staleTime: 120_000 });
  const { data: algStatus, isLoading: isAlgLoading } = trpc.autoLabor.status.useQuery(undefined, { staleTime: 30_000 });
  const { data: smsGwHealth, isLoading: isSmsGwLoading } = trpc.sms.gatewayHealth.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: smsStatus, isLoading: isSmsStatusLoading } = trpc.sms.status.useQuery(undefined, { staleTime: 60_000 });
  const { data: vapiStatus, isLoading: isVapiLoading } = trpc.vapi.status.useQuery(undefined, { staleTime: 60_000 });
  const { data: cronHealth, isLoading: isCronLoading } = trpc.nickActions.cronHealth.useQuery(undefined, { staleTime: 30_000 });

  // 2. Aggregate loading states
  const isLoading =
    isDashStatsLoading ||
    isFlagsLoading ||
    isFunnelLoading ||
    isAlgLoading ||
    isSmsGwLoading ||
    isSmsStatusLoading ||
    isVapiLoading ||
    isCronLoading;

  // 3. Compose open-issues stack (moved from view layer to state controller)
  const openIssues = useMemo<OpenIssue[]>(() => {
    const issues: OpenIssue[] = [];

    // RULE 1 · F25e gateway offline → alert
    const shopGwConfigured = smsStatus?.shopGateway?.configured ?? false;
    const shopGwOnline = smsGwHealth?.online ?? false;
    if (shopGwConfigured && !shopGwOnline) {
      issues.push({
        key: "f25e-offline",
        severity: "alert",
        title: "F25e shop SMS gateway offline",
        detail: "Customer-facing SMS via 216-862-0005 will fail until the gateway comes back. Sends fall through to Twilio (if Twilio is up).",
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

    return issues;
  }, [flags, funnel, smsStatus, smsGwHealth]);

  const alertCount = useMemo(() => openIssues.filter((i) => i.severity === "alert").length, [openIssues]);
  const warningCount = useMemo(() => openIssues.filter((i) => i.severity === "warning").length, [openIssues]);

  // KPI calculations — revenue/invoice counts removed (separate register system)
  const totalCustomers = dashStats?.shopFloor?.totalCustomers ?? "—";
  const vipCustomers = dashStats?.shopFloor?.vipCustomers ?? 0;

  return {
    isLoading,
    dashStats,
    flags,
    funnel,
    algStatus,
    smsGwHealth,
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
