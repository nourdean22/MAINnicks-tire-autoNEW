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

/** Annotate the event with `customerRef` and extend the alert. Never throws. */
export async function linkVisitToCustomer(args: LinkArgs): Promise<void> {
  try {
    const result = await lookupPlate(args.plate);
    const row = await prisma.deviceEvent.findUnique({ where: { id: args.eventId } });
    if (!row) return;
    const data = (row.data as Record<string, unknown> | null) ?? {};
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

    if (result.ok && result.matches.length > 0 && args.telegramMessageId && args.alertText) {
      const m = result.matches[0];
      const booking = m.bookingsToday?.[0];
      const line =
        `\n<b>Customer:</b> ${m.name ?? "member"} (${m.phoneMasked})` +
        `${m.exact ? "" : " ~plate variant"}` +
        `${booking ? ` · booked today: ${String(booking.service ?? "")}` : ""}`;
      await editTelegramMessage(Number(args.telegramMessageId), args.alertText + line, undefined, args.buttons).catch(
        (err) => log.warn("customer_link_telegram_edit_failed", { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  } catch (err) {
    log.warn("customer_link_failed", { eventId: args.eventId, error: err instanceof Error ? err.message : String(err) });
  }
}
