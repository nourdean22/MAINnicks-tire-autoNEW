export const missionDomainValues = [
  "BUSINESS",
  "PERSONAL",
  "HEALTH",
  "CONTENT",
  "FINANCE"
] as const;

export const missionStatusValues = ["ACTIVE", "PAUSED", "COMPLETE", "KILLED"] as const;

export const taskStatusValues = [
  "INBOX",
  "READY",
  "DOING",
  "WAITING",
  "DONE",
  "ARCHIVED"
] as const;

export const effortBandValues = ["M5", "M15", "M30", "H1", "H2PLUS"] as const;
export const energyLevelValues = ["LOW", "MEDIUM", "HIGH"] as const;
export const taskContextValues = ["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"] as const;
export const customerRiskStatusValues = ["HEALTHY", "AT_RISK", "DORMANT", "LOST"] as const;
export const ltvBandValues = ["LOW", "MID", "HIGH", "VIP"] as const;
export const customerFollowUpStageValues = ["NONE", "QUEUED", "SENT", "RESPONDED", "BOOKED"] as const;
export const customerSegmentValues = ["TIRE", "REPAIR", "FLEET", "PRICE_SHOPPER", "VIP", "OTHER"] as const;
export const leadSourceValues = ["WEBSITE", "INSTAGRAM", "PHONE", "WALK_IN", "REFERRAL", "ADS", "OTHER"] as const;
export const leadTypeValues = ["TIRES", "BRAKES", "DIAGNOSTIC", "OIL", "REPAIR", "OTHER"] as const;
export const leadUrgencyValues = ["LOW", "MEDIUM", "HIGH"] as const;
export const leadStatusValues = ["NEW", "CONTACTED", "BOOKED", "LOST", "DEAD"] as const;
export const serviceCategoryValues = [
  "TIRES",
  "BRAKES",
  "DIAGNOSTIC",
  "OIL",
  "ALIGNMENT",
  "SUSPENSION",
  "GENERAL_REPAIR",
  "OTHER"
] as const;
export const driftLevelValues = ["LOW", "MEDIUM", "HIGH"] as const;
export const communicationModeValues = ["NEUTRAL", "DIRECT", "SHADOW"] as const;
export const devicePriorityValues = ["PHONE_FIRST", "DESKTOP_FIRST", "BALANCED"] as const;
export const designModeValues = ["SHADOW_TACTICAL", "AUTOMOTIVE_EXECUTIVE", "BOARDROOM_MINIMAL"] as const;
export const empireLaneValues = ["MONEY", "HEALTH", "PERSONAL"] as const;
export const dayStateValues = ["OPEN", "CLOSED"] as const;
export const commandResolutionTypeValues = ["DONE", "DEFER", "BLOCKED", "REPLACE"] as const;
export const captureTriageStatusValues = ["NEW", "TRIAGED", "CONVERTED", "ARCHIVED"] as const;
export const captureConversionTargetValues = ["TASK", "MISSION", "LEAD", "REFERENCE", "PERSONAL", "ARCHIVE"] as const;

export const domainLabels: Record<string, string> = {
  BUSINESS: "Business",
  PERSONAL: "Personal",
  HEALTH: "Health",
  CONTENT: "Content",
  FINANCE: "Finance"
};

export const empireLaneLabels: Record<string, string> = {
  MONEY: "Money",
  HEALTH: "Health",
  PERSONAL: "Personal"
};

export const statusToneMap: Record<string, string> = {
  ACTIVE: "lime",
  AUTH_PENDING: "purple",
  MONEY: "amber",
  HEALTH: "lime",
  PERSONAL: "blue",
  DEGRADED: "orange",
  FAILED: "rose",
  PAUSED: "amber",
  COMPLETE: "slate",
  KILLED: "rose",
  READY: "blue",
  STARTING: "amber",
  DOING: "amber",
  WAITING: "purple",
  DONE: "slate",
  INBOX: "zinc",
  ARCHIVED: "zinc",
  NEW: "blue",
  CONTACTED: "amber",
  BOOKED: "lime",
  LOST: "rose",
  DEAD: "zinc",
  HEALTHY: "lime",
  AT_RISK: "amber",
  DORMANT: "orange",
  LOW: "zinc",
  MEDIUM: "amber",
  HIGH: "rose",
  VIP: "violet"
};

export type DriftLevel = (typeof driftLevelValues)[number];
