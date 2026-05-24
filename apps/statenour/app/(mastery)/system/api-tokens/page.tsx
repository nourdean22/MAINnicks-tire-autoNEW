"use client";

/**
 * /system/api-tokens · P4 · 2026-05-23.
 *
 * Operator surface for issuing + revoking personal API tokens used
 * by the Chrome extension (and future external clients). Tokens are
 * sha256-hashed in BrainMemory(category=API_TOKEN) · the raw token
 * is shown ONCE on issue and never re-readable.
 *
 * UX:
 *   1. List existing tokens (label · createdAt · lastUsedAt · keyHint)
 *   2. "Issue new" form (label · optional scope)
 *   3. Modal showing the raw token immediately after issue · copy-to-
 *      clipboard button · "I saved it" dismisses
 *   4. Revoke button per row (confirm dialog)
 */

import { useState } from "react";
import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { useConfirmDialog, usePromptDialog } from "@/components/ui/confirm-dialog";
import { trpc } from "@/lib/trpc/client";
import { ChevronLeft, Copy, Key, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function ApiTokensPage() {
  const utils = trpc.useUtils();
  const { data: tokens, isLoading, error } = trpc.system.apiTokensList.useQuery();
  const issueMutation = trpc.system.apiTokensIssue.useMutation();
  const revokeMutation = trpc.system.apiTokensRevoke.useMutation();

  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { prompt, dialog: promptDialog } = usePromptDialog();

  // Raw token surfaced once after issuance · cleared on dismiss.
  const [freshToken, setFreshToken] = useState<{ token: string; label: string } | null>(null);

  async function handleIssue() {
    const label = await prompt({
      title: "New API token",
      body: "Give this token a label (e.g. \"chrome-laptop\", \"my-iphone-shortcut\"). You'll see the raw token ONCE.",
      placeholder: "chrome-laptop",
      confirmLabel: "Issue token",
    });
    if (!label) return;
    try {
      const result = await issueMutation.mutateAsync({ label });
      setFreshToken({ token: result.token, label: result.label });
      void utils.system.apiTokensList.invalidate();
    } catch (err) {
      toast.error(`failed to issue · ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function handleRevoke(id: string, label: string) {
    const ok = await confirm({
      title: `Revoke token "${label}"?`,
      body: "Any client using this token will immediately stop working. Cannot be undone.",
      confirmLabel: "Revoke",
      cancelLabel: "Keep",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await revokeMutation.mutateAsync({ id });
      void utils.system.apiTokensList.invalidate();
      toast.success(`revoked · ${label}`);
    } catch (err) {
      toast.error(`failed to revoke · ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  async function copyToken(t: string) {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("token copied · save it before dismissing");
    } catch {
      toast.error("clipboard write failed · select + copy manually");
    }
  }

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="API Tokens"
      description={
        tokens
          ? `${tokens.length} active · Chrome extension + future scripts`
          : isLoading
            ? "loading…"
            : "no data"
      }
      width="2xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => void handleIssue()} disabled={issueMutation.isPending}>
            <Key size={14} aria-hidden /> {issueMutation.isPending ? "issuing…" : "Issue new"}
          </Button>
          <Link
            href="/system"
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
          >
            <ChevronLeft size={12} aria-hidden /> back
          </Link>
        </div>
      }
    >
      {confirmDialog}
      {promptDialog}

      {/* Fresh-token modal · shows the raw token ONCE */}
      {freshToken ? (
        <GlassCard className="border-emerald-500/30 bg-emerald-500/[0.04] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Token issued · {freshToken.label}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            This is the raw token. Save it NOW · it&apos;s sha256-hashed in
            the DB and cannot be retrieved again.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-emerald-500/30 bg-[var(--bg-void)]/60 p-3 font-mono text-sm text-emerald-300">
            {freshToken.token}
          </pre>
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={() => void copyToken(freshToken.token)}
              variant="outline"
            >
              <Copy size={14} aria-hidden /> Copy
            </Button>
            <Button
              variant="outline"
              onClick={() => setFreshToken(null)}
            >
              I saved it
            </Button>
          </div>
        </GlassCard>
      ) : null}

      {error ? (
        <GlassCard className="p-6">
          <div className="text-sm text-rose-300">failed to load · {error.message}</div>
        </GlassCard>
      ) : null}

      <GlassCard className="p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Active tokens
        </h2>
        {!tokens || tokens.length === 0 ? (
          <p className="mt-4 text-xs italic text-[var(--text-tertiary)]">
            {isLoading ? "loading…" : "no tokens yet · click Issue new"}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border-default)]/40">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <Key size={12} className="text-[var(--text-tertiary)]" aria-hidden />
                    <span className="font-medium">{t.label}</span>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                      …{t.keyHint}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
                    issued {new Date(t.createdAt).toLocaleDateString()} · scope {t.scope}
                    {t.lastUsedAt
                      ? ` · last used ${new Date(t.lastUsedAt).toLocaleString()}`
                      : " · never used"}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="border-rose-500/30 text-rose-300 hover:bg-rose-500/[0.04]"
                  onClick={() => void handleRevoke(t.id, t.label)}
                  disabled={revokeMutation.isPending}
                >
                  <Trash2 size={12} aria-hidden /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        Tokens authenticate{" "}
        <code className="rounded bg-[var(--bg-void)]/40 px-1 py-0.5">POST /api/brain/dump</code>
        {" "}calls from the Chrome extension (and future external clients).
        Send as{" "}
        <code className="rounded bg-[var(--bg-void)]/40 px-1 py-0.5">
          Authorization: Bearer &lt;token&gt;
        </code>
        . Revocation is immediate · soft-delete in BrainMemory.
      </p>
    </StandardPage>
  );
}
