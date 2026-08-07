// ─── AUTONOMOUS OPERATIONS · CRON DESCRIPTIONS ────────────
// Static descriptive catalog of the scheduled jobs surfaced in the
// ShopDriver HQ "Autonomous Operations" panel. This is DATA (not JSX) —
// rendered by SettingsSection. Editing here updates the displayed list.

export const AUTONOMOUS_OPERATIONS: Array<{ name: string; interval: string; desc: string }> = [
  // ── ALG / ShopDriver sync ─────────────────────────
  { name: "ALG Overnight Probe", interval: "Daily 3 AM ET", desc: "Single nightly sync — shop closed, no Moe risk" },
  { name: "ALG On-Login Probe", interval: "On admin login", desc: "Fresh data when you arrive at /admin" },
  { name: "ALG Chat-Demand Probe", interval: "On Nick query", desc: "Probes when Nick asks for shop pulse" },
  // ── Workflow automation ───────────────────────────
  { name: "Intelligence Autopilot", interval: "Every 2h", desc: "Lead scoring, revenue pacing, cross-sell" },
  { name: "No-Show Detection", interval: "Daily", desc: "Flags past-date bookings, sends SMS" },
  { name: "Declined Work Recovery", interval: "Daily", desc: "5×3 SMS sequence to walk-aways (DRY-RUN until env set)" },
  { name: "Review Auto-Draft", interval: "Daily", desc: "AI drafts for new Google reviews" },
  { name: "Cross-Sell Outreach", interval: "Daily", desc: "SMS recommendations from service history" },
  { name: "Stale Booking Cleanup", interval: "Daily", desc: "Auto-cancels 30+ day old bookings" },
  { name: "Callback Escalation", interval: "Every 2h", desc: "Re-alerts on unanswered callbacks >4h" },
  // ── wave-181.x Tier S/A compounding loops (NEW) ────
  { name: "Customer Psycho Profiler", interval: "Daily", desc: "Classify ~2,800 customers into 10 segments for SMS routing" },
  { name: "Inventory Demand Forecast", interval: "Daily", desc: "Aggregate declined tire estimates → Gateway purchase signal" },
  { name: "Nick AI Call Eval", interval: "Daily", desc: "Score every VAPI call 0-100 · Telegram if avg<60 or 3+ wasted" },
  { name: "Agentic Actions Auditor", interval: "Daily", desc: "Audit Nick AI tool calls · price drift · missing bookings" },
  { name: "Closed-Loop Measurement", interval: "Daily", desc: "Measure wave_metrics with measure_at past · auto-seeds baselines" },
  { name: "SEO Forensic", interval: "Daily", desc: "Top-30 GSC queries · catch rank drops ≥5 positions same-day" },
  { name: "Monte-Carlo Forecast", interval: "Weekly (Mon)", desc: "10k trials · P10/P50/P90 revenue band · top variance driver" },
  { name: "Weekly Revenue Digest", interval: "Weekly (Mon)", desc: "Paid-invoice mirror truth · WoW delta · repeat-revenue share · arrivals receipts → Telegram" },
  { name: "Competitor Monitor", interval: "Daily", desc: "5 competitors · Google Places · rating + review delta detection" },
  { name: "SMS Gateway Health", interval: "Every 15m", desc: "Ping F25e Capevace cloud · Telegram if offline >30m" },
];
