/**
 * ComplianceSection — TCPA opt-in / opt-out log + admin login audit.
 * Defensive visibility. If Twilio calls about a complaint, or you want to
 * know "who else signed into admin this week", this is the page.
 */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader, LoadingState, ErrorState } from "../shared";
import {
  Shield, UserCheck, UserX, LogIn, AlertTriangle, Clock, Globe,
} from "lucide-react";
import { timeAgoShort as timeAgo } from "../shared/format";

type Tab = "logins" | "consent" | "failures";

export default function ComplianceSection() {
  const [tab, setTab] = useState<Tab>("logins");
  const { data: loginData, isError: loginsError, refetch: refetchLogins } = trpc.controlCenter.recentAdminLogins.useQuery({ limit: 50 });
  const { data: consentData, isError: consentError, refetch: refetchConsent } = trpc.controlCenter.smsConsentAudit.useQuery({ limit: 200 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance"
        subtitle="TCPA SMS audit trail + admin login visibility. Every entry is timestamped and IP-attributed."
        icon={<Shield className="w-5 h-5" />}
        badge={
          loginData && consentData
            ? {
                label: `${loginData.successes.length} logins · ${consentData.totalOptIns} opt-ins · ${consentData.totalOptOuts} opt-outs`,
                variant: loginData.failures.length > 0 ? "warning" : "neutral",
              }
            : undefined
        }
      />

      {/* ─── Tab bar ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/20 pb-0">
        {(
          [
            { id: "logins", label: "Admin Logins", icon: LogIn, count: loginData?.successes.length },
            { id: "consent", label: "SMS Consent", icon: UserCheck, count: consentData ? consentData.totalOptIns + consentData.totalOptOuts : undefined },
            { id: "failures", label: "Login Failures", icon: AlertTriangle, count: loginData?.failures.length },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
              {typeof t.count === "number" && (
                <span className="font-mono text-[10px] text-muted-foreground">({t.count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Admin Logins ──────────────────────────── */}
      {tab === "logins" && (
        <div className="space-y-3">
          {loginsError ? (
            <ErrorState message="Couldn't load admin login audit" onRetry={() => refetchLogins()} />
          ) : !loginData ? (
            <LoadingState />
          ) : loginData.successes.length === 0 ? (
            <div className="border border-border/30 bg-card/50 p-10 text-center">
              <LogIn className="w-8 h-8 mx-auto mb-3 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No admin logins yet.</p>
            </div>
          ) : (
            <>
              {loginData.uniqueIpsLast30d.length > 0 && (
                <div className="border border-border/30 bg-card/50 p-3 text-xs">
                  <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                    <Globe className="w-3.5 h-3.5" />
                    <span className="uppercase tracking-widest text-[10px] font-bold">
                      Unique IPs, last 30 days ({loginData.uniqueIpsLast30d.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {loginData.uniqueIpsLast30d.map((ip) => (
                      <span key={ip} className="font-mono text-[10px] px-2 py-0.5 rounded bg-secondary">
                        {ip}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* wave-119 — was `overflow-hidden` which actively prevented
                  horizontal scroll on phone (Email + IP columns overflow
                  390px viewport). Switched to `overflow-x-auto` so operator
                  can scroll the table on phone to read security audit info. */}
              <div className="overflow-x-auto border border-border/30 bg-card/50">
                <table className="w-full text-sm">
                  <thead className="bg-background/50 text-[10px] uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="text-left p-3">When</th>
                      <th className="text-left p-3">Email</th>
                      <th className="text-left p-3">IP</th>
                      <th className="text-left p-3 hidden sm:table-cell">User-Agent</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {loginData.successes.map((s) => (
                      <tr key={s.id} className="border-t border-border/20 hover:bg-background/30 transition-colors">
                        <td className="p-3 text-muted-foreground whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(s.createdAt)}
                          </span>
                        </td>
                        <td className="p-3 font-bold text-foreground">{s.actor}</td>
                        <td className="p-3 text-muted-foreground">{s.ipAddress || "—"}</td>
                        <td className="p-3 text-muted-foreground hidden sm:table-cell truncate max-w-xs">
                          {typeof s.changes === "object" && s.changes && "userAgent" in s.changes
                            ? String((s.changes as { userAgent?: string }).userAgent ?? "—")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── SMS Consent ───────────────────────────── */}
      {tab === "consent" && (
        <div className="space-y-4">
          {consentError ? (
            <ErrorState message="Couldn't load SMS consent audit" onRetry={() => refetchConsent()} />
          ) : !consentData ? (
            <LoadingState />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 text-emerald-400 mb-1">
                    <UserCheck className="w-4 h-4" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Opt-ins</span>
                  </div>
                  <div className="font-mono font-black text-3xl text-foreground">{consentData.totalOptIns}</div>
                </div>
                <div className="border border-red-500/30 bg-red-500/5 p-4">
                  <div className="flex items-center gap-2 text-red-400 mb-1">
                    <UserX className="w-4 h-4" />
                    <span className="text-[10px] uppercase tracking-widest font-bold">Opt-outs</span>
                  </div>
                  <div className="font-mono font-black text-3xl text-foreground">{consentData.totalOptOuts}</div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                  Recent consent events
                </h3>
                <div className="overflow-x-auto border border-border/30 bg-card/50">
                  <table className="w-full text-xs">
                    <thead className="bg-background/50 text-[10px] uppercase tracking-widest text-muted-foreground">
                      <tr>
                        <th className="text-left p-2.5">When</th>
                        <th className="text-left p-2.5">Type</th>
                        <th className="text-left p-2.5">Phone</th>
                        <th className="text-left p-2.5 hidden sm:table-cell">Source</th>
                        <th className="text-left p-2.5 hidden md:table-cell">IP</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {[
                        ...consentData.optIns.map((e) => ({ ...e, kind: "in" as const })),
                        ...consentData.optOuts.map((e) => ({ ...e, kind: "out" as const })),
                      ]
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .slice(0, 100)
                        .map((e) => (
                          <tr key={e.id} className="border-t border-border/20 hover:bg-background/30 transition-colors">
                            <td className="p-2.5 text-muted-foreground whitespace-nowrap">{timeAgo(e.createdAt)}</td>
                            <td className="p-2.5">
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  e.kind === "in"
                                    ? "text-emerald-400 bg-emerald-500/10"
                                    : "text-red-400 bg-red-500/10"
                                }`}
                              >
                                {e.kind === "in" ? "OPT-IN" : "OPT-OUT"}
                              </span>
                            </td>
                            <td className="p-2.5 text-foreground">{e.actor}</td>
                            <td className="p-2.5 text-muted-foreground hidden sm:table-cell">
                              {typeof e.changes === "object" && e.changes && "source" in e.changes
                                ? String((e.changes as { source?: string; via?: string }).source ?? (e.changes as { via?: string }).via ?? "—")
                                : "—"}
                            </td>
                            <td className="p-2.5 text-muted-foreground hidden md:table-cell">
                              {e.ipAddress || "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Login Failures ─────────────────────────── */}
      {tab === "failures" && (
        <div>
          {loginsError ? (
            <ErrorState message="Couldn't load login audit" onRetry={() => refetchLogins()} />
          ) : !loginData ? (
            <LoadingState />
          ) : loginData.failures.length === 0 ? (
            <div className="border border-border/30 bg-card/50 p-10 text-center">
              <UserCheck className="w-8 h-8 mx-auto mb-3 text-emerald-400/80" />
              <p className="text-sm text-muted-foreground">No failed admin logins. Clean.</p>
            </div>
          ) : (
            // wave-119 — same overflow-hidden→overflow-x-auto fix as the
            // login-history table above. Operator can scroll on phone.
            <div className="overflow-x-auto border border-red-500/30 bg-red-500/5">
              <table className="w-full text-sm">
                <thead className="bg-background/50 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">When</th>
                    <th className="text-left p-3">Attempted</th>
                    <th className="text-left p-3">Reason</th>
                    <th className="text-left p-3">IP</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  {loginData.failures.map((f) => (
                    <tr key={f.id} className="border-t border-border/20 hover:bg-background/30 transition-colors">
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{timeAgo(f.createdAt)}</td>
                      <td className="p-3 font-bold text-red-400">{f.actor}</td>
                      <td className="p-3 text-muted-foreground truncate max-w-xs">
                        {typeof f.changes === "object" && f.changes && "reason" in f.changes
                          ? String((f.changes as { reason?: string }).reason ?? "—")
                          : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">{f.ipAddress || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
