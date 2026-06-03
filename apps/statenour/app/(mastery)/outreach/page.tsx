"use client";

/**
 * /outreach · Wave-200 outreach segmentation surface
 * (2026-05-17 follow-up)
 *
 * Compose a bulk-SMS campaign · the operator-approval gate (Telegram
 * /approve · /reject) gates the actual send. Pure compose UI on this
 * page · no mutation here · POST to /api/outreach/propose emits the
 * Inngest event.
 *
 * Aesthetic · editorial-minimalist · matches Customer 360.
 *
 * See:
 *   - app/api/outreach/propose/route.ts (emit endpoint)
 *   - src/inngest/functions/bulk-sms-approval.ts (Inngest flow)
 *   - app/api/telegram/webhook/route.ts (/approve, /reject commands)
 */

import { useCallback, useMemo, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";

type PaymentBehavior = "any" | "prompt" | "typical" | "slow";
type LtvTier = "any" | "low" | "mid" | "high";

export default function OutreachPage() {
  const [campaignId, setCampaignId] = useState<string>(suggestCampaignId());
  const [paymentBehavior, setPaymentBehavior] =
    useState<PaymentBehavior>("slow");
  const [ltvTier, setLtvTier] = useState<LtvTier>("high");
  const [minDeclinedDollars, setMinDeclinedDollars] = useState<number>(500);
  const [recipientCount, setRecipientCount] = useState<number>(1);
  const [bodyPreview, setBodyPreview] = useState<string>(
    "Hey {firstName} — Nour here from Nick's Tire & Auto. Following up on that work we quoted you. We can fit you in this week if you reply with a good time.",
  );
  const [reason, setReason] = useState<string>("");
  const [state, setState] = useState<"idle" | "sending" | "ok" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [serverHint, setServerHint] = useState<string | null>(null);

  const segmentLabel = useMemo(() => {
    const parts: string[] = [];
    if (ltvTier !== "any") parts.push(`${ltvTier} LTV`);
    if (paymentBehavior !== "any") parts.push(`${paymentBehavior} payer`);
    if (minDeclinedDollars > 0)
      parts.push(`declined ≥ $${minDeclinedDollars.toLocaleString()}`);
    return parts.length > 0 ? parts.join(" · ") : "all customers";
  }, [ltvTier, paymentBehavior, minDeclinedDollars]);

  const canPropose =
    campaignId.trim().length > 0 &&
    bodyPreview.trim().length > 0 &&
    recipientCount > 0 &&
    state !== "sending";

  const onPropose = useCallback(async () => {
    if (!canPropose) return;
    setState("sending");
    setErrorMsg(null);
    setServerHint(null);
    try {
      const res = await fetch("/api/outreach/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignId.trim(),
          targetSegment: segmentLabel,
          recipientCount,
          bodyPreview: bodyPreview.trim(),
          reason: reason.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        hint?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setState("error");
        setErrorMsg(data.hint ?? data.error ?? data.message ?? `HTTP ${res.status}`);
        return;
      }
      setState("ok");
      setServerHint(data.hint ?? null);
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [
    campaignId,
    segmentLabel,
    recipientCount,
    bodyPreview,
    reason,
    canPropose,
  ]);

  return (
    <StandardPage
      eyebrow="Outreach"
      title="Bulk SMS campaign"
      description={
        <>
          Propose → Telegram approval → Inngest dispatch.
          <br />
          <span className="text-white/30">
            The dispatch step is a TEMPLATE until the nickstire-side bulk-SMS
            endpoint is wired · proposing is safe today.
          </span>
        </>
      }
    >
        {/* Segment */}
        <section className="mt-8 space-y-4">
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-white/40">
            Segment
          </h2>
          <Field label="LTV tier">
            <Select
              value={ltvTier}
              onChange={(v) => setLtvTier(v as LtvTier)}
              options={["any", "low", "mid", "high"]}
            />
          </Field>
          <Field label="Payment behavior">
            <Select
              value={paymentBehavior}
              onChange={(v) => setPaymentBehavior(v as PaymentBehavior)}
              options={["any", "prompt", "typical", "slow"]}
            />
          </Field>
          <Field label="Min declined value ($)">
            <input
              type="number"
              min={0}
              step={50}
              value={minDeclinedDollars}
              onChange={(e) => setMinDeclinedDollars(Number(e.target.value) || 0)}
              className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-32 text-right tabular-nums"
            />
          </Field>
          <p className="text-sm text-white/70">
            <span className="text-white/40">resolved · </span>
            {segmentLabel}
          </p>
        </section>

        {/* Composition */}
        <section className="mt-8 space-y-4">
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-white/40">
            Composition
          </h2>
          <Field label="Campaign ID">
            <input
              type="text"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-full font-mono"
              placeholder="winback-high-ltv-2026-05-17"
            />
          </Field>
          <Field label="Expected recipient count">
            <input
              type="number"
              min={1}
              value={recipientCount}
              onChange={(e) => setRecipientCount(Number(e.target.value) || 1)}
              className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-32 text-right tabular-nums"
            />
          </Field>
          <Field label="Message preview">
            <textarea
              value={bodyPreview}
              onChange={(e) => setBodyPreview(e.target.value)}
              rows={4}
              className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-full"
              placeholder="What goes in the SMS · {firstName} placeholder OK"
            />
          </Field>
          <Field label="Reason (optional · audit)">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-full"
              placeholder="why now · what makes this the right moment"
            />
          </Field>
        </section>

        {/* Action */}
        <div className="mt-10 flex items-start gap-4">
          <button
            type="button"
            disabled={!canPropose}
            onClick={() => void onPropose()}
            className={[
              "px-5 py-2 rounded text-sm font-medium",
              "transition-colors",
              canPropose
                ? "bg-[#FDB913] text-black hover:bg-[#FDB913]/90"
                : "bg-white/[0.04] text-white/40 cursor-not-allowed",
            ].join(" ")}
          >
            {state === "sending"
              ? "Proposing…"
              : state === "ok"
                ? "Re-propose"
                : "Propose for approval"}
          </button>
          {state === "ok" ? (
            <p className="text-sm text-emerald-300 max-w-md">
              ✓ Proposed · {serverHint ?? "Watch Telegram for the approval request."}
            </p>
          ) : null}
          {state === "error" ? (
            <p className="text-sm text-red-300 max-w-md">{errorMsg}</p>
          ) : null}
        </div>

        <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30">
          dispatch · TEMPLATE · no real SMS yet
        </p>
    </StandardPage>
  );
}

// ── small components ────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span className="text-white/60 text-xs uppercase tracking-[0.14em] w-44 shrink-0">
        {label}
      </span>
      <span className="flex-1">{children}</span>
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-full"
    >
      {options.map((opt) => (
        <option key={opt} value={opt} className="bg-[var(--bg-base)]">
          {opt}
        </option>
      ))}
    </select>
  );
}

function suggestCampaignId(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `winback-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
