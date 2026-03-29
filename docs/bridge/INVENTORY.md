# Admin Inventory — Nick's Tire & Auto
Generated: 2026-03-29

## Admin Frontend

### Shell: `client/src/pages/Admin.tsx`
- Auth gate: Google OAuth → role check (`user.role === "admin"`)
- State: `useState<AdminSection>("overview")` for section selection
- Layout: Fixed 260px sidebar + main content area
- Mobile: Overlay sidebar with backdrop blur
- Stats polling: `trpc.adminDashboard.stats` at 60s interval (for badge counts)

### Section Config: `client/src/pages/admin/shared.tsx`
- `AdminSection` union type: 30 sections
- `NAV_GROUPS`: 6 groups (Dashboard, Sales Pipeline, Customers & SMS, Marketing, Operations, System)
- `SECTION_TITLES`: Display names for all 30 sections
- `NAV_ITEMS`: Flat list from NAV_GROUPS

### All 30 Admin Sections

| Group | Section ID | Label | Component |
|-------|-----------|-------|-----------|
| Dashboard | overview | Overview | OverviewSection.tsx |
| Dashboard | analyticsView | Analytics | AnalyticsSection.tsx |
| Dashboard | callTrackingView | Call Tracking | CallTrackingSection.tsx |
| Dashboard | revenue | Revenue Center | RevenueSection.tsx |
| Dashboard | health | Site Health | SiteHealthSection.tsx |
| Dashboard | exportView | Export Data | ExportSection.tsx |
| Sales Pipeline | bookings | Bookings | BookingsSection.tsx |
| Sales Pipeline | tireOrders | Tire Orders | TireOrdersSection.tsx |
| Sales Pipeline | leads | Leads / CRM | LeadsSection.tsx |
| Sales Pipeline | financing | Financing | FinancingSection.tsx |
| Sales Pipeline | chats | Chat Sessions | ChatSessionsSection.tsx |
| Customers & SMS | customers | Customers | CustomersSection.tsx |
| Customers & SMS | sms | SMS | SmsSection.tsx |
| Customers & SMS | winback | Win-Back | WinBackSection.tsx |
| Customers & SMS | campaigns | Campaigns | CampaignsSection.tsx |
| Customers & SMS | autoFollowUp | Auto Follow-Up | AutoFollowUpSection.tsx |
| Customers & SMS | followups | Follow-Ups | FollowUpsSection.tsx |
| Marketing | content | Content | ContentSection.tsx |
| Marketing | coupons | Coupons | CouponsSection.tsx |
| Marketing | referrals | Referrals | ReferralsSection.tsx |
| Marketing | reviewRequests | Reviews | ReviewRequestsSection.tsx |
| Operations | inspections | Inspections | InspectionsSection.tsx |
| Operations | loyalty | Loyalty | LoyaltyAdminSection.tsx |
| Operations | qa | Q&A | QASection.tsx |
| Operations | jobs | Job Board | JobBoardSection.tsx |
| Operations | integrations | Integrations | IntegrationsSection.tsx |
| System | shopdriver | ShopDriver Sync | ShopDriverSection.tsx |
| System | estimates | Estimate Log | EstimatesSection.tsx |
| System | activity | Activity Feed | ActivitySection.tsx |
| System | settings | Shop Settings | SettingsSection.tsx |

### Polling Intervals

| Endpoint | Interval | Used In |
|----------|----------|---------|
| adminDashboard.stats | 60s | Overview, Revenue, Admin shell (badges) |
| adminDashboard.siteHealth | 5min | Overview |
| customers.campaignStats | 30s | Overview, Customers |
| booking.list | 30s | Bookings |
| lead.list | 30s | Leads |
| customers.recentFollowUps | 15s | AutoFollowUp |
| followUps.pending/recent | 30s | FollowUps |

### UI Kit
- shadcn/ui + cmdk (v1.1.1) already installed
- Command component at `client/src/components/ui/command.tsx`
- StatCard, UrgencyBadge, ActivityIcon, StatusDot in shared.tsx

---

## Admin Backend (tRPC)

### adminDashboardRouter (admin.ts)
- `stats` — DashboardStats (bookings, leads, content, chat, users, activity, callTracking, callbacks)
- `siteHealth` — Domain info, sitemap count, blog posts, Google review rating, Sheets config
- `notificationLog` — Delivery logs
- `syncHealth` — Integration health checks (DB, Sheets, Gmail, Gateway Tire, Twilio, Stripe, etc.)

### analyticsRouter (admin.ts)
- `snapshots` — Daily analytics (30d default)
- `serviceBreakdown` — Service booking breakdown
- `funnel` — {bookings, leads, completed, converted}

### followUpsRouter (admin.ts)
- `run` — Execute follow-up
- `pending` — Pending notifications
- `recent` — Recent notifications (limit 50)

### weeklyReportRouter (admin.ts)
- `generate` — Weekly intelligence report, sent via email

### callTrackingRouter (admin.ts)
- `logCall` — PUBLIC — log phone click
- `list` — Call events (limit 100)

### exportRouter (admin.ts)
- `bookings` / `leads` / `calls` / `callbacks` — CSV exports

### controlCenterRouter (controlCenter.ts)
- `getOverview` — Today's stats, urgent items, AI gateway, system status
- `getDailyBrief` / `getYesterday` — Daily execution metrics
- `toggleHabit` / `setMission` / `logAction` / `closeDay` — Daily ops
- `getRepoActivity` / `getOperationalTwin` / `getSourceStatus`

### invoicesRouter (advanced.ts)
- `list` / `create` / `update` / `delete` / `stats` / `topCustomers`

### kpiRouter (advanced.ts)
- `current` / `history`

### campaignsRouter (campaigns.ts)
- `list` / `getById` / `create` / `preview` / `send` / `recentSends` / `stats`

### customersRouter (customers.ts)
- `list` / `stats` / `getById` / `campaignStats` / `recentFollowUps`
- `exportCsv` / `quickSms` / `updateNotes` / `retryCampaign` / `updateSegment`

---

## Auth

- Google OAuth via `server/_core/oauth.ts`
- Session cookie: httpOnly, secure, sameSite: none, 1yr expiry
- tRPC: adminProcedure enforces `ctx.user.role === 'admin'`
- Admin gate in Admin.tsx: `useAuth()` hook → role check → redirect to login
