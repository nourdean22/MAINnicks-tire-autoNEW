/**
 * Plate -> customer enrichment for confirmed arrivals · 2026-09-08 (ADR-0017).
 *
 * After a CONFIRMED_ARRIVAL carries a plate read, ask nickstire (read-only
 * `vehicle_lookup_by_plate` on the nour-os/query bridge) whether the plate
 * belongs to someone we know, store the answer on the DeviceEvent as
 * `customerRef`, and append one line to the Telegram alert. ADVISORY ONLY:
 * nothing customer-facing is ever triggered from here (root AGENTS.md
 * "Protected operations"; PROTECTED-CORE on the nickstire side).
 *
 * Fire-and-forget from the ingest path: statenour-web is a long-lived Node
 * process on Railway, so the promise completes after the response; the edge
 * outbox retries are idempotent by eventId, so a slow lookup can never
 * duplicate a visit. A failed lookup is recorded as `lookup_failed`, never
 * as "unmatched" (empty-vs-error), and the ingest path retries it on the
 * next confirmed update for the visit (`maybeLinkCustomer`); only `matched`
 * and `unmatched` are terminal, and only for the plate text they answered.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { queryNick } from "@/lib/nickstire/query";
import { editTelegramMessage, type InlineButton } from "@/lib/services/telegram";
import { logger } from "@/lib/logger";

const log = logger.withSurface("services/vehicle-customer-link");

export interface PlateMatch {
  source: string;
  membershipId?: unknown;
  name: string | null;
  phoneMasked: string;
  plate: string;
  exact: boolean;
  vehicleDesc: string | null;
  membershipStatus: string | null;
  bookingsToday: Array<Record<string, unknown>>;
}

export type PlateLookup =
  | { ok: true; normalized: string; matches: PlateMatch[] }
  | { ok: false; error: string };

/** One bridge round-trip, bounded. */
export async function lookupPlate(plate: string, timeoutMs = 6000): Promise<PlateLookup> {
  const res = await queryNick<{ matches?: PlateMatch[]; normalized?: string }>(
    "vehicle_lookup_by_plate",
    { plate },
    timeoutMs,
  );
  if ("error" in res) return { ok: false, error: res.error };
  return { ok: true, normalized: res.data?.normalized ?? plate, matches: res.data?.matches ?? [] };
}

export interface LinkArgs {
  eventId: string;
  plate: string;
  telegramMessageId?: string | null;
  alertText?: string;
  buttons?: InlineButton[][];
}

const plateKey = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");

/** The plate text the event currently carries (normalized form first). */
function plateTextOf(data: Record<string, unknown>): string | null {
  const p = data.plate as { normalizedText?: unknown; text?: unknown } | undefined;
  const v = p?.normalizedText ?? p?.text;
  return typeof v === "string" && v ? v : null;
}

/**
 * The one line the Telegram alert carries for a matched customer; "" for
 * anything else. Pure, so every refresh of the alert can re-compose it from
 * the persisted `customerRef`. A booking found by PHONE is only claimed as
 * "booked today" when nickstire could also agree on the name
 * (`linkage: "phone+name"`); a shared household number stays "unconfirmed"
 * and its service is never shown (the bridge does not send it).
 */
export function renderCustomerLine(customerRef: unknown): string {
  const ref = customerRef as { status?: string; matches?: PlateMatch[] } | null | undefined;
  const m = ref?.status === "matched" ? ref.matches?.[0] : undefined;
  if (!m) return "";
  const booking = m.bookingsToday?.[0];
  const bookingText = !booking
    ? ""
    : booking.linkage === "phone+name"
      ? ` · booked today: ${String(booking.service ?? "")}`
      : " · a booking on file today (same phone, unconfirmed)";
  return `\n<b>Customer:</b> ${m.name ?? "member"} (${m.phoneMasked})${m.exact ? "" : " ~plate variant"}${bookingText}`;
}

/** Annotate the event with `customerRef` and extend the alert. Never throws. */
export async function linkVisitToCustomer(args: LinkArgs): Promise<void> {
  try {
    const result = await lookupPlate(args.plate);
    const row = await prisma.deviceEvent.findUnique({ where: { id: args.eventId } });
    if (!row) return;
    const data = (row.data as Record<string, unknown> | null) ?? {};
    // The lookup is asynchronous: if the edge corrected the plate while it
    // was in flight, the row now carries a different plate and THIS answer is
    // about the wrong one. An obsolete lookup must never win the write.
    const current = plateTextOf(data);
    if (current && plateKey(current) !== plateKey(args.plate)) {
      log.info("customer_link_stale", { eventId: args.eventId, plateChanged: true });
      return;
    }
    const checkedAt = new Date().toISOString();
    // `plate` = the text that was looked up, so the ingest guard can tell a
    // terminal answer for THIS plate from one for a since-corrected read.
    const customerRef = result.ok
      ? {
          checkedAt,
          plate: args.plate,
          status: result.matches.length > 0 ? "matched" : "unmatched",
          normalized: result.normalized,
          matches: result.matches.slice(0, 3),
        }
      : { checkedAt, plate: args.plate, status: "lookup_failed", error: result.error };

    await prisma.deviceEvent.update({
      where: { id: args.eventId },
      data: { data: { ...data, customerRef } as Prisma.InputJsonObject },
    });
    log.info("customer_link", { eventId: args.eventId, status: customerRef.status });

    const line = renderCustomerLine(customerRef);
    if (line && args.telegramMessageId && args.alertText) {
      await editTelegramMessage(Number(args.telegramMessageId), args.alertText + line, undefined, args.buttons).catch(
        (err) => log.warn("customer_link_telegram_edit_failed", { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  } catch (err) {
    log.warn("customer_link_failed", { eventId: args.eventId, error: err instanceof Error ? err.message : String(err) });
  }
}
