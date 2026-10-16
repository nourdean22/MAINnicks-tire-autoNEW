/**
 * One row of Today's board (admin UI v1 W2): the urgency dot, the name over one muted detail line,
 * the money when there is any, and ONE verb. Call and Text sit beside it when the item has a phone;
 * a different secondary action waits behind a small overflow button, because four controls and two
 * labels do not fit a 390 px row without wrapping.
 *
 * Act in place: when an action reports that the item has left the queue, the row fades for 150 ms
 * (opacity only, no transform: the crew taps these a hundred times a day) and then asks the board to
 * drop it. A failure or a cancelled confirm leaves the row exactly where it was.
 */
import { useState } from "react";
import { MessageSquare, MoreHorizontal, Phone } from "lucide-react";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import type { ActionItem } from "./types";

const FADE_MS = 150;

interface QueueRowProps {
  item: ActionItem;
  /** "booking", "lead", "callback", "work order" or "text". */
  typeLabel: string;
  primaryLabel: string;
  /** Omitted when the secondary action is the same as the primary. */
  secondaryLabel?: string;
  /** The text prefill, owned by the caller (admin-customer-copy-pins pins it there). */
  body: string;
  disabled: boolean;
  /** Resolves true when the item has left the queue. Never rejects: the caller toasts its own errors. */
  onPrimary: () => Promise<boolean>;
  onSecondary: () => Promise<boolean>;
  onGone: () => void;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// Named, not default: the admin render matrix (admin.test.tsx) mounts every default export with no props.
export function QueueRow({ item, typeLabel, primaryLabel, secondaryLabel, body, disabled, onPrimary, onSecondary, onGone }: QueueRowProps) {
  const [leaving, setLeaving] = useState(false);
  const [more, setMore] = useState(false);
  const urgent = item.urgency >= 4;

  async function run(action: () => Promise<boolean>) {
    if (await action()) {
      setLeaving(true);
      setTimeout(onGone, FADE_MS);
    }
  }

  return (
    <article className={`py-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4 transition-opacity duration-150 ${leaving ? "opacity-0" : ""}`}>
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span aria-hidden className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${urgent ? "bg-red-400" : "bg-muted-foreground/50"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <h3 className="text-[16px] leading-snug font-semibold truncate flex-1 min-w-0">{item.name}</h3>
            {item.totalRevenue ? <span className="text-[15px] tabular-nums text-foreground/85 shrink-0">{money(item.totalRevenue)}</span> : null}
          </div>
          <p className="text-[13px] text-muted-foreground truncate">
            {urgent && <span className="text-red-400">Urgent </span>}
            {typeLabel} · {item.detail}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-[18px] lg:pl-0 shrink-0">
        {item.phone && (
          <a href={`tel:${item.phone}`} className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-md border border-border/40 text-foreground/80" aria-label={`Call ${item.name}`}>
            <Phone className="w-4 h-4" />
          </a>
        )}
        {item.phone && (
          <MessageCustomerLink phone={item.phone} body={body} className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-md border border-border/40 text-foreground/80" title="Message customer" ariaLabel={`Message ${item.name}`}>
            <MessageSquare className="w-4 h-4" />
          </MessageCustomerLink>
        )}
        {secondaryLabel && (
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} aria-label={`More actions for ${item.name}`} className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-md text-muted-foreground hover:text-foreground">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
        <button type="button" disabled={disabled} onClick={() => void run(onPrimary)} className="min-h-12 px-4 ml-auto lg:ml-0 whitespace-nowrap rounded-md bg-secondary text-foreground text-[14px] font-semibold border border-border/60 disabled:opacity-50">
          {primaryLabel}
        </button>
      </div>
      {secondaryLabel && more && (
        <div className="flex justify-end lg:order-last">
          <button type="button" disabled={disabled} onClick={() => void run(onSecondary)} className="min-h-12 px-4 whitespace-nowrap rounded-md border border-border/40 text-[14px] text-foreground/85 disabled:opacity-50">
            {secondaryLabel}
          </button>
        </div>
      )}
    </article>
  );
}
