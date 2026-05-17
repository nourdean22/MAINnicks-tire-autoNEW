import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.resolve(process.cwd(), "../../data/nour-os.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      overall_score REAL,
      energy_level INTEGER CHECK(energy_level BETWEEN 1 AND 10),
      focus_quality INTEGER CHECK(focus_quality BETWEEN 1 AND 10),
      discipline_score INTEGER CHECK(discipline_score BETWEEN 1 AND 10),
      mood TEXT CHECK(mood IN ('calm','stressed','anxious','energized','flat','irritable')),
      wake_time TEXT,
      sleep_time TEXT,
      sleep_hours REAL,
      workout_done INTEGER DEFAULT 0,
      workout_type TEXT CHECK(workout_type IN ('boxing','gym','walk','bodyweight','none',NULL)),
      workout_duration INTEGER,
      journal_done INTEGER DEFAULT 0,
      journal_entry TEXT,
      adderall_taken INTEGER DEFAULT 0,
      adderall_time TEXT,
      meals_tracked INTEGER DEFAULT 0,
      water_intake INTEGER DEFAULT 0,
      nasal_breathing_focus INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      habit_key TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, habit_key)
    );

    CREATE TABLE IF NOT EXISTS mastery_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      domain TEXT NOT NULL,
      score REAL CHECK(score BETWEEN 0 AND 10),
      evidence TEXT,
      delta REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, domain)
    );

    CREATE TABLE IF NOT EXISTS drift_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      severity TEXT CHECK(severity IN ('warning','alert','critical')) NOT NULL,
      message TEXT NOT NULL,
      acknowledged INTEGER DEFAULT 0,
      resolved INTEGER DEFAULT 0,
      resolved_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      domain TEXT,
      stakes TEXT CHECK(stakes IN ('low','medium','high','critical')),
      context TEXT,
      options_considered TEXT,
      chosen TEXT,
      reasoning TEXT,
      predicted_outcome TEXT,
      emotional_state TEXT,
      review_date TEXT,
      actual_outcome TEXT,
      grade TEXT CHECK(grade IN ('A','B','C','D','F',NULL)),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_made TEXT NOT NULL,
      to_whom TEXT DEFAULT 'self',
      description TEXT NOT NULL,
      deadline TEXT,
      domain TEXT,
      status TEXT CHECK(status IN ('active','kept','broken','deferred','in_progress')) DEFAULT 'active',
      follow_up_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS open_loops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      domain TEXT,
      priority TEXT CHECK(priority IN ('critical','high','medium','low')) DEFAULT 'medium',
      description TEXT,
      source TEXT,
      status TEXT CHECK(status IN ('open','in_progress','resolved','dropped')) DEFAULT 'open',
      decay_rate TEXT CHECK(decay_rate IN ('fast','medium','slow','none')) DEFAULT 'medium',
      date_identified TEXT DEFAULT (date('now')),
      date_resolved TEXT,
      resolution_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS morning_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      drift_alerts_count INTEGER DEFAULT 0,
      open_loops_count INTEGER DEFAULT 0,
      streak_data TEXT,
      top_priorities TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pattern_detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      pattern_id TEXT NOT NULL,
      pattern_name TEXT NOT NULL,
      trigger_desc TEXT,
      evidence TEXT,
      intervention_applied TEXT,
      outcome TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS body_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      weight REAL,
      body_fat_pct REAL,
      waist_inches REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS financial_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      net_worth_estimate REAL,
      checking_balance REAL,
      savings_balance REAL,
      investment_value REAL,
      business_revenue REAL,
      owner_take_home REAL,
      total_debt REAL,
      savings_rate_pct REAL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_daily_scores_date ON daily_scores(date);
    CREATE INDEX IF NOT EXISTS idx_habits_date ON habits(date);
    CREATE INDEX IF NOT EXISTS idx_mastery_domain ON mastery_scores(domain, date);
    CREATE INDEX IF NOT EXISTS idx_drift_resolved ON drift_alerts(resolved, date);
    CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status);
    CREATE INDEX IF NOT EXISTS idx_open_loops_status ON open_loops(status, priority);
    CREATE INDEX IF NOT EXISTS idx_body_date ON body_tracking(date);
  `);
}

// Helper to compute overall daily score
export function computeOverallScore(row: {
  energy_level?: number | null;
  focus_quality?: number | null;
  discipline_score?: number | null;
  workout_done?: number | null;
  journal_done?: number | null;
  sleep_hours?: number | null;
}): number {
  const energy = row.energy_level ?? 5;
  const focus = row.focus_quality ?? 5;
  const discipline = row.discipline_score ?? 5;
  const workout = row.workout_done ? 10 : 0;
  const journal = row.journal_done ? 10 : 0;
  const sleepMapped = Math.min(10, Math.max(0, ((row.sleep_hours ?? 6) - 4) * (10 / 4)));

  return Math.round(
    (discipline * 0.25 + focus * 0.20 + energy * 0.15 + workout * 0.15 + journal * 0.10 + sleepMapped * 0.15) * 10
  ) / 10;
}

// Re-export from canonical datetime module for backwards compatibility
export { today, daysAgo } from "@/lib/utils/datetime";
