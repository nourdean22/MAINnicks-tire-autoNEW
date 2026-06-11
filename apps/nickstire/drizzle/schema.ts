import { int, bigint, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, index, uniqueIndex, primaryKey, decimal, date, datetime, float } from "drizzle-orm/mysql-core";

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
  source: mysqlEnum("source", ["popup", "chat", "booking", "manual", "callback", "fleet", "financing_preapproval", "sms", "careers"]).default("popup").notNull(),
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
  callbackId: int("callbackId"),
  bookingId: int("bookingId"),
  invoiceId: int("invoiceId"),
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
  userId: int("userId"),
  vehicleId: int("vehicleId"),
  bookingId: int("bookingId"),
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
  inspectionId: int("inspectionId").notNull(),
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
  /** Estimated repair cost */
  estimatedCost: int("estimatedCost"),
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
  userId: int("userId").notNull(),
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
  /** Link to the completed booking */
  bookingId: int("bookingId").notNull(),
  /** Customer name from booking */
  customerName: varchar("customerName", { length: 255 }).notNull(),
  /** Customer phone (normalized) */
  phone: varchar("phone", { length: 30 }).notNull(),
  /** Service performed (for personalization) */
  service: varchar("service", { length: 100 }),
  /** Current status of the review request */
  status: mysqlEnum("status", ["pending", "sent", "clicked", "failed", "skipped"]).default("pending").notNull(),
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
  /** Link to conversation */
  conversationId: int("conversationId").notNull(),
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
  smsOptOut: int("smsOptOut").default(0).notNull(),
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
  customerId: int("customerId").notNull(),
  messageId: int("messageId").notNull(),
  step: int("step").notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  personalizedBody: text("personalizedBody").notNull(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  sentAt: timestamp("sentAt"),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
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
  bookingId: int("bookingId").notNull(),
  technicianId: int("technicianId").notNull(),
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
  customerId: int("customerId").notNull(),
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
  /** Link to imported customer if matched */
  customerId: int("customerId"),
  /** Link to booking if matched */
  bookingId: int("bookingId"),
  /** Link to work order if matched */
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_invoice_booking").on(table.bookingId),
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
  invoiceId: int("invoiceId"),
  /** Link to booking if converted */
  bookingId: int("bookingId"),
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
 * matchedInvoiceId is set during sync when we find an invoice for the
 * same customer within ±10% of the estimated amount and within 30d of
 * the estimate date.
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
  matchedInvoiceId: int("matched_invoice_id"),
  matchedAt: timestamp("matched_at"),
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
  customerId: int("customerId"),
  /** Link to booking if one was created for installation */
  bookingId: int("bookingId"),

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
  /** Whether this call produced a callback / booking / lead row */
  convertedToLead: int("convertedToLead").default(0).notNull(),
  leadId: int("leadId"),
  callbackId: int("callbackId"),
  transcriptUrl: varchar("transcriptUrl", { length: 500 }),
  recordingUrl: varchar("recordingUrl", { length: 500 }),
  /** wave-181.113 · Nick AI evaluation. Daily cron scores each call
   *  0-100 (eval_score), classifies outcome (eval_outcome), preserves
   *  reasoning for compound improvement (eval_reasoning), stamps eval_at
   *  so re-runs / catch-ups can detect what's been processed.
   *  Sub-50 = wasted · 50-69 = info_only · 70-84 = converted · 85+ = exemplary.
   *  Migration 0057. */
  evalScore: int("eval_score"),
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
  customerId: int("customerId").notNull(),
  /** Normalized phone number that was sent to */
  phone: varchar("phone", { length: 20 }).notNull(),
  /** Actual message body sent */
  messageBody: text("messageBody").notNull(),
  /** Twilio message SID for tracking */
  twilioSid: varchar("twilioSid", { length: 100 }),
  /** Status: pending, sent, failed */
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
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
  customerId: int("customer_id"),
  customerPhone: varchar("customer_phone", { length: 20 }),
  customerName: varchar("customer_name", { length: 200 }),
  amount: int("amount").notNull(), // cents
  description: varchar("description", { length: 500 }),
  stripePaymentLinkId: varchar("stripe_payment_link_id", { length: 255 }),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  invoiceId: int("invoice_id"),
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
  bookingId: int("booking_id").notNull(),
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
  customerId: int("customer_id").notNull(),
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
  customerId: int("customer_id"),
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
  workOrderId: varchar("work_order_id", { length: 36 }).notNull(),
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
  workOrderId: varchar("work_order_id", { length: 36 }).notNull(),
  fromStatus: varchar("from_status", { length: 30 }),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  changedBy: varchar("changed_by", { length: 100 }),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wot_work_order").on(table.workOrderId),
]);

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
  workOrderId: varchar("work_order_id", { length: 36 }).notNull(),
  customerId: int("customer_id"),
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
  firedFor: timestamp("fired_for").notNull(),
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
  rawPayload: text("raw_payload"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_actor").on(table.actor),
  index("idx_audit_entity").on(table.entityType, table.entityId),
  index("idx_audit_created").on(table.createdAt),
]);

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
  customerId: int("customer_id").notNull(),
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
  predictionId: bigint("prediction_id", { mode: "number" }).notNull(),
  shownAt: timestamp("shown_at").defaultNow().notNull(),
  // Enforced at app layer: 'admin_roster' | 'customer_drawer' | 'sms_queue' | 'statenour_brain'
  surface: varchar("surface", { length: 64 }).notNull(),
  operatorId: varchar("operator_id", { length: 64 }),
}, (t) => [
  index("idx_prediction_shown").on(t.predictionId, t.shownAt),
]);

export const predictionActions = mysqlTable("prediction_actions", {
  id: bigint("id", { mode: "number" }).primaryKey().autoincrement(),
  predictionId: bigint("prediction_id", { mode: "number" }).notNull(),
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
  workOrderId: varchar("work_order_id", { length: 36 }).notNull(),
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
  /** AI-suggested response text */
  suggestedResponse: text("suggestedResponse"),
  /** Whether admin has reviewed this entry */
  reviewed: int("reviewed").default(0).notNull(),
  /** Whether the suggested response was sent */
  responseSent: int("responseSent").default(0).notNull(),
  /** Admin notes */
  adminNotes: text("adminNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
  date: varchar("date", { length: 10 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_search_perf_query").on(table.query),
  index("idx_search_perf_date").on(table.date),
  index("idx_search_perf_page").on(table.page),
  // 2026-05-27 · migration 0062 · unique (date, query, page) so the
  // gsc-pipeline upsert collapses re-syncs of the same cell instead of
  // duplicating. NULL pages get normalized to "" in the same migration.
  uniqueIndex("uq_search_perf_date_query_page").on(table.date, table.query, table.page),
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
  /** Error message if failed */
  errorMessage: text("errorMessage"),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ig_analytics_post").on(table.postId),
  index("idx_ig_analytics_created").on(table.createdAt),
]);

export type InstagramAnalyticsRow = typeof instagramAnalytics.$inferSelect;

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ig_autopost_created").on(table.createdAt),
  index("idx_ig_autopost_slot_day").on(table.slot, table.slotDate),
  index("idx_ig_autopost_status").on(table.status),
]);

export type IgAutopostLogRow = typeof igAutopostLog.$inferSelect;
export type InsertIgAutopostLog = typeof igAutopostLog.$inferInsert;

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
   *   admin_login | chat_query | manual_refresh | overnight | health_check
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
