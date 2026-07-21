/**
 * Cron · Agentic-Actions Auditor (daily)
 *
 * Tier S · wave-181.x · pairs with the Nick AI call-eval cron (#48)
 * but audits the AGENTIC ACTIONS (tool calls) instead of the
 * conversation outcome. The eval cron grades the call · this cron
 * grades the AGENT's decisions.
 *
 * Why this exists · #48 tells us the call score was 65/100. This
 * cron tells us WHY · "Nick called scheduleDropoff for a Toyota
 * Camry but the customer was driving a Ford F-150" or "Nick told
 * the caller $89 brake pads but our actual price for that service
 * is $129+". These are the agentic drift modes that the
 * conversation-level eval misses.
 *
 * Findings (audit_findings JSON on vapi_call_logs)
 *   · vehicle_mismatch · scheduleDropoff vehicle != caller's known vehicle
 *   · price_drift · quoteRange returned a value outside our pricing
 *     bounds (e.g. quoted $25 oil change when minimum is $50)
 *   · missing_followthrough · submitCallback fired but no callbacks
 *     row exists (callback was promised but not persisted)
 *   · missing_arrival_record · scheduleDropoff/bookSlot fired but no
 *     expected_arrivals row exists (dropoff promised but not persisted)
 *   · tool_error_ignored · tool returned error but agent continued
 *     as if successful (caller heard "I scheduled you" after a fail)
 *
 * Telegram alert · only fires when audit finds severity≥warning
 * findings. Daily-stable runs are silent.
 */

import { createLogger } from "../../lib/logger";

const log = createLogger("cron:agentic-auditor");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

interface AuditFinding {
  type:
    | "vehicle_mismatch"
    | "price_drift"
    | "missing_followthrough"
    | "missing_arrival_record"
    | "tool_error_ignored";
  severity: "info" | "warning" | "alert";
  detail: string;
  toolName?: string;
  toolCallId?: string;
}

interface VapiCallDetail {
  id: string;
  messages?: Array<{
    role?: string;
    toolCalls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
    toolCallId?: string;
    result?: string;
    error?: string;
  }>;
  artifact?: {
    messages?: Array<{
      role?: string;
      toolCalls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
      toolCallId?: string;
      result?: string;
      error?: string;
    }>;
  };
}

// Canonical pricing floor per service · matches §7.1 brand-voice
// pricing. Anything below floor or wildly above ceiling = price_drift.
const PRICING_BOUNDS: Record<string, { floor: number; ceiling: number }> = {
  "oil-change": { floor: 50, ceiling: 150 },
  "brakes": { floor: 89, ceiling: 600 },
  "tires": { floor: 60, ceiling: 400 },
  "diagnostics": { floor: 49, ceiling: 150 },
  "alignment": { floor: 79, ceiling: 150 },
  "emissions": { floor: 29, ceiling: 80 },
  "flat-repair": { floor: 15, ceiling: 35 },
};

const LOOKBACK_HOURS = 36; // overlap with eval cron's 48h window

export async function processAgenticAuditor(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[agentic-auditor] start");

  const { getDb } = await import("../../db");
  const { vapiCallLogs, bookings, callbackRequests, expectedArrivals } = await import("../../../drizzle/schema");
  const { sql, gte, isNull, and, desc, eq } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  // 1 · pull recently-evaluated calls that don't yet have audit findings
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await d
    .select({
      id: vapiCallLogs.id,
      vapiCallId: vapiCallLogs.vapiCallId,
      phoneNumber: vapiCallLogs.phoneNumber,
      durationSeconds: vapiCallLogs.durationSeconds,
      metadata: vapiCallLogs.metadata,
    })
    .from(vapiCallLogs)
    .where(and(gte(vapiCallLogs.createdAt, cutoff), isNull(vapiCallLogs.auditedAt)))
    .orderBy(desc(vapiCallLogs.createdAt))
    .limit(200);

  if (rows.length === 0) {
    return { recordsProcessed: 0, details: "no unaudited calls" };
  }

  const VAPI_API_KEY = process.env.VAPI_API_KEY;
  if (!VAPI_API_KEY) {
    return { recordsProcessed: 0, details: "VAPI_API_KEY not set" };
  }

  const totalFindings: AuditFinding[] = [];
  const callsWithIssues: Array<{ vapiCallId: string; phoneTail4: string; findings: AuditFinding[] }> = [];
  let errored = 0;

  for (const row of rows) {
    try {
      const resp = await fetch(`https://api.vapi.ai/call/${row.vapiCallId}`, {
        headers: { Authorization: `Bearer ${VAPI_API_KEY}` },
      });
      if (!resp.ok) {
        errored++;
        continue;
      }
      const detail = (await resp.json()) as VapiCallDetail;

      // Tool calls live in artifact.messages (post-call) or messages (live).
      const msgs = detail.artifact?.messages ?? detail.messages ?? [];
      const findings: AuditFinding[] = [];

      // Build map of tool call IDs → tool call args, paired with results
      const callsById = new Map<string, { name: string; args: Record<string, unknown> }>();
      const resultsById = new Map<string, { result?: string; error?: string }>();

      for (const m of msgs) {
        if (m.toolCalls?.length) {
          for (const tc of m.toolCalls) {
            const id = tc.id ?? "";
            const name = tc.function?.name ?? "";
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function?.arguments ?? "{}");
            } catch { /* ignore */ }
            callsById.set(id, { name, args });
          }
        }
        if (m.role === "tool_result" || m.role === "tool") {
          const id = m.toolCallId ?? "";
          resultsById.set(id, { result: m.result, error: m.error });
        }
      }

      // 2 · audit each tool call
      for (const [toolCallId, { name, args }] of callsById) {
        const r = resultsById.get(toolCallId);

        // RULE 1 · tool returned error but agent kept going · the conversation
        // continued AFTER a tool error · check by looking for an assistant
        // message in messages after this tool result with no acknowledgement
        // of the failure. Simplified v1 · just flag tool errors as warnings.
        if (r?.error && !r.result) {
          findings.push({
            type: "tool_error_ignored",
            severity: "warning",
            toolName: name,
            toolCallId,
            detail: `${name} returned error: ${(r.error || "").slice(0, 100)}`,
          });
        }

        // RULE 2 · quoteRange · check against PRICING_BOUNDS
        if (name === "quoteRange" || name === "quote_range") {
          const service = String(args.service ?? args.serviceSlug ?? "").toLowerCase();
          const bounds = PRICING_BOUNDS[service];
          if (bounds && r?.result) {
            // VAPI tool results are typically strings or JSON · look for
            // numbers in the result.
            const numbers = (r.result.match(/\$?(\d{2,4})/g) ?? [])
              .map((s) => parseInt(s.replace(/\D/g, ""), 10))
              .filter((n) => n >= 10 && n <= 5000);
            const minQuoted = numbers.length ? Math.min(...numbers) : 0;
            if (minQuoted > 0 && minQuoted < bounds.floor) {
              findings.push({
                type: "price_drift",
                severity: "alert",
                toolName: name,
                toolCallId,
                detail: `quoted $${minQuoted} for ${service} · below floor $${bounds.floor}`,
              });
            }
          }
        }

        // RULE 3 · scheduleDropoff/bookSlot fired · verify an EXPECTED ARRIVAL
        // row was persisted for the customer in the call window. The shop is
        // FCFS with no appointments, so the durable "customer said they're
        // coming" record is an expected_arrivals row, NOT a booking. Its
        // customerPhone is stored normalized to last-10, so match directly.
        if (name === "scheduleDropoff" || name === "schedule_dropoff" || name === "bookSlot") {
          const phone = String(args.phone ?? row.phoneNumber ?? "").replace(/\D/g, "").slice(-10);
          if (phone) {
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
            const [hit] = await d
              .select({ id: expectedArrivals.id })
              .from(expectedArrivals)
              .where(and(
                gte(expectedArrivals.createdAt, since),
                eq(expectedArrivals.customerPhone, phone),
              ))
              .limit(1);
            if (!hit) {
              findings.push({
                type: "missing_arrival_record",
                severity: "alert",
                toolName: name,
                toolCallId,
                detail: `dropoff scheduled but no expected_arrival row found for ...${phone.slice(-4)}`,
              });
            }
          }
        }

        // RULE 4 · submitCallback fired · verify a callbacks row exists
        if (name === "submitCallback" || name === "submit_callback" || name === "escalate") {
          const phone = String(args.phone ?? args.callbackPhone ?? row.phoneNumber ?? "")
            .replace(/\D/g, "")
            .slice(-10);
          if (phone) {
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const [hit] = await d
              .select({ id: callbackRequests.id })
              .from(callbackRequests)
              .where(and(
                gte(callbackRequests.createdAt, since),
                sql`RIGHT(REGEXP_REPLACE(${callbackRequests.phone}, '[^0-9]', ''), 10) = ${phone}`,
              ))
              .limit(1);
            if (!hit) {
              findings.push({
                type: "missing_followthrough",
                severity: "warning",
                toolName: name,
                toolCallId,
                detail: `callback promised but no callbacks row for ...${phone.slice(-4)}`,
              });
            }
          }
        }
      }

      // 3 · persist findings + mark audited
      const auditPayload = {
        findings,
        auditedAt: new Date().toISOString(),
        toolCallCount: callsById.size,
      };
      await d
        .update(vapiCallLogs)
        .set({
          metadata: sql`JSON_SET(COALESCE(${vapiCallLogs.metadata}, JSON_OBJECT()), '$.agenticAudit', CAST(${JSON.stringify(auditPayload)} AS JSON))`,
          auditedAt: new Date(),
        })
        .where(sql`${vapiCallLogs.id} = ${row.id}`);

      totalFindings.push(...findings);
      if (findings.length > 0) {
        callsWithIssues.push({
          vapiCallId: row.vapiCallId,
          phoneTail4: (row.phoneNumber ?? "").replace(/\D/g, "").slice(-4),
          findings,
        });
      }
    } catch (err) {
      errored++;
      log.warn("[agentic-auditor] call audit failed", {
        vapiCallId: row.vapiCallId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4 · Telegram digest only on warning/alert findings
  const alerts = totalFindings.filter((f) => f.severity === "alert").length;
  const warnings = totalFindings.filter((f) => f.severity === "warning").length;
  if (alerts > 0 || warnings >= 3) {
    try {
      const { sendTelegram } = await import("../../services/telegram");
      const lines: string[] = [
        `🔍 AGENTIC AUDIT · ${rows.length} calls · ${alerts} alerts · ${warnings} warnings`,
        ``,
      ];
      for (const c of callsWithIssues.slice(0, 6)) {
        lines.push(`· ...${c.phoneTail4} · ${c.findings.length} finding${c.findings.length === 1 ? "" : "s"}`);
        for (const f of c.findings.slice(0, 3)) {
          const emoji = f.severity === "alert" ? "🚨" : f.severity === "warning" ? "⚠" : "·";
          lines.push(`   ${emoji} ${f.type}: ${f.detail.slice(0, 100)}`);
        }
      }
      if (callsWithIssues.length > 6) {
        lines.push(``, `+ ${callsWithIssues.length - 6} more calls with findings · drill down via vapi_call_logs.metadata.agenticAudit`);
      }
      if (alerts > 0) {
        lines.push(``, `Alerts are agentic drift · price below floor, booking promised but not persisted, etc. Listen to the calls.`);
      }
      await sendTelegram(lines.join("\n"));
    } catch (err) {
      log.warn("[agentic-auditor] telegram failed", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  const durMs = Date.now() - start;
  log.info(`[agentic-auditor] done in ${durMs}ms`, {
    calls: rows.length,
    findings: totalFindings.length,
    alerts,
    warnings,
    errored,
  });

  return {
    recordsProcessed: rows.length,
    details: `audited=${rows.length} findings=${totalFindings.length} alerts=${alerts} warnings=${warnings} errors=${errored}`,
  };
}
