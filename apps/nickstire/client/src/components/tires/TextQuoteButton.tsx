// "Text me this quote" on a /tires top-pick card (2026-10-18). Self-contained, like
// FollowUpButton in admin: its own state, its own mutation, an inline phone field.
// No window.prompt/alert/confirm: the iOS PWA suppresses them silently.
import { useEffect, useId, useRef, useState } from "react";
import { Check, MessageSquare } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { trackEvent } from "@/components/SEO";
import { getUtmData } from "@/lib/utm";
import { BUSINESS } from "@shared/business";
import type { PickKind } from "@/lib/tirePicks";
import type { SavedVehicle } from "@/components/tires/VehicleSizePicker";

type Props = {
  tire: { brand: string; model: string; size: string; pricePerTireCents: number };
  quantity: number;
  pick: PickKind;
  vehicle: SavedVehicle | null;
};

type Sms = "sent" | "queued" | "uncertain" | "not_sent" | "duplicate";

const CallShop = () => (
  <a href={BUSINESS.phone.href} className="font-semibold text-primary underline underline-offset-4">{BUSINESS.phone.display}</a>
);

export default function TextQuoteButton({ tire, quantity, pick, vehicle }: Props) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [sms, setSms] = useState<Sms | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const send = trpc.tireQuote.text.useMutation();

  useEffect(() => { if (open) field.current?.focus(); }, [open]);

  if (sms) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" aria-hidden="true" />
        <span>
          {sms === "not_sent" ? (
            <>Saved. We could not text this number. Call <CallShop /> and we will go over it.</>
          ) : sms === "uncertain" ? (
            <>We tried to text you. If nothing arrives in a few minutes, call <CallShop />.</>
          ) : (
            "Sent. We will text you this quote in a minute."
          )}
        </span>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border px-5 font-semibold"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />Text me this quote
      </button>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    if (digits.length !== 10) {
      setError("Enter a 10-digit mobile number.");
      return;
    }
    setError("");
    trackEvent("quote_text_requested", { pick, size: tire.size });
    send.mutate(
      {
        phone: digits,
        tireBrand: tire.brand,
        tireModel: tire.model,
        tireSize: tire.size,
        quantity,
        pricePerTireCents: tire.pricePerTireCents,
        pick,
        vehicle: vehicle ? { year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim || undefined } : undefined,
        ...getUtmData(),
      },
      {
        onSuccess: (r) => {
          if (r.ok) setSms(r.sms);
          else setError(r.reason === "price" ? "This price changed. Reload the page and try again." : `Could not send. Call ${BUSINESS.phone.display}.`);
        },
        onError: () => setError(`Could not send. Call ${BUSINESS.phone.display}.`),
      },
    );
  };

  return (
    <form onSubmit={submit} aria-label="Text me this quote" className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <label htmlFor={id} className="text-sm font-semibold">Mobile number</label>
      <div className="flex gap-2">
        <input
          id={id}
          ref={field}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); if (error) setError(""); }}
          placeholder={BUSINESS.phone.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-base outline-none focus:border-primary"
        />
        <button type="submit" disabled={send.isPending} className="min-h-12 rounded-xl bg-primary px-4 font-bold text-primary-foreground disabled:opacity-60">
          {send.isPending ? "Sending" : "Send"}
        </button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="text-sm font-medium text-amber-400">{error}</p>}
      <p className="text-xs text-muted-foreground">One text with this quote, nothing else. Reply STOP to opt out. We don't sell or rent contact info.</p>
    </form>
  );
}
