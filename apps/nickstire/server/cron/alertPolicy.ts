/**
 * Q-28 · Alertmanager-style cron alert policy.
 *
 * Pattern only: grouping, quiet-time routing, dependency inhibition and
 * resolved notices. No Alertmanager dependency/server is introduced.
 */
export interface FailureAlertItem {
  jobName: string;
  consecutiveFailures: number;
  latestError: string | null;
  latestFailureAt: Date;
}

export interface ShapeAlertItem {
  loop: string;
  verdict: string;
  ros?: string | null;
  summary: string;
  firstCheck: string;
}

function localHour(nowMs: number, timeZone: string): number {
  const token = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(new Date(nowMs));
  const hour = Number(token);
  return hour === 24 ? 0 : hour;
}

/**
 * Quiet window defaults to 22:00–07:00 local operator time. The observer only
 * applies it to downstream job/shape noise; a root DB dependency outage bypasses
 * quiet hours so the control plane never sleeps through its own blindness.
 */
export function isCronAlertQuietHours(
  nowMs: number,
  timeZone: string,
  startHour = 22,
  endHour = 7,
): boolean {
  if (
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    startHour < 0 ||
    startHour > 23 ||
    endHour < 0 ||
    endHour > 23
  ) {
    throw new Error("quiet-hour bounds must be integers in 0..23");
  }
  if (startHour === endHour) return false;
  const hour = localHour(nowMs, timeZone);
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

const clean = (value: string | null | undefined, max = 180): string =>
  (value || "no error message logged").replace(/\s+/g, " ").trim().slice(0, max);

export function formatFailureAlertGroup(
  failures: readonly FailureAlertItem[],
  lookbackHours: number,
): string {
  const shown = failures.slice(0, 12);
  const lines = shown.map(
    (f) =>
      `• \`${f.jobName}\` · ${f.consecutiveFailures} consecutive · ${clean(f.latestError)} · ${f.latestFailureAt.toISOString()}`,
  );
  if (failures.length > shown.length) {
    lines.push(`• … ${failures.length - shown.length} more failing job(s) in this group`);
  }
  return (
    `🚨 Cron failures · ${failures.length} job(s)\n` +
    `Grouped from the last ${lookbackHours}h; one Telegram, not one page per job.\n` +
    lines.join("\n")
  );
}

export function formatShapeAlertGroup(findings: readonly ShapeAlertItem[]): string {
  const shown = findings.slice(0, 10);
  const lines = shown.map(
    (f) =>
      `• \`${f.loop}\` → ${f.verdict}${f.ros ? ` (${f.ros})` : ""} · ${clean(f.summary, 220)} · check: ${clean(f.firstCheck, 220)}`,
  );
  if (findings.length > shown.length) {
    lines.push(`• … ${findings.length - shown.length} more loop finding(s)`);
  }
  return `📉 Loop-shape alerts · ${findings.length} finding(s)\n${lines.join("\n")}`;
}

export function formatResolvedAlertGroup(keys: readonly string[]): string {
  const labels = keys.slice(0, 20).map((key) => `• ${key}`);
  if (keys.length > labels.length) labels.push(`• … ${keys.length - labels.length} more`);
  return `✅ Cron alerts resolved · ${keys.length}\n${labels.join("\n")}`;
}

export function formatDatabaseDependencyAlert(error: unknown): string {
  const message = clean(error instanceof Error ? error.message : String(error), 300);
  return (
    "🚨 Cron observer dependency · database unavailable\n" +
    "Downstream job-failure pages are inhibited until the observer can read cron_log again.\n" +
    `Observer error: ${message}`
  );
}
