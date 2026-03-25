/**
 * useCountdown — Countdown timer hook.
 * Returns hours, minutes, seconds until target date.
 * Useful for limited-time offers and specials pages.
 */
import { useState, useEffect } from "react";

interface CountdownResult {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

export function useCountdown(targetDate: Date): CountdownResult {
  const [timeLeft, setTimeLeft] = useState<CountdownResult>(calculate(targetDate));

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculate(targetDate));
    }, 1000);

    return () => clearInterval(timer);
  }, [targetDate]);

  return timeLeft;
}

function calculate(target: Date): CountdownResult {
  const diff = target.getTime() - Date.now();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true };
  }

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    isExpired: false,
  };
}
