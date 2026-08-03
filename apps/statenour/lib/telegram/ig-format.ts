/**
 * Pure formatters for the operator's read-only /ig Telegram surface.
 *
 * Shape rule, copied from the service these read (nickstire
 * server/services/socialDeliveryIssues.ts): the formatter is PURE. All reads
 * live in the caller, so the rendering rules are testable without mocking half
 * the server — and the rule that actually matters here is testable at all.
 *
 * THE RULE: null means UNKNOWN, never zero.
 *
 * nickstire deliberately returns null for facts it could not read —
 * `metaLive`, `controls`, `publishAmbiguousReelJobs`, `jobsNeedingAttention`,
 * and every count in ReelReliability. It pays real complexity for that
 * distinction. A single `?? 0` on this side would convert a database outage
 * into a clean bill of health and throw the whole discipline away, which is
 * the failure mode this repo has already had to fix in several other places.
 */

export interface IgDeliveryIssue {
  key: string;
  layer: string;
  severity: "blocker" | "warning" | "info";
  reason: string;
  evidence: string;
  nextAction: string;
}

export interface IgDeliveryFacts {
  generatorProvider: string;
  generatorConfigured: boolean;
  generationEnabled: boolean;
  reelPublishArmed: boolean;
  metaLive: boolean | null;
  publishAmbiguousReelJobs: number | null;
  jobsNeedingAttention: number | null;
}

export interface IgReelReliability {
  windowDays: number;
  total: number | null;
  byStatus: Record<string, number>;
  succeeded: number | null;
  failed: number | null;
  closedFailures: number | null;
  ambiguous: number | null;
  failureRate: number | null;
}

export interface IgAutopostRow {
  archetype: string | null;
  status: string | null;
  createdAt: string | Date | null;
  error: string | null;
}

export function escapeIgHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders UNKNOWN for null/undefined. Never 0 — that is the entire point. */
export function igNum(n: number | null | undefined): string {
  return typeof n === "number" ? String(n) : "unknown";
}

const SEVERITY_ICON: Record<string, string> = {
  blocker: "🔴",
  warning: "🟠",
  info: "ℹ️",
};

export function formatDeliveryIssues(data: {
  issues: IgDeliveryIssue[];
  facts: IgDeliveryFacts;
}): string {
  const issues = data.issues ?? [];
  const facts = data.facts;
  // `info` issues are DELIBERATE control state (a kill switch that is
  // intentionally on). Painting deliberate stops red trains the operator to
  // ignore red, so they collapse to a count instead of a stanza.
  const loud = issues.filter((i) => i.severity !== "info");
  const infoCount = issues.length - loud.length;
  const blockers = loud.filter((i) => i.severity === "blocker").length;
  const warnings = loud.filter((i) => i.severity === "warning").length;

  const body = loud.length
    ? loud
        .map(
          (i) =>
            `${SEVERITY_ICON[i.severity] ?? "•"} <b>${escapeIgHtml(i.layer)}</b> — ${escapeIgHtml(i.reason)}\n   → ${escapeIgHtml(i.nextAction)}`,
        )
        .join("\n\n")
    : "No blockers or warnings.";

  const metaLine =
    facts.metaLive === null ? "meta unknown" : facts.metaLive ? "meta live" : "meta DOWN";
  const footer =
    `<i>provider ${escapeIgHtml(facts.generatorProvider)} · creds ${facts.generatorConfigured ? "ok" : "MISSING"} · ` +
    `gen ${facts.generationEnabled ? "on" : "off"} · publish ${facts.reelPublishArmed ? "armed" : "off"} · ${metaLine}</i>`;

  return (
    `📸 <b>IG delivery</b> · ${blockers} blocker${blockers === 1 ? "" : "s"} · ${warnings} warning${warnings === 1 ? "" : "s"}\n\n` +
    `${body}\n\n` +
    (infoCount ? `<i>${infoCount} info item${infoCount === 1 ? "" : "s"} (deliberate control state)</i>\n` : "") +
    `<i>attention: ${igNum(facts.jobsNeedingAttention)} · ambiguous: ${igNum(facts.publishAmbiguousReelJobs)}</i>\n` +
    footer
  );
}

export function formatReelReliability(r: IgReelReliability): string {
  // All-null is the service's explicit "could not read the table" signal. It
  // must never render as a healthy zero.
  if (r.total === null) {
    return `🎬 <b>Reels · last ${r.windowDays}d</b>\n\nPipeline stats unreadable — <b>UNKNOWN, not healthy</b>.`;
  }

  const rate = r.failureRate === null ? "unknown" : `${Math.round(r.failureRate * 100)}%`;
  const statuses = Object.entries(r.byStatus ?? {})
    .map(([k, v]) => `${escapeIgHtml(k)} ${v}`)
    .join(" · ");

  return (
    `🎬 <b>Reels · last ${r.windowDays}d</b>\n\n` +
    `${igNum(r.total)} jobs · ${igNum(r.succeeded)} ok · ${igNum(r.failed)} unresolved · ${igNum(r.closedFailures)} closed by you\n` +
    `failure rate ${rate} <i>(closed excluded both sides)</i>\n` +
    (r.ambiguous ? `\n⚠️ ${r.ambiguous} ambiguous — may already be live, do not retry blind\n` : "") +
    (statuses ? `\n<i>${statuses}</i>` : "")
  );
}

export function formatAutopostLane(data: {
  livePostingEnabled: boolean;
  latestLogs: IgAutopostRow[];
}): string {
  const rows = (data.latestLogs ?? []).map((l) => {
    // Prod carries BOTH spellings as success. Treating only one as success is
    // the exact bug the nickstire service documents.
    const icon =
      l.status === "posted" || l.status === "published"
        ? "✅"
        : l.status === "failed"
          ? "❌"
          : "⚪";
    const when = l.createdAt
      ? new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "?";
    const tail = l.error ? `\n   ${escapeIgHtml(l.error.slice(0, 140))}` : "";
    return `${icon} ${escapeIgHtml(l.archetype ?? "unknown")} · ${escapeIgHtml(l.status ?? "unknown")} · ${when}${tail}`;
  });

  // The lane is NAMED on purpose: reels publish through reel_jobs and appear
  // nowhere in this log, so "no rows" must not read as "nothing posted today".
  return (
    `📅 <b>IG autopost lane</b> · last ${rows.length} run${rows.length === 1 ? "" : "s"}\n` +
    `${data.livePostingEnabled ? "🟢" : "⚪"} live posting ${data.livePostingEnabled ? "on" : "off"}\n\n` +
    (rows.length ? rows.join("\n") : "No autopost runs recorded.") +
    `\n\n<i>This lane only. Reels publish separately — see /ig reels.</i>`
  );
}

export function igUsage(): string {
  return (
    `📸 <b>/ig</b> — read-only Instagram\n\n` +
    `/ig — delivery blockers + what to do\n` +
    `/ig reels — 30-day pipeline reliability\n` +
    `/ig today — the autopost lane's last runs`
  );
}
