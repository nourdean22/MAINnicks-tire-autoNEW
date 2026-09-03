/**
 * useBusinessHours — Hook for checking business open/closed status
 * Checks current time against business hours in Eastern Time
 * Re-checks every 60 seconds to keep status accurate
 */

import { useEffect, useState } from "react";
import { BUSINESS } from "@shared/business";

// Open/close boundaries derived from the single source of truth
// (BUSINESS.hours.structured, "HH:MM-HH:MM") so this hook can never drift from
// the canonical hours the rest of the site shows. Previously hardcoded as raw
// minute magic numbers (480/1080/540/960).
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toLabel = (hhmm: string): string => {
  const [rawH, min] = hhmm.split(":");
  let h = Number(rawH);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min ?? "00"} ${ampm}`;
};
const parseRange = (range: string) => {
  const [open, close] = range.split("-");
  return { open: toMinutes(open), close: toMinutes(close), openLabel: toLabel(open) };
};
const MON_SAT = parseRange(BUSINESS.hours.structured.monday);
const SUNDAY = parseRange(BUSINESS.hours.structured.sunday);

interface BusinessHoursStatus {
  isOpen: boolean;
  nextOpenTime: string;
  currentTime: string;
}

export function useBusinessHours(): BusinessHoursStatus {
  const [status, setStatus] = useState<BusinessHoursStatus>({
    isOpen: true,
    nextOpenTime: "",
    currentTime: "",
  });

  const checkIsOpen = () => {
    // Get current time in Eastern Time
    const now = new Date();
    const etFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const etDate = new Date(
      now.toLocaleString("en-US", { timeZone: "America/New_York" })
    );
    const dayOfWeek = etDate.getDay();
    const hours = etDate.getHours();
    const minutes = etDate.getMinutes();
    const currentMinutes = hours * 60 + minutes;

    const currentTimeStr = etFormatter.format(now);

    // Business hours:
    // Mon-Sat: 8AM-6PM (480-1080 minutes)
    // Sun: 9AM-4PM (540-960 minutes)

    let isOpen = false;
    let nextOpenTime = "";

    if (dayOfWeek === 0) {
      // Sunday
      isOpen = currentMinutes >= SUNDAY.open && currentMinutes < SUNDAY.close;
      if (!isOpen) {
        nextOpenTime =
          currentMinutes < SUNDAY.open
            ? `Today at ${SUNDAY.openLabel} ET`
            : `Monday at ${MON_SAT.openLabel} ET`;
      }
    } else if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      // Monday-Saturday
      isOpen = currentMinutes >= MON_SAT.open && currentMinutes < MON_SAT.close;
      if (!isOpen) {
        if (currentMinutes < MON_SAT.open) {
          nextOpenTime = `Today at ${MON_SAT.openLabel} ET`;
        } else if (dayOfWeek === 6) {
          // Saturday night → next open is SUNDAY (was wrongly "Monday",
          // burying the shop's open-Sunday differentiator).
          nextOpenTime = `Sunday at ${SUNDAY.openLabel} ET`;
        } else {
          nextOpenTime = `Tomorrow at ${MON_SAT.openLabel} ET`;
        }
      }
    }

    setStatus({
      isOpen,
      nextOpenTime,
      currentTime: currentTimeStr,
    });
  };

  useEffect(() => {
    checkIsOpen();
    const interval = setInterval(checkIsOpen, 60000); // Re-check every 60 seconds

    return () => clearInterval(interval);
  }, []);

  return status;
}
