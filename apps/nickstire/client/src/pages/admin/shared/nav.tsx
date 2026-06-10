/**
 * Shared admin navigation config.
 */
import React from "react";
import {
  LayoutDashboard, UserCheck, Send, DollarSign, PhoneCall, Settings, Disc,
  ClipboardList,
} from "lucide-react";
import type { NavGroup } from "./types";

/**
 * NAV STRUCTURE — 2026-05-19 Elon+Jobs first-principles reset.
 *
 * Prior iterations (4 → 4 → 5 groups, 17 → 12 items) optimized inside
 * the wrong frame: organizing destinations by category. Operator at a
 * Cleveland tire shop running this from his phone asks ONE question:
 * "what needs me right now and what's making me money?"
 *
 * That maps to 4 verbs, not 5 categories:
 *   TODAY      — Dashboard surfaces the action queue (leads + bookings +
 *                callbacks + voice metrics all surfaced as priority items).
 *                Leads / Calls / Voice Receptionist remain reachable via
 *                Cmd+K or ?tab=leads / ?tab=callTrackingView / ?tab=voiceReceptionist
 *                — they just aren't first-class sidebar slots.
 *   CUSTOMERS  — the ledger + 1:1 SMS surface
 *   OUTREACH   — bulk campaigns, win-back, reviews, performance
 *   MONEY      — revenue + declined + financing + shop floor (5 tabs in one screen)
 *   SETTINGS   — config (ShopDriver / Health / Compliance / Integrations)
 *
 * Killed from sidebar in this pass (still URL-reachable):
 *   - Leads & Estimates       → priority queue on Dashboard
 *   - Call Tracking           → priority queue on Dashboard
 *   - Voice Receptionist      → call surface accessible via Cmd+K
 *   - GROW group entirely     → trafficFunnel / content / intelligence
 *                                are monthly review tools, not shift work
 *   - NOUR OS Bridge          → 433 lines for 2 hyperlinks + a status dot;
 *                                links live in the sidebar footer already
 *
 * Group labels removed: 5 items in a flat list don't need category
 * headers. The items ARE their own context.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "", // No group label · flat list per Jobs "one screen one question"
    items: [
      { id: "overview", label: "Today", icon: <LayoutDashboard className="w-4 h-4" />, badge: "leads" },
      { id: "customers", label: "Customers", icon: <UserCheck className="w-4 h-4" /> },
      { id: "campaigns", label: "Outreach", icon: <Send className="w-4 h-4" /> },
      { id: "revenue", label: "Money", icon: <DollarSign className="w-4 h-4" /> },
      { id: "tireOrders", label: "Tire Orders", icon: <Disc className="w-4 h-4" /> },
      // 2026-05-23 · added Voice back. Wave 181.92 dropped it claiming
      // Cmd+K accessibility, but it was never actually wired into
      // CommandSearch — leaving operator with no way to find it from
      // the phone. VAPI / "Nick" handles inbound shop calls; the
      // operator needs to see call activity + transcripts on a glance.
      { id: "voiceReceptionist", label: "Voice (Nick)", icon: <PhoneCall className="w-4 h-4" /> },
      // 2026-06-10 · Ops Hub: reports corpus + owner-action registry +
      // preview-only message templates. Read-only by design; earns the
      // slot because the four owner-gated systems (refunds, D&K,
      // messaging, entity cleanup) had no visible home before this.
      { id: "opsHub", label: "Ops Hub", icon: <ClipboardList className="w-4 h-4" /> },
      { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
    ],
  },
];

// Flat list for backward compatibility
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);
