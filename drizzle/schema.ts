import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  source: mysqlEnum("source", ["popup", "chat", "booking", "manual", "callback", "fleet"]).default("popup").notNull(),
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
  /** Points earned for this service */
  pointsEarned: int("pointsEarned").default(0).notNull(),
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
  notificationType: mysqlEnum("notificationType", ["booking_confirmed", "booking_inprogress", "booking_completed", "follow_up", "review_request", "maintenance_reminder", "special_offer", "status_update"]).notNull(),
  subject: varchar("subject", { length: 255 }),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "failed"]).default("pending").notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
});

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
});

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

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
});

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
