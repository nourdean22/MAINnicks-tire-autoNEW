"use client";

/**
 * HomeNarrator · the editorial-sentence replacement for HomeStrip
 *
 * Replaces the 5-chip status bar that sat above /chat with a single
 * composed sentence the OS speaks to the operator. Each named phrase
 * is a <Link> to its destination · the sentence IS the navigation.
 *
 * Time-aware composition · the phrase emphasis shifts by hour-of-day:
 *
 *   morning   (5:00–11:59 local) · leads with brief readiness +
 *               coalescing themes + tasks-in-motion
 *   afternoon (12:00–16:59)      · leads with throughput + alerts
 *   evening   (17:00–23:59)      · leads with done count + named
 *               themes + reflection cue
 *   late      (00:00–4:59)       · same as evening but quieter copy
 *
 * Self-hides if no signal at all (clean morning state). Per the
 * design contract, this is "the OS narrating the day" · not a
 * dashboard. The chat textbox stays prominent below.
 *
 * Aesthetic per docs/aesthetic-principles.md:
 *   · text-[var(--text-primary)] body · gold ONLY on the operator
 *     phrases that link out
 *   · max-width 60ch reading width
 *   · no chips, no borders, no decorative elements
 *   · single line on desktop · wraps naturally on mobile
 *
 * Built 2026-05-18 PM · brainstorm Q1 answer "more minimalist +
 * cleaner + better-looking + more useful" · Q2 chose editorial
 * sentence + time-aware composition combined.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";

interface HealthShape {
  tasks: { inbox: number; ready: number; doing: number; done: number; total: number };
  alerts: { unresolved: number };
  radar: {
    threads: { active: number; dormant: number; archived: number; total: number };
    pendingCandidates: number;
    pendingSuggestions: number;
  };
  morningBrief: { ready: boolean; date: string; composedAt: string | null };
}

type Tod = "morning" | "afternoon" | "evening" | "late";

function timeOfDay(d: Date): Tod {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17) return "evening";
  return "late";
}

function greeting(tod: Tod): string {
  switch (tod) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Steady";
    case "evening":
      return "Wind-down";
    case "late":
      return "Quiet";
  }
}

export function HomeNarrator() {
  const { data: payload } = useAuthedFetch<{ ok: boolean; data: HealthShape }>(
    "/api/health",
  );
  const data = payload?.data;

  // Re-render at the top of each hour so the time-of-day shifts feel
  // natural without a full reload. Cheap · just a state bump.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = new Date();
    const msUntilNextHour =
      (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000;
    const t = setTimeout(() => setTick((n) => n + 1), msUntilNextHour);
    return () => clearTimeout(t);
  }, [tick]);

  // Re-fetch on the same domains the old HomeStrip subscribed to so
  // capture writes (chat tool calls, etc) push-refresh the sentence.
  const { reload } = useAuthedFetch<unknown>("/api/health");
  useEffect(() => {
    const off = onDataChanged(
      ["tasks", "goals", "score", "brain", "commitments"],
      () => setTimeout(reload, 500),
    );
    return off;
  }, [reload]);

  const sentence = useMemo(() => {
    if (!data) return null;
    return composeSentence(data, timeOfDay(new Date()));
  }, [data, tick]);

  if (!sentence || sentence.parts.length === 0) {
    // Clean state · self-hide entirely. Chat composer is the only
    // surface visible · matches "calm by default" radar pattern.
    return null;
  }

  return (
    <section
      aria-label="today at a glance"
      className="px-3 pt-3 pb-1 mx-auto max-w-[60ch]"
    >
      <p className="text-sm sm:text-base leading-relaxed text-[var(--text-primary)]">
        <span className="text-[var(--text-tertiary)]">{sentence.greeting} · </span>
        {sentence.parts.map((part, i) => (
          <span key={i}>
            {i > 0 ? (
              <span className="text-[var(--text-tertiary)]"> · </span>
            ) : null}
            {part.href ? (
              <Link
                href={part.href}
                className="text-[var(--gold)] hover:underline underline-offset-4 decoration-[var(--gold)]/40 hover:decoration-[var(--gold)] transition"
                title={part.title}
              >
                {part.text}
              </Link>
            ) : (
              <span>{part.text}</span>
            )}
          </span>
        ))}
        <span className="text-[var(--text-tertiary)]">.</span>
      </p>
    </section>
  );
}

interface SentencePart {
  text: string;
  href?: string;
  title?: string;
}

interface Composition {
  greeting: string;
  parts: SentencePart[];
}

function composeSentence(d: HealthShape, tod: Tod): Composition {
  const parts: SentencePart[] = [];

  // Order changes by time-of-day · morning leads with brief +
  // coalescing themes (forward-looking) · evening leads with done
  // (backward-looking) · alerts are urgent so they jump the queue
  // when they fire critical.

  // Critical alerts always lead regardless of time-of-day.
  if (d.alerts.unresolved > 0) {
    parts.push({
      text: `${d.alerts.unresolved} alert${d.alerts.unresolved === 1 ? "" : "s"}`,
      href: "/system/logs?view=errors",
      title: "open the unresolved alerts queue",
    });
  }

  // Morning: brief + coalescing themes first.
  if (tod === "morning") {
    if (d.morningBrief.ready) {
      parts.push({
        text: "brief ready",
        href: "/voice",
        title: "play today's morning brief",
      });
    }
    if (d.radar.pendingCandidates > 0) {
      const n = d.radar.pendingCandidates;
      parts.push({
        text: `${n} theme${n === 1 ? "" : "s"} coalescing`,
        href: "/journal",
        title: "open the pattern radar",
      });
    }
    if (d.tasks.doing > 0) {
      parts.push({
        text: `${d.tasks.doing} in motion`,
        href: "/tasks",
        title: "tasks currently doing",
      });
    } else if (d.tasks.ready > 0) {
      parts.push({
        text: `${d.tasks.ready} ready`,
        href: "/tasks",
        title: "tasks ready to start",
      });
    }
  }

  // Afternoon: throughput + remaining work.
  else if (tod === "afternoon") {
    if (d.tasks.done > 0) {
      parts.push({
        text: `${d.tasks.done} done`,
        href: "/tasks",
        title: "tasks completed today",
      });
    }
    if (d.tasks.doing > 0) {
      parts.push({
        text: `${d.tasks.doing} in motion`,
        href: "/tasks",
        title: "tasks currently doing",
      });
    }
    if (d.radar.pendingCandidates > 0) {
      const n = d.radar.pendingCandidates;
      parts.push({
        text: `${n} theme${n === 1 ? "" : "s"} coalescing`,
        href: "/journal",
        title: "open the pattern radar",
      });
    }
    if (d.radar.pendingSuggestions > 0) {
      const n = d.radar.pendingSuggestions;
      parts.push({
        text: `${n} join${n === 1 ? "" : "s"} to confirm`,
        href: "/journal",
        title: "borderline thread-join suggestions",
      });
    }
  }

  // Evening: reflection cue.
  else {
    if (d.tasks.done > 0) {
      parts.push({
        text: `${d.tasks.done} done`,
        href: "/tasks",
        title: "tasks completed today",
      });
    }
    const totalThreads = d.radar.threads.active;
    if (totalThreads > 0) {
      parts.push({
        text: `${totalThreads} thread${totalThreads === 1 ? "" : "s"} active`,
        href: "/journal",
        title: "named themes in the journal",
      });
    }
    if (d.tasks.doing > 0) {
      parts.push({
        text: `${d.tasks.doing} still open`,
        href: "/tasks",
        title: "tasks still in motion",
      });
    }
  }

  return {
    greeting: greeting(tod),
    parts: parts.slice(0, 4), // hard cap so the sentence stays sentence-length
  };
}
