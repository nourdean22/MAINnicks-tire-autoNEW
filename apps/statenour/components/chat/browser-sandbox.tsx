"use client";

/**
 * <BrowserSandbox /> — desktop-only slide-out panel mirroring the
 * BuilderSandbox pattern, but for the live Browserbase session.
 *
 * Shows up when personality === "builder" AND Nick has created an
 * active browser session (either via the `browser_do` tool call or
 * Nour tapping "New session" in the panel). Embeds the session's
 * live-view URL in an iframe so Nour can watch + take over.
 *
 * Graceful states:
 *   · Browserbase not configured → "connecting" state with env hint
 *   · No active sessions → empty state with a "+ New session" button
 *   · Has session → iframe + [close] action
 *
 * Session discovery: GET /api/browser/session (lists), POST creates,
 * DELETE?id=… closes. All owner-authed.
 */

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  X,
  Globe,
  Loader2,
  RefreshCw,
  Plus,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";

interface BrowserSession {
  id: string;
  status: string;
  liveViewUrl?: string;
  connectUrl?: string;
  createdAt: string;
  expiresAt?: string;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "not_configured" }
  | { kind: "error"; message: string }
  | { kind: "idle"; sessions: BrowserSession[] }
  | { kind: "active"; session: BrowserSession; sessions: BrowserSession[] };

export function BrowserSandbox({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    setState({ kind: "loading" });
    try {
      const res = await authedFetch("/api/browser/session");
      if (res.status === 501) {
        setState({ kind: "not_configured" });
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setState({ kind: "error", message: `${res.status} · ${body.slice(0, 140)}` });
        return;
      }
      const raw = (await res.json().catch(() => ({}))) as {
        data?: { sessions?: BrowserSession[] };
      };
      const sessions = raw.data?.sessions ?? [];
      const active = sessions.find((s) => s.status !== "COMPLETED" && s.status !== "RELEASED" && s.liveViewUrl);
      if (active) {
        setState({ kind: "active", session: active, sessions });
      } else {
        setState({ kind: "idle", sessions });
      }
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [open]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createNew() {
    setBusy(true);
    try {
      const res = await authedFetch("/api/browser/session", { method: "POST" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        toast.error(`new session failed: ${res.status} ${body.slice(0, 80)}`);
        return;
      }
      toast.success("session created — loading live view");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function closeSession(id: string) {
    setBusy(true);
    try {
      const res = await authedFetch(`/api/browser/session?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`close failed: ${res.status}`);
        return;
      }
      toast.success("session closed");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[480px] z-[90] bg-[var(--bg-void)] border-l border-[var(--border-default)] shadow-2xl hidden md:flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-violet-400" />
          <span className="text-[12px] font-bold text-violet-400 uppercase tracking-wider">
            Browser
          </span>
          {state.kind === "active" && (
            <span className="text-[9px] font-mono text-emerald-400 ml-1 inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void load()}
            disabled={busy}
            title="Refresh"
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded"
          >
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onClose}
            title="Close panel"
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)] p-6 justify-center">
            <Loader2 size={12} className="animate-spin" />
            loading sessions…
          </div>
        )}

        {state.kind === "not_configured" && (
          <div className="p-4">
            <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-[var(--gold)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-[var(--gold)] uppercase tracking-wider mb-1">
                    Browserbase not configured
                  </p>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    Sign up at <span className="font-mono">browserbase.com</span>{" "}
                    (2 min, Google auth). Drop keys into Vercel env:
                  </p>
                  <pre className="mt-2 bg-[var(--bg-base)] rounded p-2 text-[10px] font-mono text-[var(--text-primary)] overflow-x-auto">
BROWSERBASE_API_KEY=…
BROWSERBASE_PROJECT_ID=…
                  </pre>
                  <p className="text-[10px] text-[var(--text-tertiary)] mt-2">
                    Once set, Nick can spin cloud Chrome sessions for web
                    tasks — ShopDriver, Gong, Stripe dashboards, any form-
                    fill flow. Live view right here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {state.kind === "error" && (
          <div className="p-4">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <p className="text-[11px] font-bold text-rose-300">session fetch failed</p>
              <p className="text-[10px] text-rose-300/70 mt-0.5 break-words font-mono">
                {state.message}
              </p>
              <button
                onClick={() => void load()}
                className="mt-2 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-400/10"
              >
                retry
              </button>
            </div>
          </div>
        )}

        {state.kind === "idle" && (
          <div className="p-4 space-y-3">
            <div className="text-center py-6 text-[11px] text-[var(--text-tertiary)]">
              no active sessions
            </div>
            <button
              onClick={() => void createNew()}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors text-[11px] font-bold uppercase tracking-wider"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              New session
            </button>
            {state.sessions.length > 0 && (
              <div className="pt-3 border-t border-[var(--border-default)]">
                <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                  recent · closed/completed
                </p>
                <div className="space-y-1">
                  {state.sessions.slice(0, 5).map((s) => (
                    <div key={s.id} className="text-[9px] font-mono text-[var(--text-tertiary)] px-2 py-1 rounded bg-[var(--bg-base)]">
                      {s.status} · {new Date(s.createdAt).toLocaleTimeString()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {state.kind === "active" && (
          <>
            {/* Live view */}
            <div className="relative w-full" style={{ height: "calc(100vh - 200px)" }}>
              {state.session.liveViewUrl ? (
                <iframe
                  src={state.session.liveViewUrl}
                  className="w-full h-full border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  allow="clipboard-read; clipboard-write"
                  title="Browserbase live view"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-[11px] text-[var(--text-tertiary)]">
                  session has no live-view URL
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="p-3 border-t border-[var(--border-default)] space-y-2">
              <div className="flex items-center justify-between text-[9px] font-mono text-[var(--text-tertiary)]">
                <span>id: {state.session.id.slice(0, 16)}…</span>
                <span>started {new Date(state.session.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="flex items-center gap-2">
                {state.session.liveViewUrl && (
                  <a
                    href={state.session.liveViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border",
                      "border-violet-500/30 text-violet-300 hover:bg-violet-500/10",
                      "text-[10px] font-mono uppercase tracking-wider transition-colors",
                    )}
                  >
                    <ExternalLink size={10} />
                    open fullscreen
                  </a>
                )}
                <button
                  onClick={() => void closeSession(state.session.id)}
                  disabled={busy}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 text-[10px] font-mono uppercase tracking-wider transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                  close session
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
