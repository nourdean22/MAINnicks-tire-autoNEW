/**
 * Ops registry — the single source of truth behind the admin Ops Hub
 * (Reports / Owner Actions / Danger Zones).
 *
 * 2026-06-10 danger-zone-safe-build wave. Static and hand-maintained on
 * purpose: every entry is a CLAIM, and claims here must be as carefully
 * curated as code. Update an entry in the same PR that changes its truth.
 *
 * Nothing in this module performs side effects — it is data consumed by
 * read-only admin UI.
 */

export type OpsStatus =
  | "done"            // verified complete (cite evidence)
  | "partial"         // some shipped, some missing
  | "preview_only"    // built but cannot execute side effects
  | "design_only"     // documented, no code path
  | "manual_owner"    // only the owner can do this (external access)
  | "blocked_external"// needs credentials/docs we don't have
  | "requires_approval" // safe to build, but activation needs owner sign-off
  | "not_started";

export type OpsRisk = "low" | "medium" | "high";

export interface OpsItem {
  id: string;
  title: string;
  category:
    | "Money Safety"
    | "Supplier Availability"
    | "Customer Messaging"
    | "GBP / Local SEO"
    | "Entity Cleanup"
    | "Google Sheets"
    | "Reports / Audits"
    | "Website Audit";
  status: OpsStatus;
  risk: OpsRisk;
  /** What is true today — no aspiration, no hype. */
  truth: string;
  /** Exactly what is FORBIDDEN until an explicit owner-approved change. */
  forbidden?: string;
  /** The single next action. */
  nextAction: string;
  /** Does this need the owner (credentials / money / external account)? */
  ownerRequired: boolean;
  /** Repo doc with the full detail, relative to apps/nickstire/. */
  doc?: string;
  /** Admin deep link if one exists. */
  href?: string;
  /** When a human last verified this entry (YYYY-MM-DD). */
  lastVerified: string;
}

export const OPS_REGISTRY: OpsItem[] = [
  // ─── Money Safety ──────────────────────────────────────────
  {
    id: "refund-writeback",
    title: "Refunds / writeback",
    category: "Money Safety",
    status: "done",
    risk: "high",
    truth:
      "LIVE admin-gated refunds exist. The Tire Orders cockpit AUTO-REFUND button calls gatewayTire.refundOrder " +
      "(adminProcedure, non-empty reason required, two-tap confirm) -> refundTireOrderPayment, which issues " +
      "stripe.refunds.create with an idempotency key (refund-<orderNumber>), flips tire_orders + the linked invoice " +
      "to 'refunded', and appends a timestamped admin note (actor + reason + Stripe refund id). Invoice-level refunds " +
      "use the same Stripe path with an explicit amount in server/routers/advanced/invoices.ts.",
    forbidden: "Moving money out outside this flow: refunds without an admin session, without a reason, or bypassing the refund-<orderNumber> idempotency key.",
    nextAction: "Monitor: every refund must write paymentStatus='refunded' + an admin note. If one ever lacks a note or double-fires, check the idempotency key.",
    ownerRequired: false,
    doc: "docs/refund-writeback-design.md",
    href: "/admin?tab=tireOrders",
    lastVerified: "2026-06-19",
  },
  {
    id: "stripe-config",
    title: "Stripe configuration health",
    category: "Money Safety",
    status: "done",
    risk: "high",
    truth:
      "payments.health exposes booleans (never keys). The Tire Orders cockpit shows a red banner if " +
      "STRIPE_WEBHOOK_SECRET is missing while charges are enabled. Live QA 2026-06-10: no banner = fully configured.",
    nextAction: "If a red banner ever appears, set STRIPE_WEBHOOK_SECRET on Railway the same day.",
    ownerRequired: false,
    href: "/admin?tab=tireOrders",
    lastVerified: "2026-06-10",
  },
  // ─── Supplier Availability ─────────────────────────────────
  {
    id: "dk-gateway",
    title: "D&K / Gateway live availability",
    category: "Supplier Availability",
    status: "blocked_external",
    risk: "high",
    truth:
      "D&K migrated their B2B portal to a static SPA in 2026; the old auth endpoint is gone. The site runs on " +
      "the daily pipeline cache (live QA 2026-06-10: real D&K inventory served) with an honest catalog fallback " +
      "banner when the cache misses. Order-time availability rechecks are impossible today. NO supplier ordering " +
      "exists in code.",
    forbidden: "Placing supplier orders, or claiming live availability before a working endpoint is verified.",
    nextAction: "Owner: get current API docs/credentials from the D&K/Gateway rep, then scope a repair PR.",
    ownerRequired: true,
    doc: "docs/gateway-dk-availability-status.md",
    lastVerified: "2026-06-10",
  },
  // ─── Customer Messaging ────────────────────────────────────
  {
    id: "customer-confirmations",
    title: "Customer confirmation SMS/email",
    category: "Customer Messaging",
    status: "preview_only",
    risk: "high",
    truth:
      "Customers currently get NO automatic order-confirmation messages. Preview-only templates exist in " +
      "server/services/customerMessageTemplates.ts — there is no send path, no cron, no provider call.",
    forbidden: "Sending any SMS/email to customers until the owner approves provider, cost, and copy.",
    nextAction: "Owner reviews templates + the notifications design doc, approves provider/env, then a dedicated send PR.",
    ownerRequired: true,
    doc: "docs/customer-confirmation-notifications.md",
    lastVerified: "2026-06-10",
  },
  // ─── GBP / Local SEO ───────────────────────────────────────
  {
    id: "gbp-automation",
    title: "GBP automation (posts, reviews, Q&A, photos)",
    category: "GBP / Local SEO",
    status: "partial",
    risk: "medium",
    truth:
      "Generator/poster code exists (gbpAutoPost.ts, gbpContentGenerator.ts, reviewMonitor.ts, igAutopost.ts) " +
      "but production enablement was NOT verified this session. Q&A seeds, photo shot lists, competitor monitor, " +
      "and rank tracker are roadmap-only. All new GBP work stays draft-queue / copy-paste until approved.",
    forbidden: "New live posting paths or review replies without owner review.",
    nextAction: "Verify which automations are actually enabled in prod env, then work the roadmap doc top-down.",
    ownerRequired: true,
    doc: "docs/gbp-automation-roadmap.md",
    lastVerified: "2026-06-10",
  },
  // ─── Entity Cleanup ────────────────────────────────────────
  {
    id: "entity-cleanup",
    title: "Brand / entity cleanup (external NAP)",
    category: "Entity Cleanup",
    status: "manual_owner",
    risk: "medium",
    truth:
      "External listings (GBP, Yelp, Facebook, CARFAX, BBB, MapQuest, old Google Sites) can only be fixed by " +
      "logging into each platform. Nothing here is automated and nothing has been verified as fixed.",
    forbidden: "Editing any external platform from code.",
    nextAction: "Owner works the checklist platform-by-platform; mark each row as you go.",
    ownerRequired: true,
    doc: "docs/entity-cleanup-checklist.md",
    lastVerified: "2026-06-10",
  },
  // ─── Google Sheets ─────────────────────────────────────────
  {
    id: "sheets-tire-orders",
    title: "Google Sheets — Tire Orders tab",
    category: "Google Sheets",
    status: "done",
    risk: "low",
    truth:
      "Operator-completed 2026-06-10 and verified via a Drive read: tab named exactly 'Tire Orders' with the " +
      "canonical 24 headers in row 1. Sync is append-only and fail-soft (a missing tab can never lose an order). " +
      "First synced order row not yet observed.",
    nextAction: "Watch the next online order appear as a sheet row; if it doesn't, check server logs for the sheets-sync error.",
    ownerRequired: false,
    doc: "docs/tire-orders-cockpit.md",
    lastVerified: "2026-06-10",
  },
  // ─── Website Audit ─────────────────────────────────────────
  {
    id: "website-audit",
    title: "Website audit cleanup",
    category: "Website Audit",
    status: "partial",
    risk: "medium",
    truth:
      "Three truth/pricing waves shipped 2026-06-03 (warranty, founding-date, geo, tire pricing centralized). " +
      "Open: phone/SMS/voice channels still quote '$60 used' vs the site's '$25 installed' (owner price decision), " +
      "/emissions meta-description length warning, off-palette hex hygiene on 4 pages.",
    nextAction: "Owner decides the used-tire price channel policy; then a small cleanup PR.",
    ownerRequired: true,
    doc: "docs/website-audit-status.md",
    lastVerified: "2026-06-10",
  },
  // ─── Reports / Audits ──────────────────────────────────────
  {
    id: "completion-ledger",
    title: "Project completion ledger",
    category: "Reports / Audits",
    status: "done",
    risk: "low",
    truth:
      "Repo-root docs/PROJECT-COMPLETION-LEDGER.md tags every roadmap item with evidence-based status. " +
      "Hand-maintained — update it in the PR that changes an item's truth.",
    nextAction: "Review the three owner-gated rows (D&K, messaging, entity cleanup) — refunds now shipped LIVE.",
    ownerRequired: false,
    doc: "../../docs/PROJECT-COMPLETION-LEDGER.md",
    lastVerified: "2026-06-10",
  },
];

/** Reports corpus — existing audit/report documents worth one click. */
export interface ReportDoc {
  title: string;
  category: string;
  path: string;
  note: string;
}

export const REPORT_DOCS: ReportDoc[] = [
  { title: "Project Completion Ledger", category: "Completion Ledger", path: "docs/PROJECT-COMPLETION-LEDGER.md", note: "Repo root — evidence-based status of every roadmap item" },
  { title: "Tire Orders Cockpit guide", category: "Tire Commerce", path: "apps/nickstire/docs/tire-orders-cockpit.md", note: "Routes, banner meanings, what is NOT automated" },
  { title: "Checkout error closeout / hardening", category: "Checkout Safety", path: "apps/nickstire/docs/2026-06-10-tires-quantum-conversion-upgrade.md", note: "Latest /tires conversion + claim-safety wave" },
  { title: "Front-face uniformity audit", category: "Website SEO Audit", path: "apps/nickstire/docs/frontface-audit/PLAN.md", note: "3 shipped waves: warranty/pricing/founding truth" },
  { title: "Admin cleanup audit", category: "Website SEO Audit", path: "apps/nickstire/docs/audits/NICKSTIRE-ADMIN-CLEANUP-AUDIT.md", note: "" },
  { title: "Attribution tracking audit + closeout", category: "Ads / Social", path: "apps/nickstire/docs/audits/NICKSTIRE-ATTRIBUTION-TRACKING-AUDIT.md", note: "UTM spine, Sheets tails, CAPI (dormant)" },
  { title: "Lead source hygiene audit", category: "Ads / Social", path: "apps/nickstire/docs/audits/NICKSTIRE-LEAD-SOURCE-HYGIENE-AUDIT.md", note: "" },
  { title: "Off-page growth playbook", category: "GBP / Local SEO", path: "apps/nickstire/docs/2026-05-30-offpage-growth-playbook.md", note: "" },
  { title: "GBP automation roadmap", category: "GBP / Local SEO", path: "apps/nickstire/docs/gbp-automation-roadmap.md", note: "Draft-queue-only plan — no live posting" },
  { title: "Entity cleanup checklist", category: "Entity Cleanup", path: "apps/nickstire/docs/entity-cleanup-checklist.md", note: "Owner manual NAP fixes" },
  { title: "Refund / writeback design", category: "Checkout Safety", path: "apps/nickstire/docs/refund-writeback-design.md", note: "Design doc — refunds now LIVE (admin-gated AUTO-REFUND in Tire Orders)" },
  { title: "Gateway / D&K availability status", category: "D&K / Gateway", path: "apps/nickstire/docs/gateway-dk-availability-status.md", note: "Why live availability is down, what's needed" },
  { title: "Customer confirmation notifications", category: "Customer Messaging", path: "apps/nickstire/docs/customer-confirmation-notifications.md", note: "Preview-only — no sends" },
  { title: "Website audit status", category: "Website SEO Audit", path: "apps/nickstire/docs/website-audit-status.md", note: "What's fixed vs still open" },
];
