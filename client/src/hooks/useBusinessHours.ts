/**
 * useBusinessHours — Hook for checking business open/closed status
 * Checks current time against business hours in Eastern Time
 * Re-checks every 60 seconds to keep status accurate
 */

import { useEffect, useState } from "react";

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
      // Sunday: 9AM-4PM
      isOpen = currentMinutes >= 540 && currentMinutes < 960;
      if (!isOpen) {
        if (currentMinutes < 540) {
          // Before 9AM on Sunday
          nextOpenTime = `Today at 9:00 AM ET`;
        } else {
          // After 4PM on Sunday
          nextOpenTime = `Monday at 8:00 AM ET`;
        }
      }
    } else if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      // Monday-Saturday: 8AM-6PM
      isOpen = currentMinutes >= 480 && currentMinutes < 1080;
      if (!isOpen) {
        if (currentMinutes < 480) {
          // Before 8AM
          nextOpenTime = `Today at 8:00 AM ET`;
        } else {
          // After 6PM
          if (dayOfWeek === 6) {
            // Saturday night
            nextOpenTime = `Monday at 8:00 AM ET`;
          } else {
            // Weekday night
            nextOpenTime = `Tomorrow at 8:00 AM ET`;
          }
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
