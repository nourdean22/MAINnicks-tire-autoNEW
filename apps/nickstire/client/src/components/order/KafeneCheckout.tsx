import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trackEvent } from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { loadKafeneSdk, type KafeneItem, type KafeneResult } from "@/lib/kafeneSdk";

// "Pay with Kafene lease" after a tire order is placed (contract kafene v1). Kafene's SDK opens
// its own overlay; approval and signing are recorded on our server. Hidden unless the server
// reports Kafene configured. apiKey/storeId come from kafene.config and live only in memory.

type Ids = { orderNumber: string; phone: string };
type KafeneConfig = {
  enabled: boolean;
  apiKey: string | null;
  storeId: string | null;
  environment: "sandbox" | "production" | null;
  maxApprovalCents: number | null;
};
type StartResult =
  | { ok: true; orderId: string; items: KafeneItem[]; shippingCost: number; customer: { billing: Record<string, unknown> } }
  | { ok: false; reason: "disabled" | "not_found" | "already_paid" | "cancelled" | "over_limit" | "upstream_error" };
type AttachResult = { ok: true } | { ok: false; reason: "disabled" | "not_found" | "conflict" };
type SignResult = { ok: true; status: "signed" } | { ok: false; reason: "disabled" | "not_found" | "unknown_uid" };
type KafeneApi = {
  config: { useQuery: (input?: undefined, opts?: { staleTime?: number; retry?: boolean }) => { data?: KafeneConfig } };
  start: { useMutation: () => { mutateAsync: (input: Ids) => Promise<StartResult> } };
  attach: { useMutation: () => { mutateAsync: (input: Ids & { uid: string }) => Promise<AttachResult> } };
  markSigned: { useMutation: () => { mutateAsync: (input: Ids & { uid: string }) => Promise<SignResult> } };
};

// shortcut: kafene v1 is not in AppRouter until the server lane's router merges, so this types the
// client against the v1 contract by hand. On integration, replace it with `trpc.kafene` so tsc checks it.
const kafeneApi = (trpc as unknown as { kafene: KafeneApi }).kafene;

const STEP_TIMEOUT_MS = 20_000;
// The customer is filling in Kafene's application inside their overlay; still bounded.
const FLOW_TIMEOUT_MS = 30 * 60_000;

const SIGNED = "Lease signed. We'll text you when your tires are in. Nothing more to pay today.";
const SIGNED_UNRECORDED = `Call us at ${BUSINESS.phone.display} with this order number so we can match your lease.`;
const MESSAGES = {
  declined: "Kafene didn't approve this one. You can still pay by card or call us.",
  cancelled: "Kafene checkout closed. Your order is saved; pay by card or call us.",
  error: "Kafene checkout couldn't finish. Try again or pay by card.",
  overLimit: "This order is above Kafene's limit for our shop. Pay by card or call us.",
  alreadyPaid: "This order is already paid.",
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

type Phase =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "open" }
  | { kind: "signed"; recorded: boolean }
  | { kind: "message"; text: string };

export default function KafeneCheckout({
  orderNumber,
  phone,
  onOpenChange,
  onSigned,
}: Ids & { onOpenChange: (open: boolean) => void; onSigned: () => void }) {
  const config = kafeneApi.config.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const start = kafeneApi.start.useMutation();
  const attach = kafeneApi.attach.useMutation();
  const markSigned = kafeneApi.markSigned.useMutation();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const cfg = config.data;
  const usable = cfg?.enabled === true && !!cfg.apiKey && !!cfg.storeId;
  if (!usable && phase.kind !== "signed") return null;

  const begin = async () => {
    if (!cfg?.apiKey || !cfg.storeId) return;
    const ids = { orderNumber, phone };
    const show = (text: string) => {
      onOpenChange(false);
      setPhase({ kind: "message", text });
    };
    setPhase({ kind: "busy" });

    let res: StartResult;
    try {
      res = await withTimeout(start.mutateAsync(ids), STEP_TIMEOUT_MS);
    } catch {
      return show(MESSAGES.error);
    }
    if (!res.ok) {
      return show(res.reason === "over_limit" ? MESSAGES.overLimit : res.reason === "already_paid" ? MESSAGES.alreadyPaid : MESSAGES.error);
    }

    let sdk;
    try {
      sdk = await loadKafeneSdk();
    } catch {
      return show(MESSAGES.error);
    }

    // Attach fires once per checkout; a network failure (rejection or timeout) gets one retry.
    let uid: string | null = null;
    let attached: Promise<unknown> = Promise.resolve();
    const attachOnce = async (input: Ids & { uid: string }) => {
      try {
        return await withTimeout(attach.mutateAsync(input), STEP_TIMEOUT_MS);
      } catch {
        return withTimeout(attach.mutateAsync(input), STEP_TIMEOUT_MS).catch(() => null);
      }
    };

    let result: Promise<KafeneResult>;
    try {
      const flow = sdk
        .init({ apiKey: cfg.apiKey, storeId: cfg.storeId, environment: cfg.environment ?? "sandbox" })
        .openCheckout({ orderId: res.orderId, items: res.items, shippingCost: res.shippingCost, customer: res.customer });
      flow.on("approved", (payload) => {
        if (!payload?.uid || uid) return;
        uid = payload.uid;
        attached = attachOnce({ ...ids, uid });
      });
      result = flow.result;
    } catch {
      return show(MESSAGES.error);
    }
    onOpenChange(true);
    setPhase({ kind: "open" });
    trackEvent("kafene_checkout_opened", { orderNumber });

    let outcome: KafeneResult;
    try {
      outcome = await withTimeout(result, FLOW_TIMEOUT_MS);
    } catch {
      outcome = { status: "error" };
    }
    onOpenChange(false);
    trackEvent("kafene_checkout_result", { status: outcome.status });

    if (outcome.status === "completed") {
      // The lease is signed with Kafene whatever our server says next, so never offer the card again.
      let recorded = false;
      const signedUid = uid as string | null;
      if (signedUid) {
        try {
          await withTimeout(attached, STEP_TIMEOUT_MS);
          const r = await withTimeout(markSigned.mutateAsync({ ...ids, uid: signedUid }), STEP_TIMEOUT_MS);
          recorded = r.ok;
        } catch {
          recorded = false;
        }
      }
      setPhase({ kind: "signed", recorded });
      onSigned();
      return;
    }
    const text = outcome.status === "declined" ? MESSAGES.declined : outcome.status === "cancelled" ? MESSAGES.cancelled : MESSAGES.error;
    setPhase({ kind: "message", text });
  };

  if (phase.kind === "signed") {
    return (
      <div role="status" className="space-y-1 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-center">
        <p className="text-sm font-semibold text-foreground">{SIGNED}</p>
        <p className="text-xs text-muted-foreground">Order #{orderNumber}</p>
        {!phase.recorded && <p className="text-xs text-amber-500">{SIGNED_UNRECORDED}</p>}
      </div>
    );
  }

  const working = phase.kind === "busy" || phase.kind === "open";
  return (
    <div className="space-y-1.5 border-t border-border/20 pt-3">
      <button
        type="button"
        onClick={() => void begin()}
        disabled={working}
        aria-busy={working || undefined}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-primary/50 text-sm font-semibold text-foreground hover:bg-primary/10 disabled:opacity-50"
      >
        {working && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Pay with Kafene lease
      </button>
      <p className="text-center text-[10px] text-muted-foreground">Lease-to-own through Kafene. Kafene decides approval.</p>
      {phase.kind === "message" && (
        <p role="status" className="text-center text-xs font-medium text-amber-500">{phase.text}</p>
      )}
    </div>
  );
}
