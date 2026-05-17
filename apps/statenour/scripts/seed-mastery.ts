/**
 * Seed script for NOUR OS mastery database
 * Run: npx tsx scripts/seed-mastery.ts
 * Idempotent — safe to run multiple times
 */
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.resolve(__dirname, "../../../data/nour-os.db");
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run schema creation (same as db.ts initSchema)
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL, overall_score REAL,
    energy_level INTEGER, focus_quality INTEGER, discipline_score INTEGER,
    mood TEXT, wake_time TEXT, sleep_time TEXT, sleep_hours REAL,
    workout_done INTEGER DEFAULT 0, workout_type TEXT, workout_duration INTEGER,
    journal_done INTEGER DEFAULT 0, journal_entry TEXT,
    adderall_taken INTEGER DEFAULT 0, adderall_time TEXT,
    meals_tracked INTEGER DEFAULT 0, water_intake INTEGER DEFAULT 0,
    nasal_breathing_focus INTEGER DEFAULT 0, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, habit_key TEXT NOT NULL,
    completed INTEGER DEFAULT 0, notes TEXT, created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date, habit_key)
  );
  CREATE TABLE IF NOT EXISTS mastery_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, domain TEXT NOT NULL,
    score REAL, evidence TEXT, delta REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), UNIQUE(date, domain)
  );
  CREATE TABLE IF NOT EXISTS drift_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, rule_id TEXT NOT NULL,
    rule_name TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL,
    acknowledged INTEGER DEFAULT 0, resolved INTEGER DEFAULT 0, resolved_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, title TEXT NOT NULL,
    domain TEXT, stakes TEXT, context TEXT, options_considered TEXT,
    chosen TEXT, reasoning TEXT, predicted_outcome TEXT, emotional_state TEXT,
    review_date TEXT, actual_outcome TEXT, grade TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date_made TEXT NOT NULL, to_whom TEXT DEFAULT 'self',
    description TEXT NOT NULL, deadline TEXT, domain TEXT,
    status TEXT DEFAULT 'active', follow_up_date TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS open_loops (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, domain TEXT,
    priority TEXT DEFAULT 'medium', description TEXT, source TEXT,
    status TEXT DEFAULT 'open', decay_rate TEXT DEFAULT 'medium',
    date_identified TEXT DEFAULT (date('now')), date_resolved TEXT, resolution_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS morning_briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL, content TEXT NOT NULL,
    drift_alerts_count INTEGER DEFAULT 0, open_loops_count INTEGER DEFAULT 0,
    streak_data TEXT, top_priorities TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pattern_detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, pattern_id TEXT NOT NULL,
    pattern_name TEXT NOT NULL, trigger_desc TEXT, evidence TEXT,
    intervention_applied TEXT, outcome TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS body_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL, weight REAL,
    body_fat_pct REAL, waist_inches REAL, notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS financial_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL,
    net_worth_estimate REAL, checking_balance REAL, savings_balance REAL,
    investment_value REAL, business_revenue REAL, owner_take_home REAL,
    total_debt REAL, savings_rate_pct REAL, notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

console.log("Schema created/verified.");

// Helper: insert if not exists
function upsert(table: string, uniqueCol: string, uniqueVal: string, data: Record<string, unknown>) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE ${uniqueCol} = ?`).get(uniqueVal);
  if (existing) return;
  const cols = Object.keys(data);
  const placeholders = cols.map(() => "?").join(", ");
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(...Object.values(data));
}

// === SEED MASTERY BASELINES ===
const masteryBaselines = [
  { domain: "business_ops", score: 6.5, evidence: "Running shop daily, deployed autonicks.com, GSC audit done. Revenue automations planned, not built." },
  { domain: "sales", score: 3.0, evidence: "Follow-up automation designed but not built. No direct sales outreach visible. Critical gap." },
  { domain: "technical", score: 7.5, evidence: "Production deployment, 671-line upgrade plan, schema audit, Firebase TEEZY started." },
  { domain: "marketing", score: 4.5, evidence: "GSC audit done. Zero content published. Instagram calendar planned only." },
  { domain: "financial", score: 4.0, evidence: "Passive monitoring only. US Bank overdraft -$747.81 caught reactively." },
  { domain: "physical", score: 4.0, evidence: "230 lbs, target 186. Boxing at Strong Style. Bursts not sustained 4x/week." },
  { domain: "mental", score: 5.0, evidence: "High-intensity system building. ADHD managed with Adderall IR 10mg. Late-night rumination persists." },
  { domain: "leadership", score: 4.0, evidence: "AI system delegation only. No human team development visible." },
  { domain: "relationships", score: 5.0, evidence: "Married to Dania. Trying for children 4+ years. Mom health issues. Provider drive strong." },
  { domain: "strategy", score: 6.0, evidence: "Strong system design instinct. 5-year vision written. Inconsistent execution of strategy." },
];

for (const m of masteryBaselines) {
  upsert("mastery_scores", "domain", m.domain, { date: "2026-03-24", ...m, delta: 0 });
}
console.log(`Seeded ${masteryBaselines.length} mastery baselines.`);

// === SEED BODY TRACKING ===
upsert("body_tracking", "date", "2026-03-24", { date: "2026-03-24", weight: 230, notes: "Baseline. Target: 186 lbs." });
console.log("Seeded body tracking baseline.");

// === SEED FINANCIAL SNAPSHOT ===
upsert("financial_snapshots", "date", "2026-03-01", {
  date: "2026-03-01",
  checking_balance: -747.81,
  notes: "US Bank overdraft. FICO change detected. Firebase Blaze upgrade potential surprise bills.",
});
console.log("Seeded financial snapshot.");

// === SEED OPEN LOOPS (from knowledge/context/open-loops.md) ===
const openLoops = [
  { title: "Fund US Bank account (-$747.81) and reverse overdraft fee", priority: "critical", domain: "financial", decay_rate: "fast", source: "email triage" },
  { title: "Fix JSON-LD schema: all nickstire.org refs → autonicks.com", priority: "high", domain: "technical", decay_rate: "medium", source: "GSC audit" },
  { title: "Block Railway deployment URL from Google indexing", priority: "high", domain: "technical", decay_rate: "medium", source: "GSC audit" },
  { title: "Transfer nickstire.org nameservers from Manus → Cloudflare", priority: "high", domain: "technical", decay_rate: "slow", source: "deploy session" },
  { title: "Follow up estimate 1613 — HUGGINS, CINA (2011 Honda CRV)", priority: "critical", domain: "business", decay_rate: "fast", source: "morning brief" },
  { title: "Follow up estimate 1612 — Conner, Alaias (2014 Nissan Altima)", priority: "critical", domain: "business", decay_rate: "fast", source: "morning brief" },
  { title: "Follow up estimate 1610 — Faxall, Tyasia (2015 Jeep Grand Cherokee)", priority: "high", domain: "business", decay_rate: "fast", source: "morning brief" },
  { title: "Follow up estimate 1609 — WOUP, ANDRE (1977 Oldsmobile Toronado)", priority: "high", domain: "business", decay_rate: "medium", source: "morning brief" },
  { title: "Follow up estimate 1606 — EDWARDS, JOHNNY (2017 Honda Accord)", priority: "high", domain: "business", decay_rate: "medium", source: "morning brief" },
  { title: "Post 1 piece of content to Instagram", priority: "high", domain: "marketing", decay_rate: "fast", source: "mastery check" },
  { title: "Configure Twilio SMS webhook for booking bot", priority: "medium", domain: "technical", decay_rate: "slow", source: "NOU-8" },
  { title: "Build customer follow-up automation (NOU-11)", priority: "high", domain: "business", decay_rate: "medium", source: "Linear" },
  { title: "Export Claude conversation history for knowledge pipeline", priority: "medium", domain: "systems", decay_rate: "slow", source: "weekly sync" },
  { title: "Execute Phase 1 of MASTER-UPGRADE-PROMPT.md", priority: "medium", domain: "technical", decay_rate: "slow", source: "upgrade plan" },
  { title: "Verify GitHub PAT permissions — scope down if needed", priority: "medium", domain: "technical", decay_rate: "slow", source: "email triage" },
  { title: "Check FICO score change direction (AmEx MyCredit Guide)", priority: "medium", domain: "financial", decay_rate: "medium", source: "morning briefing" },
];

let loopCount = 0;
for (const loop of openLoops) {
  const exists = db.prepare(`SELECT id FROM open_loops WHERE title = ?`).get(loop.title);
  if (!exists) {
    db.prepare(`INSERT INTO open_loops (title, domain, priority, decay_rate, source) VALUES (?, ?, ?, ?, ?)`)
      .run(loop.title, loop.domain, loop.priority, loop.decay_rate, loop.source);
    loopCount++;
  }
}
console.log(`Seeded ${loopCount} open loops.`);

// === SEED COMMITMENTS ===
const commitments = [
  { description: "Run Daily Command 5/7 days per week", to_whom: "self", domain: "discipline", deadline: "2026-06-24" },
  { description: "Weekly CEO Review every Sunday", to_whom: "self", domain: "discipline", deadline: null },
  { description: "3 Instagram posts per week", to_whom: "self", domain: "marketing", deadline: null },
  { description: "Follow up on all estimates within 48 hours", to_whom: "customers", domain: "business", deadline: null },
  { description: "Train 4x/week at Strong Style or gym", to_whom: "self", domain: "physical", deadline: null },
  { description: "Sleep before midnight on weeknights", to_whom: "self", domain: "mental", deadline: null },
  { description: "Weekly financial pulse — check all accounts", to_whom: "self", domain: "financial", deadline: null },
  { description: "Lose 44 lbs: 230 → 186 target", to_whom: "self", domain: "physical", deadline: "2027-03-01" },
  { description: "$10K/month owner take-home from shop", to_whom: "self", domain: "financial", deadline: null },
  { description: "No impulse purchases over $50 without 48hr wait", to_whom: "self", domain: "financial", deadline: null },
];

let commitCount = 0;
for (const c of commitments) {
  const exists = db.prepare(`SELECT id FROM commitments WHERE description = ?`).get(c.description);
  if (!exists) {
    db.prepare(`INSERT INTO commitments (date_made, to_whom, description, deadline, domain) VALUES (?, ?, ?, ?, ?)`)
      .run("2026-03-24", c.to_whom, c.description, c.deadline, c.domain);
    commitCount++;
  }
}
console.log(`Seeded ${commitCount} commitments.`);

// === SEED KEY DECISIONS ===
const decisions = [
  { title: "Changed shop name from Moe's to Nick's Tire & Auto", domain: "business", stakes: "high", chosen: "Full rebrand to Nick's", reasoning: "Other Moe's shops jealous, brand confusion", grade: "B" },
  { title: "Deployed autonicks.com as primary domain", domain: "technical", stakes: "medium", chosen: "Railway + Cloudflare deployment", reasoning: "nickstire.org nameservers controlled by Manus — needed full DNS control", grade: "A" },
  { title: "Built NOUR OS as markdown-based brain system", domain: "technical", stakes: "medium", chosen: "Local markdown + Claude Code execution", reasoning: "Multiple prior attempts (Notion, Statenour web app, Python runtime) — this is most sustainable", grade: "B" },
  { title: "Set owner take-home target at $10K/month", domain: "financial", stakes: "high", chosen: "$10K/month with $5K/day stretch", reasoning: "Concrete financial goal for shop operations", grade: null },
  { title: "Weight loss commitment: 230 → 186 lbs", domain: "health", stakes: "high", chosen: "Boxing + gym, 1-1.5 lbs/week", reasoning: "Out of shape, inconsistent training. Provider identity requires physical readiness.", grade: "D" },
];

let decisionCount = 0;
for (const d of decisions) {
  const exists = db.prepare(`SELECT id FROM decisions WHERE title = ?`).get(d.title);
  if (!exists) {
    db.prepare(`INSERT INTO decisions (date, title, domain, stakes, chosen, reasoning, grade) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("2026-03-24", d.title, d.domain, d.stakes, d.chosen, d.reasoning, d.grade);
    decisionCount++;
  }
}
console.log(`Seeded ${decisionCount} decisions.`);

console.log("\n✅ Seed complete. Database at:", DB_PATH);
db.close();
