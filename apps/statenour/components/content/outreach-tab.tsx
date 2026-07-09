"use client";

/**
 * OutreachTab · the Outreach section of the merged /content surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/outreach/page.tsx — the only
 * change is the outer <StandardPage> wrapper became a fragment (the page-level
 * chrome now lives on /content) and the former StandardPage `description`
 * moved into an inline header at the top.
 *
 * 2026-07-09 (post-#621) · the propose route now REQUIRES two
 * machine-actionable fields the nickstire bridge consumes:
 *   - `segment` · recent | lapsed | all — the audience nickstire actually
 *     targets (getSegmentCustomers). The LTV/payment filters below only
 *     compose the human-readable `targetSegment` label for the Telegram
 *     preview; they do NOT narrow the send audience today.
 *   - `messageTemplate` · the FULL SMS body ({firstName} interpolated
 *     per-recipient on the nickstire side). `bodyPreview` is derived from
 *     its first 240 chars for the Telegram approval message.
 *
 * Compose a bulk-SMS campaign · the operator-approval gate (Telegram
 * /approve · /reject) gates the actual send. Pure compose UI · no mutation
 * here.
 */

import { useCallback, useMemo, useState } from "react";

type PaymentBehavior = "any" | "prompt" | "typical" | "slow";
type LtvTier = "any" | "low" | "mid" | "high";
type Audience = "recent" | "lapsed" | "all";

export function OutreachTab() {
  const [campaignId, setCampaignId] = useState<string>(suggestCampaignId());
  // Machine-actionable audience — the segment nickstire's bridge actually
  // sends to. Defaults to "lapsed" (91-365d since last visit), the natural
  // winback pool and the smallest realistic blast surface of the three.
  const [audience, setAudience] = useState<Audience>("lapsed");
  // v-truth · neutral defaults. Pre-fix the form opened pre-set to a SPECIFIC
  // segment (high-LTV slow-payer declined>=$500) that read like a recommended
  // target but was just a hardcoded default. Default to "any"/"any"/$0 so the
  // resolved segment honestly reads "all customers" until the operator narrows.
  const [paymentBehavior, setPaymentBehavior] =
    useState<PaymentBehavior>("any");
  const [ltvTier, setLtvTier] = useState<LtvTier>("any");
  const [minDeclinedDollars, setMinDeclinedDollars] = useState<number>(0);
  const [recipientCount, setRecipientCount] = useState<number>(1);
  const [message, setMessage] = useState<string>(
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
    message.trim().length > 0 &&
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
          segment: audience,
          recipientCount,
          bodyPreview: message.trim().slice(0, 240),
          messageTemplate: message.trim(),
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
    audience,
    recipientCount,
    message,
    reason,
    canPropose,
  ]);

  return (
    <>
      <p className="text-sm text-white/70" style={{ maxWidth: "60ch" }}>
        Propose → Telegram approval → Inngest dispatch → nickstire bridge.
        <br />
        <span className="text-white/30">
          Approved campaigns dispatch as a DRY RUN (count + preview to
          Telegram, no SMS) unless FEATURE_BULK_SMS_LIVE=1 is set on
          statenour.
        </span>
      </p>

      {/* Segment */}
      <section className="mt-8 space-y-4">
        <h2 className="text-[10px] uppercase tracking-[0.22em] text-white/40">
          Segment
        </h2>
        <Field label="Audience (sent to)">
          <Select
            value={audience}
            onChange={(v) => setAudience(v as Audience)}
            options={["recent", "lapsed", "all"]}
          />
        </Field>
        <p className="text-xs text-white/40">
          Audience is what nickstire actually targets · recent = visited
          ≤90d · lapsed = 91-365d · all = every reachable customer. The
          filters below only annotate the Telegram preview label — they do
          not narrow the send.
        </p>
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
        <Field label="Message (full SMS)">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="bg-white/[0.04] border border-white/10 rounded px-3 py-2 text-sm w-full"
            placeholder="The exact SMS sent to each recipient · {firstName} placeholder OK · STOP footer appended automatically"
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
        dispatch · wired to nickstire · dry-run unless FEATURE_BULK_SMS_LIVE=1
      </p>
    </>
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
