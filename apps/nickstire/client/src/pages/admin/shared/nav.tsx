/**
 * Shared admin navigation config.
 */
import React from "react";
import {
  LayoutDashboard, UserCheck, Send, DollarSign, PhoneCall, Settings, Disc,
  ClipboardList, TrendingUp, Shield,
} from "lucide-react";
import type { NavGroup } from "./types";

/**
 * NAV STRUCTURE — Restructured 9-Section Organization Pass (2026-06-12)
 *
 * Reorganizes the admin panel into 9 clean operational sections:
 *   1. Today (overview)
 *   2. Customers (customers)
 *   3. Sales Pipeline (leads)
 *   4. Tires (tireOrders)
 *   5. Marketing / Growth (growth)
 *   6. Winback (campaigns)
 *   7. Nonstop Nick (memberships)
 *   8. Reports (opsHub)
 *   9. Settings / Safety (settings)
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "", // Flat list
    items: [
      { id: "overview", label: "Today", icon: <LayoutDashboard className="w-4 h-4" />, badge: "leads" },
      { id: "customers", label: "Customers", icon: <UserCheck className="w-4 h-4" /> },
      { id: "leads", label: "Sales Pipeline", icon: <TrendingUp className="w-4 h-4" /> },
      { id: "tireOrders", label: "Tires", icon: <Disc className="w-4 h-4" /> },
      { id: "growth", label: "Marketing / Growth", icon: <TrendingUp className="w-4 h-4" /> },
      { id: "campaigns", label: "Winback", icon: <Send className="w-4 h-4" /> },
      { id: "memberships", label: "Nonstop Nick", icon: <Shield className="w-4 h-4" /> },
      { id: "opsHub", label: "Reports", icon: <ClipboardList className="w-4 h-4" /> },
      { id: "settings", label: "Settings / Safety", icon: <Settings className="w-4 h-4" /> },
    ],
  },
];

// Flat list for backward compatibility
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);
