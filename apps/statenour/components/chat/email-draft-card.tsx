/**
 * Email draft card · v10.0.49 · Apr 30.
 *
 * Renders the `composeEmail` Nick tool's output as a reviewable draft
 * with explicit "Send" + "Edit" actions. Wired through the Streamdown
 * `code` override in `nick-message.tsx` — the tool emits:
 *
 *   ```email-draft
 *   {"to":"...", "subject":"...", "body":"...", "tone":"warm"}
 *   ```
 *
 * Send NEVER fires automatically. Nour clicks the button, the click
 * POSTs to `/api/email/send` (owner-gated), and the card flips to a
 * sent / failed state inline.
 *
 * Ports the "Email Composer" plugin from open-webui-plugins (Python)
 * into the bdnick.info TypeScript stack — re-implemented in the
 * existing Resend integration so the draft uses the project's own
 * sendEmail() service + AgentTrace lineage rather than an out-of-tree
 * plugin runtime.
 */

"use client";

import * as React from "react";
import { useState } from "react";
import { Send, Pencil, Check, X, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  tone?: string;
  apiResult?: { draftId: string; messageId: string } | { error: string } | null;
}

export function parseEmailDraft(raw: string): EmailDraft | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const to = typeof parsed.to === "string" ? parsed.to.trim() : "";
    const subject = typeof parsed.subject === "string" ? parsed.subject : "";
    const body = typeof parsed.body === "string" ? parsed.body : "";
    if (!to || !subject || !body) return null;
    if (!/^\S+@\S+\.\S+$/.test(to)) return null;
    return {
      to,
      subject,
      body,
      tone: typeof parsed.tone === "string" ? parsed.tone : undefined,
      apiResult: parsed.apiResult || undefined,
    };
  } catch {
    return null;
  }
}

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string | null }
  | { kind: "error"; message: string };

export function EmailDraftCard({ draft: initial }: { draft: EmailDraft }) {
  const [draft, setDraft] = useState<EmailDraft>(initial);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<SendState>({ kind: "idle" });

  // Phase HH (2026-05-18 PM) · first true `.mutation()` migration ·
  // chat.sendEmail wraps the Resend sendEmail() service + audit trail.
  // The component's SendState machine still drives the UI · the
  // mutation just replaces the manual authedFetch + JSON-parse +
  // status-check ladder. mutateAsync returns the typed result so
  // we get `id` directly without an unsafe `as` cast on json.
  const sendEmailMutation = trpc.chat.sendEmail.useMutation();

  const send = async () => {
    if (state.kind === "sending" || state.kind === "sent") return;
    setState({ kind: "sending" });
    try {
      const result = await sendEmailMutation.mutateAsync({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
      });
      setState({ kind: "sent", id: result.id });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "send failed",
      });
    }
  };

  return (
    <div className="my-3 rounded-xl border border-[var(--gold)]/20 bg-[var(--bg-raised)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-elevated)]">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--gold)]">
          email draft
          {draft.tone && (
            <span className="ml-2 text-[var(--text-tertiary)] normal-case tracking-normal">
              · tone: {draft.tone}
            </span>
          )}
        </span>
        {state.kind === "idle" && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] flex items-center gap-1"
          >
            {editing ? <X size={11} /> : <Pencil size={11} />}
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      <div className="px-3 py-2.5 space-y-1.5">
        <Field
          label="To"
          value={draft.to}
          editable={editing}
          onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
        />
        <Field
          label="Subject"
          value={draft.subject}
          editable={editing}
          onChange={(v) => setDraft((d) => ({ ...d, subject: v }))}
        />
        <BodyField
          value={draft.body}
          editable={editing}
          onChange={(v) => setDraft((d) => ({ ...d, body: v }))}
        />
      </div>

      <div className="px-3 py-2 border-t border-[var(--border-default)] flex items-center justify-between">
        <StateLabel state={state} apiResult={draft.apiResult} />
        <button
          onClick={send}
          disabled={state.kind === "sending" || state.kind === "sent"}
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all",
            state.kind === "sent"
              ? "bg-emerald-500/15 text-emerald-300 cursor-default"
              : state.kind === "sending"
                ? "bg-[var(--gold)]/40 text-[var(--text-inverse)] cursor-wait"
                : "bg-[var(--gold)] text-[var(--text-inverse)] hover:bg-[var(--gold-dim)]",
          )}
        >
          {state.kind === "sending" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : state.kind === "sent" ? (
            <Check size={12} />
          ) : (
            <Send size={12} />
          )}
          {state.kind === "sent" ? "Sent" : state.kind === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function StateLabel({ state, apiResult }: { state: SendState; apiResult?: any }) {
  if (state.kind === "error") {
    return (
      <span className="text-[10px] text-rose-300 font-mono truncate max-w-[60%]">
        ⚠ {state.message}
      </span>
    );
  }
  if (state.kind === "sent") {
    return (
      <span className="text-[10px] text-emerald-300 font-mono">
        ✓ delivered{state.id ? ` · ${state.id.slice(0, 12)}` : ""}
      </span>
    );
  }
  if (apiResult && !apiResult.error && apiResult.draftId) {
    return (
      <span className="text-[10px] text-cyan-300 font-mono">
        ✓ saved in Gmail drafts (ID: {apiResult.draftId.slice(0, 8)})
      </span>
    );
  }
  if (apiResult?.error) {
    return (
      <span className="text-[10px] text-amber-300 font-mono truncate max-w-[60%]">
        ⚠ Gmail draft failed: {apiResult.error}
      </span>
    );
  }
  return (
    <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
      preview · review before sending
    </span>
  );
}

function Field({
  label,
  value,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] w-12 shrink-0">
        {label}
      </span>
      {editable ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-[var(--bg-void)] border border-[var(--border-default)] rounded px-2 py-1 text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/40 outline-none"
        />
      ) : (
        <span className="flex-1 text-[12px] text-[var(--text-primary)] truncate">{value}</span>
      )}
    </div>
  );
}

function BodyField({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="pt-1">
      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] block mb-1">
        Body
      </span>
      {editable ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.min(12, Math.max(4, value.split("\n").length + 1))}
          className="w-full bg-[var(--bg-void)] border border-[var(--border-default)] rounded px-2 py-1.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--gold)]/40 outline-none font-sans leading-relaxed resize-y"
        />
      ) : (
        <pre className="text-[12px] text-[var(--text-secondary)] font-sans leading-relaxed whitespace-pre-wrap break-words">
          {value}
        </pre>
      )}
    </div>
  );
}
