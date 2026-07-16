import { isCallbackDuplicateLead, type LeadOriginInput } from "@shared/leadSource";

interface BookingLike {
  status?: string | null;
}

interface LeadLike extends LeadOriginInput {
  status?: string | null;
  urgencyScore?: number | null;
}

interface CallbackLike {
  status?: string | null;
}

export interface AdminActionableCounts {
  newBookings: number;
  newLeads: number;
  actionableLeads: number;
  pendingCallbacks: number;
  total: number;
}
