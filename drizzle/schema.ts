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
  /** Structured vehicle fields */
  vehicleYear: varchar("vehicleYear", { length: 10 }),
  vehicleMake: varchar("vehicleMake", { length: 50 }),
  vehicleModel: varchar("vehicleModel", { length: 50 }),
  preferredDate: varchar("preferredDate", { length: 30 }),
  preferredTime: mysqlEnum("preferredTime", ["morning", "afternoon", "no-preference"]).default("no-preference").notNull(),
  message: text("message"),
  /** JSON array of photo URLs uploaded by customer */
  photoUrls: text("photoUrls"),
  /** Admin-only notes for internal tracking */
  adminNotes: text("adminNotes"),
  /** Admin priority ordering (lower = higher priority) */
  priority: int("priority").default(0).notNull(),
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

/**
 * Coupons & Special Offers
 */
export const coupons = mysqlTable("coupons", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  discountType: mysqlEnum("discountType", ["dollar", "percent", "free"]).default("dollar").notNull(),
  discountValue: int("discountValue").default(0).notNull(),
  code: varchar("code", { length: 50 }),
  /** Which services this applies to (comma-separated or 'all') */
  applicableServices: varchar("applicableServices", { length: 500 }).default("all").notNull(),
  terms: text("terms"),
  /** Max number of redemptions (0 = unlimited) */
  maxRedemptions: int("maxRedemptions").default(0).notNull(),
  currentRedemptions: int("currentRedemptions").default(0).notNull(),
  isActive: int("isActive").default(1).notNull(),
  isFeatured: int("isFeatured").default(0).notNull(),
  startsAt: timestamp("startsAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Coupon = typeof coupons.$inferSelect;
export type InsertCoupon = typeof coupons.$inferInsert;

/**
 * Customer saved vehicles ("My Garage")
 */
export const customerVehicles = mysqlTable("customer_vehicles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  year: varchar("year", { length: 10 }).notNull(),
  make: varchar("make", { length: 50 }).notNull(),
  model: varchar("model", { length: 50 }).notNull(),
  mileage: int("mileage"),
  nickname: varchar("nickname", { length: 100 }),
  vin: varchar("vin", { length: 20 }),
  lastServiceDate: timestamp("lastServiceDate"),
  lastServiceMileage: int("lastServiceMileage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomerVehicle = typeof customerVehicles.$inferSelect;
export type InsertCustomerVehicle = typeof customerVehicles.$inferInsert;

/**
 * Service history records
 */
export const serviceHistory = mysqlTable("service_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  vehicleId: int("vehicleId"),
  bookingId: int("bookingId"),
  serviceType: varchar("serviceType", { length: 100 }).notNull(),
  description: text("description"),
  mileageAtService: int("mileageAtService"),
  cost: int("cost"),
  technicianNotes: text("technicianNotes"),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
  nextServiceDue: timestamp("nextServiceDue"),
  nextServiceMileage: int("nextServiceMileage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ServiceHistoryRecord = typeof serviceHistory.$inferSelect;
export type InsertServiceHistory = typeof serviceHistory.$inferInsert;

/**
 * Referral program tracking
 */
export const referrals = mysqlTable("referrals", {
  id: int("id").autoincrement().primaryKey(),
  referrerName: varchar("referrerName", { length: 255 }).notNull(),
  referrerPhone: varchar("referrerPhone", { length: 30 }).notNull(),
  referrerEmail: varchar("referrerEmail", { length: 320 }),
  refereeName: varchar("refereeName", { length: 255 }).notNull(),
  refereePhone: varchar("refereePhone", { length: 30 }).notNull(),
  refereeEmail: varchar("refereeEmail", { length: 320 }),
  status: mysqlEnum("status", ["pending", "visited", "redeemed", "expired"]).default("pending").notNull(),
  referrerRewardRedeemed: int("referrerRewardRedeemed").default(0).notNull(),
  refereeRewardRedeemed: int("refereeRewardRedeemed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;

/**
 * Ask a Mechanic Q&A
 */
export const mechanicQA = mysqlTable("mechanic_qa", {
  id: int("id").autoincrement().primaryKey(),
  questionerName: varchar("questionerName", { length: 255 }).notNull(),
  questionerEmail: varchar("questionerEmail", { length: 320 }),
  question: text("question").notNull(),
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),
  answer: text("answer"),
  answeredBy: varchar("answeredBy", { length: 255 }),
  isPublished: int("isPublished").default(0).notNull(),
  isFeatured: int("isFeatured").default(0).notNull(),
  category: varchar("category", { length: 100 }),
  upvotes: int("upvotes").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MechanicQA = typeof mechanicQA.$inferSelect;
export type InsertMechanicQA = typeof mechanicQA.$inferInsert;

/**
 * Business analytics snapshots (daily aggregated metrics)
 */
export const analyticsSnapshots = mysqlTable("analytics_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull(),
  totalBookings: int("totalBookings").default(0).notNull(),
  completedBookings: int("completedBookings").default(0).notNull(),
  newLeads: int("newLeads").default(0).notNull(),
  convertedLeads: int("convertedLeads").default(0).notNull(),
  pageViews: int("pageViews").default(0).notNull(),
  uniqueVisitors: int("uniqueVisitors").default(0).notNull(),
  topService: varchar("topService", { length: 100 }),
  /** JSON: { "tires": 5, "brakes": 3, ... } */
  serviceBreakdownJson: text("serviceBreakdownJson"),
  /** JSON: { "Cleveland": 10, "Euclid": 5, ... } */
  geoBreakdownJson: text("geoBreakdownJson"),
  avgReviewRating: int("avgReviewRating"),
  newReviewCount: int("newReviewCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;
export type InsertAnalyticsSnapshot = typeof analyticsSnapshots.$inferInsert;

/**
 * Notification queue for customer communications
 */
export const customerNotifications = mysqlTable("customer_notifications", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId"),
  recipientName: varchar("recipientName", { length: 255 }).notNull(),
  recipientPhone: varchar("recipientPhone", { length: 30 }),
  recipientEmail: varchar("recipientEmail", { length: 320 }),
  notificationType: mysqlEnum("notificationType", ["booking_confirmed", "booking_inprogress", "booking_completed", "follow_up", "review_request", "maintenance_reminder", "special_offer"]).notNull(),
  subject: varchar("subject", { length: 255 }),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CustomerNotification = typeof customerNotifications.$inferSelect;
export type InsertCustomerNotification = typeof customerNotifications.$inferInsert;
