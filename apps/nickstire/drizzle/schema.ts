import { int, tinyint, bigint, mysqlEnum, mysqlTable, text, mediumtext, timestamp, varchar, boolean, json, index, uniqueIndex, primaryKey, decimal, date, datetime, float, smallint } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

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
  /** Loyalty points balance */
  loyaltyPoints: int("loyaltyPoints").default(0).notNull(),
  loyaltyTier: mysqlEnum("loyaltyTier", ["bronze", "silver", "gold", "platinum"]).default("bronze").notNull(),
  totalVisits: int("totalVisits").default(0).notNull(),
  totalSpent: int("totalSpent").default(0).notNull(),
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
  /** Urgency level from booking form */
  urgency: mysqlEnum("urgency", ["emergency", "this-week", "whenever"]).default("whenever").notNull(),
  /** Job stage for status tracker */
  stage: mysqlEnum("stage", ["received", "inspecting", "waiting-parts", "in-progress", "quality-check", "ready"]).default("received").notNull(),
  stageUpdatedAt: timestamp("stageUpdatedAt").defaultNow().notNull(),
  /** Reference code for customer status lookup */
  referenceCode: varchar("referenceCode", { length: 20 }),
  status: mysqlEnum("status", ["new", "confirmed", "completed", "cancelled"]).default("new").notNull(),
  /** Follow-up tracking */
  followUp24hSent: int("followUp24hSent").default(0).notNull(),
  followUp7dSent: int("followUp7dSent").default(0).notNull(),
  /** UTM source attribution */
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  utmTerm: varchar("utmTerm", { length: 255 }),
  // journey-join migration 0068 (2026-06) - localStorage visitor id; exact-key joins only
  sessionId: varchar("sessionId", { length: 64 }),
  utmContent: varchar("utmContent", { length: 255 }),
  /** Landing page URL that brought the visitor */
  landingPage: varchar("landingPage", { length: 500 }),
  /** Referrer URL */
  referrer: varchar("referrer", { length: 500 }),
  /** Google Ads click ID for offline conversion tracking */
  gclid: varchar("gclid", { length: 255 }),
  /** Confirmation tracking — Booking→Confirm pipeline stage */
  confirmedAt: timestamp("confirmedAt"),
  confirmationMethod: varchar("confirmationMethod", { length: 20 }),
  confirmationSentAt: timestamp("confirmationSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_booking_phone").on(table.phone),
  index("idx_booking_status").on(table.status),
  index("idx_booking_created").on(table.createdAt),
  uniqueIndex("idx_booking_ref").on(table.referenceCode),
]);

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
  source: mysqlEnum("source", ["popup", "chat", "booking", "manual", "callback", "fleet", "financing_preapproval", "sms", "careers", "diagnose"]).default("popup").notNull(),
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
  /** Fleet-specific fields */
  companyName: varchar("companyName", { length: 255 }),
  fleetSize: int("fleetSize"),
  vehicleTypes: text("vehicleTypes"),
  status: mysqlEnum("status", ["new", "contacted", "booked", "completed", "closed", "lost"]).default("new").notNull(),
  /** Estimated dollar value of the lead (cents) — set when quote given */
  estimatedValueCents: int("estimatedValueCents"),
  /** When the last follow-up was done (call, text, or admin action) */
  lastFollowUpAt: timestamp("lastFollowUpAt"),
  /** Google Ads click ID for offline conversion tracking */
  gclid: varchar("gclid", { length: 255 }),
  /** UTM source attribution */
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  landingPage: varchar("landingPage", { length: 500 }),
  referrer: varchar("referrer", { length: 500 }),
  // attribution-holds migration 0067 (2026-06) - additive, nullable
  utmContent: varchar("utmContent", { length: 255 }),
  utmTerm: varchar("utmTerm", { length: 255 }),
  // journey-join migration 0068 (2026-06) - localStorage visitor id; exact-key joins only
  sessionId: varchar("sessionId", { length: 64 }),
  // wave-125 — pipeline FKs. callbackId links a callback-source lead
  // back to its callback_requests row (closes the "same person in two
  // sections" gap). bookingId / invoiceId set on conversion so
  // source-to-revenue analytics become a real query.
  callbackId: int("callbackId").references(() => callbackRequests.id, { onDelete: "set null" }),
  bookingId: int("bookingId").references(() => bookings.id, { onDelete: "set null" }),
  invoiceId: int("invoiceId").references(() => invoices.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_lead_phone").on(table.phone),
  index("idx_lead_status").on(table.status),
  index("idx_lead_source").on(table.source),
  index("idx_lead_created").on(table.createdAt),
  // wave-125 — indexes on the new pipeline FKs for fast lookup
  index("idx_lead_callback_id").on(table.callbackId),
  index("idx_lead_booking_id").on(table.bookingId),
  index("idx_lead_invoice_id").on(table.invoiceId),
]);

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

/**
 * AI chat conversations for the vehicle diagnosis assistant.
 */
export const chatSessions = mysqlTable("chat_sessions", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to lead if contact info was captured */
  leadId: int("leadId"),
  /** JSON array of messages: [{ role, content, timestamp }]. MEDIUMTEXT since 0142 (TEXT overflowed). */
  messagesJson: mediumtext("messagesJson").notNull(),
  /** AI-extracted vehicle info */
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),
  /** AI-extracted problem summary */
  problemSummary: text("problemSummary"),
  /** Whether the chat converted to a lead */
  converted: int("converted").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  idx_chat_lead: index("idx_chat_lead").on(table.leadId),
  idx_chat_created: index("idx_chat_created").on(table.createdAt),
}));

export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

/**
 * Cross-session conversation memory — Nick remembers past chat topics.
 * Each entry captures a key fact/preference from a chat session.
 */
export const conversationMemory = mysqlTable("conversation_memory", {
  id: int("id").autoincrement().primaryKey(),
  /** Fingerprint/identifier for returning visitors (phone, IP hash, or sessionId chain) */
  visitorKey: varchar("visitorKey", { length: 255 }).notNull(),
  /** Topic category: vehicle, problem, preference, appointment, feedback */
  category: varchar("category", { length: 50 }).notNull(),
  /** The actual memory content */
  content: text("content").notNull(),
  /** Source chat session ID */
  sessionId: int("sessionId"),
  /** Confidence score 0-1 */
  confidence: float("confidence").default(0.8).notNull(),
  /** How many times this memory has been reinforced */
  reinforcements: int("reinforcements").default(1).notNull(),
  /** How many times this memory was used and led to a conversion */
  conversionHits: int("conversionHits").default(0).notNull(),
  /** Last time this memory was accessed/reinforced */
  lastAccessed: timestamp("lastAccessed").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_memory_visitor").on(table.visitorKey),
  index("idx_memory_category").on(table.category),
]);

export type ConversationMemory = typeof conversationMemory.$inferSelect;
export type InsertConversationMemory = typeof conversationMemory.$inferInsert;

/**
 * AI-generated blog articles stored in the database.
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
 */
export const notificationMessages = mysqlTable("notification_messages", {
  id: int("id").autoincrement().primaryKey(),
  message: text("message").notNull(),
  ctaText: varchar("ctaText", { length: 100 }),
  ctaHref: varchar("ctaHref", { length: 500 }),
  icon: varchar("icon", { length: 50 }).default("wrench"),
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
 * Content generation log.
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
  applicableServices: varchar("applicableServices", { length: 500 }).default("all").notNull(),
  terms: text("terms"),
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
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
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
}, (table) => [
  index("idx_vehicle_user").on(table.userId),
]);

export type CustomerVehicle = typeof customerVehicles.$inferSelect;
export type InsertCustomerVehicle = typeof customerVehicles.$inferInsert;

/**
 * Service history records
 */
export const serviceHistory = mysqlTable("service_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  vehicleId: int("vehicleId").references(() => customerVehicles.id, { onDelete: "set null" }),
  bookingId: int("bookingId").references(() => bookings.id, { onDelete: "set null" }),
  serviceType: varchar("serviceType", { length: 100 }).notNull(),
  description: text("description"),
  mileageAtService: int("mileageAtService"),
  cost: int("cost"),
  technicianNotes: text("technicianNotes"),
  /** Points earned for this service */
  pointsEarned: int("pointsEarned").default(0).notNull(),
  completedAt: timestamp("completedAt").defaultNow().notNull(),
  nextServiceDue: timestamp("nextServiceDue"),
  nextServiceMileage: int("nextServiceMileage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_service_user").on(table.userId),
  index("idx_service_vehicle").on(table.vehicleId),
  index("idx_service_booking").on(table.bookingId),
  index("idx_service_completed").on(table.completedAt),
]);

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
  avgReviewRating: decimal("avgReviewRating", { precision: 3, scale: 1 }),
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
  notificationType: mysqlEnum("notificationType", ["booking_confirmed", "booking_inprogress", "booking_completed", "follow_up", "review_request", "maintenance_reminder", "special_offer", "status_update"]).notNull(),
  subject: varchar("subject", { length: 255 }),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  // wave-121 — followUpsRouter.pending polls WHERE status='pending' every 30s
  index("idx_notification_status").on(table.status),
]);

export type CustomerNotification = typeof customerNotifications.$inferSelect;
export type InsertCustomerNotification = typeof customerNotifications.$inferInsert;

/**
 * Service pricing for the Instant Price Estimator
 */
export const servicePricing = mysqlTable("service_pricing", {
  id: int("id").autoincrement().primaryKey(),
  serviceType: varchar("serviceType", { length: 100 }).notNull(),
  serviceLabel: varchar("serviceLabel", { length: 255 }).notNull(),
  /** Vehicle size category */
  vehicleCategory: mysqlEnum("vehicleCategory", ["compact", "midsize", "full-size", "truck-suv"]).notNull(),
  lowEstimate: int("lowEstimate").notNull(),
  highEstimate: int("highEstimate").notNull(),
  /** Typical time in hours */
  typicalHours: varchar("typicalHours", { length: 20 }),
  notes: text("notes"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ServicePricing = typeof servicePricing.$inferSelect;
export type InsertServicePricing = typeof servicePricing.$inferInsert;

/**
 * Digital Vehicle Inspection Reports
 */
export const vehicleInspections = mysqlTable("vehicle_inspections", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId"),
  /** Customer info for sharing */
  customerName: varchar("customerName", { length: 255 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 30 }),
  customerEmail: varchar("customerEmail", { length: 320 }),
  vehicleInfo: varchar("vehicleInfo", { length: 255 }).notNull(),
  vehicleYear: varchar("vehicleYear", { length: 10 }),
  vehicleMake: varchar("vehicleMake", { length: 50 }),
  vehicleModel: varchar("vehicleModel", { length: 50 }),
  mileage: int("mileage"),
  technicianName: varchar("technicianName", { length: 255 }).notNull(),
  /** Overall vehicle condition */
  overallCondition: mysqlEnum("overallCondition", ["good", "fair", "needs-attention"]).default("fair").notNull(),
  summaryNotes: text("summaryNotes"),
  /** Public share token for customer access */
  shareToken: varchar("shareToken", { length: 64 }).notNull().unique(),
  isPublished: int("isPublished").default(0).notNull(),
  /** DVI view tracking (migration 0101) — did the customer open the packet */
  firstViewedAt: timestamp("firstViewedAt"),
  viewCount: int("viewCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VehicleInspection = typeof vehicleInspections.$inferSelect;
export type InsertVehicleInspection = typeof vehicleInspections.$inferInsert;

/**
 * Individual line items within a vehicle inspection
 */
export const inspectionItems = mysqlTable("inspection_items", {
  id: int("id").autoincrement().primaryKey(),
  inspectionId: int("inspectionId").notNull().references(() => vehicleInspections.id, { onDelete: "cascade" }),
  /** Component being inspected */
  component: varchar("component", { length: 255 }).notNull(),
  /** Category grouping */
  category: mysqlEnum("category", ["brakes", "tires", "engine", "suspension", "electrical", "fluids", "body", "other"]).notNull(),
  /** Condition rating */
  condition: mysqlEnum("condition", ["green", "yellow", "red"]).notNull(),
  notes: text("notes"),
  /** Photo evidence URL */
  photoUrl: varchar("photoUrl", { length: 1000 }),
  /** Recommended action */
  recommendedAction: text("recommendedAction"),
  /** Estimated repair cost, in WHOLE DOLLARS (not cents): the admin types
   *  "Est. $" and the customer page renders it unscaled. */
  estimatedCost: int("estimatedCost"),
  /** DVI customer decision (migration 0101): "approved" | "declined" |
   *  "question". NULL = no decision yet. The customer's words in
   *  customerNote — never invented, never summarized into the field. */
  decision: varchar("decision", { length: 16 }),
  decisionAt: timestamp("decisionAt"),
  customerNote: varchar("customerNote", { length: 500 }),
  /** Sort order within inspection */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_inspection_item_inspection").on(table.inspectionId),
]);

export type InspectionItem = typeof inspectionItems.$inferSelect;
export type InsertInspectionItem = typeof inspectionItems.$inferInsert;

/**
 * Loyalty rewards definitions
 */
export const loyaltyRewards = mysqlTable("loyalty_rewards", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  /** Points required to redeem */
  pointsCost: int("pointsCost").notNull(),
  /** Discount value in dollars */
  rewardValue: int("rewardValue").notNull(),
  rewardType: mysqlEnum("rewardType", ["dollar-off", "percent-off", "free-service"]).default("dollar-off").notNull(),
  /** Which service this applies to (or 'all') */
  applicableService: varchar("applicableService", { length: 100 }).default("all").notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LoyaltyReward = typeof loyaltyRewards.$inferSelect;
export type InsertLoyaltyReward = typeof loyaltyRewards.$inferInsert;

/**
 * Nonstop Nick memberships — the $7.99/mo tire membership (chunk 2/5).
 *
 * One row per paid membership. Designed around 3 access patterns:
 *   1. Counter lookup: "is this phone an active member?" → idx on (phone, status)
 *   2. Stripe webhook upsert: find by stripeSubscriptionId → unique idx
 *   3. Vehicle binding at FIRST USE (not signup — keeps signup one-tap):
 *      vehiclePlate is nullable, set the first time the member pulls up.
 *
 * status is driven by Stripe webhook events (subscription.created/updated/
 * deleted) — `active`/`past_due`/`canceled` mirror Stripe's subscription
 * status so the counter never has to call Stripe live. Migration: drizzle/0063.
 */
export const memberships = mysqlTable("memberships", {
  id: int("id").autoincrement().primaryKey(),
  /** Plan key — single plan today ("nonstop-nick"); column future-proofs tiers. */
  plan: varchar("plan", { length: 64 }).default("nonstop-nick").notNull(),
  /** Member contact — the counter's primary lookup key. */
  phone: varchar("phone", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  /** Bound at first use, not signup (one vehicle per membership). */
  vehiclePlate: varchar("vehiclePlate", { length: 16 }),
  vehicleDesc: varchar("vehicleDesc", { length: 255 }),
  /** Mirrors Stripe subscription status — set by webhook, read by counter. */
  status: mysqlEnum("status", ["active", "past_due", "canceled", "incomplete"]).default("incomplete").notNull(),
  /** Stripe linkage — webhook finds the row by subscriptionId. */
  stripeCustomerId: varchar("stripeCustomerId", { length: 64 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 64 }),
  /** End of the current paid period (from Stripe) — grace window for past_due. */
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  canceledAt: timestamp("canceledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_membership_phone").on(table.phone),
  index("idx_membership_status").on(table.status),
  uniqueIndex("uq_membership_stripe_sub").on(table.stripeSubscriptionId),
]);

export type Membership = typeof memberships.$inferSelect;
export type InsertMembership = typeof memberships.$inferInsert;

/**
 * Loyalty point transactions (earn/redeem history)
 */
export const loyaltyTransactions = mysqlTable("loyalty_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "restrict" }),
  type: mysqlEnum("type", ["earn", "redeem", "bonus", "adjustment"]).notNull(),
  points: int("points").notNull(),
  /** Positive for earn, negative for redeem */
  balanceAfter: int("balanceAfter").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  /** Link to service history if earned from service */
  serviceHistoryId: int("serviceHistoryId"),
  /** Link to reward if redeemed */
  rewardId: int("rewardId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_loyalty_tx_user").on(table.userId),
  index("idx_loyalty_tx_type").on(table.type),
]);

export type LoyaltyTransaction = typeof loyaltyTransactions.$inferSelect;
export type InsertLoyaltyTransaction = typeof loyaltyTransactions.$inferInsert;

/**
 * Callback requests — lightweight "call me back" form
 */
export const callbackRequests = mysqlTable("callback_requests", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  /** Optional context about what they need */
  context: text("context"),
  /** Page they were on when requesting */
  sourcePage: varchar("sourcePage", { length: 255 }),
  status: mysqlEnum("status", ["new", "called", "no-answer", "completed"]).default("new").notNull(),
  calledAt: timestamp("calledAt"),
  calledBy: varchar("calledBy", { length: 255 }),
  notes: text("notes"),
  /** UTM source attribution */
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  landingPage: varchar("landingPage", { length: 500 }),
  referrer: varchar("referrer", { length: 500 }),
  // attribution-holds migration 0067 (2026-06) - additive, nullable
  utmContent: varchar("utmContent", { length: 255 }),
  utmTerm: varchar("utmTerm", { length: 255 }),
  // journey-join migration 0068 (2026-06) - localStorage visitor id; exact-key joins only
  sessionId: varchar("sessionId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  // wave-121 — admin.ts todaysBrief + sectionInsight + getCallbackRequests
  // all filter WHERE status IN ('new','pending') on 30s polling cadence
  index("idx_callback_status").on(table.status),
]);

export type CallbackRequest = typeof callbackRequests.$inferSelect;
export type InsertCallbackRequest = typeof callbackRequests.$inferInsert;

// ─── REVIEW REQUESTS ─────────────────────────────────
/**
 * Tracks automated Google review request SMS messages sent to customers
 * after service completion. Includes click tracking and duplicate prevention.
 */
export const reviewRequests = mysqlTable("review_requests", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to the completed booking — NULL for a row sourced from an ALG invoice (0139). */
  bookingId: int("bookingId").references(() => bookings.id, { onDelete: "cascade" }),
  /**
   * The paid ALG/ShopDriver invoice this ask was created from (0139) — NULL for a
   * booking-sourced row. UNIQUE: one review ask per invoice. Written by
   * services/invoiceReviewRequests.ts. Declared 2026-10-02 only after 0139 was applied AND
   * recorded in production (reconcile-migrations --strict exit 0), because projection-less
   * select().from(reviewRequests) reads name every declared column.
   */
  invoiceId: int("invoiceId"),
  /** Customer name from booking */
  customerName: varchar("customerName", { length: 255 }).notNull(),
  /** Customer phone (normalized) */
  phone: varchar("phone", { length: 30 }).notNull(),
  /** Service performed (for personalization) */
  service: varchar("service", { length: 100 }),
  /** Current status of the review request */
  status: mysqlEnum("status", ["pending", "sent", "clicked", "failed", "skipped", "heldout"]).default("pending").notNull(),
  /** When the SMS should be sent (booking completion + delay) */
  scheduledAt: timestamp("scheduledAt").notNull(),
  /** When the SMS was actually sent */
  sentAt: timestamp("sentAt"),
  /** When the customer clicked the review link */
  clickedAt: timestamp("clickedAt"),
  /** Unique tracking token for click tracking */
  trackingToken: varchar("trackingToken", { length: 64 }).notNull(),
  /** Error message if sending failed */
  errorMessage: text("errorMessage"),
  /** Twilio message SID for reference */
  twilioSid: varchar("twilioSid", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_review_booking").on(table.bookingId),
  index("idx_review_phone").on(table.phone),
  index("idx_review_status").on(table.status),
  index("idx_review_scheduled").on(table.scheduledAt),
  uniqueIndex("uq_review_requests_invoice").on(table.invoiceId),
]);

export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type InsertReviewRequest = typeof reviewRequests.$inferInsert;

// ─── REVIEW SETTINGS ─────────────────────────────────
/**
 * Global settings for the automated review request system.
 * Single-row table (id=1) for configuration.
 */
export const reviewSettings = mysqlTable("review_settings", {
  id: int("id").autoincrement().primaryKey(),
  /** Whether the system is enabled */
  enabled: int("enabled").default(1).notNull(),
  /** Delay in minutes after completion before sending (default 120 = 2 hours) */
  delayMinutes: int("delayMinutes").default(120).notNull(),
  /** Maximum review requests to send per day */
  maxPerDay: int("maxPerDay").default(20).notNull(),
  /** Minimum days between requests to the same phone number */
  cooldownDays: int("cooldownDays").default(30).notNull(),
  /** Custom message template (uses {firstName}, {service}, {reviewUrl} placeholders) */
  messageTemplate: text("messageTemplate"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReviewSettings = typeof reviewSettings.$inferSelect;
export type InsertReviewSettings = typeof reviewSettings.$inferInsert;

// ─── SERVICE REMINDERS ──────────────────────────────────
/**
 * Automated maintenance reminders based on service history and mileage intervals.
 * Tracks when customers are due for their next service and SMS delivery status.
 */
export const serviceReminders = mysqlTable("service_reminders", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to customer vehicle (optional — may be anonymous booking) */
  vehicleId: int("vehicleId"),
  /** Link to the booking that triggered this reminder */
  bookingId: int("bookingId"),
  /** Customer name */
  customerName: varchar("customerName", { length: 255 }).notNull(),
  /** Customer phone (normalized) */
  phone: varchar("phone", { length: 30 }).notNull(),
  /** Vehicle description (e.g. "2019 Toyota Camry") */
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),
  /** Service type this reminder is for */
  serviceType: varchar("serviceType", { length: 100 }).notNull(),
  /** When the last service was performed */
  lastServiceDate: timestamp("lastServiceDate").notNull(),
  /** Mileage at last service (if known) */
  lastServiceMileage: int("lastServiceMileage"),
  /** Calculated next due date */
  nextDueDate: timestamp("nextDueDate").notNull(),
  /** Calculated next due mileage (if applicable) */
  nextDueMileage: int("nextDueMileage"),
  /** Current status */
  status: mysqlEnum("status", ["scheduled", "sent", "snoozed", "completed", "cancelled"]).default("scheduled").notNull(),
  /** When the reminder SMS was sent */
  sentAt: timestamp("sentAt"),
  /** Twilio message SID */
  twilioSid: varchar("twilioSid", { length: 64 }),
  /** Error message if sending failed */
  errorMessage: text("errorMessage"),
  /** Snooze until this date (if snoozed) */
  snoozedUntil: timestamp("snoozedUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ServiceReminder = typeof serviceReminders.$inferSelect;
export type InsertServiceReminder = typeof serviceReminders.$inferInsert;

// ─── REMINDER SETTINGS ──────────────────────────────────
/**
 * Per-service-type reminder interval configuration.
 * Defines how often each service should be recommended.
 */
export const reminderSettings = mysqlTable("reminder_settings", {
  id: int("id").autoincrement().primaryKey(),
  /** Service type key (e.g. "oil-change", "brakes", "tires") */
  serviceType: varchar("serviceType", { length: 100 }).notNull().unique(),
  /** Human-readable label */
  serviceLabel: varchar("serviceLabel", { length: 255 }).notNull(),
  /** Interval in months between services */
  intervalMonths: int("intervalMonths").notNull(),
  /** Interval in miles between services (0 = time-based only) */
  intervalMiles: int("intervalMiles").default(0).notNull(),
  /** Whether reminders are enabled for this service type */
  enabled: int("enabled").default(1).notNull(),
  /** Custom SMS message template (optional — falls back to default) */
  messageTemplate: text("messageTemplate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReminderSetting = typeof reminderSettings.$inferSelect;
export type InsertReminderSetting = typeof reminderSettings.$inferInsert;

// ─── SMS CONVERSATIONS ──────────────────────────────────
/**
 * Two-way SMS conversation threads with customers.
 * Groups messages by phone number for inbox-style management.
 */
export const smsConversations = mysqlTable("sms_conversations", {
  id: int("id").autoincrement().primaryKey(),
  /** Customer phone (normalized, unique per conversation) */
  phone: varchar("phone", { length: 30 }).notNull().unique(),
  /** Customer name (from booking or manual entry) */
  customerName: varchar("customerName", { length: 255 }),
  /** Link to booking if known */
  bookingId: int("bookingId"),
  /** Conversation status */
  status: mysqlEnum("status", ["active", "closed", "archived"]).default("active").notNull(),
  /** Number of unread inbound messages */
  unreadCount: int("unreadCount").default(0).notNull(),
  /** Last message timestamp for sorting */
  lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
  /** Last message preview text */
  lastMessagePreview: varchar("lastMessagePreview", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SmsConversation = typeof smsConversations.$inferSelect;
export type InsertSmsConversation = typeof smsConversations.$inferInsert;

// ─── SMS MESSAGES ────────────────────────────────────────
/**
 * Individual messages within an SMS conversation.
 */
export const smsMessages = mysqlTable("sms_messages", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to conversation. DB-level FK fk_sms_msg_conv (BE-DATA-1, 2026-07-07). */
  conversationId: int("conversationId")
    .notNull()
    .references(() => smsConversations.id, { onDelete: "cascade" }),
  /** Message direction */
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),
  /** Message body */
  body: text("body").notNull(),
  /** Twilio message SID */
  twilioSid: varchar("twilioSid", { length: 64 }),
  /** Delivery status — "sending" is the in-flight state used by the
   *  rehydrate path in server/sms.ts to atomically claim a queued row
   *  without falsely flagging it as "sent" before the gateway responds.
   *  Order matches drizzle/0041_wave181_sms_sending_status.sql — "sending"
   *  is APPENDED at the end so the MySQL ALTER is metadata-only (storage
   *  index remap would be required if inserted in the middle). */
  status: mysqlEnum("status", ["queued", "sent", "delivered", "failed", "received", "sending"]).default("queued").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** 0104 (2026-07-29, hand-apply) · definitive-failure attempt count for the
   *  durable retry loop; drain dead-letters at 5. NULL until 0104 applied —
   *  all code paths degrade to pre-0104 (time-bounded-only) behavior. */
  sendAttempts: int("send_attempts"),
  /** 0104 · why a row went terminal ('max_retries_exceeded',
   *  'stale_sending_expired', gateway error slice). */
  failureReason: varchar("failure_reason", { length: 255 }),
  /** 0105 (2026-07-29, hand-apply) · when the gateway ACCEPTED the send.
   *  Completes the creation→dispatch latency the ops surface refused to
   *  fabricate from createdAt alone. NULL until 0105 applied; stamped
   *  best-effort (a failed stamp never fails a send). */
  sentAt: timestamp("sent_at"),
  // ─── wave-181.51 · SMS INSTRUMENTATION ──────────────
  // Persisted per-send metrics so attribution doesn't require keyword-
  // sniffing the body. Reply tracking written by the SMS gateway
  // webhook; conversion attribution written by an eventBus subscriber
  // on booking_created / lead_captured.
  /** Inbound replies received within 7d of this send (outbound rows only) */
  replyCount: int("replyCount").default(0).notNull(),
  /** First inbound reply timestamp (NULL until a reply lands) */
  firstReplyAt: timestamp("firstReplyAt"),
  /** Customer texted STOP after this send (subset of replyCount) */
  optOutAt: timestamp("optOutAt"),
  /** Bookings/leads created within 14d of this send (outbound rows only) */
  convertedCount: int("convertedCount").default(0).notNull(),
  /** The booking we credit this send for (first inside window) */
  attributedBookingId: int("attributedBookingId"),
  /** Timestamp the attribution was recorded */
  attributedAt: timestamp("attributedAt"),
  /** A/B variant bucket (e.g. "v1" / "v2"); NULL = pre-variant rollout */
  variantKey: varchar("variantKey", { length: 50 }),
}, (table) => ({
  idx_sms_msg_conv: index("idx_sms_msg_conv").on(table.conversationId),
  idx_sms_msg_created: index("idx_sms_msg_created").on(table.createdAt),
  idx_sms_msg_status_created: index("idx_sms_msg_status_created").on(table.status, table.createdAt),
  // wave-181.51 — narrows "most recent outbound to phone X" lookups
  sms_attribution_idx: index("sms_attribution_idx").on(table.direction, table.createdAt),
  // wave-181.51 — supports A/B aggregator queries in the admin tile
  sms_variant_idx: index("sms_variant_idx").on(table.variantKey, table.createdAt),
  // audit #9 — speeds smsMessageExists() inbound-webhook dedup + the
  // smsGateway delivery-receipt UPDATEs (both filter on twilioSid).
  // Applied by drizzle/0050_wave181_sms_messages_twilio_sid_index.sql.
  idx_sms_msg_twilio_sid: index("idx_sms_msg_twilio_sid").on(table.twilioSid),
}));

export type SmsMessage = typeof smsMessages.$inferSelect;
export type InsertSmsMessage = typeof smsMessages.$inferInsert;

// ─── REPAIR GALLERY ──────────────────────────────────────
/**
 * Before/after repair photos for the public gallery page.
 */
export const repairGallery = mysqlTable("repair_gallery", {
  id: int("id").autoincrement().primaryKey(),
  /** Repair title (e.g. "Brake Rotor Replacement") */
  title: varchar("title", { length: 255 }).notNull(),
  /** Description of the repair work */
  description: text("description"),
  /** Before photo URL (CDN) */
  beforeImageUrl: varchar("beforeImageUrl", { length: 1000 }).notNull(),
  /** After photo URL (CDN) */
  afterImageUrl: varchar("afterImageUrl", { length: 1000 }).notNull(),
  /** Service category */
  serviceType: varchar("serviceType", { length: 100 }).notNull(),
  /** Vehicle info (e.g. "2018 Honda Civic") */
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),
  /** Whether visible on public gallery */
  isPublished: int("isPublished").default(1).notNull(),
  /** Sort order (lower = first) */
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RepairGalleryItem = typeof repairGallery.$inferSelect;
export type InsertRepairGalleryItem = typeof repairGallery.$inferInsert;

// ─── TECHNICIANS ─────────────────────────────────────────
/**
 * Technician profiles for the team page and spotlight section.
 */
export const technicians = mysqlTable("technicians", {
  id: int("id").autoincrement().primaryKey(),
  /** Full name */
  name: varchar("name", { length: 255 }).notNull(),
  /** Job title (e.g. "Lead Technician", "Tire Specialist") */
  title: varchar("title", { length: 255 }).notNull(),
  /** Short bio */
  bio: text("bio"),
  /** Comma-separated specialties */
  specialties: text("specialties"),
  /** Years of experience */
  yearsExperience: int("yearsExperience").default(0).notNull(),
  /** Comma-separated certifications (e.g. "ASE Master, Ohio E-Check") */
  certifications: text("certifications"),
  /** Profile photo URL (CDN) */
  photoUrl: varchar("photoUrl", { length: 1000 }),
  /** Whether visible on public team page */
  isActive: int("isActive").default(1).notNull(),
  /** Sort order (lower = first) */
  sortOrder: int("sortOrder").default(0).notNull(),
  // ── Dispatch fields ──
  /** Tech level: junior | mid | senior | lead | master */
  role: varchar("role", { length: 20 }).default("mid"),
  /** Skill tags JSON array: ["brakes","alignment","diagnostics","tires","engine","electrical","suspension","oil_change"] */
  skills: json("skills"),
  /** ASE certifications JSON array */
  aseCerts: json("ase_certs"),
  /** Currently clocked in */
  clockedIn: boolean("clocked_in").default(false),
  clockedInAt: timestamp("clocked_in_at"),
  /** Contact */
  phone: varchar("phone", { length: 30 }),
  /** Performance metrics (updated nightly or on event) */
  avgJobDurationRatio: decimal("avg_job_duration_ratio", { precision: 5, scale: 2 }).default("1.00"),
  qcPassRate: decimal("qc_pass_rate", { precision: 5, scale: 2 }).default("1.00"),
  comebackRate: decimal("comeback_rate", { precision: 5, scale: 2 }).default("0.00"),
  totalJobsCompleted: int("total_jobs_completed").default(0),
  notes: text("tech_notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Technician = typeof technicians.$inferSelect;
export type InsertTechnician = typeof technicians.$inferInsert;

// ─── TIME CLOCK ENTRIES (AG-43 · 2026-07-09 · migration 0077) ────────
/**
 * Durable time-clock ledger · one row per shift. The technicians
 * clocked_in/clocked_in_at pair stays as the live "on the floor now"
 * cache; every clock-out used to ERASE the shift, so weekly hours /
 * payroll history was unrecoverable. ON DELETE RESTRICT — a tech with
 * recorded shifts is payroll history; deactivate, never delete.
 */
export const timeClockEntries = mysqlTable("time_clock_entries", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  technicianId: int("technician_id").notNull().references(() => technicians.id, { onDelete: "restrict" }),
  clockInAt: timestamp("clock_in_at").notNull(),
  clockOutAt: timestamp("clock_out_at"),
  /** Where the punch came from: admin_ui | dispatch | api */
  source: varchar("source", { length: 32 }).default("admin_ui").notNull(),
}, (t) => [
  index("idx_tce_tech_clockin").on(t.technicianId, t.clockInAt),
]);

export type TimeClockEntry = typeof timeClockEntries.$inferSelect;
export type InsertTimeClockEntry = typeof timeClockEntries.$inferInsert;

// ─── IMPORTED CUSTOMERS (from ALS shop management system) ───────────
/**
 * Customer records imported from the shop's management software.
 * Contains contact info, visit history, and segment classification.
 */
export const customers = mysqlTable("customers", {
  id: int("id").autoincrement().primaryKey(),
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }),
  phone: varchar("phone", { length: 30 }).notNull(),
  phone2: varchar("phone2", { length: 30 }),
  /** BE-DATA-2 (2026-07-07) · DB-level dedup. VIRTUAL generated last-10 digits
   *  of `phone`; the `uniq_customer_phone10` index below rejects a duplicate
   *  customer regardless of stored phone format (E.164 / 10-digit / dashes).
   *  Applied to prod first (0 existing dups). VIRTUAL — TiDB can't ADD a STORED
   *  generated column via ALTER. Insert paths already catch ER_DUP_ENTRY. */
  phone10: varchar("phone10", { length: 10 }).generatedAlwaysAs(
    sql`RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10)`,
    { mode: "virtual" },
  ),
  email: varchar("email", { length: 320 }),
  address: varchar("address", { length: 500 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 10 }),
  zip: varchar("zip", { length: 20 }),
  /** Individual or Commercial */
  customerType: mysqlEnum("customerType", ["individual", "commercial"]).default("individual").notNull(),
  totalVisits: int("totalVisits").default(0).notNull(),
  /** Total spent in cents (enriched from invoices) */
  totalSpent: int("totalSpent").default(0).notNull(),
  lastVisitDate: timestamp("lastVisitDate"),
  /** First service date (earliest invoice/WO) */
  firstVisitDate: timestamp("firstVisitDate"),
  balanceDue: int("balanceDue").default(0).notNull(),
  /** Primary vehicle info (enriched from work orders) */
  vehicleYear: varchar("vehicleYear", { length: 10 }),
  vehicleMake: varchar("vehicleMake", { length: 50 }),
  vehicleModel: varchar("vehicleModel", { length: 50 }),
  /** External ID from ALS shop management system */
  alsCustomerId: varchar("alsCustomerId", { length: 50 }),
  /** Customer segment for marketing */
  segment: mysqlEnum("segment", ["recent", "lapsed", "new", "unknown"]).default("unknown").notNull(),
  /** Whether this customer was sent the March 2026 SMS campaign */
  /** wave-181.111 · psychographic profile (10 segments) cached on the
   *  customer row · written by daily psychoProfileRefresh cron · powers
   *  profile-aware SMS routing + admin chip + analytics. Distinct from
   *  `segment` above (which is the recency bucket used by retention
   *  cron). Migration 0056. */
  psychoProfile: varchar("psycho_profile", { length: 32 }),
  psychoProfileScore: int("psycho_profile_score"),
  psychoProfileAt: timestamp("psycho_profile_at"),
  smsCampaignSent: int("smsCampaignSent").default(0).notNull(),
  smsCampaignDate: timestamp("smsCampaignDate"),
  /** Admin notes for internal tracking */
  notes: text("notes"),
  /** Whether customer has opted out of marketing SMS (transactional SMS still allowed) */
  smsOptOut: tinyint("smsOptOut").default(0).notNull(),
  /** Last retention SMS tier sent (45, 90, 180, 365) — prevents double-sending same tier */
  lastRetentionTier: int("lastRetentionTier"),
  /** When the last retention SMS was sent */
  lastRetentionDate: timestamp("lastRetentionDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  // wave-116 — phone is now UNIQUE (was a plain index). Migration
  // 0034_wave116_customer_phone_unique.sql adds the constraint after
  // operator-side dedupe. Application code (shopdriver import,
  // shopDriverMirror, customerLookup) treats Duplicate-entry errors
  // as "race lost; fall through to UPDATE".
  uniqueIndex("uniq_customer_phone").on(table.phone),
  // BE-DATA-2 · stricter dedup than uniq_customer_phone (which is on the raw
  // string): catches the same person stored in different formats. Live in prod.
  uniqueIndex("uniq_customer_phone10").on(table.phone10),
  index("idx_customer_segment").on(table.segment),
  index("idx_customer_last_visit").on(table.lastVisitDate),
  index("idx_customer_als_id").on(table.alsCustomerId),
  // wave-181.111 · psychographic profile filter (migration 0056)
  index("idx_customer_psycho").on(table.psychoProfile),
]);

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

/**
 * Win-back campaigns — automated SMS sequences to re-engage lapsed customers.
 */
export const winbackCampaigns = mysqlTable("winback_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  targetSegment: mysqlEnum("targetSegment", ["lapsed", "unknown", "recent", "dormant", "lost", "vip", "fleet", "tire_customer"]).notNull(),
  targetCount: int("targetCount").default(0).notNull(),
  sentCount: int("sentCount").default(0).notNull(),
  status: mysqlEnum("status", ["draft", "active", "paused", "completed"]).default("draft").notNull(),
  activatedAt: timestamp("activatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WinbackCampaign = typeof winbackCampaigns.$inferSelect;

/**
 * Individual message steps within a win-back campaign.
 */
export const winbackMessages = mysqlTable("winback_messages", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  step: int("step").notNull(),
  delayDays: int("delayDays").default(0).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WinbackMessage = typeof winbackMessages.$inferSelect;

/**
 * Individual send records — one per customer per message step.
 */
export const winbackSends = mysqlTable("winback_sends", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaignId").notNull(),
  customerId: int("customerId").notNull().references(() => customers.id, { onDelete: "cascade" }),
  messageId: int("messageId").notNull(),
  step: int("step").notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  personalizedBody: text("personalizedBody").notNull(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  sentAt: timestamp("sentAt"),
  status: mysqlEnum("status", ["pending", "sent", "failed", "heldout"]).default("pending").notNull(),
  twilioSid: varchar("twilioSid", { length: 100 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WinbackSend = typeof winbackSends.$inferSelect;

// ─── SHOP SETTINGS ──────────────────────────────────────
/**
 * Key-value store for dynamic shop settings.
 * Allows admin to update labor rate, shop info, etc. without code changes.
 * Auto-syncs with ShopDriver Elite when CSV is imported.
 */
export const shopSettings = mysqlTable("shop_settings", {
  id: int("id").autoincrement().primaryKey(),
  /** Setting key (e.g. "laborRate", "shopName", "taxRate") */
  key: varchar("key", { length: 100 }).notNull().unique(),
  /** Setting value (stored as string, parsed by consumer) */
  value: text("value").notNull(),
  /** Human-readable label */
  label: varchar("label", { length: 255 }),
  /** Category for grouping in admin UI */
  category: mysqlEnum("category", ["pricing", "contact", "hours", "sms", "general"]).default("general").notNull(),
  /** Last updated by (user or "system" for auto-sync) */
  updatedBy: varchar("updatedBy", { length: 100 }).default("system").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopSetting = typeof shopSettings.$inferSelect;
export type InsertShopSetting = typeof shopSettings.$inferInsert;

// ─── CUSTOMER IMPORT LOG ────────────────────────────────
/**
 * Tracks CSV import history from ShopDriver Elite.
 */
export const customerImportLog = mysqlTable("customer_import_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Number of rows in the CSV */
  totalRows: int("totalRows").default(0).notNull(),
  /** New customers added */
  newCustomers: int("newCustomers").default(0).notNull(),
  /** Existing customers updated */
  updatedCustomers: int("updatedCustomers").default(0).notNull(),
  /** Rows skipped (invalid data) */
  skippedRows: int("skippedRows").default(0).notNull(),
  /** Import source */
  source: varchar("source", { length: 100 }).default("shopdriver_csv").notNull(),
  /** Status */
  status: mysqlEnum("status", ["processing", "completed", "failed"]).default("processing").notNull(),
  /** Error message if failed */
  errorMessage: text("errorMessage"),
  /** Who triggered the import */
  importedBy: varchar("importedBy", { length: 100 }).default("admin").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CustomerImportLog = typeof customerImportLog.$inferSelect;
export type InsertCustomerImportLog = typeof customerImportLog.$inferInsert;

// ─── TECHNICIAN ASSIGNMENTS (Job Board Advanced) ────────
/**
 * Tracks which technician is assigned to which booking/job.
 * Enables time tracking and workload balancing.
 */
export const jobAssignments = mysqlTable("job_assignments", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  technicianId: int("technicianId").notNull().references(() => technicians.id, { onDelete: "restrict" }),
  /** Estimated hours for the job */
  estimatedHours: varchar("estimatedHours", { length: 10 }),
  /** When the tech actually started working */
  startedAt: timestamp("startedAt"),
  /** When the tech finished */
  completedAt: timestamp("completedAt"),
  /** Admin notes about the assignment */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type JobAssignment = typeof jobAssignments.$inferSelect;
export type InsertJobAssignment = typeof jobAssignments.$inferInsert;

// ─── CUSTOMER LIFETIME VALUE TRACKING ───────────────────
/**
 * Aggregated customer value metrics, computed periodically.
 * One row per customer (from imported customers table).
 */
export const customerMetrics = mysqlTable("customer_metrics", {
  id: int("id").autoincrement().primaryKey(),
  customerId: int("customerId").notNull().references(() => customers.id, { onDelete: "cascade" }),
  /** Total revenue from this customer */
  totalRevenue: int("totalRevenue").default(0).notNull(),
  /** Number of completed jobs */
  totalJobs: int("totalJobs").default(0).notNull(),
  /** Average spend per visit */
  avgSpendPerVisit: int("avgSpendPerVisit").default(0).notNull(),
  /** Days since last visit */
  daysSinceLastVisit: int("daysSinceLastVisit"),
  /** Churn risk: low, medium, high */
  churnRisk: mysqlEnum("churnRisk", ["low", "medium", "high"]).default("low").notNull(),
  /** Whether flagged as VIP (top 10% revenue) */
  isVip: int("isVip").default(0).notNull(),
  /** Predicted next visit date */
  predictedNextVisit: timestamp("predictedNextVisit"),
  /** Wave-100: materialized declined-work value (cents) — sum of unmatched
   * ALG estimates by phone. Updated by metricsRefresh cron. */
  declinedValue: int("declinedValue").default(0).notNull(),
  declinedCount: int("declinedCount").default(0).notNull(),
  /** Wave-100: materialized active-backlog value (cents) — sum of open
   * work order totals by customer. Updated by metricsRefresh cron. */
  backlogValueCents: int("backlogValueCents").default(0).notNull(),
  backlogCount: int("backlogCount").default(0).notNull(),
  /** Last computed timestamp */
  computedAt: timestamp("computedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  // wave-121 — customers.list LEFT JOIN customer_metrics ON customer_id
  // runs every 30s; without this index the JOIN was a full scan
  index("idx_cm_customer_id").on(table.customerId),
]);

export type CustomerMetric = typeof customerMetrics.$inferSelect;
export type InsertCustomerMetric = typeof customerMetrics.$inferInsert;

// ─── REVENUE TRACKING (from ShopDriver invoices) ────────
/**
 * Individual invoice records imported from ShopDriver or manually entered.
 * Powers the revenue dashboard and CLV calculations.
 */
export const invoices = mysqlTable("invoices", {
  id: int("id").autoincrement().primaryKey(),
  /** Link to imported customer if matched. DB-level FK fk_invoices_customer
   *  (BE-DATA-1, 2026-07-07) · ON DELETE SET NULL — never cascade-delete an
   *  invoice; unlink it. Nullable: an unmatched import legitimately has none. */
  customerId: int("customerId").references(() => customers.id, { onDelete: "set null" }),
  /** Link to booking if matched */
  bookingId: int("bookingId").references(() => bookings.id, { onDelete: "set null" }),
  /** Link to work order if matched. NOTE: this is int; work_orders.id is
   *  varchar(36) — no DB FK possible (type mismatch); kept as a soft link. */
  workOrderId: int("workOrderId"),
  /** Customer name (denormalized for display) */
  customerName: varchar("customerName", { length: 255 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 30 }),
  /** Invoice number from shop management system */
  invoiceNumber: varchar("invoiceNumber", { length: 50 }).unique(),
  /** Total amount in cents */
  totalAmount: int("totalAmount").default(0).notNull(),
  /** Parts cost in cents */
  partsCost: int("partsCost").default(0).notNull(),
  /** Labor cost in cents */
  laborCost: int("laborCost").default(0).notNull(),
  /** Tax in cents */
  taxAmount: int("taxAmount").default(0).notNull(),
  /** Service description */
  serviceDescription: text("serviceDescription"),
  /** Vehicle info */
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),
  /** Payment method */
  paymentMethod: mysqlEnum("paymentMethod", ["cash", "card", "check", "financing", "other"]).default("card").notNull(),
  /** Payment status */
  paymentStatus: mysqlEnum("paymentStatus", ["paid", "pending", "partial", "refunded"]).default("paid").notNull(),
  /** Invoice date */
  invoiceDate: timestamp("invoiceDate").defaultNow().notNull(),
  /** Source of the record */
  source: mysqlEnum("source", ["shopdriver", "manual", "stripe"]).default("manual").notNull(),
  /** ALG ticket UUID — captured from ShopDriver listRecentTickets so we
   * have a stable identifier independent of invoiceNumber. Wave-99. */
  algTicketId: varchar("algTicketId", { length: 64 }),
  // Unpaid-invoice recovery cron (FEATURE_UNPAID_INVOICE_RECOVERY) · at-most-once
  // claim + sent markers per touch. camelCase DB columns match this table.
  // Applied by drizzle/0072_unpaid_invoice_recovery.sql (hand-applied to prod).
  paymentReminder7dAttemptedAt: timestamp("paymentReminder7dAttemptedAt"),
  paymentReminder7dSentAt: timestamp("paymentReminder7dSentAt"),
  paymentReminder30dAttemptedAt: timestamp("paymentReminder30dAttemptedAt"),
  paymentReminder30dSentAt: timestamp("paymentReminder30dSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_invoice_booking").on(table.bookingId),
  index("idx_invoice_work_order").on(table.workOrderId),
  index("idx_invoice_customer").on(table.customerName),
  index("idx_invoice_date").on(table.invoiceDate),
  index("idx_invoice_payment_status").on(table.paymentStatus),
  // Wave-97 additions — fix unindexed scans flagged by audit
  index("idx_invoice_customer_id").on(table.customerId),
  index("idx_invoice_customer_phone").on(table.customerPhone),
  index("idx_invoice_source").on(table.source),
  // Composite for the most common dashboard query (last-N paid revenue)
  index("idx_invoice_date_status").on(table.invoiceDate, table.paymentStatus),
  // Wave-99: stable lookup by ALG ticket UUID
  index("idx_invoice_alg_ticket").on(table.algTicketId),
]);

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ─── ESTIMATES LOG ─────────────────────────────────────���─
/**
 * Persists every estimate generated (AI or manual).
 * Closes the analytics gap: tracks estimate→conversion rate and $ pipeline.
 */
export const estimatesLog = mysqlTable("estimates_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Customer phone for matching */
  phone: varchar("phone", { length: 30 }).notNull(),
  /** Customer name */
  name: varchar("name", { length: 255 }),
  /** Vehicle info */
  vehicle: varchar("vehicle", { length: 255 }),
  /** Service described */
  service: varchar("service", { length: 255 }).notNull(),
  /** Estimated amount in cents */
  estimatedAmountCents: int("estimatedAmountCents"),
  /** Low end of range in cents */
  estimatedLowCents: int("estimatedLowCents"),
  /** High end of range in cents */
  estimatedHighCents: int("estimatedHighCents"),
  /** Source: ai-estimator, manual, phone-quote */
  source: mysqlEnum("source", ["ai-estimator", "manual", "phone-quote"]).default("ai-estimator").notNull(),
  /** Whether customer converted (booked / invoiced) */
  converted: int("converted").default(0).notNull(),
  /** Link to invoice if converted */
  invoiceId: int("invoiceId").references(() => invoices.id, { onDelete: "set null" }),
  /** Link to booking if converted */
  bookingId: int("bookingId").references(() => bookings.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_estimate_phone").on(table.phone),
  index("idx_estimate_source").on(table.source),
  index("idx_estimate_created").on(table.createdAt),
]);

export type EstimateLog = typeof estimatesLog.$inferSelect;
export type InsertEstimateLog = typeof estimatesLog.$inferInsert;

// ─── KPI SNAPSHOTS (Command Center) ────────────────────
/**
 * Weekly KPI snapshots for trend tracking and projections.
 * Computed every Sunday night or on-demand.
 */
export const kpiSnapshots = mysqlTable("kpi_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  /** Week start date (YYYY-MM-DD) */
  weekStart: varchar("weekStart", { length: 10 }).notNull(),
  /** Total revenue for the week (cents) */
  revenue: int("revenue").default(0).notNull(),
  /** Number of completed jobs */
  jobsCompleted: int("jobsCompleted").default(0).notNull(),
  /** New customers acquired */
  newCustomers: int("newCustomers").default(0).notNull(),
  /** Average ticket size (cents) */
  avgTicket: int("avgTicket").default(0).notNull(),
  /** Lead-to-booking conversion rate (percentage * 100) */
  conversionRate: int("conversionRate").default(0).notNull(),
  /** Customer satisfaction score (1-5 * 100) */
  satisfactionScore: int("satisfactionScore").default(0).notNull(),
  /** Number of review requests sent */
  reviewsSent: int("reviewsSent").default(0).notNull(),
  /** Number of reviews received */
  reviewsReceived: int("reviewsReceived").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;
export type InsertKpiSnapshot = typeof kpiSnapshots.$inferInsert;

// ─── ALG WALK-IN ESTIMATES (DECLINED WORK) ──────────────
/**
 * ALG (Auto Labor Guide / ShopDriver Elite) walk-in estimates —
 * physical quotes written at the shop counter. An estimate WITHOUT a
 * matching invoice = declined sale = recovery opportunity.
 *
 * Populated by services/shopDriverEstimateSync.runEstimateMirror() which
 * hits ShopDriver's /api/Estimate/listEstimates endpoint. Shop-protection
 * aware: only syncs when admin is active (runIfAdminActive wrapper).
 *
 * matchedInvoiceId is set by backfillMatches() when exactly one invoice for
 * the same phone falls within MATCH_AMOUNT_TOLERANCE and MATCH_WINDOW_DAYS of
 * the estimate (shopDriverEstimateSync.ts). It runs after each ALG estimate
 * sync and daily as the `estimate-invoice-match` tier job (Q-37). No match is
 * an INFERRED decline; an observed one is in declined_work_captures.
 */
export const algEstimates = mysqlTable("alg_estimates", {
  id: int("id").autoincrement().primaryKey(),
  /** External ID from ALG (Estimate# in ShopDriver) — unique */
  externalId: varchar("external_id", { length: 64 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 30 }),
  vehicleInfo: varchar("vehicle_info", { length: 255 }),
  serviceDescription: text("service_description"),
  /** Estimated total in CENTS (matches invoices.totalAmount convention) */
  estimatedAmount: int("estimated_amount").default(0).notNull(),
  /** When ALG wrote the estimate */
  estimateDate: timestamp("estimate_date").notNull(),
  /** Link to invoice if converted (matched during sync) */
  matchedInvoiceId: int("matched_invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  matchedAt: timestamp("matched_at"),
  customerId: int("customer_id").references(() => customers.id, { onDelete: "set null" }),
  vin: varchar("vin", { length: 17 }),
  laborRate: int("labor_rate").default(11500).notNull(),
  serviceCategory: varchar("service_category", { length: 64 }),
  estimatedLaborCost: int("estimated_labor_cost").default(0).notNull(),
  estimatedPartsCost: int("estimated_parts_cost").default(0).notNull(),
  /** Recovery follow-up tracking.
   *
   * wave-181.59 — `*AttemptedAt` columns added for at-most-once delivery.
   * The cron claims a row by stamping AttemptedAt inside a conditional
   * UPDATE BEFORE calling sendSms. If the process crashes between send
   * and the success commit, the next cron run sees AttemptedAt set and
   * skips — at most one send, never duplicates. Missed sends (claimed
   * but never confirmed) land in the manual review queue (Sent=0 +
   * AttemptedAt IS NOT NULL). Per-tier columns so a failed 7d attempt
   * does not block the 30d send. Migration 0042. */
  followUp3dSent: int("follow_up_3d_sent").default(0).notNull(),
  followUp3dAttemptedAt: timestamp("follow_up_3d_attempted_at"),
  followUp3dSentAt: timestamp("follow_up_3d_sent_at"),
  followUp7dSent: int("follow_up_7d_sent").default(0).notNull(),
  followUp7dAttemptedAt: timestamp("follow_up_7d_attempted_at"),
  followUp7dSentAt: timestamp("follow_up_7d_sent_at"),
  followUp14dSent: int("follow_up_14d_sent").default(0).notNull(),
  followUp14dAttemptedAt: timestamp("follow_up_14d_attempted_at"),
  followUp14dSentAt: timestamp("follow_up_14d_sent_at"),
  followUp30dSent: int("follow_up_30d_sent").default(0).notNull(),
  followUp30dAttemptedAt: timestamp("follow_up_30d_attempted_at"),
  followUp30dSentAt: timestamp("follow_up_30d_sent_at"),
  followUp45dSent: int("follow_up_45d_sent").default(0).notNull(),
  followUp45dAttemptedAt: timestamp("follow_up_45d_attempted_at"),
  followUp45dSentAt: timestamp("follow_up_45d_sent_at"),
  /** wave-181.110 (this commit) · psychographic profile cache for 5×3
   *  sequence (P1=broke_brenda · P2=skeptical_pat · P3=busy_tim). Set
   *  on first touch and sticky so the sequence stays consistent even
   *  if customer signals shift. Migration 0055. */
  recoveryProfile: varchar("recovery_profile", { length: 8 }),
  recoveryProfileScore: int("recovery_profile_score").default(0).notNull(),
  /** Recovery 2.0 (migration 0100) · the customer's OWN stated objection —
   *  "price" | "proof" | "time" | "repaired_elsewhere" | "no_longer_owns" |
   *  "not_interested". NULL = never stated. Routing may ONLY key off this,
   *  never off vehicle/service/amount proxies (revenue-truth doctrine). */
  statedConcern: varchar("stated_concern", { length: 24 }),
  /** Where the stated concern came from: "operator" | "sms_reply" | "call". */
  statedConcernSource: varchar("stated_concern_source", { length: 24 }),
  statedConcernAt: timestamp("stated_concern_at"),
  /** Recovery holdout flag (0100): NULL = unassigned · 1 = control group
   *  (never contacted by the recovery cron) · 0 = treated. Deterministic
   *  at first eligibility (id % 100 < 15). Lift = treated vs holdout
   *  matched-invoice rates — measured, never assumed. */
  recoveryHoldout: tinyint("recovery_holdout"),
  /** 0103 · experiment version stamped at assignment ("v3"+); legacy %-modulo rows stay NULL */
  recoveryExperimentVersion: varchar("recovery_experiment_version", { length: 8 }),
  /** 0103 · when the arm was assigned — outcome windows anchor here, not on estimate_date */
  recoveryAssignedAt: timestamp("recovery_assigned_at"),
  /** wave-181.85 · voice recovery escalation (post-D30) · AgentPhone */
  voiceRecoveryAttemptedAt: timestamp("voice_recovery_attempted_at"),
  voiceRecoveryCallId: varchar("voice_recovery_call_id", { length: 64 }),
  voiceRecoveryOutcome: mysqlEnum("voice_recovery_outcome", ["pending", "dialing", "interested", "not_interested", "no_answer", "failed"]),
  recoveryNote: text("recovery_note"),
  /** Source of the record (alg, manual, ...) */
  source: varchar("source", { length: 32 }).default("alg").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_alg_est_phone").on(t.customerPhone),
  index("idx_alg_est_date").on(t.estimateDate),
  index("idx_alg_est_unmatched").on(t.matchedInvoiceId, t.estimateDate),
  // Wave-97 — admin search by customer name + filter by source
  index("idx_alg_est_customer_name").on(t.customerName),
  index("idx_alg_est_source").on(t.source),
  // wave-181.110 · profile-aware sequence filter
  index("idx_alg_est_recovery_profile").on(t.recoveryProfile),
]);

export type AlgEstimate = typeof algEstimates.$inferSelect;
export type InsertAlgEstimate = typeof algEstimates.$inferInsert;

// ─── DECLINED WORK · COUNTER CAPTURES (Q-37, migration 0132) ──
/**
 * A person at the counter recorded that the customer declined this estimate.
 * The only OBSERVED decline for an ALG estimate; everything else is inferred from
 * "no matching invoice" (shared/declineProvenance.ts).
 *
 * A separate table, not columns on alg_estimates, on purpose: drizzle's MySQL
 * insert names EVERY column in the table definition (mysql-core/dialect.js
 * buildInsertQuery), so a new alg_estimates column would break the estimate
 * mirror's insert for the whole window between deploy and the hand-applied DDL.
 * A missing table here degrades to "not enabled" (services/declineCaptures.ts).
 *
 * One row per estimate (unique key) — the capture is a claim, so a second tap or
 * a second device loses the insert and reads the winner back.
 */
export const declinedWorkCaptures = mysqlTable("declined_work_captures", {
  id: int("id").autoincrement().primaryKey(),
  estimateId: int("estimate_id").notNull(),
  /** What was quoted, snapshotted at capture (the estimate's service description). */
  declinedItem: varchar("declined_item", { length: 500 }),
  /** "counter" today. VARCHAR, not ENUM: an out-of-enum write loses the row on TiDB. */
  source: varchar("source", { length: 32 }).default("counter").notNull(),
  capturedBy: varchar("captured_by", { length: 255 }),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_declined_capture_estimate").on(t.estimateId),
]);

export type DeclinedWorkCapture = typeof declinedWorkCaptures.$inferSelect;

// ─── CUSTOMER PORTAL SESSIONS ──────────────────────────
/**
 * Phone-based login sessions for the customer portal.
 * Customers verify via SMS code to access their vehicle history.
 */
export const portalSessions = mysqlTable("portal_sessions", {
  id: int("id").autoincrement().primaryKey(),
  /** Customer phone (normalized) */
  phone: varchar("phone", { length: 30 }).notNull(),
  /** Link to imported customer if matched */
  customerId: int("customerId"),
  /** 6-digit verification code */
  verificationCode: varchar("verificationCode", { length: 10 }).notNull(),
  /** Session token after verification */
  sessionToken: varchar("sessionToken", { length: 128 }),
  /** Whether the code has been verified */
  verified: int("verified").default(0).notNull(),
  /** Expiry for the verification code */
  codeExpiresAt: timestamp("codeExpiresAt").notNull(),
  /** Session expiry */
  sessionExpiresAt: timestamp("sessionExpiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_portal_phone").on(table.phone),
  index("idx_portal_token").on(table.sessionToken),
]);

export type PortalSession = typeof portalSessions.$inferSelect;
export type InsertPortalSession = typeof portalSessions.$inferInsert;

// ─── TIRE ORDERS ──────────────────────────────────────
/**
 * Online tire orders placed by customers through the Tire Finder.
 * Tracks the full lifecycle: received → confirmed → ordered → delivered → installed.
 * Email notification sent to shop on creation.
 */
export const tireOrders = mysqlTable("tire_orders", {
  id: int("id").autoincrement().primaryKey(),
  /** Order reference number (e.g. "TO-20260320-001") */
  orderNumber: varchar("orderNumber", { length: 50 }).notNull().unique(),

  // ─── Customer info ───
  customerName: varchar("customerName", { length: 255 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 30 }).notNull(),
  customerEmail: varchar("customerEmail", { length: 320 }),
  vehicleInfo: varchar("vehicleInfo", { length: 255 }),

  // ─── Tire details ───
  tireBrand: varchar("tireBrand", { length: 100 }).notNull(),
  tireModel: varchar("tireModel", { length: 255 }).notNull(),
  tireSize: varchar("tireSize", { length: 50 }).notNull(),
  quantity: int("quantity").default(4).notNull(),
  pricePerTire: int("pricePerTire").default(0).notNull(), // cents
  /** Mounting + balancing + disposal per tire (cents) */
  serviceFeePerTire: int("serviceFeePerTire").default(3500).notNull(), // $35 default
  /** Federal Excise Tax per tire (cents) */
  fetPerTire: int("fetPerTire").default(0).notNull(),
  /** Total order amount (cents) — (pricePerTire + serviceFee + fet) * quantity */
  totalAmount: int("totalAmount").default(0).notNull(),

  // ─── Order lifecycle ───
  status: mysqlEnum("status", [
    "received",     // Customer submitted — awaiting shop review
    "confirmed",    // Shop confirmed availability & price with customer
    "ordered",      // Tires ordered from Gateway Tire
    "in_transit",   // Tires shipped / en route to shop
    "delivered",    // Tires arrived at shop
    "scheduled",    // Installation appointment set
    "installed",    // Job complete
    "cancelled",    // Order cancelled
  ]).default("received").notNull(),

  /** Internal notes (admin only) */
  adminNotes: text("adminNotes"),
  /** Customer-visible notes */
  customerNotes: text("customerNotes"),

  /** Gateway Tire PO or reference number */
  gatewayOrderRef: varchar("gatewayOrderRef", { length: 100 }),
  /** Expected delivery date */
  expectedDelivery: timestamp("expectedDelivery"),

  // attribution-holds migration 0067 (2026-06) - additive, nullable.
  // Which page/campaign produced the tire ORDER (the money path) -
  // same field shapes as leads/bookings.
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  landingPage: varchar("landingPage", { length: 500 }),
  referrer: varchar("referrer", { length: 500 }),
  // journey-join migration 0068 (2026-06) - localStorage visitor id; exact-key joins only
  sessionId: varchar("sessionId", { length: 64 }),
  /** Scheduled installation date */
  installationDate: timestamp("installationDate"),

  /** Link to imported customer if matched */
  customerId: int("customerId").references(() => customers.id, { onDelete: "set null" }),
  /** Link to booking if one was created for installation */
  bookingId: int("bookingId").references(() => bookings.id, { onDelete: "set null" }),

  /** Whether the shop email notification was sent */
  emailSent: int("emailSent").default(0).notNull(),

  // ─── Online payment (Stripe Checkout) ───
  /** Linked invoice number — invoice is auto-created at order placement */
  invoiceNumber: varchar("invoiceNumber", { length: 50 }),
  /** unpaid | paid | refunded */
  paymentStatus: varchar("paymentStatus", { length: 20 }).default("unpaid").notNull(),
  /** Stripe Checkout Session id — audit trail + idempotency */
  stripeSessionId: varchar("stripeSessionId", { length: 255 }),
  /** When the customer's online payment cleared */
  paidAt: timestamp("paidAt"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TireOrder = typeof tireOrders.$inferSelect;
export type InsertTireOrder = typeof tireOrders.$inferInsert;

// ─── CALL EVENTS (Phone Click Tracking) ──────────────
/**
 * Tracks every phone call click from the website.
 * Captures source attribution for ad spend ROI analysis.
 */
export const callEvents = mysqlTable("call_events", {
  id: int("id").autoincrement().primaryKey(),
  /** Phone number clicked */
  phoneNumber: varchar("phoneNumber", { length: 30 }).notNull(),
  /** Page where the click happened */
  sourcePage: varchar("sourcePage", { length: 500 }),
  /** Button/element that was clicked */
  clickElement: varchar("clickElement", { length: 100 }),
  /** UTM source attribution */
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  /** Landing page that brought the visitor */
  landingPage: varchar("landingPage", { length: 500 }),
  /** Referrer URL */
  referrer: varchar("referrer", { length: 500 }),
  /** User agent for device tracking */
  userAgent: varchar("userAgent", { length: 500 }),
  // journey-join migration 0068 (2026-06) - localStorage visitor id +
  // Meta-pixel event_id (trackPhoneCall generates+returns it; was discarded)
  sessionId: varchar("sessionId", { length: 64 }),
  eventId: varchar("eventId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idx_call_created: index("idx_call_created").on(table.createdAt),
  idx_call_source: index("idx_call_source").on(table.sourcePage),
}));

export type CallEvent = typeof callEvents.$inferSelect;
export type InsertCallEvent = typeof callEvents.$inferInsert;

/**
 * Wave-125 — VAPI call logs. Persists every inbound voice call (the
 * AI receptionist) with the AI-generated summary + extracted service
 * mention. Closes the gap where calls that DIDN'T explicitly trigger
 * a callback/booking left no DB trace.
 *
 * Operator can review "today's voice calls that mentioned brakes"
 * even when the customer hung up without booking. Linked to leads
 * + callbacks via FK when conversion happens.
 */
export const vapiCallLogs = mysqlTable("vapi_call_logs", {
  id: int("id").autoincrement().primaryKey(),
  /** VAPI's call id — unique per call */
  vapiCallId: varchar("vapiCallId", { length: 64 }).notNull().unique(),
  phoneNumber: varchar("phoneNumber", { length: 30 }),
  customerName: varchar("customerName", { length: 255 }),
  durationSeconds: int("durationSeconds").default(0).notNull(),
  endedReason: varchar("endedReason", { length: 64 }),
  /** AI-generated 1-2 sentence summary of the call */
  aiSummary: text("aiSummary"),
  /** AI-extracted service mention (brakes, oil change, etc.) */
  serviceMention: varchar("serviceMention", { length: 120 }),
  /**
   * MISNAMED — means "Nick REACHED a tool" (any state_tool_called / state_confirmed
   * event, incl. the recap SMS), NOT "a lead row exists". Operator decision 2026-09-23
   * (option C) kept the behaviour; durable capture is leadId / callbackId below.
   * Measured 2026-10-02: ~101 calls/7d with 1 here, 0 with a leadId. Never count it as a
   * lead conversion (METRICS-CONTRACT "Leads created" = calls linked to a real leads row).
   */
  convertedToLead: int("convertedToLead").default(0).notNull(),
  leadId: int("leadId").references(() => leads.id, { onDelete: "set null" }),
  callbackId: int("callbackId").references(() => callbackRequests.id, { onDelete: "set null" }),
  transcriptUrl: varchar("transcriptUrl", { length: 500 }),
  recordingUrl: varchar("recordingUrl", { length: 500 }),
  /** wave-181.113 · Nick AI evaluation. Daily cron scores each call
   *  0-100 (eval_score), classifies outcome (eval_outcome), preserves
   *  reasoning for compound improvement (eval_reasoning), stamps eval_at
   *  so re-runs / catch-ups can detect what's been processed.
   *  Sub-50 = wasted · 50-69 = info_only · 70-84 = converted · 85+ = exemplary.
   *  Migration 0057. */
  evalScore: tinyint("eval_score"),
  evalOutcome: varchar("eval_outcome", { length: 32 }),
  evalReasoning: text("eval_reasoning"),
  evalAt: timestamp("eval_at"),
  /** wave-181.x · agentic-actions-auditor stores findings under
   *  metadata.agenticAudit (JSON) · auditedAt stamps when audit ran ·
   *  daily cron filters for NULL auditedAt to find unaudited calls.
   *  Migration 0060. */
  metadata: json("metadata"),
  auditedAt: timestamp("audited_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_vapi_log_created").on(table.createdAt),
  index("idx_vapi_log_phone").on(table.phoneNumber),
  index("idx_vapi_log_lead").on(table.leadId),
  // wave-181.113 · daily eval cron index for "all unevaluated calls"
  index("idx_vapi_eval_at_score").on(table.evalAt, table.evalScore),
  // wave-181.x · agentic-auditor cron index for "all unaudited calls"
  index("idx_vapi_audited_at").on(table.auditedAt),
]);

export type VapiCallLog = typeof vapiCallLogs.$inferSelect;

/**
 * VAPI call archive — the durable vault for artifacts VAPI purges upstream at
 * 14 days. `vapi_call_logs` keeps summaries, evals and URLs; the URLs die with
 * VAPI's retention window, permanently destroying the raw transcript of every
 * call. One row per call, written by the daily archive pass
 * (server/services/vapiCallArchive.ts) that rides the vapi-eval cron.
 * `transcript` NULL means "not yet available upstream" — the pass retries those
 * until the call ages past the retention window, so a row without a transcript
 * is a pending capture, not a finished one (`transcript_captured_at` is the
 * completion stamp). Migration 0109.
 */
export const vapiCallArchives = mysqlTable("vapi_call_archives", {
  id: int("id").autoincrement().primaryKey(),
  /** VAPI's call id — one archive row per call, keyed to vapi_call_logs.vapiCallId */
  vapiCallId: varchar("vapi_call_id", { length: 64 }).notNull().unique(),
  phoneNumber: varchar("phone_number", { length: 30 }),
  /** VAPI call type (inboundPhoneCall / outboundPhoneCall / webCall) */
  callType: varchar("call_type", { length: 32 }),
  endedReason: varchar("ended_reason", { length: 64 }),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  durationSeconds: int("duration_seconds"),
  /** Full conversation transcript — the artifact the 14-day purge destroys */
  transcript: mediumtext("transcript"),
  /** Role-annotated message array from the call detail (training-grade record) */
  messagesJson: json("messages_json"),
  /** Provider URLs expire with retention — kept for the short window they work */
  recordingUrl: varchar("recording_url", { length: 500 }),
  stereoRecordingUrl: varchar("stereo_recording_url", { length: 500 }),
  summary: text("summary"),
  analysisJson: json("analysis_json"),
  costTotal: decimal("cost_total", { precision: 10, scale: 4 }),
  /** Set only when a non-empty transcript landed — the vault-complete stamp */
  transcriptCapturedAt: timestamp("transcript_captured_at"),
  archivedAt: timestamp("archived_at").defaultNow().notNull(),
}, (table) => [
  index("idx_vapi_archive_started").on(table.startedAt),
]);

export type VapiCallArchive = typeof vapiCallArchives.$inferSelect;
export type InsertVapiCallLog = typeof vapiCallLogs.$inferInsert;

// 🔴 INTEGRATION FAILURES (Error Tracking)
/**
 * Tracks failed integrations (Sheets sync, email, SMS, CAPI, etc.) for visibility
 * Admin dashboard queries this to surface issues that would otherwise be silent
 */
export const integrationFailures = mysqlTable("integration_failures", {
  id: int("id").autoincrement().primaryKey(),
  /** Type of integration that failed */
  failureType: mysqlEnum("failureType", [
    "sheets_sync",
    "email",
    "sms",
    "capi",
    "review_request",
    "reminders",
    "invoice",
  ]).notNull(),
  /** Entity ID (booking ID, lead ID, invoice ID, etc.) */
  entityId: int("entityId"),
  /** Type of entity (booking, lead, invoice, reminder, review) */
  entityType: mysqlEnum("entityType", [
    "booking",
    "lead",
    "invoice",
    "reminder",
    "review",
  ]).notNull(),
  /** Error message from the failed call */
  errorMessage: text("errorMessage").notNull(),
  /** JSON stringified error details for debugging */
  errorDetails: text("errorDetails"),
  /** Timestamp when the failure was resolved (null = unresolved) */
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Per-lead notification delivery ledger — appends one row per email / SMS /
 * Telegram dispatch attempt+outcome so a lead's outreach chronology survives
 * process restarts. Failures still ALSO land in integration_failures
 * (unchanged); this is the superset that additionally records successful /
 * queued sends, so "was the CEO email for this lead even attempted?" is
 * answerable. No FK to leads on purpose: an append-only audit trail must
 * survive lead deletion (deleting a lead should not erase the record that we
 * tried to reach them), and an early failure can predate the lead row.
 */
export const leadDeliveryEvents = mysqlTable("lead_delivery_events", {
  id: int("id").autoincrement().primaryKey(),
  leadId: int("leadId"),
  channel: mysqlEnum("channel", ["email", "sms", "telegram", "capi", "push"]).notNull(),
  status: mysqlEnum("status", ["attempted", "sent", "queued", "delivered", "failed", "skipped"]).notNull(),
  /** Gateway used: resend / shop (Twilio) / telegram / meta */
  provider: varchar("provider", { length: 40 }),
  /** Provider-side message id, when the gateway returns one */
  providerRef: varchar("providerRef", { length: 191 }),
  /** Error message or short note (writer truncates to 1000 chars) */
  detail: text("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idx_lde_lead: index("idx_lde_lead").on(table.leadId, table.createdAt),
}));

/**
 * Financing provider-click ledger (attribution-join wave). Before this,
 * financing `trackApplication` wrote clicks ONLY to Google Sheets (append-only,
 * unjoinable) plus a synthetic leadCaptured({id:0}) — so a customer's "Apply
 * Now" click could never be tied back to their lead/booking. This persists each
 * click with the visitor sessionId (already sent by the client's getUtmData()
 * spread, just zod-stripped server-side until now) so clicks LEFT JOIN
 * leads.sessionId — real financing attribution, not a fabricated guess.
 */
export const financingClicks = mysqlTable("financing_clicks", {
  id: int("id").autoincrement().primaryKey(),
  provider: mysqlEnum("provider", ["acima", "snap", "koalafi", "american-first"]).notNull(),
  sourcePage: varchar("sourcePage", { length: 500 }),
  customerName: varchar("customerName", { length: 200 }),
  customerPhone: varchar("customerPhone", { length: 20 }),
  customerEmail: varchar("customerEmail", { length: 254 }),
  estimatedAmount: varchar("estimatedAmount", { length: 20 }),
  /** Visitor session id — the join key to leads.sessionId */
  sessionId: varchar("sessionId", { length: 64 }),
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  landingPage: varchar("landingPage", { length: 500 }),
  referrer: varchar("referrer", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idx_fc_session: index("idx_fc_session").on(table.sessionId),
  idx_fc_created: index("idx_fc_created").on(table.createdAt),
}));

export type IntegrationFailure = typeof integrationFailures.$inferSelect;
export type InsertIntegrationFailure = typeof integrationFailures.$inferInsert;

// 📱 SMS CAMPAIGN SYSTEM
/**
 * One-off SMS campaigns for targeted customer outreach.
 * Supports templates and customer segments.
 */
export const smsCampaigns = mysqlTable("sms_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  /** Campaign name (e.g., "Spring Maintenance Reminder") */
  name: varchar("name", { length: 255 }).notNull(),
  /** Template type: maintenance, seasonal, special_offer, winback */
  template: mysqlEnum("template", ["maintenance", "seasonal", "special_offer", "winback"]).notNull(),
  /** Target segment: recent (active last 90 days), lapsed (91-365 days), all */
  segment: mysqlEnum("segment", ["recent", "lapsed", "all"]).notNull(),
  /** Custom message if not using template */
  customMessage: text("customMessage"),
  /** Total count of customers in segment */
  targetCount: int("targetCount").default(0).notNull(),
  /** Number of SMS sent */
  sentCount: int("sentCount").default(0).notNull(),
  /** Number of SMS failed */
  failedCount: int("failedCount").default(0).notNull(),
  /** Campaign status: draft, active (in progress), completed */
  status: mysqlEnum("status", ["draft", "active", "completed"]).default("draft").notNull(),
  /** When campaign started sending */
  startedAt: timestamp("startedAt"),
  /** When campaign finished */
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SmsCampaign = typeof smsCampaigns.$inferSelect;
export type InsertSmsCampaign = typeof smsCampaigns.$inferInsert;

/**
 * Individual SMS sends tracked for each campaign send.
 */
export const smsCampaignSends = mysqlTable("sms_campaign_sends", {
  id: int("id").autoincrement().primaryKey(),
  /** Reference to the campaign */
  campaignId: int("campaignId").notNull(),
  /** Reference to customer */
  customerId: int("customerId").notNull().references(() => customers.id, { onDelete: "cascade" }),
  /** Normalized phone number that was sent to */
  phone: varchar("phone", { length: 20 }).notNull(),
  /** Actual message body sent */
  messageBody: text("messageBody").notNull(),
  /** Twilio message SID for tracking */
  twilioSid: varchar("twilioSid", { length: 100 }),
  /** Status: pending, sent, failed, heldout (0136 appended heldout) */
  status: mysqlEnum("status", ["pending", "sent", "failed", "heldout"]).default("pending").notNull(),
  /** Error message if failed */
  errorMessage: text("errorMessage"),
  /** When SMS was actually sent */
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  idx_campaign_send_cid: index("idx_campaign_send_cid").on(table.campaignId),
  idx_campaign_send_status: index("idx_campaign_send_status").on(table.status),
}));

export type SmsCampaignSend = typeof smsCampaignSends.$inferSelect;
export type InsertSmsCampaignSend = typeof smsCampaignSends.$inferInsert;

// ─── Phase 5: New Tables ─────────────────────────────

/** Emergency after-hours service requests */
export const emergencyRequests = mysqlTable("emergency_requests", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  vehicle: varchar("vehicle", { length: 200 }),
  problem: text("problem"),
  urgency: varchar("urgency", { length: 20 }).default("normal"),
  status: varchar("status", { length: 20 }).default("new"),
  source: varchar("source", { length: 50 }).default("after_hours"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** AI-generated review reply drafts */
export const reviewReplies = mysqlTable("review_replies", {
  id: int("id").primaryKey().autoincrement(),
  reviewId: varchar("review_id", { length: 200 }).notNull(),
  reviewerName: varchar("reviewer_name", { length: 100 }),
  reviewRating: int("review_rating"),
  reviewText: text("review_text"),
  reviewDate: timestamp("review_date"),
  draftReply: text("draft_reply"),
  finalReply: text("final_reply"),
  status: varchar("status", { length: 20 }).default("draft"),
  approvedAt: timestamp("approved_at"),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

/** Shareable vehicle health/service cards */
export const shareCards = mysqlTable("share_cards", {
  id: int("id").primaryKey().autoincrement(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 100 }),
  vehicleInfo: varchar("vehicle_info", { length: 200 }),
  serviceType: varchar("service_type", { length: 100 }),
  healthScore: int("health_score"),
  healthDetails: text("health_details"),
  completedDate: timestamp("completed_date"),
  inspectionId: int("inspection_id"),
  views: int("views").default(0),
  shares: int("shares").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// ═══════════════════════════════════════════════════════
// Phase 3 — New tables added by master upgrade
// ═══════════════════════════════════════════════════════

/**
 * Unified communication log — tracks every SMS, email, call, and note per customer.
 */
export const communicationLog = mysqlTable("communication_log", {
  id: int("id").primaryKey().autoincrement(),
  customerId: int("customer_id"),
  customerPhone: varchar("customer_phone", { length: 20 }),
  type: varchar("type", { length: 20 }).notNull(), // sms, email, call, note
  direction: varchar("direction", { length: 10 }).notNull(), // inbound, outbound, internal
  subject: varchar("subject", { length: 255 }),
  body: text("body"),
  metadata: json("metadata"),
  staffName: varchar("staff_name", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_comm_customer_id").on(table.customerId),
  index("idx_comm_phone").on(table.customerPhone),
  index("idx_comm_type").on(table.type),
  index("idx_comm_created").on(table.createdAt),
]);

/**
 * SMS opt-in/opt-out preferences (TCPA compliance).
 */
export const smsPreferences = mysqlTable("sms_preferences", {
  id: int("id").primaryKey().autoincrement(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  optedOut: boolean("opted_out").default(false).notNull(),
  optOutKeyword: varchar("opt_out_keyword", { length: 20 }),
  optedOutAt: timestamp("opted_out_at"),
  optedInAt: timestamp("opted_in_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/**
 * Q-43 append-only consent/revocation evidence. The TiDB table is hand-applied
 * by migration 0133; code tolerates it being absent until the operator applies it.
 */
export const contactConsentEvents = mysqlTable("contact_consent_events", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  subjectType: varchar("subject_type", { length: 8 }).notNull(),
  subjectKey: varchar("subject_key", { length: 255 }).notNull(),
  customerKey: varchar("customer_key", { length: 64 }),
  scope: varchar("scope", { length: 32 }).notNull(),
  action: varchar("action", { length: 16 }).notNull(),
  source: varchar("source", { length: 48 }).notNull(),
  method: varchar("method", { length: 32 }).notNull(),
  disclosureId: varchar("disclosure_id", { length: 64 }),
  disclosureVersion: varchar("disclosure_version", { length: 16 }),
  disclosureSha256: varchar("disclosure_sha256", { length: 64 }),
  evidenceRef: varchar("evidence_ref", { length: 191 }).notNull(),
  evidenceExcerpt: varchar("evidence_excerpt", { length: 160 }),
  detectorVersion: varchar("detector_version", { length: 16 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 300 }),
  actor: varchar("actor", { length: 100 }).notNull(),
  occurredAt: datetime("occurred_at", { mode: "date" }).notNull(),
  occurredAtEstimated: tinyint("occurred_at_estimated").default(0).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  reviewStatus: varchar("review_status", { length: 16 }),
  reviewedBy: varchar("reviewed_by", { length: 100 }),
  reviewedAt: datetime("reviewed_at", { mode: "date" }),
}, (table) => [
  uniqueIndex("uq_contact_consent_event").on(
    table.subjectType, table.subjectKey, table.source, table.evidenceRef, table.scope, table.action,
  ),
  index("idx_contact_consent_subject").on(table.subjectType, table.subjectKey, table.occurredAt),
  index("idx_contact_consent_review").on(table.action, table.reviewStatus),
]);

/**
 * Tracks abandoned form submissions for recovery outreach.
 */
export const formAbandonment = mysqlTable("form_abandonment", {
  id: int("id").primaryKey().autoincrement(),
  phone: varchar("phone", { length: 20 }),
  name: varchar("name", { length: 100 }),
  email: varchar("email", { length: 255 }),
  formType: varchar("form_type", { length: 50 }).notNull(),
  fieldsCompleted: json("fields_completed"),
  recoverySmsSent: boolean("recovery_sms_sent").default(false),
  recovered: boolean("recovered").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_abandon_phone").on(table.phone),
  index("idx_abandon_created").on(table.createdAt),
  index("idx_abandon_recovered").on(table.recovered),
]);

/**
 * Payment records for Stripe payment links.
 */
export const payments = mysqlTable("payments", {
  id: int("id").primaryKey().autoincrement(),
  customerId: int("customer_id").references(() => customers.id, { onDelete: "set null" }),
  customerPhone: varchar("customer_phone", { length: 20 }),
  customerName: varchar("customer_name", { length: 200 }),
  amount: int("amount").notNull(), // cents
  description: varchar("description", { length: 500 }),
  stripePaymentLinkId: varchar("stripe_payment_link_id", { length: 255 }),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  invoiceId: int("invoice_id").references(() => invoices.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_pay_customer").on(table.customerId),
  index("idx_pay_status").on(table.status),
  index("idx_pay_stripe").on(table.stripePaymentIntentId),
  index("idx_pay_created").on(table.createdAt),
]);

/**
 * Server + client error log persistence.
 */
export const errorLog = mysqlTable("error_log", {
  id: int("id").primaryKey().autoincrement(),
  source: varchar("source", { length: 20 }).notNull(), // client, server
  message: text("message").notNull(),
  stack: text("stack"),
  url: varchar("url", { length: 500 }),
  userAgent: varchar("user_agent", { length: 500 }),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_error_source").on(table.source),
  index("idx_error_created").on(table.createdAt),
]);

/**
 * Appointment reminder delivery tracking.
 */
export const appointmentReminders = mysqlTable("appointment_reminders", {
  id: int("id").primaryKey().autoincrement(),
  bookingId: int("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 30 }).notNull(), // 24h-before, 1h-before, thank-you, review-request, maintenance-reminder
  scheduledFor: timestamp("scheduled_for"), // When this reminder should actually fire
  sentAt: timestamp("sent_at"),
  smsSid: varchar("sms_sid", { length: 100 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_remind_booking").on(table.bookingId),
  index("idx_remind_type").on(table.type),
  index("idx_remind_status").on(table.status),
  index("idx_remind_scheduled").on(table.scheduledFor),
]);

// ═══════════════════════════════════════════════════════
// BACKEND-5: Core Business Tables
// ═══════════════════════════════════════════════════════

// customers table already defined earlier in this file (line ~761)
// Removed duplicate definition to prevent esbuild errors

/**
 * Vehicles — linked to customers
 */
export const vehicles = mysqlTable("vehicles", {
  id: varchar("id", { length: 36 }).primaryKey(),
  customerId: int("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  year: int("year"),
  make: varchar("make", { length: 50 }),
  model: varchar("model", { length: 50 }),
  trim: varchar("trim_level", { length: 50 }),
  vin: varchar("vin", { length: 17 }),
  licensePlate: varchar("license_plate", { length: 20 }),
  color: varchar("color", { length: 30 }),
  mileage: int("mileage"),
  mileageUpdatedAt: timestamp("mileage_updated_at"),
  tireSize: varchar("tire_size", { length: 30 }),
  engine: varchar("engine", { length: 50 }),
  transmission: varchar("transmission", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_veh_customer").on(table.customerId),
  index("idx_veh_vin").on(table.vin),
]);

/**
 * Work Orders / Repair Orders
 */
export const workOrders = mysqlTable("work_orders", {
  id: varchar("id", { length: 36 }).primaryKey(),
  orderNumber: varchar("order_number", { length: 20 }).notNull(),
  /** DB-level FK fk_work_orders_customer · ON DELETE SET NULL (nullable link). */
  customerId: int("customer_id").references(() => customers.id, { onDelete: "set null" }),
  vehicleId: varchar("vehicle_id", { length: 36 }),
  /** Full lifecycle status */
  status: varchar("status", { length: 30 }).default("draft").notNull(),
  priority: varchar("priority", { length: 10 }).default("normal").notNull(),
  assignedBay: varchar("assigned_bay", { length: 10 }),
  assignedTech: varchar("assigned_tech", { length: 100 }),
  assignedTechId: int("assigned_tech_id"),
  assignedAdvisor: varchar("assigned_advisor", { length: 100 }),
  diagnosis: text("diagnosis"),
  customerComplaint: text("customer_complaint"),
  internalNotes: text("internal_notes"),
  techNotes: text("tech_notes"),
  /** Vehicle info (denormalized for quick display) */
  vehicleYear: int("vehicle_year"),
  vehicleMake: varchar("vehicle_make", { length: 50 }),
  vehicleModel: varchar("vehicle_model", { length: 50 }),
  vehicleVin: varchar("vehicle_vin", { length: 20 }),
  vehicleMileage: int("vehicle_mileage"),
  /** Blocker tracking */
  blockerType: varchar("blocker_type", { length: 30 }),
  blockerNote: text("blocker_note"),
  blockerSince: timestamp("blocker_since"),
  /** Lifecycle timestamps */
  promisedAt: timestamp("promised_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  pickedUpAt: timestamp("picked_up_at"),
  estimatedCompletion: timestamp("estimated_completion"),
  actualCompletion: timestamp("actual_completion"),
  /** Financial */
  quotedTotal: decimal("quoted_total", { precision: 10, scale: 2 }).default("0"),
  partsCost: decimal("parts_cost", { precision: 10, scale: 2 }).default("0"),
  laborCost: decimal("labor_cost", { precision: 10, scale: 2 }).default("0"),
  tax: decimal("tax", { precision: 10, scale: 2 }).default("0"),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0"),
  paymentMethod: varchar("payment_method", { length: 50 }),
  paymentStatus: varchar("payment_status", { length: 20 }).default("unpaid").notNull(),
  financingUsed: boolean("financing_used").default(false),
  financingProvider: varchar("financing_provider", { length: 50 }),
  warrantyMonths: int("warranty_months").default(0),
  warrantyMiles: int("warranty_miles").default(0),
  warrantyExpiresAt: timestamp("warranty_expires_at"),
  /** Links */
  source: varchar("source", { length: 50 }),
  bookingId: int("booking_id"),
  estimateId: int("estimate_id"),
  inspectionId: int("inspection_id"),
  /** Declined work tracking */
  hasDeclinedWork: boolean("has_declined_work").default(false),
  declinedWorkJson: json("declined_work_json"),
  /** Service summary */
  serviceDescription: text("service_description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wo_customer").on(table.customerId),
  index("idx_wo_status").on(table.status),
  index("idx_wo_created").on(table.createdAt),
  index("idx_wo_order_num").on(table.orderNumber),
]);

/**
 * Work Order Line Items — parts, labor, tires, fees
 */
export const workOrderItems = mysqlTable("work_order_items", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workOrderId: varchar("work_order_id", { length: 36 }).notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull(), // 'labor' | 'part' | 'tire' | 'fee' | 'sublet'
  description: varchar("description", { length: 500 }).notNull(),
  partNumber: varchar("part_number", { length: 50 }),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).default("1"),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).default("0"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0"),
  techName: varchar("tech_name", { length: 100 }),
  laborHours: decimal("labor_hours", { precision: 5, scale: 2 }),
  laborRate: decimal("labor_rate", { precision: 8, scale: 2 }),
  laborSource: varchar("labor_source", { length: 20 }), // 'vendor' | 'manual' | 'guide'
  warrantyCovered: boolean("warranty_covered").default(false),
  notes: text("notes"),
  /** Parts pipeline tracking */
  partStatus: varchar("part_status", { length: 20 }).default("not_needed"), // 'not_needed' | 'needed' | 'ordered' | 'received' | 'installed'
  partOrderedAt: timestamp("part_ordered_at"),
  partReceivedAt: timestamp("part_received_at"),
  partEta: timestamp("part_eta"),
  supplierName: varchar("supplier_name", { length: 100 }),
  supplierOrderRef: varchar("supplier_order_ref", { length: 50 }),
  partSource: varchar("part_source", { length: 30 }), // 'gateway' | 'manual' | 'in_stock' | 'supplier'
  /** Approval tracking */
  approved: boolean("approved").default(true),
  declined: boolean("declined").default(false),
  declineReason: varchar("decline_reason", { length: 100 }),
  /** Declined-line recovery outreach (while line may still be declined) */
  declineOutreachAt: timestamp("decline_outreach_at"),
  declineOutreachMethod: varchar("decline_outreach_method", { length: 64 }),
  declineOutreachNotes: text("decline_outreach_notes"),
  /** When customer approved the line (converted from declined) */
  declineRecoveredAt: timestamp("decline_recovered_at"),
  completed: boolean("completed").default(false),
  /** Urgency from inspection */
  urgency: varchar("urgency", { length: 20 }), // 'safety_now' | 'needs_soon' | 'monitor'
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_woi_work_order").on(table.workOrderId),
]);

/**
 * Work Order Status Transitions — audit trail for every status change
 */
export const workOrderTransitions = mysqlTable("work_order_transitions", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: varchar("work_order_id", { length: 36 }).notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  changedBy: varchar("changed_by", { length: 100 }),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wot_work_order").on(table.workOrderId),
]);

/**
 * Tire registrations — each installed tire's TIN (DOT code) and how 49 CFR 574.8 was met.
 * One row per tire position on a work order (migration 0130, hand-applied). No FK on purpose:
 * the compliance record must outlive a deleted work order. Values validated in shared/tireTin.ts.
 */
export const tireRegistrations = mysqlTable("tire_registrations", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: varchar("work_order_id", { length: 36 }).notNull(),
  /** Base positions LF/RF/LR/RR/LRI/RRI/SPARE, plus EXTRA1..EXTRA999 when an order contains more tires. */
  position: varchar("position", { length: 8 }).notNull(),
  /** Normalized TIN; null = position reserved, TIN not captured yet */
  tin: varchar("tin", { length: 20 }),
  /** valid | legacy_date_code | invalid */
  tinStatus: varchar("tin_status", { length: 32 }),
  tinWeek: int("tin_week"),
  tinYear: int("tin_year"),
  tireBrand: varchar("tire_brand", { length: 100 }),
  /** new | used — 574.8 covers new tires only */
  tireCondition: varchar("tire_condition", { length: 8 }).default("new").notNull(),
  /** pending | form_given | dealer_submitted_paper | dealer_submitted_electronic | not_required_used */
  registrationMethod: varchar("registration_method", { length: 32 }).default("pending").notNull(),
  registeredAt: timestamp("registered_at"),
  registeredBy: varchar("registered_by", { length: 100 }),
  capturedBy: varchar("captured_by", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_tire_reg_wo_position").on(table.workOrderId, table.position),
  index("idx_tire_reg_tin").on(table.tin),
]);

export type TireRegistration = typeof tireRegistrations.$inferSelect;

/**
 * Specials / Promotions
 */
export const specials = mysqlTable("specials", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  discountType: varchar("discount_type", { length: 20 }).notNull(),
  discountValue: decimal("discount_value", { precision: 10, scale: 2 }),
  serviceCategory: varchar("service_category", { length: 100 }),
  conditions: text("conditions"),
  couponCode: varchar("coupon_code", { length: 50 }),
  startsAt: timestamp("starts_at").notNull(),
  expiresAt: timestamp("expires_at"),
  maxUses: int("max_uses"),
  currentUses: int("current_uses").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  displayOnWebsite: boolean("display_on_website").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_special_active").on(table.isActive, table.startsAt, table.expiresAt),
  index("idx_special_code").on(table.couponCode),
]);

/**
 * Warranties — tracks service warranties for follow-up
 */
export const warranties = mysqlTable("warranties", {
  id: varchar("id", { length: 36 }).primaryKey(),
  workOrderId: varchar("work_order_id", { length: 36 }).notNull().references(() => workOrders.id, { onDelete: "restrict" }),
  customerId: int("customer_id").references(() => customers.id, { onDelete: "set null" }),
  vehicleId: varchar("vehicle_id", { length: 36 }),
  serviceDescription: varchar("service_description", { length: 500 }),
  warrantyMonths: int("warranty_months").notNull(),
  warrantyMiles: int("warranty_miles"),
  startsAt: date("starts_at").notNull(),
  expiresAt: date("expires_at").notNull(),
  mileageAtService: int("mileage_at_service"),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  reminderSent: boolean("reminder_sent").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_warr_customer").on(table.customerId),
  index("idx_warr_expires").on(table.expiresAt),
  index("idx_warr_status").on(table.status),
]);

/**
 * Inventory — basic parts and tire tracking
 */
export const inventory = mysqlTable("inventory", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sku: varchar("sku", { length: 50 }),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 30 }).notNull(),
  brand: varchar("brand", { length: 100 }),
  size: varchar("size", { length: 50 }),
  quantityOnHand: int("quantity_on_hand").default(0).notNull(),
  quantityReserved: int("quantity_reserved").default(0).notNull(),
  reorderThreshold: int("reorder_threshold").default(2).notNull(),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  retailPrice: decimal("retail_price", { precision: 10, scale: 2 }),
  supplier: varchar("supplier", { length: 100 }),
  supplierPartNumber: varchar("supplier_part_number", { length: 100 }),
  location: varchar("location", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_inv_sku").on(table.sku),
  index("idx_inv_category").on(table.category),
  index("idx_inv_low_stock").on(table.quantityOnHand, table.reorderThreshold),
]);

/**
 * Referrals — tracks customer referral program
 */
// referrals table already defined earlier in this file (line ~283)
// Removed duplicate definition to prevent esbuild errors

/**
 * Waitlist — when shop is fully booked
 */
export const waitlist = mysqlTable("waitlist", {
  id: varchar("id", { length: 36 }).primaryKey(),
  customerName: varchar("customer_name", { length: 200 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
  customerEmail: varchar("customer_email", { length: 255 }),
  serviceType: varchar("service_type", { length: 100 }),
  preferredDate: date("preferred_date"),
  notes: text("notes"),
  status: varchar("status", { length: 20 }).default("waiting").notNull(),
  notifiedAt: timestamp("notified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wait_status").on(table.status),
]);

/**
 * Cron Job Log — tracks execution of scheduled jobs
 */
export const cronLog = mysqlTable("cron_log", {
  id: varchar("id", { length: 36 }).primaryKey(),
  jobName: varchar("job_name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  durationMs: int("duration_ms"),
  recordsProcessed: int("records_processed").default(0),
  details: text("details"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_cron_job").on(table.jobName),
  index("idx_cron_started").on(table.startedAt),
]);

/**
 * wave-168 · Cron Locks — race-safe job orchestration across dyno restart.
 *
 * The in-memory job.running flag in server/cron/index.ts protects against
 * overlap within a single Node process but does nothing when Railway
 * restarts the dyno mid-cron — the new process starts with running=false
 * and immediately fires duplicate work on top of the dying dyno's still-
 * in-flight jobs. Customers receive duplicate SMS in the worst case.
 *
 * The lock acquire pattern uses MySQL's "INSERT ... ON DUPLICATE KEY UPDATE"
 * with a token-comparison check so it stays race-safe under concurrent
 * acquire attempts from multiple processes:
 *   1. caller generates a UUID lockToken
 *   2. INSERT (name, lockToken, lockedUntil) ON DUPLICATE KEY UPDATE
 *      SET lockToken = IF(lockedUntil < NOW(), VALUES(lockToken), lockToken),
 *          lockedUntil = IF(lockedUntil < NOW(), VALUES(lockedUntil), lockedUntil)
 *   3. SELECT lockToken WHERE name = ? — if it matches our token, we own
 *      the lock; if not, somebody else has it
 *   4. on completion, DELETE WHERE name = ? AND lockToken = ?
 *
 * The lockedUntil acts as a self-healing TTL: if a dyno crashes without
 * releasing, the next acquire after expiry takes over cleanly.
 */
export const cronLocks = mysqlTable("cron_locks", {
  /** Job name (matches CronJob.name in server/cron/index.ts) */
  name: varchar("name", { length: 100 }).primaryKey(),
  /** UUID token identifying which acquire attempt owns the lock */
  lockToken: varchar("lock_token", { length: 36 }).notNull(),
  /** Hostname or dyno-id of the holder (debug only) */
  holder: varchar("holder", { length: 100 }).notNull(),
  /** When this lock was acquired */
  lockedAt: timestamp("locked_at").defaultNow().notNull(),
  /** When this lock auto-expires (typically lockedAt + 2 * job max duration) */
  lockedUntil: timestamp("locked_until").notNull(),
});

/**
 * OTP Brute-Force Attempts — wave-181.59 · durable replacement for the
 * prior in-memory Map in server/middleware/bruteForce.ts. One row per
 * phone, atomic INSERT ... ON DUPLICATE KEY UPDATE keeps the counter
 * race-safe across multiple Railway pods and Node restarts.
 *
 * Semantics: 5 failed attempts inside a 15-minute window triggers a
 * 1-hour lockout. Rows >2h old with no active block are pruned by the
 * cleanup cron (server/cron/jobs/cleanup.ts).
 *
 * Mirror of drizzle/0040_wave181_otp_attempts_durable.sql — schema
 * MUST match the migration so drizzle-kit doesn't try to drop the table.
 */
export const otpAttempts = mysqlTable("otp_attempts", {
  /** Last-10 digits of the phone (E.164 stripped). Primary key. */
  phone: varchar("phone", { length: 30 }).primaryKey(),
  /** Failed-attempt count in the current rolling window */
  attemptCount: int("attempt_count").default(0).notNull(),
  /** Start of the current 15-minute attempt window */
  windowStartedAt: timestamp("window_started_at").defaultNow().notNull(),
  /** If set + in the future, all attempts are denied until this time */
  blockedUntil: timestamp("blocked_until"),
  /** Row touched timestamp — used by cleanup cron for stale pruning */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * SMS Daily Rate Limit — wave-181.66 · durable replacement for the prior
 * in-memory smsCountMap in server/sms.ts. Sister bug to [[otpAttempts]] —
 * the in-memory Map reset on every Railway redeploy (customers could
 * receive 8 → restart → 8 more) and split counts across pods (effective
 * cap was N× the intended ceiling).
 *
 * One row per phone, atomic INSERT ... ON DUPLICATE KEY UPDATE keeps the
 * counter race-safe across multiple Railway pods and Node restarts.
 *
 * Semantics: MAX_SMS_PER_PHONE_PER_DAY sends per rolling 24h window
 * (constant lives in sms.ts so ops can tweak it without a migration).
 * Rows >25h old are pruned by the cleanup cron (server/cron/jobs/cleanup.ts).
 *
 * Mirror of drizzle/0043_wave181_sms_rate_limit_durable.sql — schema
 * MUST match the migration so drizzle-kit doesn't try to drop the table.
 */
export const smsRateLimit = mysqlTable("sms_rate_limit", {
  /** Last-10 digits of the phone (E.164 stripped). Primary key. */
  phone: varchar("phone", { length: 30 }).primaryKey(),
  /** Sends counted in the current rolling 24h window */
  count24h: int("count_24h").default(0).notNull(),
  /** Start of the current 24h window — rolls forward when stale */
  windowStartedAt: timestamp("window_started_at").defaultNow().notNull(),
  /** Wall-clock time of the most recent send (operationally useful for diagnostics) */
  lastSentAt: timestamp("last_sent_at").defaultNow().notNull(),
  /** Row touched timestamp — used by cleanup cron for stale pruning */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Cron Tier Skip State — wave-181.83 · durable replacement for the
 * `tierSkipCounts = new Map<string, number>()` module-level state in
 * server/cron/scheduler.ts. Pre-fix · pod restart during a chronic
 * overrun cleared the counter so the alert that should fire on the
 * 2nd consecutive skip never fired. Multi-pod safe · all pods read
 * + write the same row. Mirror of drizzle/0047.
 */
/**
 * Confirmation Calls — wave-181.84 · per-booking AgentPhone call tracking.
 *
 * One row per attempt. The cron creates a row on each call · the webhook
 * handler at /api/webhooks/agentphone updates it when the call ends.
 * Admin UI shows no_answer + rescheduled rows for operator triage.
 *
 * Mirror of drizzle/0048.
 */
export const confirmationCalls = mysqlTable("confirmation_calls", {
  id: int("id").autoincrement().primaryKey(),
  /** Foreign key to bookings.id (no FK constraint · soft join) */
  bookingId: int("booking_id").notNull(),
  /** When the cron initiated the call (NOT when answered) */
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
  /** When the call finished · NULL if still in-progress or pending */
  completedAt: timestamp("completed_at"),
  /** AgentPhone's call ID · joined back via webhook events */
  agentphoneCallId: varchar("agentphone_call_id", { length: 64 }),
  /** Lifecycle status */
  status: mysqlEnum("status", ["pending", "dialing", "confirmed", "rescheduled", "no_answer", "failed"]).default("pending").notNull(),
  /** First 500 chars of the transcript · operator skim · NULL on no_answer */
  transcriptSnippet: text("transcript_snippet"),
  /** If customer asked to reschedule · their request text */
  rescheduleRequest: text("reschedule_request"),
  /** Failure reason · NULL on success */
  errorMessage: text("error_message"),
  updatedAt: timestamp("updated_at").defaultNow().notNull().onUpdateNow(),
});

export const cronTierSkipState = mysqlTable("cron_tier_skip_state", {
  /** Tier name from server/cron/scheduler.ts (e.g. "heartbeat", "pulse") */
  tierName: varchar("tier_name", { length: 50 }).primaryKey(),
  /** Consecutive skip count · resets to 0 on successful run */
  consecutiveSkips: int("consecutive_skips").default(0).notNull(),
  /** Timestamp of last skip · NULL if never skipped */
  lastSkipAt: timestamp("last_skip_at"),
  /** Timestamp of last successful run · NULL on cold start */
  lastRunAt: timestamp("last_run_at"),
  /** Row touched timestamp · informational only */
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Cron Alerts Fired — wave-181.69 · durable replacement for the
 * `let lastAlertDate: string | null` module-level dedup variable in
 * cron jobs that fire daily Telegram alerts (vapiLatencySync.ts and
 * any others added later). Pre-fix: pod restart cleared the variable
 * so today's alert could re-fire; multi-pod sent one copy per pod.
 *
 * Pattern: `INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for)
 * VALUES (?, CURDATE())`. affectedRows=1 means we won the claim (fire
 * the alert). affectedRows=0 means another pod (or this pod earlier)
 * already fired today — skip silently.
 *
 * Mirror of drizzle/0044_wave181_cron_alerts_fired.sql.
 */
export const cronAlertsFired = mysqlTable("cron_alerts_fired", {
  /** Logical alert identifier · e.g. "vapi_latency_breach" */
  alertKey: varchar("alert_key", { length: 100 }).notNull(),
  /** Date the alert was claimed for · part of the composite PK */
  firedFor: date("fired_for", { mode: "string" }).notNull(),
  /** Wall-clock time of the actual claim */
  firedAt: timestamp("fired_at").defaultNow().notNull(),
  /** Optional metadata · for debugging the alert content later */
  payload: text("payload"),
}, (table) => [
  // Sync to prod (0044): composite PK is the INSERT-IGNORE dedup claim key;
  // fired_at index serves the 90-day cleanup scan. (fired_for is DATE in prod.)
  primaryKey({ columns: [table.alertKey, table.firedFor] }),
  index("idx_cron_alerts_fired_fired_at").on(table.firedAt),
]);

/**
 * Wave metrics — wave-181.x · Tier A · Closed-loop delivery
 *
 * Records baseline + target measurement date for every shipped wave.
 * The daily measure-due cron reads pending rows past their measure_at,
 * resolves the current value via a named resolver, computes delta, and
 * marks lift / no-lift / regression. This is the feedback signal that
 * tells us which compounding loops actually compound.
 */
export const waveMetrics = mysqlTable("wave_metrics", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  waveId: varchar("wave_id", { length: 64 }).notNull(),
  metricKey: varchar("metric_key", { length: 64 }).notNull(),
  baselineValue: decimal("baseline_value", { precision: 12, scale: 4 }).notNull(),
  measureAt: timestamp("measure_at").notNull(),
  measuredValue: decimal("measured_value", { precision: 12, scale: 4 }),
  deltaPercent: decimal("delta_percent", { precision: 8, scale: 2 }),
  status: mysqlEnum("status", ["pending", "lifted", "no_lift", "regression", "resolver_error"]).notNull().default("pending"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  measuredAt: timestamp("measured_at"),
}, (t) => ({
  idxWaveMeasureAt: index("idx_wave_measure_at").on(t.status, t.measureAt),
  idxWaveId: index("idx_wave_id").on(t.waveId),
}));

/**
 * Competitor snapshots — wave-181.x · Tier S persistent storage for
 * the existing in-memory competitor monitor. Survives pod restarts so
 * change detection works across weeks, not just minutes within one
 * process lifetime. Indexed (place_id, captured_at DESC) so the
 * "previous snapshot" lookup is a single fast read.
 */
export const competitorSnapshots = mysqlTable("competitor_snapshots", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  competitorName: varchar("competitor_name", { length: 160 }).notNull(),
  placeId: varchar("place_id", { length: 128 }).notNull(),
  rating: decimal("rating", { precision: 3, scale: 2 }).notNull().default("0"),
  reviewCount: int("review_count").notNull().default(0),
  source: varchar("source", { length: 32 }).notNull().default("google_places"),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  rawPayload: json("raw_payload"),
}, (t) => ({
  idxCompetitorCaptured: index("idx_competitor_captured").on(t.placeId, t.capturedAt),
  idxCapturedAt: index("idx_captured_at").on(t.capturedAt),
}));

/**
 * Webhook Deliveries — retry queue for failed external API calls
 */
export const webhookDeliveries = mysqlTable("webhook_deliveries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  webhookName: varchar("webhook_name", { length: 100 }).notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  method: varchar("method", { length: 10 }).default("POST").notNull(),
  payload: json("payload").notNull(),
  responseStatus: int("response_status"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  attemptCount: int("attempt_count").default(0).notNull(),
  maxAttempts: int("max_attempts").default(5).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  nextRetryAt: timestamp("next_retry_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wh_status").on(table.status),
  index("idx_wh_next_retry").on(table.nextRetryAt),
]);

// ═══════════════════════════════════════════════════════
// LAYER 8: Security Tables
// ═══════════════════════════════════════════════════════

/**
 * OTP Codes — phone-based one-time password authentication
 */
export const otpCodes = mysqlTable("otp_codes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_otp_phone").on(table.phone),
  index("idx_otp_expires").on(table.expiresAt),
]);

/**
 * Audit Log — tracks all admin/system mutations
 */
export const auditLog = mysqlTable("audit_log", {
  id: varchar("id", { length: 36 }).primaryKey(),
  actor: varchar("actor", { length: 100 }).notNull(),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: varchar("entity_id", { length: 36 }),
  changes: json("changes"),
  ipAddress: varchar("ip_address", { length: 45 }),
  // 0110 (hand-apply required) — attributed activity-ledger columns. All
  // nullable/defaulted so pre-0110 writers and rows are untouched. Writers must
  // OMIT these keys unless they have values (services/auditTrail.ts does), so
  // inserts stay valid against a database that has not applied 0110 yet.
  /** 'human_user' | 'ai_agent' | 'nick_receptionist' | 'public' | 'system' — varchar, not enum: out-of-enum writes lose the row under STRICT_TRANS_TABLES */
  actorType: varchar("actor_type", { length: 24 }),
  beforeJson: json("before_json"),
  afterJson: json("after_json"),
  /** 'executed' | 'proposed' — a proposed row records intent, not a completed action */
  status: varchar("status", { length: 32 }).default("executed").notNull(),
  /** at-most-once claim key; DB unique index, never JSON_EXTRACT dedup (nour-os-query.ts:195 incident) */
  idempotencyKey: varchar("idempotency_key", { length: 191 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_actor").on(table.actor),
  index("idx_audit_entity").on(table.entityType, table.entityId),
  index("idx_audit_created").on(table.createdAt),
  uniqueIndex("uniq_audit_idem").on(table.idempotencyKey),
]);

/**
 * Admin Proposals — the generic approval queue (0111, hand-apply required).
 *
 * Every row is an INTENT, not an action: payload_json is validated against the
 * server-side executor registry in services/proposals.ts, and execution is
 * reachable ONLY through the CAS transition chain
 * draft/pending_review → approved → executing → executed. The five existing
 * domain approval lanes (IG studio, review_replies,
 * sms_learning_recommendations, revenue_opportunities, nickgpt_drafts) keep
 * their own tables and semantics — this one exists for NEW action classes
 * (Nick call extractions, one-tap admin actions) that must start as drafts.
 *
 * status is varchar, never enum (STRICT_TRANS_TABLES rejects out-of-enum
 * writes and loses the row — 0099's standing rule).
 */
export const adminProposals = mysqlTable("admin_proposals", {
  id: varchar("id", { length: 36 }).primaryKey(),
  /** 'nick_receptionist' | 'ai_agent' | 'human_user' | 'system' */
  source: varchar("source", { length: 24 }).notNull(),
  actor: varchar("actor", { length: 100 }).notNull(),
  /** Executor registry key (services/proposals.ts) — e.g. 'create_callback' */
  actionType: varchar("action_type", { length: 48 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: varchar("entity_id", { length: 64 }),
  title: varchar("title", { length: 255 }).notNull(),
  payloadJson: json("payload_json").notNull(),
  /** Provenance for the reviewer: call id, transcript/recording refs, extraction detail */
  contextJson: json("context_json"),
  /** Extraction confidence 0-100; null for human-originated proposals */
  confidence: int("confidence"),
  /** draft | pending_review | approved | executing | executed | failed | rejected */
  status: varchar("status", { length: 32 }).default("draft").notNull(),
  reviewedBy: varchar("reviewed_by", { length: 100 }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  executedAt: timestamp("executed_at"),
  executionResultJson: json("execution_result_json"),
  idempotencyKey: varchar("idempotency_key", { length: 191 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_proposals_idem").on(table.idempotencyKey),
  index("idx_proposals_status").on(table.status, table.createdAt),
  index("idx_proposals_entity").on(table.entityType, table.entityId),
]);

export type AdminProposal = typeof adminProposals.$inferSelect;
export type InsertAdminProposal = typeof adminProposals.$inferInsert;

/**
 * Service Affinity v2 closed-loop tables (2026-05-24).
 * Apply migration: drizzle/0061_service_affinity_v2.sql
 * Per docs/2026-05-24-service-affinity-v2.md §2.3 (CLOSED LOOP layer).
 *
 * The 4-table closed-loop chain:
 *   predictions → impressions → actions → outcomes
 *
 * Each prediction the v2 cron computes lands in `service_affinity_
 * predictions` (with ab_arm = treatment | control for the 50/50 hold-
 * out). When the prediction surfaces to the operator (roster · drawer ·
 * SMS queue), an impression row lands. When the operator acts (sms_sent
 * / dismissed / snoozed / called) an action row lands. When the
 * outcome resolves (booked within 14d? matched the predicted service?)
 * an outcome row lands. Weekly cron joins outcomes by ab_arm to compute
 * conversion lift · feeds the wave_metrics resolver.
 */
export const serviceAffinityPredictions = mysqlTable("service_affinity_predictions", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  // DB column is BIGINT (not int) — schema-drift fix 2026-07-07. This mismatch
  // is also why no FK to customers.id (int) is possible without a type change.
  customerId: bigint("customer_id", { mode: "number" }).notNull(),
  predictedService: varchar("predicted_service", { length: 64 }).notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(),
  featuresJson: json("features_json").notNull(),
  modelVersion: varchar("model_version", { length: 32 }).notNull(),
  abArm: mysqlEnum("ab_arm", ["treatment", "control"]).default("treatment").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_customer_created").on(t.customerId, t.createdAt),
  index("idx_model_created").on(t.modelVersion, t.createdAt),
  index("idx_ab_arm_created").on(t.abArm, t.createdAt),
]);

export const predictionImpressions = mysqlTable("prediction_impressions", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  predictionId: bigint("prediction_id", { mode: "number" }).notNull().references(() => serviceAffinityPredictions.id, { onDelete: "cascade" }),
  shownAt: timestamp("shown_at").defaultNow().notNull(),
  // Enforced at app layer: 'admin_roster' | 'customer_drawer' | 'sms_queue' | 'statenour_brain'
  surface: varchar("surface", { length: 64 }).notNull(),
  operatorId: varchar("operator_id", { length: 64 }),
}, (t) => [
  index("idx_prediction_shown").on(t.predictionId, t.shownAt),
]);

export const predictionActions = mysqlTable("prediction_actions", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  predictionId: bigint("prediction_id", { mode: "number" }).notNull().references(() => serviceAffinityPredictions.id, { onDelete: "cascade" }),
  // Enforced at app layer: 'sms_sent' | 'dismissed' | 'snoozed' | 'called' | 'modified'
  action: varchar("action", { length: 32 }).notNull(),
  actedAt: timestamp("acted_at").defaultNow().notNull(),
  operatorId: varchar("operator_id", { length: 64 }),
}, (t) => [
  index("idx_prediction_acted").on(t.predictionId, t.actedAt),
  index("idx_action_acted").on(t.action, t.actedAt),
]);

export const predictionOutcomes = mysqlTable("prediction_outcomes", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  predictionId: bigint("prediction_id", { mode: "number" }).notNull(),
  invoiceId: bigint("invoice_id", { mode: "number" }),
  matched: boolean("matched").notNull(),
  resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
  windowDays: int("window_days").notNull(),
}, (t) => [
  index("idx_prediction").on(t.predictionId),
  index("idx_resolved").on(t.resolvedAt),
]);

/**
 * Push Subscriptions — Web Push notification endpoints
 */
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  customerId: int("customer_id"),
  endpoint: text("endpoint").notNull(),
  p256dh: varchar("p256dh", { length: 255 }).notNull(),
  auth: varchar("auth_key", { length: 255 }).notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_push_customer").on(table.customerId),
  index("idx_push_admin").on(table.isAdmin),
]);

// ─── Feature Flags ──────────────────────────────────────
export const featureFlags = mysqlTable("feature_flags", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: boolean("value").default(false).notNull(),
  description: varchar("description", { length: 500 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_flag_key").on(table.key),
]);

// ─── App secret / token KV · 2026-05-31 ─────────────────
/**
 * Server-held secrets that must survive pod restarts — e.g. the minted,
 * never-expiring Meta Page access token. Keyed by a short string; value is
 * the raw secret as text. Read/written ONLY server-side; never returned to
 * any client surface.
 */
export const appSecretKv = mysqlTable("app_secret_kv", {
  k: varchar("k", { length: 64 }).primaryKey(),
  v: text("v").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Drip enrollments · promoted from inline DDL (2026-06-01) ───────────
// Phase-1 fix: was a "ghost table" created only via raw CREATE TABLE in
// server/services/dripProcessor.ts (ensureTable) + migration 0045 — alive in
// prod but invisible to Drizzle (no type-safety, no drizzle-kit visibility).
// This def restores both. Shape matches dripProcessor.ts:29 exactly.
// enrolledAt is DATETIME DEFAULT CURRENT_TIMESTAMP enforced by the DDL — not
// redeclared here (the processor inserts via raw SQL, never the Drizzle table).
export const dripEnrollments = mysqlTable("drip_enrollments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  campaignId: varchar("campaignId", { length: 50 }).notNull(),
  customerPhone: varchar("customerPhone", { length: 20 }).notNull(),
  customerName: varchar("customerName", { length: 100 }),
  currentStep: int("currentStep").default(0),
  status: mysqlEnum("status", ["active", "completed", "cancelled", "converted"]).default("active"),
  enrolledAt: datetime("enrolledAt"),
  nextStepAt: datetime("nextStepAt"),
  metadata: json("metadata"),
}, (table) => [
  index("idx_status_next").on(table.status, table.nextStepAt),
  index("idx_phone_campaign").on(table.customerPhone, table.campaignId),
  uniqueIndex("uq_drip_active").on(table.customerPhone, table.campaignId, table.status),
]);

// ─── DAILY EXECUTION TRACKING ───────────────────────────
/**
 * Daily execution log — one row per day for mission tracking and status.
 */
export const dailyExecution = mysqlTable("daily_execution", {
  id: int("id").primaryKey().autoincrement(),
  date: date("date").notNull(),
  mission: text("mission"),
  notes: text("notes"),
  status: mysqlEnum("status", ["on_track", "drifting", "off_track"]).default("on_track").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_daily_date").on(table.date),
]);

export type DailyExecution = typeof dailyExecution.$inferSelect;
export type InsertDailyExecution = typeof dailyExecution.$inferInsert;

/**
 * Daily habit tracking — one row per habit per day.
 */
export const dailyHabits = mysqlTable("daily_habits", {
  id: int("id").primaryKey().autoincrement(),
  date: date("date").notNull(),
  habitKey: varchar("habit_key", { length: 50 }).notNull(),
  completed: boolean("completed").default(false).notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_habit_date_key").on(table.date, table.habitKey),
]);

export type DailyHabit = typeof dailyHabits.$inferSelect;
export type InsertDailyHabit = typeof dailyHabits.$inferInsert;

// ─── SHOP BAYS ─────────────────────────────────────────
/**
 * Physical bays/lifts in the shop.
 * Tracks capabilities and current occupancy.
 */
export const bays = mysqlTable("bays", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 20 }).notNull(),
  type: varchar("type", { length: 30 }).notNull(), // full_service | tire_only | alignment | quick_lube | diagnostics
  capabilities: json("capabilities"), // string[]
  hasLift: boolean("has_lift").default(true),
  liftType: varchar("lift_type", { length: 30 }), // two_post | four_post | scissor | drive_on
  active: boolean("active").default(true),
  currentWorkOrderId: varchar("current_work_order_id", { length: 36 }),
  currentTechId: int("current_tech_id"),
  displayOrder: int("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Bay = typeof bays.$inferSelect;
export type InsertBay = typeof bays.$inferInsert;

// ─── QC CHECKLISTS ──────────────────────────────────────
/**
 * Quality control checklists — service-specific quality checks
 * before a vehicle can be released for pickup.
 */
export const qcChecklists = mysqlTable("qc_checklists", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: varchar("work_order_id", { length: 36 }).notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  completedBy: varchar("completed_by", { length: 100 }),
  reviewedBy: varchar("reviewed_by", { length: 100 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | in_progress | passed | failed | waived
  items: json("items"), // QCChecklistItem[]
  roadTestRequired: boolean("road_test_required").default(false),
  roadTestCompleted: boolean("road_test_completed").default(false),
  roadTestNotes: text("road_test_notes"),
  roadTestMileage: int("road_test_mileage"),
  failureReasons: json("failure_reasons"), // string[]
  correctiveActions: text("corrective_actions"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_qc_wo").on(table.workOrderId),
]);

export type QcChecklist = typeof qcChecklists.$inferSelect;
export type InsertQcChecklist = typeof qcChecklists.$inferInsert;

// ─── COMEBACKS / WARRANTY RETURNS ───────────────────────
/**
 * Tracks warranty returns and comebacks within 30 days.
 */
export const comebacks = mysqlTable("comebacks", {
  id: int("id").autoincrement().primaryKey(),
  originalWorkOrderId: varchar("original_work_order_id", { length: 36 }).notNull(),
  comebackWorkOrderId: varchar("comeback_work_order_id", { length: 36 }),
  customerId: int("customer_id"),
  serviceType: varchar("service_type", { length: 100 }),
  originalTechId: int("original_tech_id"),
  daysSinceOriginal: int("days_since_original"),
  type: varchar("type", { length: 20 }).notNull(), // comeback | warranty | related_issue | unrelated
  severity: varchar("severity", { length: 20 }), // minor | moderate | major | safety
  rootCause: varchar("root_cause", { length: 50 }), // part_failure | installation_error | missed_diagnosis | customer_misuse | unrelated | unknown
  description: text("description"),
  resolution: text("resolution"),
  costToShop: decimal("cost_to_shop", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_comeback_orig").on(table.originalWorkOrderId),
  index("idx_comeback_customer").on(table.customerId),
]);

export type Comeback = typeof comebacks.$inferSelect;
export type InsertComeback = typeof comebacks.$inferInsert;

// ─── CUSTOMER STATUS MESSAGES ───────────────────────────
/**
 * Log of all status messages sent to customers about their work orders.
 */
export const customerStatusMessages = mysqlTable("customer_status_messages", {
  id: int("id").autoincrement().primaryKey(),
  workOrderId: varchar("work_order_id", { length: 36 }).notNull(),
  customerId: int("customer_id"),
  trigger: varchar("trigger", { length: 30 }).notNull(), // status that triggered the message
  channel: varchar("channel", { length: 10 }).notNull(), // sms | email
  recipient: varchar("recipient", { length: 100 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 20 }).default("sent").notNull(), // sent | failed | skipped
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_csm_wo").on(table.workOrderId),
]);

// ─── CHAT ANALYTICS ──────────────────────────────────────
/**
 * Temporal pattern tracking for chat sessions.
 * Tracks when chats happen, conversion rates by time/day, and session duration.
 * Powers insights like "most chats convert on Monday mornings."
 */
export const chatAnalytics = mysqlTable("chat_analytics", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId"),
  hourOfDay: int("hourOfDay").notNull(), // 0-23
  dayOfWeek: int("dayOfWeek").notNull(), // 0=Sun, 6=Sat
  month: int("month").notNull(), // 1-12
  messageCount: int("messageCount").default(0).notNull(),
  converted: int("converted").default(0).notNull(),
  leadScore: int("leadScore"),
  duration: int("duration"), // seconds from first to last message
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_chat_analytics_hour").on(table.hourOfDay),
  index("idx_chat_analytics_day").on(table.dayOfWeek),
  index("idx_chat_analytics_month").on(table.month),
  index("idx_chat_analytics_session").on(table.sessionId),
]);

export type ChatAnalytic = typeof chatAnalytics.$inferSelect;
export type InsertChatAnalytic = typeof chatAnalytics.$inferInsert;

// ─── REVIEW PIPELINE ─────────────────────────────────────
/**
 * GBP review analysis pipeline — stores fetched reviews with AI sentiment
 * analysis and suggested responses for admin review.
 */
export const reviewPipeline = mysqlTable("review_pipeline", {
  id: int("id").autoincrement().primaryKey(),
  /** Google review author name */
  authorName: varchar("authorName", { length: 255 }).notNull(),
  /** Star rating 1-5 */
  rating: int("rating").notNull(),
  /** Full review text */
  reviewText: text("reviewText"),
  /** When the review was posted (epoch seconds from Google) */
  reviewTime: int("reviewTime"),
  /** Relative time string from Google (e.g. "2 weeks ago") */
  relativeTime: varchar("relativeTime", { length: 100 }),
  /** AI sentiment: positive, negative, neutral, mixed */
  sentiment: varchar("sentiment", { length: 20 }),
  /** AI-detected key topics (JSON string array) */
  topicsJson: text("topicsJson"),
  /** AI-detected keywords (JSON string array) */
  keywordsJson: text("keywordsJson"),
  /** AI-detected urgency: low, normal, high, critical */
  urgency: varchar("urgency", { length: 20 }),
  /** AI-suggested response text */
  suggestedResponse: text("suggestedResponse"),
  /** Triage status (default 'pending') */
  status: varchar("status", { length: 20 }).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** Whether admin has reviewed this entry */
  reviewed: int("reviewed").default(0).notNull(),
  /** Whether the suggested response was sent */
  responseSent: int("responseSent").default(0).notNull(),
}, (table) => [
  index("idx_review_pipeline_rating").on(table.rating),
  index("idx_review_pipeline_sentiment").on(table.sentiment),
  index("idx_review_pipeline_reviewed").on(table.reviewed),
]);

export type ReviewPipelineEntry = typeof reviewPipeline.$inferSelect;
export type InsertReviewPipelineEntry = typeof reviewPipeline.$inferInsert;

// ─── SEARCH PERFORMANCE ──────────────────────────────────
/**
 * Google Search Console data — query-level performance metrics.
 * Populated by the GSC data pipeline (daily or on-demand).
 */
export const searchPerformance = mysqlTable("search_performance", {
  id: int("id").autoincrement().primaryKey(),
  /** The search query string */
  query: varchar("query", { length: 500 }).notNull(),
  /** The page URL that appeared in search results */
  page: varchar("page", { length: 1000 }),
  /** Number of clicks */
  clicks: int("clicks").default(0).notNull(),
  /** Number of impressions */
  impressions: int("impressions").default(0).notNull(),
  /** Click-through rate (stored as percentage * 100, e.g. 5.5% = 550) */
  ctr: int("ctr").default(0).notNull(),
  /** Average position (stored * 100, e.g. 3.2 = 320) */
  position: int("position").default(0).notNull(),
  /** Date of the data point (YYYY-MM-DD) */
  date: date("date", { mode: "string" }).notNull(),
  /** Device type (e.g. desktop, mobile, tablet) */
  device: varchar("device", { length: 20 }).default("desktop").notNull(),
  /** Country code (e.g. usa) */
  country: varchar("country", { length: 10 }).default("usa").notNull(),
  /** Search type (e.g. web, discover) */
  searchType: varchar("searchType", { length: 20 }).default("web").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_search_perf_query").on(table.query),
  index("idx_search_perf_date").on(table.date),
  index("idx_search_perf_page").on(table.page),
  // 2026-06-16 · unique index including device, country, and searchType to avoid duplicates
  uniqueIndex("uq_search_perf_date_query_page_device_country_type").on(
    table.date,
    table.query,
    table.page,
    table.device,
    table.country,
    table.searchType
  ),
]);

// ─── PIPELINE RUNS ──────────────────────────────────────
/**
 * Tracks every pipeline execution — timing, status, results.
 * Used by the orchestrator for scheduling and dashboard health.
 */
export const pipelineRuns = mysqlTable("pipeline_runs", {
  id: int("id").autoincrement().primaryKey(),
  /** Pipeline identifier (e.g. "gbp-reviews", "gsc-data", "instagram") */
  pipelineName: varchar("pipelineName", { length: 50 }).notNull(),
  /** "running", "success", "error" */
  status: varchar("status", { length: 20 }).notNull(),
  /** Duration in milliseconds */
  durationMs: int("durationMs"),
  /** JSON blob of pipeline results */
  resultJson: text("resultJson"),
  /** Error message if failed. DB column is `error` (not `errorMessage`) — the
   *  field name stays errorMessage but maps to the real column, so
   *  orchestrator.ts's `.set({ errorMessage })` on failure no longer throws
   *  "Unknown column 'errorMessage'" (schema-drift fix, 2026-07-07). */
  errorMessage: text("error"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_pipeline_runs_name").on(table.pipelineName),
  index("idx_pipeline_runs_status").on(table.status),
  index("idx_pipeline_runs_started").on(table.startedAt),
]);

export type PipelineRun = typeof pipelineRuns.$inferSelect;

// ─── INSTAGRAM ANALYTICS ────────────────────────────────
/**
 * Instagram post-level analytics data for trend tracking.
 */
export const instagramAnalytics = mysqlTable("instagram_analytics", {
  id: int("id").autoincrement().primaryKey(),
  /** Instagram post ID */
  postId: varchar("postId", { length: 100 }).notNull(),
  postType: varchar("postType", { length: 30 }),
  caption: text("caption"),
  likes: int("likes").default(0).notNull(),
  comments: int("comments").default(0).notNull(),
  /** Engagement rate = (likes+comments) / followers at time of capture */
  engagementRate: int("engagementRate").default(0).notNull(),
  /** Stored as *10000, e.g. 3.5% = 350 */
  postedAt: varchar("postedAt", { length: 30 }),
  /** Day of week 0-6 */
  dayOfWeek: int("dayOfWeek"),
  /** Hour of day 0-23 */
  hourOfDay: int("hourOfDay"),
  /** AI-assigned content score 1-10 */
  contentScore: int("contentScore"),
  /** AI-detected content themes */
  themesJson: text("themesJson"),
  /** Follower count at time of snapshot */
  followerSnapshot: int("followerSnapshot"),
  /** Live Graph insights, refreshed each sync (nullable until first fetched). */
  reach: int("reach"),
  saved: int("saved"),
  /** `views` replaces Meta's deprecated `plays` metric. */
  views: int("views"),
  shares: int("shares"),
  /**
   * Graph `media_product_type` (e.g. REELS vs FEED) — `media_type` alone
   * returns VIDEO for a published reel, which misclassifies it (IG-037).
   * Nullable = not yet captured; DDL: drizzle/0106 (hand-applied).
   */
  mediaProductType: varchar("mediaProductType", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ig_analytics_post").on(table.postId),
  index("idx_ig_analytics_created").on(table.createdAt),
]);

export type InstagramAnalyticsRow = typeof instagramAnalytics.$inferSelect;

/**
 * Append-only per-sync metric snapshots (Wave C substrate): windowed 24h/7d/30d
 * comparisons need to know what a post's numbers WERE, and the analytics row
 * only knows what they ARE. One row per post per sync tick; never updated,
 * never deleted. DDL: drizzle/0106 (hand-applied via apply-0106-ig-insights).
 */
export const igMetricSnapshots = mysqlTable("ig_metric_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  postId: varchar("postId", { length: 100 }).notNull(),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
  likes: int("likes").default(0).notNull(),
  comments: int("comments").default(0).notNull(),
  reach: int("reach"),
  saved: int("saved"),
  views: int("views"),
  shares: int("shares"),
  followerSnapshot: int("followerSnapshot"),
  // 0108. MILLISECONDS, matching `ig_reels_avg_watch_time` from the Graph API —
  // stored in native units and named for it, because a silent ms->s conversion
  // is how a metric ends up wrong by 1000x with nothing to catch it.
  // NULL means NOT REPORTED and must never be read as zero: "nobody watched"
  // and "Instagram did not return this" are different facts, and these two
  // columns are what a DISCOVERY objective is actually scored on.
  avgWatchTimeMs: int("avg_watch_time_ms"),
  skipRate: decimal("skip_rate", { precision: 6, scale: 4 }),
}, (table) => [
  index("idx_ig_snap_post").on(table.postId),
  index("idx_ig_snap_captured").on(table.capturedAt),
]);

export type IgMetricSnapshotRow = typeof igMetricSnapshots.$inferSelect;

/**
 * Pattern Lab (Wave C′): the STRUCTURE of winning short-form references —
 * hook/pacing/caption/loop mechanics — captured as data, never content.
 * `patternJson` holds the full shared/reelPatterns.ts ReelPattern; the typed
 * columns exist for listing and future cohort joins (pattern × trial results).
 * DDL: drizzle/0107 (hand-applied via apply-0107-reel-patterns).
 */
export const socialReelPatterns = mysqlTable("social_reel_patterns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 80 }).notNull(),
  hookType: varchar("hookType", { length: 32 }).notNull(),
  loopType: varchar("loopType", { length: 32 }).notNull(),
  patternJson: text("patternJson").notNull(),
  timesUsed: int("timesUsed").default(0).notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_srp_created").on(table.createdAt),
]);

export type SocialReelPatternRow = typeof socialReelPatterns.$inferSelect;

// ─── REVIEW TREND SNAPSHOTS ─────────────────────────────
/**
 * Weekly snapshots of review health for trend tracking.
 */
export const reviewTrends = mysqlTable("review_trends", {
  id: int("id").autoincrement().primaryKey(),
  /** Snapshot date (YYYY-MM-DD) */
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  /** Average rating in this period (stored * 100, e.g. 4.7 = 470) */
  avgRating: int("avgRating").notNull(),
  /** Total reviews counted in this snapshot */
  totalReviews: int("totalReviews").notNull(),
  /** Count of 1-2 star reviews */
  negativeCount: int("negativeCount").default(0).notNull(),
  /** Count of 4-5 star reviews */
  positiveCount: int("positiveCount").default(0).notNull(),
  /** Top keywords from reviews (JSON array) */
  topKeywordsJson: text("topKeywordsJson"),
  /** Sentiment distribution (JSON: {positive, negative, neutral, mixed}) */
  sentimentDistJson: text("sentimentDistJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_review_trends_date").on(table.snapshotDate),
]);

// ─── GBP POST LOG ───────────────────────────────────────
/**
 * Sent-history log for Google Business Profile posts.
 * Replaces the in-memory variety guard (which lost state on every deploy)
 * with a durable table the generator reads from before picking the next
 * archetype. Lets us:
 *  - Avoid duplicate topics across consecutive posts
 *  - Audit what was sent and when
 *  - Track playbook ratio over time (proof should be ~50%, etc)
 *  - Flag drift (e.g. 3 anti-promise posts in a row)
 */
export const gbpPostLog = mysqlTable("gbp_post_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Post archetype: proof | anti | math | seasonal */
  archetype: varchar("archetype", { length: 20 }).notNull(),
  /** SHA-1 hash of post body for cross-post dedup (variety guard) */
  topicHash: varchar("topicHash", { length: 64 }).notNull(),
  /** Truncated body text (first 1500 chars — GBP post limit) */
  postBody: text("postBody").notNull(),
  /** CTA enum: BOOK | CALL | LEARN_MORE | ORDER */
  ctaType: varchar("ctaType", { length: 20 }).notNull(),
  /** Full CTA URL (with UTM params) */
  ctaUrl: varchar("ctaUrl", { length: 500 }).notNull(),
  /** Image hint string from generator */
  imageHint: text("imageHint"),
  /** Source: 'cron' (scheduled) or 'admin' (one-off button) */
  source: varchar("source", { length: 20 }).default("cron").notNull(),
  /** When the post was generated and queued for paste */
  postedAt: timestamp("postedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_gbp_post_log_posted").on(table.postedAt),
  index("idx_gbp_post_log_archetype").on(table.archetype),
  index("idx_gbp_post_log_topic").on(table.topicHash),
]);

export type GbpPostLogRow = typeof gbpPostLog.$inferSelect;
export type InsertGbpPostLog = typeof gbpPostLog.$inferInsert;

// ─── IG / FB AUTOPOST LOG ───────────────────────────────
/**
 * Durable log for the autonomous Instagram + Facebook poster
 * (server/services/igAutopost.ts). One row per run (dryrun, posted, failed,
 * or aborted). Backs three things: the anti-repetition guard (recent
 * conceptKeys fed to the generator), the once-per-slot-per-day dedupe, and
 * admin review of what the brain produced.
 *
 * Migration: drizzle/0065_ig_autopost_log.sql (hand-applied — no auto-migrate).
 */
export const igAutopostLog = mysqlTable("ig_autopost_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Content angle: proof | anti | math | seasonal | question | process */
  archetype: varchar("archetype", { length: 20 }).notNull(),
  /** Short kebab-case slug of the post's unique idea (anti-repetition guard) */
  conceptKey: varchar("conceptKey", { length: 64 }).notNull(),
  /** Slot label: morning | midday | evening | manual */
  slot: varchar("slot", { length: 16 }).default("manual").notNull(),
  /** ET calendar date (YYYY-MM-DD) the run fired — dedupes one post per slot/day */
  slotDate: varchar("slotDate", { length: 10 }).notNull(),
  /** Full eval payload (caption dims + image dim + overall) as JSON */
  evalScoresJson: text("evalScoresJson"),
  /** Weighted caption score *100 (e.g. 0.82 -> 82) for quick sorting */
  captionWeighted: int("captionWeighted"),
  /** Overall score *100 */
  overallScore: int("overallScore"),
  /** Outcome: dryrun | posted | failed | aborted */
  status: varchar("status", { length: 16 }).notNull(),
  /** Final composed caption (with hashtags) — IG limit is 2200 chars */
  caption: text("caption").notNull(),
  /** Space-joined hashtags (without # ) */
  hashtags: text("hashtags"),
  /** The art-direction prompt sent to the image generator */
  imagePrompt: text("imagePrompt"),
  /** Public JPEG url used for the post (null on abort/early-fail) */
  imageUrl: varchar("imageUrl", { length: 1000 }),
  /** Instagram media id when posted live */
  igPostId: varchar("igPostId", { length: 64 }),
  /** Facebook post id when posted live */
  fbPostId: varchar("fbPostId", { length: 64 }),
  /** Failure / abort reason */
  error: varchar("error", { length: 500 }),
  /** Trigger source: cron (scheduled) or admin (Fire Now button) */
  source: varchar("source", { length: 16 }).default("cron").notNull(),
  /** Gen + eval prompt version stamp (date string, e.g. "2026-06-20") · attribution #3 */
  promptVersion: varchar("promptVersion", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ig_autopost_created").on(table.createdAt),
  index("idx_ig_autopost_slot_day").on(table.slot, table.slotDate),
  index("idx_ig_autopost_status").on(table.status),
]);

export type IgAutopostLogRow = typeof igAutopostLog.$inferSelect;

/**
 * reel_jobs · durable status table for the Faceless Reel pipeline.
 * Enqueued by the admin; processed by the tiered cron's pulse tier (gated by
 * REEL_GENERATION_ENABLED) so minutes-long gen runs as a BACKGROUND job —
 * never a synchronous request, which dies on Railway's gateway timeout.
 * Migration: handleRunMigrations() in server/routers/nick/intelligence.ts.
 */
export const reelJobs = mysqlTable("reel_jobs", {
  id: int("id").autoincrement().primaryKey(),
  briefId: varchar("briefId", { length: 64 }).notNull(),
  /** Full ReelBrief as JSON (the generation input). */
  // MEDIUMTEXT (16MB), not TEXT (64KB): the Creative Compiler 2.0 prompt pack
  // repeats the locked visual-continuity invariants + continuity block per beat,
  // pushing the serialized brief past 64KB on richer briefs. A TEXT column threw
  // "Data too long" and intermittently failed enqueue (leaking a governor
  // reservation). Widened after the live-render drive hit it at ~70KB (job
  // 720002 chain). See drizzle/0090_reel_jobs_payload_mediumtext.sql.
  payload: mediumtext("payload").notNull(),
  /** Legacy execution status retained for compatibility with existing readers. */
  status: varchar("status", { length: 20 }).default("queued").notNull(),
  /** Stable episode identity and contract version. Added by 0113. */
  episodeId: varchar("episode_id", { length: 191 }),
  episodeVersion: varchar("episode_version", { length: 32 }),
  /** Database-enforced exactly-once enqueue key. Added by 0113. */
  idempotencyKey: varchar("idempotency_key", { length: 191 }),
  /** Explicit queue projection; null means a legacy row predating 0113. */
  queueState: varchar("queue_state", { length: 32 }),
  productionSlot: varchar("production_slot", { length: 16 }),
  productionReadyAt: timestamp("production_ready_at"),
  publicationScheduledAt: timestamp("publication_scheduled_at"),
  /**
   * Scheduling INTENT — "due to publish at T" (0118, applied 2026-09-07).
   *
   * Deliberately NOT the same field as `publicationScheduledAt` above, which is
   * stamped at the publish CAS in dailyReelPost and therefore means "publish
   * STARTED". Overloading that one would have made "intended" and "began"
   * indistinguishable after the fact.
   *
   * An approval's window says ALLOWED DURING; this says DUE AT. Intent lives on
   * the job because a job has one intent while approvals may be superseded.
   */
  publicationIntendedAt: timestamp("publication_intended_at"),
  /** JSON array of re-hosted source clip URLs, one per storyboard beat. */
  clipUrlsJson: text("clipUrlsJson"),
  voUrl: varchar("voUrl", { length: 1000 }),
  musicUrl: varchar("musicUrl", { length: 1000 }),
  /** Final assembled reel MP4 public URL. */
  mp4Url: varchar("mp4Url", { length: 1000 }),
  igPostId: varchar("igPostId", { length: 64 }),
  caption: text("caption"),
  attempts: int("attempts").default(0).notNull(),
  error: varchar("error", { length: 1000 }),
  /** Trigger source: admin | cron */
  source: varchar("source", { length: 16 }).default("admin").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_reel_jobs_status").on(table.status),
  index("idx_reel_jobs_created").on(table.createdAt),
  uniqueIndex("uniq_reel_jobs_episode_version").on(table.episodeId, table.episodeVersion),
  uniqueIndex("uniq_reel_jobs_idempotency").on(table.idempotencyKey),
  index("idx_reel_jobs_queue").on(table.queueState, table.productionSlot, table.createdAt),
]);

export type ReelJobRow = typeof reelJobs.$inferSelect;
export type InsertIgAutopostLog = typeof igAutopostLog.$inferInsert;

/**
 * Recorded human approval to publish one reel. Default-deny: the autonomous
 * publish door in cron/jobs/dailyReelPost.ts refuses any job without a live,
 * attributable row here whose caption_sha and video_url still match what is
 * about to go out. Migration: drizzle/0112_reel_publish_approvals.sql
 * (hand-applied — no auto-migrate). Decision logic: shared/reelApproval.ts.
 */
export const reelPublishApprovals = mysqlTable("reel_publish_approvals", {
  id: varchar("id", { length: 36 }).primaryKey(),
  reelJobId: int("reel_job_id").notNull(),
  /** sha256 of the EXACT caption bytes that were approved. */
  captionSha: varchar("caption_sha", { length: 64 }).notNull(),
  videoUrl: varchar("video_url", { length: 1000 }).notNull(),
  approvedBy: varchar("approved_by", { length: 100 }).notNull(),
  approvedAt: timestamp("approved_at").defaultNow().notNull(),
  /** TTL parity with social_content_approvals — a stale yes must not fire. */
  expiresAt: timestamp("expires_at"),
  /** A withdrawal, not a delete — the ledger keeps who took the yes back. */
  revokedAt: timestamp("revoked_at"),
  revokedBy: varchar("revoked_by", { length: 100 }),
  note: varchar("note", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  /**
   * DELIVERY ELIGIBILITY (0118, applied 2026-09-07). Declared only AFTER the
   * DDL was applied and reconciled — findLiveApproval reads with a bare
   * `db.select()`, so declaring a column production lacks makes that query name
   * a missing column, and it is wrapped in a catch returning null where null
   * means "not approved". The failure would have been invisible: every reel
   * silently held.
   *
   * When a window is present it GOVERNS and the rolling 72h `expiresAt` does not
   * apply — an explicit "publish between these dates" is a stronger, more
   * specific authorization than a freshness default. Both NULL on every
   * pre-0118 row, so behaviour is unchanged until a window is actually set.
   */
  publishWindowStart: timestamp("publish_window_start"),
  publishWindowEnd: timestamp("publish_window_end"),
  /**
   * sha256 of the asset BYTES as approved. `storagePut` writes to a
   * deterministic key (`reels/reel-<jobId>.mp4`), so a re-render or a selective
   * beat repair yields the SAME url with different content — the videoUrl
   * equality check passes while publishing a video nobody approved.
   */
  assetSha256: varchar("asset_sha256", { length: 64 }),
}, (table) => [
  index("idx_reel_approvals_job").on(table.reelJobId, table.revokedAt),
]);

export type ReelPublishApprovalRow = typeof reelPublishApprovals.$inferSelect;
export type InsertReelPublishApproval = typeof reelPublishApprovals.$inferInsert;

/**
 * Scheduled Instagram/Facebook posts — the publish-later queue. The
 * scheduled-posts cron fires due rows (status='pending' AND scheduledAt<=now)
 * through services/socialPublish. Migration: drizzle/0071_scheduled_posts.sql
 * (hand-applied — no auto-migrate).
 */
export const scheduledPosts = mysqlTable("scheduled_posts", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * Link back to the social_content_inventory row that owns this deferred
   * publish. Nullable — legacy rows and ad-hoc schedules have none. This link
   * is what lets reject cancel a pending schedule and lets the cron write the
   * fire-time outcome back onto the inventory row; without it a rejected item
   * still published and a failed fire left the queue saying "scheduled" forever.
   * Migration: drizzle/0096_scheduled_posts_inventory_id.sql (hand-applied).
   */
  inventoryId: varchar("inventoryId", { length: 64 }),
  platforms: json("platforms").$type<("facebook" | "instagram")[]>().notNull(),
  caption: text("caption").notNull(),
  imageUrl: varchar("imageUrl", { length: 1000 }),
  videoUrl: varchar("videoUrl", { length: 1000 }),
  imageUrls: json("imageUrls").$type<string[]>(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  /** pending | posted | failed | canceled */
  status: varchar("status", { length: 16 }).default("pending").notNull(),
  postedAt: timestamp("postedAt"),
  igPostId: varchar("igPostId", { length: 64 }),
  error: varchar("error", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_scheduled_due").on(table.status, table.scheduledAt),
  index("idx_scheduled_inventory").on(table.inventoryId),
]);
export type ScheduledPostRow = typeof scheduledPosts.$inferSelect;
export type InsertScheduledPost = typeof scheduledPosts.$inferInsert;

// ─── ALG PROBE LOG ──────────────────────────────────────
/**
 * Demand-driven ALG probe scheduler.
 *
 * Background: probing ShopDriver/ALG kicks the shop counter's live login
 * out of the system. The previous pulse-tier cron probed every 5 min when
 * any admin tab was open — this kept Moe getting kicked during normal
 * admin browsing.
 *
 * New model: probes only fire when:
 *   1. Nour just logged into /admin (real session-create event, not page refresh)
 *   2. Nick chat asks for fresh data (e.g. "what's our revenue today?")
 *   3. Admin clicks "Refresh from ALG" button
 *   4. Single overnight probe at 3 AM ET when shop is closed
 *
 * Every probe attempt writes a row here. Lets us:
 *   - Show admin a visible "last probed" timestamp + reason
 *   - 30-second dedup window (5 simultaneous chat calls = 1 probe)
 *   - Audit which trigger types are firing how often
 *   - Detect probe storms (30+ probes/hour = bug somewhere)
 */
export const algProbeLog = mysqlTable("alg_probe_log", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * Why the probe fired:
   *   admin_login | chat_query | manual_refresh | overnight | evening | health_check
   */
  reason: varchar("reason", { length: 32 }).notNull(),
  /** Optional sub-detail (chat session id, admin user id, etc) */
  detail: varchar("detail", { length: 200 }),
  /** Outcome: success | auth_failed | empty | dedup | error */
  outcome: varchar("outcome", { length: 32 }).notNull(),
  /** Records imported on this probe (invoices + customers + estimates) */
  recordsProcessed: int("recordsProcessed").default(0).notNull(),
  /** Probe duration in ms */
  durationMs: int("durationMs").default(0).notNull(),
  /** Error message if outcome != success */
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => [
  index("idx_alg_probe_log_started").on(table.startedAt),
  index("idx_alg_probe_log_reason").on(table.reason),
  index("idx_alg_probe_log_outcome").on(table.outcome),
]);

export type AlgProbeLogRow = typeof algProbeLog.$inferSelect;
export type InsertAlgProbeLog = typeof algProbeLog.$inferInsert;

// 📊 GENERIC CUSTOMER EVENT LOG
/**
 * Generic event log for customer-facing visual + interaction events
 * (PhotoRibbon photo views, sticky-CTA Hold-A-Bay clicks, scroll-depth
 * milestones, etc.). Pairs with the existing callEvents table — that
 * one is phone-only; this is everything else.
 *
 * Designed to be the single sink for client-side trackEvent() so the
 * admin dashboard can answer "which photo / CTA / surface gets the
 * most engagement on the customer-facing site?"
 *
 * Indexed on (eventName, createdAt) so per-event time-series rollups
 * are fast even at 10K+ events / day.
 */
export const customerEvents = mysqlTable("customer_events", {
  id: int("id").autoincrement().primaryKey(),
  /** Event name — kebab/snake/camel all OK; recommend snake_case (ribbon_photo_view) */
  eventName: varchar("eventName", { length: 64 }).notNull(),
  /** Free-form structured detail. Common keys: src, index, source, label */
  eventData: json("eventData"),
  /** Page where the event happened — pathname only, no querystring */
  sourcePage: varchar("sourcePage", { length: 500 }),
  /** UTM attribution at the moment of the event */
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  /** Referrer URL */
  referrer: varchar("referrer", { length: 500 }),
  /** User agent (truncated) for device-type analytics */
  userAgent: varchar("userAgent", { length: 500 }),
  /** Best-effort browser session id (set in localStorage) — not auth-bound */
  sessionId: varchar("sessionId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_customer_events_name_date").on(table.eventName, table.createdAt),
  index("idx_customer_events_date").on(table.createdAt),
  index("idx_customer_events_session").on(table.sessionId),
]);

export type CustomerEvent = typeof customerEvents.$inferSelect;
export type InsertCustomerEvent = typeof customerEvents.$inferInsert;

// ─── ABANDONED FORMS (durable partial-capture store) ────────────
//
// 2026-07-12 · Backs abandonedForms.ts's recovery-SMS pipeline. The
// service previously kept partials ONLY in an in-memory Map, so a
// Railway restart dropped every partial captured in the prior ~2h —
// their recovery SMS never fired. This table makes them durable. The
// Map stays as a synchronous write-through cache; this is the survive-
// restart copy. One row per browser session (sessionId PK), upserted on
// each blur beacon. recoveryAttempted gates the one-shot recovery send.
export const abandonedForms = mysqlTable("abandoned_forms", {
  sessionId: varchar("sessionId", { length: 64 }).primaryKey(),
  formType: varchar("formType", { length: 32 }).notNull(),
  name: varchar("name", { length: 200 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  service: varchar("service", { length: 300 }),
  pageUrl: varchar("pageUrl", { length: 300 }),
  recoveryAttempted: boolean("recoveryAttempted").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  // The recovery scan filters by (not attempted, age window) — this index
  // serves that predicate directly.
  index("idx_abandoned_recovery").on(table.recoveryAttempted, table.createdAt),
]);

export type AbandonedForm = typeof abandonedForms.$inferSelect;
export type InsertAbandonedForm = typeof abandonedForms.$inferInsert;

// ─── ROLE-BASED ACCESS CONTROL ──────────────────────────────────
//
// 2026-05-07 wave-59 · scaffold-only RBAC table. Created BEFORE the
// first second-user case arrives so the migration is cheap when needed.
// Per docs/SECURITY_AUDIT.md hardening opportunity #3:
//
//   "if the admin gains additional users with different roles
//   (manager / mechanic / accountant), the email allowlist won't
//   suffice. Designing the schema NOW even before implementing means
//   the migration is cheap when the first second-user case arrives."
//
// IMPORTANT: this table is created but NOT YET wired into auth checks.
// Current admin auth uses ALLOWED_EMAILS env var. When/if a second
// admin user is added, the auth flow can be extended to query this
// table for role-based permission gates without a schema migration.
//
// Roles defined for nickstire context:
//   "owner"      — Nour, full access
//   "manager"    — shop manager; access to ops/customers/dispatch
//                  but not financials/integrations
//   "mechanic"   — bay-floor staff; access to dispatch + their own
//                  customer notes only
//   "accountant" — financials + invoices; no customer ops
//   "viewer"     — read-only audit access
//
export const userRoles = mysqlTable("user_roles", {
  id: int("id").autoincrement().primaryKey(),
  /** FK to users.id (the auth user) */
  userId: int("user_id").notNull(),
  /** Role string — see comment above for the canonical set */
  role: varchar("role", { length: 32 }).notNull(),
  /** Optional grant-restriction note ("temp coverage 2026-06") */
  notes: varchar("notes", { length: 255 }),
  /** Who granted this role — accountability trail */
  grantedBy: int("granted_by"),
  /** When the role was granted */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  /** When the role expires (null = permanent) */
  expiresAt: timestamp("expires_at"),
}, (table) => [
  // Composite — one user can have multiple roles, but
  // (userId, role) should be unique so we don't grant the same
  // role twice
  uniqueIndex("user_roles_userId_role_uniq").on(table.userId, table.role),
  // Lookup by user (auth-flow query: "what roles does this user have?")
  index("user_roles_userId_idx").on(table.userId),
  // Audit query: "all users with role X"
  index("user_roles_role_idx").on(table.role),
]);

export type UserRole = typeof userRoles.$inferSelect;

// ─── voice_latency_events · wave-181.4 ──────────────────────────
// Per-VAPI-call STT/LLM/TTS latency telemetry. Migrated from
// statenour-os (was v10.0.527 Arc A F3) per the business-separation
// directive — VAPI is shop infrastructure, belongs on nickstire.
//
// Stages captured:
//   stt_start, stt_end, llm_start, llm_first_token, tts_start,
//   tts_first_byte, end_to_end
//
// Target: voice-agents skill ceiling is sub-800ms end-to-end; alert
// fires when 3 consecutive call-days exceed VOICE_LATENCY_TARGET_MS
// (500ms p50). See server/services/voice-latency.ts for the
// aggregation + breach-streak logic.
//
// FAIL-OPEN: every write in the service swallows DB errors so an
// un-applied migration never breaks a VAPI webhook in production.
export const voiceLatencyEvents = mysqlTable("voice_latency_events", {
  id: int("id").autoincrement().primaryKey(),
  /** VAPI call ID — uuid string */
  callId: varchar("call_id", { length: 64 }).notNull(),
  /** VAPI assistant ID — the receptionist or follow-up assistant */
  assistantId: varchar("assistant_id", { length: 64 }).notNull(),
  /** Stage enum · see service file for canonical list */
  stage: varchar("stage", { length: 32 }).notNull(),
  /** Latency in milliseconds */
  latencyMs: int("latency_ms").notNull(),
  /** Optional capture context (toolCalls, source, error_id, etc.) */
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // Cron uses (callId, stage) to dedupe events on replay
  index("voice_latency_events_call_stage_idx").on(table.callId, table.stage),
  // Drives P50/P95-by-stage rolling-window scan + breach-streak read
  index("voice_latency_events_created_at_idx").on(table.createdAt),
]);

export type VoiceLatencyEvent = typeof voiceLatencyEvents.$inferSelect;
export type InsertUserRole = typeof userRoles.$inferInsert;

/**
 * 2026-05-23 · paid-order alert backlog.
 *
 * Written when finalizeTireOrderPayment claims an order paid but BOTH
 * downstream notification channels (shop hand-off email + Telegram)
 * fail. Without this surface a dual-channel outage hid paid-but-
 * unfulfillable orders. Admin polls the unresolved rows to render a
 * Today-dashboard banner.
 *
 * Apply migration: drizzle/0052_payment_alert_backlog.sql
 */
export const paymentAlertBacklog = mysqlTable("payment_alert_backlog", {
  id: int("id").autoincrement().primaryKey(),
  tireOrderNumber: varchar("tireOrderNumber", { length: 64 }),
  invoiceNumber: varchar("invoiceNumber", { length: 64 }),
  amountCents: int("amountCents").notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  failureReason: mysqlEnum("failureReason", ["email_failed", "telegram_failed", "both_failed"]).notNull(),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: varchar("resolvedBy", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * 2026-05-23 · event-bus dead-letter queue.
 *
 * Persists subscriber failures so they survive Railway pod restart.
 * Pre-fix: 50-item in-memory array, cleared on restart, silently lost.
 * Apply migration: drizzle/0053_event_dlq_lifecycle.sql
 */
export const eventDlq = mysqlTable("event_dlq", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  destination: varchar("destination", { length: 64 }).notNull(),
  error: varchar("error", { length: 500 }).notNull(),
  payload: json("payload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  alertedAt: timestamp("alertedAt"),
});

/**
 * 2026-05-23 · customer lifecycle journey tracker.
 *
 * Replaces the in-memory Map<phone10, events[]> that didn't survive
 * Railway pod restart and couldn't share across multi-pod deploys.
 * Apply migration: drizzle/0053_event_dlq_lifecycle.sql
 */
export const lifecycleTrackerEvents = mysqlTable("lifecycle_tracker_events", {
  phone10: varchar("phone10", { length: 10 }).primaryKey(),
  customerName: varchar("customerName", { length: 255 }),
  // JSON array of { type: string; at: number }
  events: json("events").notNull(),
  convertedAt: timestamp("convertedAt"),
  firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
});

/**
 * wave-143 · Follow-up cadence touches (the flywheel). After a completed job,
 * the follow-up caller reaches out at 7 / 30 / 60 days — catch problems early,
 * ask for the referral, bring them back. ONE row per (booking, touch); the DB
 * carries a UNIQUE KEY (bookingId, touch) — the at-most-once guarantee that a
 * customer is NEVER called twice for the same touch, even across overlapping
 * cron runs (the cadence cron claims via INSERT and treats a dup-key as
 * "already done"). Created by handleRunMigrations() · run via the
 * nickActions.runMigrations admin tRPC.
 */
export const voiceFollowups = mysqlTable("voice_followups", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  touch: mysqlEnum("touch", ["d7", "d30", "d60"]).notNull(),
  phone: varchar("phone", { length: 30 }),
  customerName: varchar("customerName", { length: 255 }),
  status: mysqlEnum("status", ["called", "failed", "skipped"]).default("called").notNull(),
  vapiCallId: varchar("vapiCallId", { length: 64 }),
  errorMessage: varchar("errorMessage", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  // Sync to prod (handleRunMigrations inline DDL): the UNIQUE is the
  // at-most-once claim — one call per booking+touch, even across overlapping
  // cron runs (a dup INSERT throws and is treated as "already done").
  uniqueIndex("uniq_booking_touch").on(table.bookingId, table.touch),
  index("idx_followup_created").on(table.createdAt),
]);

/**
 * social_drafts · Stored briefs and drafts from the IG Carousel Studio and Faceless Reel Studio.
 * Allows DB-backed memory persistence.
 */
export const socialDrafts = mysqlTable("social_drafts", {
  id: varchar("id", { length: 64 }).primaryKey(), // e.g. ai-123456789
  contentType: varchar("contentType", { length: 16 }).notNull(), // carousel | reel
  topic: varchar("topic", { length: 255 }).notNull(),
  briefJson: text("briefJson").notNull(), // Stored JSON representation of the brief
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_social_drafts_type").on(table.contentType),
  index("idx_social_drafts_created").on(table.createdAt),
]);

export type SocialDraftRow = typeof socialDrafts.$inferSelect;
export type InsertSocialDraft = typeof socialDrafts.$inferInsert;

/**
 * customer_testimonials · Curated customer reviews and testimonials generated/validated by studios.
 */
export const customerTestimonials = mysqlTable("customer_testimonials", {
  id: int("id").autoincrement().primaryKey(),
  author: varchar("author", { length: 100 }),
  text: text("text").notNull(),
  rating: int("rating").default(5).notNull(),
  source: varchar("source", { length: 50 }).default("manual").notNull(), // manual | google | etc
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_testimonials_rating").on(table.rating),
]);

export type CustomerTestimonialRow = typeof customerTestimonials.$inferSelect;
export type InsertCustomerTestimonial = typeof customerTestimonials.$inferInsert;

export const nickgptDrafts = mysqlTable("nickgpt_drafts", {
  id: int("id").autoincrement().primaryKey(),
  customerPhone: varchar("customer_phone", { length: 30 }).notNull(),
  inboundMessage: text("inbound_message").notNull(),
  draftReply: text("draft_reply").notNull(),
  operatorReply: text("operator_reply"),
  intent: varchar("intent", { length: 100 }),
  confidence: float("confidence"),
  provider: varchar("provider", { length: 50 }).notNull(),
  latencyMs: int("latency_ms"),
  rating: mysqlEnum("rating", ["good", "bad"]),
  status: mysqlEnum("status", ["draft", "approved", "edited", "rejected"]).default("draft").notNull(),
  autoSent: boolean("auto_sent").default(false).notNull(),
  /** ROS-058: the decision context the drafter ACTUALLY used (conversation
   *  turns, customer facts, router decision, reply plan, provider) — copied
   *  into training examples so a fine-tune learns why, not just what. */
  contextJson: text("context_json"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_nickgpt_drafts_phone").on(table.customerPhone),
  index("idx_nickgpt_drafts_created").on(table.createdAt),
]);

export type NickgptDraft = typeof nickgptDrafts.$inferSelect;
export type InsertNickgptDraft = typeof nickgptDrafts.$inferInsert;

// ─── 0136: customer-contact holdout assignments ──────────────────────
// Q-21. This table records NO-CONTACT control assignment. Do not overload
// sms_orchestrations.isControl: that existing field describes copy/template
// experiment control inside a message that may still be sent.
export const contactExperimentAssignments = mysqlTable("contact_experiment_assignments", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  experimentId: varchar("experiment_id", { length: 120 }).notNull(),
  laneKey: varchar("lane_key", { length: 100 }).notNull(),
  subjectKey: varchar("subject_key", { length: 64 }).notNull(),
  armId: varchar("arm_id", { length: 16 }).notNull(),
  assignmentVersion: varchar("assignment_version", { length: 32 }).notNull(),
  sourceVariantKey: varchar("source_variant_key", { length: 100 }),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uk_contact_exp_subject").on(table.experimentId, table.subjectKey),
  index("idx_contact_exp_lane_arm_time").on(table.laneKey, table.armId, table.assignedAt),
  index("idx_contact_exp_assigned").on(table.assignedAt),
]);

export type ContactExperimentAssignment = typeof contactExperimentAssignments.$inferSelect;
export type InsertContactExperimentAssignment = typeof contactExperimentAssignments.$inferInsert;

export const smsOrchestrations = mysqlTable("sms_orchestrations", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 30 }).notNull(),
  messageBody: text("message_body").notNull(),
  variantKey: varchar("variant_key", { length: 50 }).notNull(),
  shouldAutoSend: boolean("should_auto_send").notNull(),
  requiresHumanApproval: boolean("requires_human_approval").notNull(),
  reason: text("reason"),
  customerContext: text("customer_context"), // JSON string
  providerUsed: varchar("provider_used", { length: 50 }).notNull(), // 'shop' | 'twilio' | 'none'
  cooldownKey: varchar("cooldown_key", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull(), // e.g. received, classified, compiled, drafted, approved, blocked, skipped, queued, sending, sent, delivered, failed, replied, expired, cancelled
  statusReason: text("status_reason"),
  deliveryStatus: varchar("delivery_status", { length: 50 }),
  deliveredAt: timestamp("delivered_at"),
  repliedAt: timestamp("replied_at"),
  failedAt: timestamp("failed_at"),
  sentAt: timestamp("sent_at"),
  queuedUntil: timestamp("queued_until"),
  failureReason: text("failure_reason"),
  sourceTable: varchar("source_table", { length: 100 }),
  sourceId: varchar("source_id", { length: 100 }),
  relatedConversationId: int("related_conversation_id"),
  relatedLeadId: int("related_lead_id"),
  relatedBookingId: int("related_booking_id"),
  relatedCallbackId: int("related_callback_id"),
  relatedVapiCallId: varchar("related_vapi_call_id", { length: 100 }),
  relatedEstimateId: varchar("related_estimate_id", { length: 100 }),
  sendResultJson: text("send_result_json"),
  metadataJson: text("metadata_json"),
  decisionTraceJson: text("decision_trace_json"),
  riskTier: varchar("risk_tier", { length: 50 }),
  humanReviewReason: text("human_review_reason"),
  noSendReason: text("no_send_reason"),
  selectedTemplateKey: varchar("selected_template_key", { length: 100 }),
  selectedVariantKey: varchar("selected_variant_key", { length: 100 }),
  templateVersion: varchar("template_version", { length: 50 }),
  experimentId: varchar("experiment_id", { length: 100 }),
  journeyId: varchar("journey_id", { length: 100 }),
  correlationId: varchar("correlation_id", { length: 100 }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  legacyComparisonJson: text("legacy_comparison_json"),
  shadowWouldSend: boolean("shadow_would_send"),
  shadowMessageBody: text("shadow_message_body"),
  legacyMessageBody: text("legacy_message_body"),
  variantAssignmentReason: text("variant_assignment_reason"),
  isControl: boolean("is_control"),
  trafficWeight: int("traffic_weight"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_sms_orch_phone").on(table.customerPhone),
  index("idx_sms_orch_created").on(table.createdAt),
  index("idx_sms_orch_event").on(table.eventType),
  index("idx_sms_orch_cooldown").on(table.cooldownKey),
  index("idx_sms_orch_correlation").on(table.correlationId),
  index("idx_sms_orch_idempotency").on(table.idempotencyKey),
]);

export type SmsOrchestration = typeof smsOrchestrations.$inferSelect;
export type InsertSmsOrchestration = typeof smsOrchestrations.$inferInsert;

export const smsOrchestrationOutcomes = mysqlTable("sms_orchestration_outcomes", {
  id: int("id").autoincrement().primaryKey(),
  orchestrationId: int("orchestration_id").notNull().references(() => smsOrchestrations.id, { onDelete: "cascade" }),
  outcomeType: varchar("outcome_type", { length: 100 }).notNull(),
  outcomeValue: text("outcome_value"),
  sourceTable: varchar("source_table", { length: 100 }),
  sourceId: varchar("source_id", { length: 100 }),
  metadataJson: text("metadata_json"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_sms_out_orch").on(table.orchestrationId),
  index("idx_sms_out_created").on(table.createdAt),
]);

export type SmsOrchestrationOutcome = typeof smsOrchestrationOutcomes.$inferSelect;
export type InsertSmsOrchestrationOutcome = typeof smsOrchestrationOutcomes.$inferInsert;

/**
 * sms_response_jobs — the durable inbound-response obligation spine (NCSOS #1/#2).
 * One row per inbound customer message: the durable promise that the AI will
 * produce a decision. Leaves the queue only by reaching a terminal status, so an
 * un-answered inbound survives a restart instead of being silently forgotten.
 * See server/services/smsResponseJobs.ts.
 */
export const smsResponseJobs = mysqlTable("sms_response_jobs", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  customerPhone: varchar("customerPhone", { length: 30 }).notNull(),
  /** Twilio MessageSid / gateway messageId — null when the provider sent none. */
  providerMsgId: varchar("providerMsgId", { length: 128 }),
  /** Deterministic dedup key so a provider redelivery maps to ONE job. */
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "responded", "suppressed", "failed", "dead", "human_pending", "human_replied", "no_reply_required"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  maxAttempts: int("maxAttempts").default(5).notNull(),
  /** SLA / backoff anchor — the sweep only claims rows whose dueAt has passed. */
  dueAt: timestamp("dueAt").defaultNow().notNull(),
  claimedAt: timestamp("claimedAt"),
  claimedBy: varchar("claimedBy", { length: 64 }),
  orchestrationId: int("orchestrationId"),
  lastError: varchar("lastError", { length: 1000 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_response_idem").on(table.idempotencyKey),
  index("idx_response_status_due").on(table.status, table.dueAt),
  index("idx_response_phone").on(table.customerPhone),
]);

export type SmsResponseJob = typeof smsResponseJobs.$inferSelect;
export type InsertSmsResponseJob = typeof smsResponseJobs.$inferInsert;

/**
 * business_facts — versioned business facts / approved-claims store (NCSOS #1/#2).
 * One active row per factKey (prices, warranty terms, policies) with the
 * provenance the blueprint requires: source, approver, effective + verified
 * dates, and the channels it may be used on. Operator-editable override for the
 * code-level SEED_FACTS. See server/services/businessFacts.ts.
 */
export const businessFacts = mysqlTable("business_facts", {
  id: int("id").autoincrement().primaryKey(),
  factKey: varchar("factKey", { length: 64 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  value: text("value").notNull(),
  source: varchar("source", { length: 255 }).notNull(),
  approvedBy: varchar("approvedBy", { length: 100 }).notNull(),
  effectiveDate: date("effectiveDate").notNull(),
  verifiedDate: date("verifiedDate").notNull(),
  channels: varchar("channels", { length: 255 }).default("sms,voice,web").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_fact_key").on(table.factKey),
  index("idx_fact_active").on(table.active),
]);

export type BusinessFactRow = typeof businessFacts.$inferSelect;
export type InsertBusinessFactRow = typeof businessFacts.$inferInsert;

/**
 * expected_arrivals — a durable "the customer said they're coming / dropping off"
 * record (NCSOS business-action-tools). The shop is FCFS drop-off-preferred, so
 * voice/SMS "I'll come by today" must NOT mint a booking (operator directive) or
 * a lead (sms-no-lead-noise) — but it IS a real operational signal the shop can
 * plan around and later reconcile to an arrival/paid invoice. Before this,
 * bookSlot/scheduleDropoff persisted nothing (agenticAuditor flagged "dropoff
 * promised but not persisted"). See server/services/expectedArrivals.ts.
 */
export const expectedArrivals = mysqlTable("expected_arrivals", {
  id: int("id").autoincrement().primaryKey(),
  customerName: varchar("customerName", { length: 255 }),
  customerPhone: varchar("customerPhone", { length: 30 }).notNull(),
  vehicle: varchar("vehicle", { length: 255 }),
  service: varchar("service", { length: 255 }),
  /** The day they said they'd come; defaults to today (drop-offs are same-day). */
  expectedDate: date("expectedDate").notNull(),
  /** Raw phrase for context ("this afternoon", "tomorrow morning"). */
  whenText: varchar("whenText", { length: 100 }),
  source: mysqlEnum("source", ["voice", "sms", "web", "manual"]).default("manual").notNull(),
  /** vapiCallId / orchestrationId / conversationId that produced this. */
  sourceRef: varchar("sourceRef", { length: 128 }),
  status: mysqlEnum("status", ["expected", "arrived", "no_show", "cancelled"]).default("expected").notNull(),
  arrivedAt: timestamp("arrivedAt"),
  /** The invoice that reconciled this arrival (arrival -> paid). */
  reconciledInvoiceId: int("reconciledInvoiceId"),
  note: varchar("note", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_ea_status_date").on(table.status, table.expectedDate),
  index("idx_ea_phone").on(table.customerPhone),
  /**
   * One invoice reconciles at most one arrival (0126). NULLs are unlimited under
   * a MySQL/TiDB UNIQUE index, so the many rows with no invoice are unaffected.
   * The reconcile used to stamp every eligible row with the same invoice, and
   * the weekly digest summed it once per row.
   */
  uniqueIndex("uq_ea_reconciled_invoice").on(table.reconciledInvoiceId),
]);

export type ExpectedArrival = typeof expectedArrivals.$inferSelect;
export type InsertExpectedArrival = typeof expectedArrivals.$inferInsert;

export const nickgptTrainingExamples = mysqlTable("nickgpt_training_examples", {
  id: int("id").autoincrement().primaryKey(),
  customerPhone: varchar("customer_phone", { length: 30 }).notNull(),
  inboundMessage: text("inbound_message").notNull(),
  conversationContextJson: text("conversation_context_json"),
  nickgptDraft: text("nickgpt_draft").notNull(),
  operatorFinalReply: text("operator_final_reply").notNull(),
  intent: varchar("intent", { length: 100 }),
  serviceMention: varchar("service_mention", { length: 100 }),
  rating: int("rating"),
  outcome: varchar("outcome", { length: 100 }),
  /** JSON array of edit categories (why the operator changed the draft) — the
   *  training-loop signal. Null when not an edit or classification unavailable. */
  editCategoriesJson: text("edit_categories_json"),
  approvedForTraining: boolean("approved_for_training").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ngpt_train_phone").on(table.customerPhone),
  index("idx_ngpt_train_created").on(table.createdAt),
]);

export type NickgptTrainingExample = typeof nickgptTrainingExamples.$inferSelect;
export type InsertNickgptTrainingExample = typeof nickgptTrainingExamples.$inferInsert;

export const smsLearningRecommendations = mysqlTable("sms_learning_recommendations", {
  id: int("id").autoincrement().primaryKey(),
  recommendationType: varchar("recommendation_type", { length: 100 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  currentVariantKey: varchar("current_variant_key", { length: 100 }).notNull(),
  proposedVariantKey: varchar("proposed_variant_key", { length: 100 }).notNull(),
  proposedMessage: text("proposed_message").notNull(),
  reason: text("reason").notNull(),
  supportingStatsJson: text("supporting_stats_json"),
  status: varchar("status", { length: 50 }).default("pending").notNull(), // 'pending' | 'approved' | 'rejected' | 'applied'
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by", { length: 100 }),
}, (table) => [
  index("idx_sms_rec_type").on(table.recommendationType),
  index("idx_sms_rec_status").on(table.status),
  index("idx_sms_rec_created").on(table.createdAt),
]);

export type SmsLearningRecommendation = typeof smsLearningRecommendations.$inferSelect;
export type InsertSmsLearningRecommendation = typeof smsLearningRecommendations.$inferInsert;

export const contentManufacturingCampaigns = mysqlTable("content_manufacturing_campaigns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  topic: varchar("topic", { length: 128 }).notNull(),
  persona: varchar("persona", { length: 64 }).notNull(),
  targetMonthlyVolume: int("target_monthly_volume").default(30).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_campaign_topic").on(table.topic),
]);

export type ContentManufacturingCampaign = typeof contentManufacturingCampaigns.$inferSelect;
export type InsertContentManufacturingCampaign = typeof contentManufacturingCampaigns.$inferInsert;

export const socialContentInventory = mysqlTable("social_content_inventory", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 }),
  contentType: mysqlEnum("content_type", ["reel", "carousel", "post", "story", "poll", "ad"]).notNull(),
  platform: mysqlEnum("platform", ["instagram", "facebook", "both"]).default("both").notNull(),
  topic: varchar("topic", { length: 128 }).notNull(),
  seriesName: varchar("series_name", { length: 128 }).notNull(),
  episodeNumber: int("episode_number").default(1).notNull(),
  hookCategory: varchar("hook_category", { length: 64 }).notNull(),
  hookText: text("hook_text").notNull(),
  bodyText: text("body_text").notNull(),
  visualStyle: varchar("visual_style", { length: 64 }).notNull(),
  persona: varchar("persona", { length: 64 }).notNull(),

  // Attention Scores
  scoreCuriosity: int("score_curiosity").default(0).notNull(),
  scoreEmotion: int("score_emotion").default(0).notNull(),
  scoreShareability: int("score_shareability").default(0).notNull(),
  scoreCommentPotential: int("score_comment_potential").default(0).notNull(),
  scoreSavePotential: int("score_save_potential").default(0).notNull(),
  scoreLocalRelevance: int("score_local_relevance").default(0).notNull(),
  scoreRevenueRelevance: int("score_revenue_relevance").default(0).notNull(),
  scoreAuthority: int("score_authority").default(0).notNull(),
  scoreHookStrength: int("score_hook_strength").default(0).notNull(),
  scoreOverall: int("score_overall").default(0).notNull(),

  // Asymmetric grounding fields
  gscQuerySeed: varchar("gsc_query_seed", { length: 255 }),
  weatherTriggerCondition: varchar("weather_trigger_condition", { length: 128 }),
  interactiveDmKeyword: varchar("interactive_dm_keyword", { length: 64 }),

  // Analytics & Performance Loopback (Self-Learning)
  metricsReach: int("metrics_reach").default(0),
  metricsEngagement: int("metrics_engagement").default(0),
  metricsShares: int("metrics_shares").default(0),
  metricsSaves: int("metrics_saves").default(0),
  metricsComments: int("metrics_comments").default(0),
  metricsBookingsAttributed: int("metrics_bookings_attributed").default(0),

  // Status & Lifecycle
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  assetPaths: json("asset_paths"),
  briefJson: text("brief_json"),
  errorMessage: varchar("error_message", { length: 500 }),
  version: int("version").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_sci_status_scheduled").on(table.status, table.scheduledAt),
  index("idx_sci_campaign").on(table.campaignId),
  index("idx_sci_topic_type").on(table.topic, table.contentType),
]);

/** Campaign genomes (Genome Wave 1 slice 3): the judged campaign roots +
 *  their creative fingerprints, so tournaments avoid repeating what already
 *  ran. DDL: drizzle/0085 (hand-apply via scripts/apply-0085-creative-genomes.mts).*/
export const creativeGenomes = mysqlTable("creative_genomes", {
  id: varchar("id", { length: 64 }).primaryKey(),
  objective: varchar("objective", { length: 32 }).notNull(),
  territory: varchar("territory", { length: 64 }).notNull(),
  campaignAsk: text("campaign_ask").notNull(),
  fingerprint: varchar("fingerprint", { length: 512 }).notNull(),
  genomeJson: text("genome_json").notNull(),
  source: varchar("source", { length: 32 }).notNull().default("direct"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const autonomyPolicyVersions = mysqlTable("autonomy_policy_versions", {
  id: int("id").autoincrement().primaryKey(),
  version: int("version").notNull(),
  policyJson: text("policy_json").notNull(),
  note: varchar("note", { length: 400 }).notNull().default(""),
  createdBy: varchar("created_by", { length: 120 }).notNull().default("operator"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const generationReservations = mysqlTable("generation_reservations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  actionId: varchar("action_id", { length: 64 }).notNull().unique(),
  campaignId: varchar("campaign_id", { length: 64 }),
  provider: varchar("provider", { length: 48 }).notNull(),
  model: varchar("model", { length: 64 }).notNull(),
  operation: varchar("operation", { length: 48 }).notNull(),
  estimatedCostUsd: decimal("estimated_cost_usd", { precision: 10, scale: 4 }).notNull(),
  actualCostUsd: decimal("actual_cost_usd", { precision: 10, scale: 4 }),
  isEstimate: boolean("is_estimate").notNull().default(true),
  status: varchar("status", { length: 16 }).notNull().default("reserved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
});

export const contentReservations = mysqlTable("content_reservations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 }),
  platform: varchar("platform", { length: 24 }).notNull(),
  format: varchar("format", { length: 24 }).notNull(),
  topic: varchar("topic", { length: 300 }),
  cta: varchar("cta", { length: 120 }),
  territory: varchar("territory", { length: 64 }),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  priority: int("priority").notNull().default(50),
  status: varchar("status", { length: 16 }).notNull().default("reserved"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const autonomyAuditEvents = mysqlTable("autonomy_audit_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  actionType: varchar("action_type", { length: 48 }).notNull(),
  decision: varchar("decision", { length: 24 }).notNull(),
  reasoningCodes: varchar("reasoning_codes", { length: 1024 }).notNull(),
  policyVersion: int("policy_version").notNull(),
  contextJson: text("context_json"),
  campaignId: varchar("campaign_id", { length: 64 }),
});

export const socialContentApprovals = mysqlTable("social_content_approvals", {
  id: varchar("id", { length: 64 }).primaryKey(),
  inventoryId: varchar("inventory_id", { length: 64 }).notNull(),
  version: int("version").notNull(),
  approvedBy: int("approved_by").notNull(),
  briefHash: varchar("brief_hash", { length: 64 }).notNull(),
  mediaHash: varchar("media_hash", { length: 64 }).notNull(),
  mediaUrl: text("media_url").notNull(),
  /** approvals expire — a stale approval must not authorize a publish (null = legacy pre-0087 rows) */
  expiresAt: timestamp("expires_at"),
  /** which autonomy policy version governed when the human approved */
  policyVersion: int("policy_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_sca_inventory_version").on(table.inventoryId, table.version),
  index("idx_sca_inventory_version").on(table.inventoryId, table.version),
]);

export type SocialContentInventory = typeof socialContentInventory.$inferSelect;
export type InsertSocialContentInventory = typeof socialContentInventory.$inferInsert;
export type SocialContentApproval = typeof socialContentApprovals.$inferSelect;
export type InsertSocialContentApproval = typeof socialContentApprovals.$inferInsert;

/**
 * Authenticated operator quality-override (Creative Compiler 2.0 Milestone 1).
 * When an operator accepts ADVISORY findings (critic REPAIR — not a hard gate),
 * this records a "publish_anyway" decision bound to the EXACT
 * (inventoryId, version, contentHash). Any re-render/caption/audio change alters
 * the hash and invalidates the override; hard gates always re-run; consumed
 * atomically at publish. Mirrors 0089_operator_quality_overrides.sql.
 */
export const operatorQualityOverrides = mysqlTable("operator_quality_overrides", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 }),
  inventoryId: varchar("inventory_id", { length: 64 }).notNull(),
  assetId: varchar("asset_id", { length: 128 }),
  assetVersion: int("asset_version").notNull(),
  /** the approved media/render hash (sha256 of bytes) — catches re-render/audio */
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  /** the approved brief hash (sha256 of briefJson) — catches caption/metadata edits */
  briefHash: varchar("brief_hash", { length: 64 }).notNull().default(""),
  action: varchar("action", { length: 32 }).notNull().default("publish_anyway"),
  /** JSON array of accepted critic findingIds */
  acceptedFindingIds: text("accepted_finding_ids").notNull(),
  /** JSON array of accepted severities ("warn" | "repair") */
  acceptedSeverities: varchar("accepted_severities", { length: 255 }).notNull(),
  operatorReason: text("operator_reason").notNull(),
  actorId: int("actor_id").notNull(),
  actorEmail: varchar("actor_email", { length: 255 }),
  /** active | consumed | expired | revoked | invalidated */
  state: varchar("state", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
}, (table) => [
  index("idx_oqo_binding").on(table.inventoryId, table.assetVersion, table.state),
  index("idx_oqo_hash").on(table.contentHash),
  index("idx_oqo_campaign").on(table.campaignId),
]);
export type OperatorQualityOverride = typeof operatorQualityOverrides.$inferSelect;
export type InsertOperatorQualityOverride = typeof operatorQualityOverrides.$inferInsert;

export const intelligenceDecisionLedger = mysqlTable("intelligence_decision_ledger", {
  id: int("id").autoincrement().primaryKey(),
  engineId: varchar("engine_id", { length: 64 }).notNull(),
  recommendationType: varchar("recommendation_type", { length: 64 }).notNull(),
  recommendationTarget: varchar("recommendation_target", { length: 255 }).notNull(),
  actionTaken: varchar("action_taken", { length: 64 }).notNull(),
  valueAtRiskCents: int("value_at_risk_cents").default(0),
  actualRevenueCapturedCents: int("actual_revenue_captured_cents").default(0),
  contextJson: text("context_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_intel_engine").on(table.engineId),
  index("idx_intel_action").on(table.actionTaken),
  index("idx_intel_created").on(table.createdAt),
]);

export type IntelligenceDecisionLedger = typeof intelligenceDecisionLedger.$inferSelect;
export type InsertIntelligenceDecisionLedger = typeof intelligenceDecisionLedger.$inferInsert;

// ─── SIGNAL FORGE NEXUS ────────────────────────────────
//
// 2026-09-01 (audit F-18 / artifact 4 §1.3): `nexus_audit_jobs` REMOVED from
// the schema. Its consumer, nexusAuditor.ts, was never scheduled and was
// deleted in #1329 as "built, tested and never wired"; the producer in
// smsOrchestrator kept enqueueing into a queue nothing drained. The producer
// is gone with this change; the table itself is dropped by the hand-applied
// drizzle/0115_drop_nexus_audit_jobs.sql (operator-gated, destructive).

// ─── LLM CALL LEDGER (2026-09-01, audit F-21) ─────────────
//
// One row per invokeLLM() call: model, lane, tokens, latency, outcome. There
// was no per-call record at all — spend and failure rates per lane were
// unknowable. Writes are gated behind LLM_LEDGER_ENABLED=true until
// drizzle/0116_llm_calls.sql is applied (nothing selects from this table, so
// the definition is safe to ship ahead of the DDL).
export const llmCalls = mysqlTable("llm_calls", {
  id: int("id").autoincrement().primaryKey(),
  calledAt: timestamp("calledAt").defaultNow().notNull(),
  /** Model actually used after resolveEffectiveModel (e.g. gemini-2.5-flash). */
  model: varchar("model", { length: 96 }).notNull(),
  /** ollama | gemini | openai | anthropic | unknown — derived from the model id. */
  provider: varchar("provider", { length: 24 }).notNull(),
  /** Caller-supplied purpose/lane when present, else "unlabeled". */
  lane: varchar("lane", { length: 64 }).notNull(),
  promptTokens: int("promptTokens"),
  completionTokens: int("completionTokens"),
  latencyMs: int("latencyMs").notNull(),
  /** 1 = returned, 0 = threw. */
  ok: tinyint("ok").notNull(),
  /** First 200 chars of the error when ok = 0. */
  error: varchar("error", { length: 200 }),
  /** Whether the call carried image parts (routes to the vision lane). */
  hadImages: tinyint("hadImages").default(0).notNull(),
}, (table) => [
  index("idx_llm_calls_called").on(table.calledAt),
  index("idx_llm_calls_lane").on(table.lane, table.calledAt),
]);

export type LlmCall = typeof llmCalls.$inferSelect;
export type InsertLlmCall = typeof llmCalls.$inferInsert;

export const nickgptDefectLedger = mysqlTable("nickgpt_defect_ledger", {
  id: int("id").autoincrement().primaryKey(),
  // 2026-09-01: was a FK to nexus_audit_jobs (retired, see 0115). Kept as a
  // plain nullable int so existing rows and the column stay readable; the DB
  // constraint is dropped by 0115 before the table it points at.
  auditJobId: int("auditJobId"),
  orchestrationId: varchar("orchestrationId", { length: 100 }),
  nickgptDraftId: int("nickgptDraftId"),
  phoneHashOrLast4: varchar("phoneHashOrLast4", { length: 64 }).notNull(),
  eventType: varchar("eventType", { length: 100 }),
  variantKey: varchar("variantKey", { length: 100 }),
  templateKey: varchar("templateKey", { length: 100 }),
  intent: varchar("intent", { length: 100 }),
  confidence: float("confidence"),
  provider: varchar("provider", { length: 100 }),
  autoSent: int("autoSent").default(0).notNull(),
  releaseDecision: varchar("releaseDecision", { length: 100 }).notNull(),
  severity: varchar("severity", { length: 50 }).notNull(),
  defectCodesJson: text("defectCodesJson"),
  findingsJson: text("findingsJson"),
  evidenceLedgerJson: text("evidenceLedgerJson"),
  diagnosticBreakdownJson: text("diagnosticBreakdownJson"),
  recommendedFixJson: text("recommendedFixJson"),
  sanitizedTraceJson: text("sanitizedTraceJson"),
  operatorReviewed: int("operatorReviewed").default(0).notNull(),
  operatorDisposition: varchar("operatorDisposition", { length: 100 }),
  exportedToTraining: int("exportedToTraining").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type NickgptDefectLedger = typeof nickgptDefectLedger.$inferSelect;
export type InsertNickgptDefectLedger = typeof nickgptDefectLedger.$inferInsert;

/**
 * Canonical media asset registry (0088) — the single source of truth for
 * every produced/ingested media artifact: identity, checksum, lineage,
 * lifecycle, rights, and archive state. The DB row is canonical metadata;
 * Google Drive is the durable human archive; storagePut output is runtime
 * delivery. A provider URL is never permanence.
 *
 * Versioning: `logicalKey` names the logical output (e.g. "reel:30008:master");
 * exactly one row per logicalKey has isCurrent=1 (enforced in
 * services/mediaRegistry.ts inside a transaction — TiDB, no partial unique
 * indexes). A repair NEVER overwrites: it registers a new version with
 * parentAssetId set and flips isCurrent.
 */
export const mediaAssets = mysqlTable("media_assets", {
  id: varchar("id", { length: 64 }).primaryKey(),
  /** logical output identity — versions share it */
  logicalKey: varchar("logical_key", { length: 191 }).notNull(),
  version: int("version").notNull().default(1),
  isCurrent: int("is_current").notNull().default(1),
  /** campaign linkage (social_content_inventory id / reel job id as string) */
  campaignId: varchar("campaign_id", { length: 64 }),
  genomeId: varchar("genome_id", { length: 64 }),
  visualWorldId: varchar("visual_world_id", { length: 64 }),
  parentAssetId: varchar("parent_asset_id", { length: 64 }),
  /** JSON string[] of source asset ids this was derived from */
  derivedFromJson: text("derived_from_json"),
  assetType: varchar("asset_type", { length: 32 }).notNull(),
  format: varchar("format", { length: 16 }).notNull(),
  lifecycleState: varchar("lifecycle_state", { length: 24 }).notNull().default("available"),
  provider: varchar("provider", { length: 32 }),
  providerModel: varchar("provider_model", { length: 64 }),
  providerRequestId: varchar("provider_request_id", { length: 128 }),
  originalProviderUrl: text("original_provider_url"),
  runtimeUrl: text("runtime_url"),
  gdriveFileId: varchar("gdrive_file_id", { length: 128 }),
  gdriveFolderId: varchar("gdrive_folder_id", { length: 128 }),
  gdriveViewUrl: text("gdrive_view_url"),
  /** not_required | pending | uploading | synced | failed | missing — 'synced'
   *  may only be written after byte-size verification (service-enforced) */
  gdriveSyncState: varchar("gdrive_sync_state", { length: 16 }).notNull().default("pending"),
  mimeType: varchar("mime_type", { length: 64 }).notNull(),
  byteSize: int("byte_size").notNull(),
  width: int("width"),
  height: int("height"),
  durationMs: int("duration_ms"),
  checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
  /** JSON of generation parameters / probe metadata (codecs, fps, prompt refs) */
  generationParamsJson: text("generation_params_json"),
  rightsStatus: varchar("rights_status", { length: 24 }).notNull().default("ai_generated"),
  reuseAllowed: int("reuse_allowed").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_ma_logical_current").on(table.logicalKey, table.isCurrent),
  index("idx_ma_checksum").on(table.checksumSha256),
  index("idx_ma_campaign").on(table.campaignId),
  index("idx_ma_lifecycle").on(table.lifecycleState),
  uniqueIndex("uniq_ma_logical_version").on(table.logicalKey, table.version),
]);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type InsertMediaAsset = typeof mediaAssets.$inferInsert;

/**
 * Server-side integration token store (0088) — refresh tokens for headless
 * integrations (first consumer: Google Drive Creative Vault, scope
 * drive.file). Mirrors statenour's Integration-row pattern. configJson holds
 * { refreshToken, scopes, email, grantedAt, accessToken?, accessTokenExpiresAt? }.
 * NEVER log configJson.
 */
export const integrationTokens = mysqlTable("integration_tokens", {
  name: varchar("name", { length: 64 }).primaryKey(),
  configJson: text("config_json").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("healthy"),
  consecutiveFailures: int("consecutive_failures").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type IntegrationToken = typeof integrationTokens.$inferSelect;

/**
 * ONE durable parent for a single "make me something" request.
 *
 * References the existing identities rather than replacing them — inventory,
 * reel jobs and approvals keep their gates, hashes and provenance untouched.
 * What this adds is the two things nothing else holds: the DECISION AND ITS
 * REASON, and the two-state model (what was built vs what was PROVEN).
 */
export const contentRuns = mysqlTable("content_runs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),

  requestedBy: varchar("requestedBy", { length: 64 }),
  /** operator | planner | cron — who asked. */
  requestSource: varchar("requestSource", { length: 32 }).default("operator").notNull(),
  requestedTopic: text("requestedTopic"),
  /** NULL = "choose for me". */
  requestedFormat: varchar("requestedFormat", { length: 32 }),

  chosenFormat: varchar("chosenFormat", { length: 32 }),
  /** WHY this format. An operator who cannot see the reason cannot correct it. */
  formatReason: varchar("formatReason", { length: 1000 }),
  objective: varchar("objective", { length: 64 }),
  thesis: text("thesis"),

  inventoryId: varchar("inventoryId", { length: 64 }),
  reelJobId: int("reelJobId"),
  approvalId: varchar("approvalId", { length: 64 }),

  stage: varchar("stage", { length: 32 }).default("requested").notNull(),

  /** What was BUILT. Never conflate with operationalState. */
  implementationState: varchar("implementationState", { length: 32 }).default("pending").notNull(),
  /** What was PROVEN in production. A green build is not a proven outcome. */
  operationalState: varchar("operationalState", { length: 32 }).default("unproven").notNull(),

  evidenceJson: mediumtext("evidenceJson"),
  costCents: int("costCents").default(0).notNull(),
  failureReason: varchar("failureReason", { length: 1000 }),
});

// ─── 0108: content experiment registry (applied 2026-07-31) ───────
// The VERDICT is persisted including the refusals (insufficient_data /
// no_signal / invalid_design). A refusal is a result — drop it and the next
// evaluation silently re-decides a question that was already answered "not yet".
export const contentExperiments = mysqlTable("content_experiments", {
  id: int("id").autoincrement().primaryKey(),
  experimentId: varchar("experiment_id", { length: 100 }).notNull(),
  primaryVariable: varchar("primary_variable", { length: 40 }).notNull(),
  objective: varchar("objective", { length: 20 }).notNull(),
  primaryMetric: varchar("primary_metric", { length: 60 }).notNull(),
  armsJson: json("arms_json").notNull(),
  status: varchar("status", { length: 20 }).default("running").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  concludedAt: timestamp("concluded_at"),
  verdictStatus: varchar("verdict_status", { length: 24 }),
  verdictNote: text("verdict_note"),
}, (table) => [
  uniqueIndex("uk_content_experiment_id").on(table.experimentId),
  index("idx_content_exp_status").on(table.status),
]);

// One row per published episode in an experiment. Every input that could
// explain the outcome is captured AT ASSIGNMENT TIME, so a result can never be
// attributed to a variable nobody wrote down.
export const contentExperimentAssignments = mysqlTable("content_experiment_assignments", {
  id: int("id").autoincrement().primaryKey(),
  experimentId: varchar("experiment_id", { length: 100 }).notNull(),
  armId: varchar("arm_id", { length: 60 }).notNull(),
  episodeKey: varchar("episode_key", { length: 160 }).notNull(),
  mediaId: varchar("media_id", { length: 100 }),
  reelJobId: int("reel_job_id"),
  franchiseId: varchar("franchise_id", { length: 60 }),
  ctaType: varchar("cta_type", { length: 20 }),
  contentOrigin: varchar("content_origin", { length: 30 }),
  postingSlot: varchar("posting_slot", { length: 20 }),
  provider: varchar("provider", { length: 40 }),
  model: varchar("model", { length: 80 }),
  promptVersion: varchar("prompt_version", { length: 40 }),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
}, (table) => [
  // Load-bearing: assignment is deterministic on episodeKey, so this is what
  // stops a retry reassigning an arm and corrupting a running experiment.
  uniqueIndex("uk_exp_episode").on(table.experimentId, table.episodeKey),
  index("idx_exp_assign_media").on(table.mediaId),
  index("idx_exp_assign_arm").on(table.experimentId, table.armId),
]);

/**
 * Camera visit truth, shop side (migration 0119).
 *
 * Product boundary (ADR-0017, refined 2026-09-09): operational shop intelligence
 * lives in nickstire.org/admin; StateNour receives owner-level summaries, not the
 * shop-operations cockpit. One row per VISIT, written through
 * `POST /api/camera/visits`.
 *
 * WARNING: NO PRODUCER IS WIRED YET: visitd's cloud client posts to
 * `{baseUrl}/api/devices/{id}/events` on its StateNour base URL, and nothing in
 * `camera-bridge/` references the nickstire ingest route. Until visitd gains a
 * second sink the table stays empty and the Lot section correctly reports
 * "awaiting first event". `seq` is the last applied emission sequence, so a duplicate
 * or out-of-order delivery cannot walk a visit backwards.
 *
 * Every lifecycle timestamp is nullable on purpose: an unobserved time stays
 * unknown instead of being back-filled with a plausible guess, and
 * `estimatedFields` names any value that was inferred rather than observed.
 */
export const vehicleVisits = mysqlTable("vehicle_visits", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  visitId: varchar("visitId", { length: 64 }).notNull(),
  camera: varchar("camera", { length: 64 }).notNull(),
  state: varchar("state", { length: 32 }).notNull(),
  seq: int("seq").default(0).notNull(),

  // TIMESTAMP, not DATETIME, and deliberately. AGENTS.md: "Driver-parsed TiDB
  // DATETIME values come back shifted on ET". DATETIME carries no timezone, so a
  // JS Date written and read back through mysql2 shifts by the session offset --
  // which would silently corrupt every wait time and day bucket the Lot section
  // computes. TIMESTAMP stores UTC and converts on read, so the Date round-trip
  // is consistent. The 2038 range is irrelevant for shop visit times.
  arrivedAt: timestamp("arrivedAt"),
  waitStartedAt: timestamp("waitStartedAt"),
  bayEnteredAt: timestamp("bayEnteredAt"),
  bayExitedAt: timestamp("bayExitedAt"),
  departedAt: timestamp("departedAt"),
  bay: varchar("bay", { length: 32 }),

  /** Advisory until EXACT or staff-confirmed — never bind identity on a fuzzy read. */
  plateText: varchar("plateText", { length: 16 }),
  plateStatus: varchar("plateStatus", { length: 32 }).default("NONE").notNull(),
  customerMatch: varchar("customerMatch", { length: 32 }).default("NONE").notNull(),
  customerId: int("customerId"),

  /** A vehicle already present at startup/reconnect: occupancy only, never an arrival. */
  preexisting: boolean("preexisting").default(false).notNull(),
  entryEvidence: varchar("entryEvidence", { length: 191 }),
  estimatedFields: json("estimatedFields"),
  evidenceRef: varchar("evidenceRef", { length: 255 }),
  sourceGeneration: varchar("sourceGeneration", { length: 64 }),
  cameraPose: varchar("cameraPose", { length: 64 }),

  /**
   * Episode identity (migration 0127). A tracker id is NOT a vehicle -- when a track
   * dies and the same car is re-acquired, the edge used to open a second visit whose
   * clock restarted at `now`. `camera-bridge/vision/stitch.py` folds those fragments
   * into one episode and carries the ORIGINAL `arrivedAt` forward.
   *
   * All three NULLABLE on purpose: a producer predating the stitcher sends none of
   * them, and NULL must read as "not reported" rather than as an empty trail.
   */
  episodeId: varchar("episodeId", { length: 64 }),
  /** The visit this one was judged to continue. Mirrors visitd's `continues_visit_id`. */
  continuesVisitId: varchar("continuesVisitId", { length: 64 }),
  /** Every track id folded into this visit, oldest first -- the audit trail for a
   *  stitched `arrivedAt`. Without it a corrected arrival is unexplainable. */
  memberTrackIds: json("memberTrackIds"),
  detectorName: varchar("detectorName", { length: 128 }),
  calibrationVersion: varchar("calibrationVersion", { length: 32 }),

  /**
   * PRODUCTION | COMMISSIONING | REPLAY (migration 0120). A controlled test drive
   * must never become "today's customer arrival": every KPI query filters
   * PRODUCTION by default and commissioning rows are excluded, never deleted.
   */
  dataClass: varchar("dataClass", { length: 16 }).default("PRODUCTION").notNull(),
  commissioningRunId: varchar("commissioningRunId", { length: 64 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_vehicle_visits_visitId").on(table.visitId),
  index("idx_vehicle_visits_dataClass").on(table.dataClass),
  index("idx_vehicle_visits_state").on(table.state),
  index("idx_vehicle_visits_arrivedAt").on(table.arrivedAt),
  index("idx_vehicle_visits_departedAt").on(table.departedAt),
  index("idx_vehicle_visits_bay").on(table.bay),
  index("idx_vehicle_visits_plateText").on(table.plateText),
]);

/**
 * Latest heartbeat per camera producer (migration 0120). Producer health is an
 * INFRASTRUCTURE fact and lives here; zero visits is a BUSINESS fact and lives in
 * `vehicle_visits`. Before this table the two shared one timestamp, and a healthy
 * producer on a quiet lot rendered as `cameras: []`.
 *
 * Every field is what the PRODUCER observed at `observedAtEdge`; `receivedAt` is
 * when the cloud got it. Idempotency key = (producerInstanceId, heartbeatSeq).
 * `state` is the producer-side derivation at ingest; liveness (STALE /
 * PRODUCER_OFFLINE) is derived at read time from `receivedAt` age.
 */
export const cameraRuntime = mysqlTable("camera_runtime", {
  camera: varchar("camera", { length: 64 }).primaryKey(),
  producerInstanceId: varchar("producerInstanceId", { length: 64 }).notNull(),
  producerVersion: varchar("producerVersion", { length: 64 }),
  gitSha: varchar("gitSha", { length: 40 }),
  heartbeatSeq: int("heartbeatSeq").default(0).notNull(),
  observedAtEdge: timestamp("observedAtEdge"),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  /** PRODUCTION | SHADOW | COMMISSIONING — what the producer says it is doing. */
  mode: varchar("mode", { length: 16 }).default("PRODUCTION").notNull(),
  commissioningRunId: varchar("commissioningRunId", { length: 64 }),
  sourceType: varchar("sourceType", { length: 32 }),
  sourceGeneration: varchar("sourceGeneration", { length: 64 }),
  sourceConnected: boolean("sourceConnected"),
  lastFrameAt: timestamp("lastFrameAt"),
  lastHealthyFrameAt: timestamp("lastHealthyFrameAt"),
  captureFps: float("captureFps"),
  frameOk: boolean("frameOk"),
  poseOk: boolean("poseOk"),
  poseDelta: float("poseDelta"),
  /**
   * Interaction/PTZ transport proofs (0134). NULL means not measured, never success.
   * Fixed-geometry producers may omit all of these forever.
   */
  authPlaneOk: boolean("authPlaneOk"),
  eventPlaneOk: boolean("eventPlaneOk"),
  controlPlaneOk: boolean("controlPlaneOk"),
  mediaPlaneOk: boolean("mediaPlaneOk"),
  ptzHomeOk: boolean("ptzHomeOk"),
  lastEventProofAt: timestamp("lastEventProofAt"),
  lastControlProofAt: timestamp("lastControlProofAt"),
  lastMediaProofAt: timestamp("lastMediaProofAt"),
  lastPtzNotifyAt: timestamp("lastPtzNotifyAt"),
  /**
   * Office conversation worker runtime (0135). These fields ride the existing Office camera
   * heartbeat so Admin has one current-state authority, not a second health table.
   */
  conversationWorkerOk: boolean("conversationWorkerOk"),
  conversationWorkerState: varchar("conversationWorkerState", { length: 32 }),
  conversationWorkerHeartbeatAt: timestamp("conversationWorkerHeartbeatAt"),
  conversationAudioSource: varchar("conversationAudioSource", { length: 64 }),
  conversationCaptureHost: varchar("conversationCaptureHost", { length: 64 }),
  conversationSttEngine: varchar("conversationSttEngine", { length: 128 }),
  conversationQueueDepth: int("conversationQueueDepth"),
  conversationLastTrigger: varchar("conversationLastTrigger", { length: 32 }),
  lastConversationEventAt: timestamp("lastConversationEventAt"),
  lastConversationCaptureAt: timestamp("lastConversationCaptureAt"),
  lastConversationSttAt: timestamp("lastConversationSttAt"),
  lastConversationPostAt: timestamp("lastConversationPostAt"),
  lastConversationSummaryAt: timestamp("lastConversationSummaryAt"),
  lastConversationCoverage: decimal("lastConversationCoverage", { precision: 5, scale: 4 }),
  conversationFailuresToday: int("conversationFailuresToday"),
  conversationLastError: varchar("conversationLastError", { length: 500 }),
  calibrationVersion: varchar("calibrationVersion", { length: 32 }),
  detectorName: varchar("detectorName", { length: 128 }),
  modelSha256: varchar("modelSha256", { length: 64 }),
  lastInferenceAt: timestamp("lastInferenceAt"),
  inferenceP95Ms: float("inferenceP95Ms"),
  openVisits: int("openVisits"),
  outboxDepth: int("outboxDepth"),
  oldestOutboxAgeSeconds: int("oldestOutboxAgeSeconds"),
  deadLetterDepth: int("deadLetterDepth"),
  lastCloudAckAt: timestamp("lastCloudAckAt"),
  diskFreeBytes: bigint("diskFreeBytes", { mode: "number" }),
  /** Times the producer had to un-minimise its capture window. Non-zero = somebody is minimising the camera app. */
  restores: int("restores"),
  /**
   * Revalidation passes that produced NO binding — distinct from a pass that confirmed an
   * unchanged layout, which is the happy case many times an hour. Sustained non-zero means
   * the producer can no longer confirm the geometry every polygon is evaluated against.
   * NULL = this producer does not report it; 0 = it looked and found none.
   */
  relocateFailures: int("relocateFailures"),
  /**
   * Cars the census called `preexisting` that the entry portal then watched drive in — an
   * UNDER-count of arrivals, the one direction nothing else here watches for. Recorded,
   * never promoted. NULL = not reported; 0 = looked and found none.
   */
  preexistingCrossed: int("preexistingCrossed"),

  /**
   * Stitch counters (migration 0127). `arrivalsAfterStitch` is the de-duplicated
   * SHADOW of `arrivals`: it is reported ALONGSIDE the headline count and never
   * instead of it, per the operator's 2026-09-18 instruction to keep the counter
   * running and unhidden and let the data prove itself.
   *
   * `stitchRefusedAmbiguous` is the COST line. A stitcher that never stitches and one
   * that merges everything both look identical if you only record successes -- and
   * they need opposite fixes.
   */
  arrivalsAfterStitch: int("arrivalsAfterStitch"),
  stitchedTotal: int("stitchedTotal"),
  stitchRefusedAmbiguous: int("stitchRefusedAmbiguous"),
  /**
   * Rolling-window plausibility counters (migration 0143). `lastInferenceAt` says the
   * detector RAN; these say what it SAW. Frames fine + detections zero for an hour inside
   * business hours is DEGRADED_VISION, and before these existed that day rendered "steady"
   * (2026-10-05: the sign lane counted 4 arrivals on a 40-car day). NULL = this producer
   * does not report the window; 0 = it looked and found none.
   */
  detectionsLast10m: int("detectionsLast10m"),
  portalCrossingsLast60m: int("portalCrossingsLast60m"),
  /**
   * Office worker listening truth over the last hour (migration 0143), from officewake.py's
   * local receipt via the Eufy agent. Coverage is capture seconds over schedule-eligible
   * seconds (NULL under five eligible minutes: a worker that just started has not failed).
   * "Alive and heard nothing" and "deaf" used to be the same READY.
   */
  conversationListeningCoverage60m: decimal("conversationListeningCoverage60m", { precision: 5, scale: 4 }),
  conversationCaptureSecondsLast60m: int("conversationCaptureSecondsLast60m"),
  conversationCapturesLast60m: int("conversationCapturesLast60m"),
  conversationCaptureFailuresLast60m: int("conversationCaptureFailuresLast60m"),
  conversationWakeTriggersLast60m: int("conversationWakeTriggersLast60m"),
  conversationTranscribeBacklog: int("conversationTranscribeBacklog"),
  state: varchar("state", { length: 32 }).notNull(),
  stateSince: timestamp("stateSince"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_camera_runtime_receivedAt").on(table.receivedAt),
]);

/**
 * A controlled commissioning drive (migration 0121). Migration 0120 gave a visit a
 * `dataClass` so a test drive stops counting as a customer; this records what a HUMAN
 * observed during it, so the machine's answer can be compared against ground truth
 * instead of against a feeling.
 */
export const commissioningRuns = mysqlTable("commissioning_runs", {
  runId: varchar("runId", { length: 64 }).primaryKey(),
  camera: varchar("camera", { length: 64 }).notNull(),
  label: varchar("label", { length: 191 }),
  startedAt: timestamp("startedAt", { fsp: 3 }).defaultNow().notNull(),
  endedAt: timestamp("endedAt", { fsp: 3 }),
  startedBy: varchar("startedBy", { length: 191 }),
  /** Measured at run start from several round trips. NULL means NOT MEASURED, which a
   *  report must disclose rather than silently assuming a zero offset. */
  clockOffsetMs: int("clockOffsetMs"),
  clockRttMs: int("clockRttMs"),
  clockSamples: int("clockSamples"),
  /**
   * The PHONE's own zero point for `phoneMonoMs`, corrected by the measured offset.
   * Anchoring to `startedAt` would fold the whole start-request latency into every
   * reconstructed tap as a constant error, and a slow start would then read as a
   * wall-clock step or push a valid run past the match tolerance.
   */
  monoOriginAt: timestamp("monoOriginAt", { fsp: 3 }),
  verdict: varchar("verdict", { length: 16 }),
  verdictReason: varchar("verdictReason", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_commissioning_runs_camera").on(table.camera, table.startedAt),
]);

/**
 * One human tap, with THREE clocks. `phoneWallAt` can be seconds off (Android's clock
 * steps); `phoneMonoMs` is immune to that; `serverReceivedAt` puts network delay on its
 * own axis. Separating them is what lets a report say "the camera was 285 ms behind the
 * human" instead of "something somewhere took 1.4 s".
 */
export const commissioningTruthEvents = mysqlTable("commissioning_truth_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  runId: varchar("runId", { length: 64 }).notNull(),
  event: varchar("event", { length: 24 }).notNull(),
  phoneWallAt: timestamp("phoneWallAt", { fsp: 3 }).notNull(),
  phoneMonoMs: bigint("phoneMonoMs", { mode: "number" }),
  serverReceivedAt: timestamp("serverReceivedAt", { fsp: 3 }).defaultNow().notNull(),
  /** phoneWallAt adjusted by the run's measured offset. DERIVED, and stored so a report
   *  stays reproducible after the offset is re-measured. */
  correctedAt: timestamp("correctedAt", { fsp: 3 }),
  note: varchar("note", { length: 191 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_truth_events_run").on(table.runId, table.phoneWallAt),
]);

/** Producer-reported state TRANSITIONS only — never one row per heartbeat. */
export const cameraHealthEvents = mysqlTable("camera_health_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  camera: varchar("camera", { length: 64 }).notNull(),
  fromState: varchar("fromState", { length: 32 }),
  toState: varchar("toState", { length: 32 }).notNull(),
  reason: varchar("reason", { length: 191 }),
  producerInstanceId: varchar("producerInstanceId", { length: 64 }),
  sourceGeneration: varchar("sourceGeneration", { length: 64 }),
  at: timestamp("at").defaultNow().notNull(),
}, (table) => [
  index("idx_camera_health_events_camera_at").on(table.camera, table.at),
]);

/**
 * One counter interaction, with the evidence behind every claim made about it.
 *
 * The office Eufy camera (192.168.0.167) was MEASURED 2026-09-22 to carry a real audio
 * track — aac, 16 kHz, mono — alongside 1080p15 video, so capturing conversations is
 * technically possible. Whether that mic is intelligible at counter distance is a separate
 * question that only a real recording answers; `source` exists so the answer can be "use a
 * dedicated counter microphone instead" without reshaping anything here.
 *
 * THREE RULES THIS TABLE ENFORCES BY SHAPE:
 *
 * 1. Every extracted fact carries the transcript span it came from. A summary nobody can
 *    trace back to what was actually said is a rumour with a timestamp — and these facts
 *    will sometimes contradict a repair order, which is exactly when provenance matters.
 * 2. Links are CANDIDATES. `vehicleVisitId` / `workOrderId` always travel with
 *    `linkConfidence`. Binding the wrong conversation to the wrong customer is the
 *    expensive failure, and the camera side reads ZERO plates today (measured: 552 visits
 *    over 14 days, none with plateText), so there is no identity to join on yet.
 * 3. Raw audio is a POINTER, never a column. It is the most sensitive artefact here and
 *    gets the shortest life; the transcript outlives it, the structured facts outlive that.
 */
export const conversationEpisodes = mysqlTable("conversation_episodes", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  episodeId: varchar("episodeId", { length: 64 }).notNull(),
  /** `eufy-office` today; `counter-mic` if the camera mic fails the intelligibility test. */
  source: varchar("source", { length: 32 }).notNull(),
  /** Capture provenance added after the Office camera identity correction. */
  cameraSerial: varchar("cameraSerial", { length: 64 }),
  captureHost: varchar("captureHost", { length: 64 }),
  triggerType: varchar("triggerType", { length: 32 }),
  triggeredAt: timestamp("triggeredAt"),

  // TIMESTAMP, not DATETIME — same reason vehicleVisits gives: the driver hands JS a
  // shifted Date for DATETIME on ET, corrupting every duration and day bucket downstream.
  startedAt: timestamp("startedAt"),
  endedAt: timestamp("endedAt"),
  durationSeconds: int("durationSeconds"),

  /** Pointer to the clip, never the clip. NULL once aged out — distinct from never-captured. */
  audioRef: varchar("audioRef", { length: 255 }),
  /** Measured at capture. THE intelligibility signal: a quiet mean explains a bad
   *  transcript without anyone having to guess at the cause. */
  meanVolumeDb: decimal("meanVolumeDb", { precision: 6, scale: 2 }),

  /** PENDING | DONE | FAILED | SKIPPED. VARCHAR not ENUM: TiDB's STRICT_TRANS_TABLES
   *  REJECTS an out-of-enum write and LOSES the row — worst inside a failure handler. */
  transcriptStatus: varchar("transcriptStatus", { length: 32 }).default("PENDING").notNull(),
  transcriptError: varchar("transcriptError", { length: 500 }),

  /** Timed segments from `transcribeAudio()`. NULL = not transcribed; [] = transcribed and
   *  genuinely silent. Those are different facts and must stay distinguishable. */
  transcript: json("transcript"),
  sttEngine: varchar("sttEngine", { length: 32 }),
  sttModel: varchar("sttModel", { length: 128 }),
  sttLatencyMs: int("sttLatencyMs"),

  /** NULL = diarization not attempted (today's state). Never 0 — "no speakers detected" is
   *  a finding, "we did not look" is not. */
  speakerCount: int("speakerCount"),

  facts: json("facts"),
  summary: text("summary"),

  vehicleVisitId: varchar("vehicleVisitId", { length: 64 }),
  workOrderId: varchar("workOrderId", { length: 64 }),
  linkConfidence: decimal("linkConfidence", { precision: 4, scale: 3 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ConversationEpisode = typeof conversationEpisodes.$inferSelect;
export type InsertConversationEpisode = typeof conversationEpisodes.$inferInsert;

export type VehicleVisit = typeof vehicleVisits.$inferSelect;
export type InsertVehicleVisit = typeof vehicleVisits.$inferInsert;

/**
 * Technician-referral tracking — the $300-after-90-days bonus advertised on
 * /careers had no backing record before this: the referrer's name lived only
 * inside a free-text note concatenated onto the applicant's `leads.problem`
 * field (client/src/pages/Careers.tsx ApplicationForm), so the shop could not
 * reliably tell who referred whom, verify the 90-day condition, or pay the
 * bonus out without a dispute. One row per referral claim, soft-linked to the
 * referred applicant's own `leads` row (source:"careers").
 */
export const technicianReferrals = mysqlTable("technician_referrals", {
  id: int("id").autoincrement().primaryKey(),
  /**
   * The referred applicant's row in `leads` (source:"careers") — kept for
   * rows created before `candidates` existed. New submissions populate
   * `candidateId` instead, once Careers.tsx is cut over to the dedicated
   * candidates.submit endpoint (see `candidates` table below); additive,
   * both columns are nullable so neither cutover step can break the other.
   */
  // Plain nullable INT, not `.references()` — matching vehicle_visits.customerId
  // above and the migration's own stated convention (0121_technician_referrals.sql:
  // "no SQL-level FOREIGN KEY constraint"). A drizzle `.references({onDelete:
  // "set null"})` call is a promise drizzle-kit would enforce with a real DB
  // constraint if it generated this migration — it doesn't, this migration is
  // hand-written, so that promise would be fiction: deleting a lead would leave
  // a dangling leadId here forever, not null it out. Referential integrity is
  // app-enforced, not DB-enforced, for all three of these columns.
  leadId: int("leadId"),
  candidateId: int("candidateId"),
  referrerName: varchar("referrerName", { length: 255 }).notNull(),
  /** Optional — lets the shop text/call the referrer when the bonus is due. */
  referrerPhone: varchar("referrerPhone", { length: 30 }),
  /** Admin-linked match to a current employee record — never auto-matched. Plain INT, no FK — see leadId above. */
  referrerTechnicianId: int("referrerTechnicianId"),
  /** Role the referred applicant applied for, captured at submit time. */
  positionTitle: varchar("positionTitle", { length: 100 }),
  /**
   * pending -> eligible -> paid, or -> disqualified/forfeited. VARCHAR, not
   * ENUM: TiDB runs STRICT_TRANS_TABLES, so a write outside an ENUM's
   * declared values is REJECTED and the row is LOST, not defaulted (see
   * .claude/skills/nickstire-tidb-ddl). varchar(32) matches the repo's own
   * status-column convention (e.g. vehicle_visits.state above).
   */
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  bonusAmountCents: int("bonusAmountCents").default(30000).notNull(),
  /** Set only when an admin confirms the referred applicant was actually hired. */
  hiredAt: timestamp("hiredAt"),
  /** hiredAt + 90 days — stamped alongside hiredAt so eligibility is a stored fact, not a recomputation that drifts if the 90-day rule is later changed. */
  eligibleAt: timestamp("eligibleAt"),
  paidAt: timestamp("paidAt"),
  disqualifiedReason: varchar("disqualifiedReason", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_tech_referral_lead").on(table.leadId),
  index("idx_tech_referral_status").on(table.status),
  index("idx_tech_referral_created").on(table.createdAt),
]);

export type TechnicianReferral = typeof technicianReferrals.$inferSelect;
export type InsertTechnicianReferral = typeof technicianReferrals.$inferInsert;

/**
 * Job applicants from /careers — a dedicated home, NOT a `leads` row.
 *
 * Before this table, Careers.tsx's ApplicationForm submitted through
 * trpc.lead.submit — the same endpoint customer sales inquiries use. That
 * meant every job applicant: got AI-urgency-scored by scoreLead() as if
 * their application text were a car-repair problem; received the generic
 * lead-confirmation SMS, which literally asks "What's going on with the
 * car — tires, brakes, check engine, or something else?" (server/sms.ts,
 * leadConfirmationSms — verified against the live function, not assumed);
 * and entered every downstream customer-lead system (the sales opportunity
 * queue, stale-lead follow-up crons, Meta Conversions API, Google Sheets
 * sync) with no way for any of those systems to know "careers" isn't a
 * sales channel, because none of them are source-aware in that direction.
 *
 * This table and its router (server/routers/candidates.ts) went live
 * 2026-09-09: drizzle/0122_candidates.sql applied to production, then
 * Careers.tsx's ApplicationForm cut over from lead.submit to
 * candidates.submit the same day — the apply-then-wire sequencing this repo
 * uses for any schema change a live code path would otherwise query before
 * the table exists.
 */
export const candidates = mysqlTable("candidates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 320 }),
  positionTitle: varchar("positionTitle", { length: 100 }),
  experienceLevel: varchar("experienceLevel", { length: 32 }),
  message: text("message"),
  /** Where the application came from. VARCHAR, not ENUM — see nickstire-tidb-ddl. */
  source: varchar("source", { length: 40 }).default("careers").notNull(),
  /** new -> contacted -> interviewing -> hired / declined / withdrew */
  status: varchar("status", { length: 32 }).default("new").notNull(),
  // Attribution fields mirror `leads`' own convention (utmSource..sessionId)
  // so funnel/source-to-hire measurement is possible from day one, not
  // bolted on later.
  utmSource: varchar("utmSource", { length: 100 }),
  utmMedium: varchar("utmMedium", { length: 100 }),
  utmCampaign: varchar("utmCampaign", { length: 255 }),
  landingPage: varchar("landingPage", { length: 500 }),
  referrer: varchar("referrer", { length: 500 }),
  sessionId: varchar("sessionId", { length: 64 }),
  contactedAt: timestamp("contactedAt"),
  contactedBy: varchar("contactedBy", { length: 255 }),
  notes: text("notes"),
  // ── drizzle/0129_candidates_recruiting_funnel.sql (hand-applied) ──────
  // All nullable; written only when supplied, with a pre-0129 fallback on
  // ER_BAD_FIELD_ERROR (server/db.ts createCandidate). Reads name columns
  // explicitly — never a bare select() on this table.
  /** apply | confidential | shop_tour | talent_network | apprentice */
  intent: varchar("intent", { length: 32 }),
  /** Comma list from the "what would make you move?" self-selector. */
  moveReasons: varchar("moveReasons", { length: 500 }),
  /** Normalized phone (server/lib/phone.ts) — the duplicate-applicant key. */
  phoneE164: varchar("phoneE164", { length: 20 }),
  /** ?ref=<code> from a personal referral link or QR card. */
  refCode: varchar("refCode", { length: 64 }),
  gclid: varchar("gclid", { length: 255 }),
  utmTerm: varchar("utmTerm", { length: 255 }),
  utmContent: varchar("utmContent", { length: 255 }),
  /** When a not-now / talent-network candidate is due another contact. */
  nextFollowUpAt: timestamp("nextFollowUpAt"),
  /** Set once the owner alert email was accepted by the mailer. */
  ownerAlertedAt: timestamp("ownerAlertedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_candidate_phone").on(table.phone),
  index("idx_candidate_phone_e164").on(table.phoneE164),
  index("idx_candidate_ref_code").on(table.refCode),
  index("idx_candidate_status").on(table.status),
  index("idx_candidate_created").on(table.createdAt),
]);

export type Candidate = typeof candidates.$inferSelect;
export type InsertCandidate = typeof candidates.$inferInsert;

/**
 * bridge_outbox — ADR-0019 §5.1 (docs/adr/0019-idempotent-bridge-writes.md).
 * One row per nickstire -> StateNour fact, unique on its idempotency key.
 * Migration 0137 (operator-applied). Phase 1 writes only status='shadow' rows
 * (server/services/bridgeOutbox.ts, flag bridge_outbox_shadow); nothing drains
 * them yet. status is a VARCHAR on purpose (nickstire-tidb-ddl): pending |
 * sending | delivered | dead | shadow.
 */
export const bridgeOutbox = mysqlTable("bridge_outbox", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  idempotencyKey: varchar("idempotency_key", { length: 190 }).notNull(),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  route: varchar("route", { length: 64 }).notNull(),
  payload: json("payload").notNull(),
  occurredAt: timestamp("occurred_at", { fsp: 3 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  dueAt: timestamp("due_at", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  claimToken: varchar("claim_token", { length: 36 }),
  claimedAt: timestamp("claimed_at", { fsp: 3 }),
  lastHttpStatus: int("last_http_status"),
  lastError: varchar("last_error", { length: 500 }),
  deliveredAt: timestamp("delivered_at", { fsp: 3 }),
  createdAt: timestamp("created_at", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, (table) => [
  uniqueIndex("uniq_bridge_outbox_key").on(table.idempotencyKey),
  index("idx_bridge_outbox_status_due").on(table.status, table.dueAt),
  index("idx_bridge_outbox_created").on(table.createdAt),
]);

export type BridgeOutboxRow = typeof bridgeOutbox.$inferSelect;

/**
 * NHTSA manufacturer warranty extensions — ADR-0021 §5, migration 0138 (hand-applied).
 * Written only by the flag-gated nhtsa-warranty-ingest job (services/nhtsaWarrantyIngest.ts) with
 * natural-key upserts; public facts about vehicle models, no PII, no FK. Read by phase 2b's panel.
 * `matchSignal` is the ADR's `signal` (SIGNAL is a reserved word in MySQL/TiDB).
 */
export const nhtsaMfrWarrantyComms = mysqlTable("nhtsa_mfr_warranty_comms", {
  nhtsaId: bigint("nhtsa_id", { mode: "number" }).primaryKey(),
  documentId: varchar("document_id", { length: 128 }).notNull(),
  mfrCampaignId: varchar("mfr_campaign_id", { length: 128 }),
  /** Field 7 as published, e.g. "Warranty Program/Extension" or "Service Campaign" */
  communicationType: varchar("communication_type", { length: 64 }).notNull(),
  /** nhtsa_type | summary_text | both */
  matchSignal: varchar("match_signal", { length: 32 }).notNull(),
  /** Label of the summary-text rule that fired; null for nhtsa_type only */
  matchedPhrase: varchar("matched_phrase", { length: 64 }),
  mfrDate: date("mfr_date", { mode: "string" }),
  addedDate: date("added_date", { mode: "string" }),
  components: varchar("components", { length: 512 }),
  summary: text("summary").notNull(),
  /** e.g. "2025-2026" */
  sourceChunk: varchar("source_chunk", { length: 32 }).notNull(),
  /** The pass that last saw this communication; older than its chunk's latest pass = dropped by NHTSA */
  lastSeenAt: timestamp("last_seen_at", { fsp: 3 }).notNull(),
}, (table) => [
  index("idx_nhtsa_comms_last_seen").on(table.lastSeenAt),
]);

export type NhtsaMfrWarrantyComm = typeof nhtsaMfrWarrantyComms.$inferSelect;

export const nhtsaMfrWarrantyProducts = mysqlTable("nhtsa_mfr_warranty_products", {
  nhtsaId: bigint("nhtsa_id", { mode: "number" }).notNull(),
  /** Uppercase, hyphens removed, spaces collapsed (ADR-0021 §8 step 1); aliases are read-side */
  makeNorm: varchar("make_norm", { length: 128 }).notNull(),
  modelNorm: varchar("model_norm", { length: 256 }).notNull(),
  /** 9999 = not stated by the manufacturer */
  modelYear: smallint("model_year").notNull(),
  makeRaw: varchar("make_raw", { length: 128 }).notNull(),
  modelRaw: varchar("model_raw", { length: 256 }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.nhtsaId, table.makeNorm, table.modelNorm, table.modelYear] }),
  index("idx_nhtsa_products_ymm").on(table.makeNorm, table.modelYear, table.modelNorm),
]);

export type NhtsaMfrWarrantyProduct = typeof nhtsaMfrWarrantyProducts.$inferSelect;
