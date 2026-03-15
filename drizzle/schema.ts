import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Appointment booking requests from the website.
 */
export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 320 }),
  service: varchar("service", { length: 100 }).notNull(),
  vehicle: varchar("vehicle", { length: 255 }),
  preferredDate: varchar("preferredDate", { length: 30 }),
  preferredTime: mysqlEnum("preferredTime", ["morning", "afternoon", "no-preference"]).default("no-preference").notNull(),
  message: text("message"),
  status: mysqlEnum("status", ["new", "confirmed", "completed", "cancelled"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/**
 * Lead capture — every popup submission, chat interaction, and form fill.
 * Syncs to Google Sheets for CRM tracking.
 */
export const leads = mysqlTable("leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 320 }),
  vehicle: varchar("vehicle", { length: 255 }),
  problem: text("problem"),
  /** Where the lead came from */
  source: mysqlEnum("source", ["popup", "chat", "booking", "manual"]).default("popup").notNull(),
  /** AI-assigned urgency score: 1 (low) to 5 (critical) */
  urgencyScore: int("urgencyScore").default(3).notNull(),
  /** AI-generated reason for the urgency score */
  urgencyReason: text("urgencyReason"),
  /** Recommended service based on AI analysis */
  recommendedService: varchar("recommendedService", { length: 100 }),
  /** Contact tracking */
  contacted: int("contacted").default(0).notNull(),
  contactedAt: timestamp("contactedAt"),
  contactedBy: varchar("contactedBy", { length: 255 }),
  contactNotes: text("contactNotes"),
  /** Whether this lead was synced to Google Sheets */
  sheetSynced: int("sheetSynced").default(0).notNull(),
  sheetRow: int("sheetRow"),
  status: mysqlEnum("status", ["new", "contacted", "booked", "closed", "lost"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * AI chat conversations for the vehicle diagnosis assistant.
 */
export const chatSessions = mysqlTable("chat_sessions", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to lead if contact info was captured */
  leadId: int("leadId"),
  /** JSON array of messages: [{ role, content, timestamp }] */
  messagesJson: text("messagesJson").notNull(),
  /** AI-extracted vehicle info */
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),
  /** AI-extracted problem summary */
  problemSummary: text("problemSummary"),
  /** Whether the chat converted to a lead */
  converted: int("converted").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * AI-generated blog articles stored in the database.
 * These supplement the hardcoded articles in shared/blog.ts.
 */
export const dynamicArticles = mysqlTable("dynamic_articles", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 500 }).notNull(),
  metaTitle: varchar("metaTitle", { length: 255 }).notNull(),
  metaDescription: varchar("metaDescription", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  readTime: varchar("readTime", { length: 20 }).notNull(),
  heroImage: varchar("heroImage", { length: 1000 }).notNull(),
  excerpt: text("excerpt").notNull(),
  /** JSON-encoded sections array: [{ heading: string, content: string }] */
  sectionsJson: text("sectionsJson").notNull(),
  /** JSON-encoded string array of related service routes */
  relatedServicesJson: text("relatedServicesJson").notNull(),
  /** JSON-encoded string array of tags */
  tagsJson: text("tagsJson").notNull(),
  status: mysqlEnum("status", ["draft", "published", "rejected"]).default("draft").notNull(),
  generatedBy: mysqlEnum("generatedBy", ["ai", "manual"]).default("ai").notNull(),
  publishDate: varchar("publishDate", { length: 30 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DynamicArticle = typeof dynamicArticles.$inferSelect;
export type InsertDynamicArticle = typeof dynamicArticles.$inferInsert;

/**
 * Dynamic notification bar messages.
 * Rotates through active messages; weather alerts still override.
 */
export const notificationMessages = mysqlTable("notification_messages", {
  id: int("id").autoincrement().primaryKey(),
  message: text("message").notNull(),
  ctaText: varchar("ctaText", { length: 100 }),
  ctaHref: varchar("ctaHref", { length: 500 }),
  icon: varchar("icon", { length: 50 }).default("wrench"),
  /** Seasonal targeting: spring, summer, fall, winter, or all */
  season: mysqlEnum("season", ["spring", "summer", "fall", "winter", "all"]).default("all").notNull(),
  isActive: int("isActive").default(1).notNull(),
  priority: int("priority").default(0).notNull(),
  generatedBy: mysqlEnum("generatedBy", ["ai", "manual"]).default("ai").notNull(),
  startsAt: timestamp("startsAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NotificationMessage = typeof notificationMessages.$inferSelect;
export type InsertNotificationMessage = typeof notificationMessages.$inferInsert;

/**
 * Content generation log — tracks what was generated and when.
 */
export const contentGenerationLog = mysqlTable("content_generation_log", {
  id: int("id").autoincrement().primaryKey(),
  contentType: mysqlEnum("contentType", ["article", "notification", "tip"]).notNull(),
  contentId: int("contentId"),
  prompt: text("prompt"),
  status: mysqlEnum("status", ["success", "failed"]).default("success").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContentGenerationLog = typeof contentGenerationLog.$inferSelect;
