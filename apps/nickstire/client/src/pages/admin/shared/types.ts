/**
 * Shared admin type aliases.
 */
import type React from "react";

// ─── TYPES ──────────────────────────────────────────────
// 2026-04-24 admin audit: down from 45 sections to 16 active routes.
// Deleted 27 dead/redundant sections. See commit log for rationale.
// 2026-05-19 Elon-cut · noShowRisk + conversionPreview removed.
// 2026-05-19 MONEY consolidation · declinedEstimates + snapDashboard
// removed from union — they're tabs inside Money now, not destinations.
// 2026-05-19 · walkInCalc removed from union — converted to event-bus
// drawer (WalkInQuoteDrawer · openWalkInQuote() fires it from anywhere).
// Old URLs redirect via COMPOUND_REDIRECTS in Admin.tsx.
export type AdminSection =
  | "commandCenter" | "overview" | "leads" | "content" | "customers"
  | "campaigns" | "settings" | "revenue" | "callTrackingView"
  | "trafficFunnel" | "voiceReceptionist" | "memberships";
// 2026-05-09 — `reEngagement` removed from AdminSection union. Was a zombie
// top-level route after the wave-103 era half-migration to OutreachHub.
// Now lives ONLY as the 6th OutreachHub tab (campaigns?outreachTab=reengage).
// 2026-05-24 — `intelligence` removed (Intelligence Dispersal Wave 3).
// Signals dispersed to statenour /scoreboard + various briefs. The
// `intelligence` URL alias survives in Admin.tsx TAB_ALIASES so legacy
// bookmarks redirect to "overview".
export type BookingStatus = "new" | "confirmed" | "completed" | "cancelled";
export type LeadStatus = "new" | "contacted" | "booked" | "completed" | "closed" | "lost";

export type NavGroup = { label: string; items: { id: AdminSection; label: string; icon: React.ReactNode; badge?: string }[] };
