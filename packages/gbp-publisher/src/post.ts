export type GbpTopicType = "STANDARD" | "EVENT" | "OFFER";
export type GbpCtaType = "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL";

export interface GbpScheduleDate {
  year: number;
  month: number;
  day: number;
}

export interface GbpScheduleTime {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface GbpEventSchedule {
  startDate: GbpScheduleDate;
  startTime?: GbpScheduleTime;
  endDate: GbpScheduleDate;
  endTime?: GbpScheduleTime;
}

export interface GbpEvent {
  title: string;
  schedule: GbpEventSchedule;
}

export interface GbpCallToAction {
  actionType: GbpCtaType;
  url?: string;
}

export interface GbpMediaItem {
  mediaFormat: "PHOTO" | "VIDEO";
  sourceUrl: string;
}

export interface GbpLocalPostParams {
  topicType: GbpTopicType | "PRODUCT"; // Add PRODUCT to block it explicitly
  summary?: string;
  languageCode?: string;
  callToAction?: GbpCallToAction;
  media?: GbpMediaItem[];
  event?: GbpEvent;
  offer?: {
    couponCode?: string;
    redeemOnlineUrl?: string;
    termsAndConditions?: string;
  };
}

export interface GbpPostResult {
  name: string; // format: "accounts/{accountId}/locations/{locationId}/localPosts/{postId}"
  searchUrl?: string;
  state?: string;
}

/**
 * Validates and compiles local post params into the schema expected by Google Business Profile API.
 * Blocks PRODUCT posts explicitly.
 */
export function compileGbpPost(params: GbpLocalPostParams): any {
  if (params.topicType === "PRODUCT") {
    throw new Error(
      "Product posts are not programmatically supported by the Google Business Profile API. Please create this post manually on the Google Business Profile dashboard."
    );
  }

  const payload: any = {
    languageCode: params.languageCode || "en-US",
    topicType: params.topicType,
  };

  if (params.summary) {
    payload.summary = params.summary;
  }

  // Call to Action
  if (params.callToAction) {
    // Validate CALL cta doesn't require a URL, others do
    if (params.callToAction.actionType !== "CALL" && !params.callToAction.url) {
      throw new Error(`Call to Action type "${params.callToAction.actionType}" requires a URL`);
    }
    payload.callToAction = {
      actionType: params.callToAction.actionType,
    };
    if (params.callToAction.url) {
      payload.callToAction.url = params.callToAction.url;
    }
  }

  // Media
  if (params.media && params.media.length > 0) {
    payload.media = params.media.map(m => ({
      mediaFormat: m.mediaFormat || "PHOTO",
      sourceUrl: m.sourceUrl
    }));
  }

  // Event validation and construction
  if (params.topicType === "EVENT" || params.topicType === "OFFER") {
    if (!params.event) {
      throw new Error(`Topic type "${params.topicType}" requires an event definition (dates/schedule)`);
    }
    if (!params.event.title) {
      throw new Error(`Event title is required for "${params.topicType}" posts`);
    }
    if (!params.event.schedule || !params.event.schedule.startDate || !params.event.schedule.endDate) {
      throw new Error(`Event schedule with startDate and endDate is required for "${params.topicType}" posts`);
    }

    payload.event = {
      title: params.event.title,
      schedule: {
        startDate: params.event.schedule.startDate,
        endDate: params.event.schedule.endDate
      }
    };

    if (params.event.schedule.startTime) {
      payload.event.schedule.startTime = params.event.schedule.startTime;
    }
    if (params.event.schedule.endTime) {
      payload.event.schedule.endTime = params.event.schedule.endTime;
    }
  }

  // Offer fields
  if (params.topicType === "OFFER" && params.offer) {
    payload.offer = {};
    if (params.offer.couponCode) {
      payload.offer.couponCode = params.offer.couponCode;
    }
    if (params.offer.redeemOnlineUrl) {
      payload.offer.redeemOnlineUrl = params.offer.redeemOnlineUrl;
    }
    if (params.offer.termsAndConditions) {
      payload.offer.termsAndConditions = params.offer.termsAndConditions;
    }
  }

  return payload;
}

/**
 * Publishes a post to Google Business Profile localPosts endpoint using raw request.
 */
export async function publishGbpPost(params: {
  authClient: any;
  accountName: string;   // format: "accounts/{accountId}"
  locationName: string;  // format: "locations/{locationId}"
  post: GbpLocalPostParams;
}): Promise<GbpPostResult> {
  const { authClient, accountName, locationName, post } = params;

  if (!authClient) throw new Error("Missing authClient parameter");
  if (!accountName) throw new Error("Missing accountName parameter");
  if (!locationName) throw new Error("Missing locationName parameter");
  if (!post) throw new Error("Missing post parameter");

  // Format account and location names to ensure they match expected URL parts
  const cleanAccount = accountName.startsWith("accounts/") ? accountName : `accounts/${accountName}`;
  const cleanLocation = locationName.startsWith("locations/") ? locationName : `locations/${locationName}`;

  const requestBody = compileGbpPost(post);

  const url = `https://mybusiness.googleapis.com/v4/${cleanAccount}/${cleanLocation}/localPosts`;

  try {
    const res = await authClient.request({
      url,
      method: "POST",
      data: requestBody
    });

    if (res.status >= 300) {
      throw new Error(`Google API returned HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }

    return {
      name: res.data.name || "",
      searchUrl: res.data.searchUrl,
      state: res.data.state
    };
  } catch (err: any) {
    const apiError = err.response?.data?.error?.message || err.message || String(err);
    throw new Error(`Google Business Profile Publish Failed: ${apiError}`);
  }
}
