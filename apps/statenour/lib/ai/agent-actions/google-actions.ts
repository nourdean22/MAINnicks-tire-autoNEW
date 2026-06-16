/**
 * Google integration action handlers — Calendar, Gmail, and Reviews.
 *
 * Designed to connect the Nick AI Agent with Google APIs and local DB caching.
 */
import type { ActionParams, ActionResult } from "./types";

export async function handleGoogleGetSchedule(params: ActionParams, type: string): Promise<ActionResult> {
  try {
    const { listEvents } = await import("@/lib/services/calendar-api");
    const daysAhead = params.daysAhead ? Number(params.daysAhead) : 1;
    const events = await listEvents({
      daysAhead,
      maxResults: 50,
    });
    return {
      action: type,
      success: true,
      result: {
        ok: true,
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          summary: e.summary ?? "(no title)",
          start: e.start ?? null,
          end: e.end ?? null,
          location: e.location ?? null,
          attendees: e.attendees ?? [],
          link: e.htmlLink ?? null,
        })),
      },
    };
  } catch (err) {
    return {
      action: type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleGoogleProposeEvent(params: ActionParams, type: string): Promise<ActionResult> {
  try {
    const title = String(params.title || "");
    const startISO = String(params.startISO || "");
    const endISO = params.endISO ? String(params.endISO) : undefined;
    const location = params.location ? String(params.location) : undefined;
    const description = params.description ? String(params.description) : undefined;
    const attendees = Array.isArray(params.attendees) ? params.attendees.map(String) : undefined;

    const start = new Date(startISO);
    if (isNaN(start.getTime())) {
      return { action: type, success: false, error: "Invalid startISO" };
    }
    const end = endISO ? new Date(endISO) : new Date(start.getTime() + 60 * 60_000);
    if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
      return { action: type, success: false, error: "Invalid endISO (must be after startISO)" };
    }

    const { isGoogleOauthConfigured } = await import("@/lib/services/google-oauth");
    const { createEvent } = await import("@/lib/services/calendar-api");
    const configured = await isGoogleOauthConfigured();

    if (configured) {
      try {
        const created = await createEvent({
          title,
          startISO,
          endISO,
          location,
          description,
          attendees,
        });
        return {
          action: type,
          success: true,
          result: {
            ok: true,
            created: true,
            eventId: created.id,
            composeUrl: created.htmlLink,
            summary: title,
            start: start.toISOString(),
            end: end.toISOString(),
          },
        };
      } catch (err) {
        console.error("Calendar API create failed, falling back to template URL:", err);
      }
    }

    // Google Calendar event-compose URL format fallback
    const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
    const urlParams = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${fmt(start)}/${fmt(end)}`,
    });
    if (location) urlParams.set("location", location);
    if (description) urlParams.set("details", description);
    if (attendees && attendees.length > 0) {
      urlParams.set("add", attendees.join(","));
    }
    const composeUrl = `https://calendar.google.com/calendar/render?${urlParams.toString()}`;
    return {
      action: type,
      success: true,
      result: {
        ok: true,
        created: false,
        composeUrl,
        summary: title,
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  } catch (err) {
    return {
      action: type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleGmailDraftReply(params: ActionParams, type: string): Promise<ActionResult> {
  const { draftReply, isGmailConfigured } = await import("@/lib/integrations/gmail");
  
  if (!isGmailConfigured()) {
    return {
      action: type,
      success: false,
      error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md",
    };
  }

  const threadId = String(params.threadId || "");
  const body = String(params.body || "");
  const subject = params.subject ? String(params.subject) : undefined;

  if (!threadId || !body) {
    return {
      action: type,
      success: false,
      error: "threadId and body are required params",
    };
  }

  const result = await draftReply({ threadId, body, subject });
  return {
    action: type,
    success: true,
    result,
  };
}

export async function handleGmailCreateDraft(params: ActionParams, type: string): Promise<ActionResult> {
  const { createDraft, isGmailConfigured } = await import("@/lib/integrations/gmail");
  
  if (!isGmailConfigured()) {
    return {
      action: type,
      success: false,
      error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md",
    };
  }

  const to = String(params.to || "");
  const subject = String(params.subject || "");
  const body = String(params.body || "");

  if (!to || !subject || !body) {
    return {
      action: type,
      success: false,
      error: "to, subject, and body are required params",
    };
  }

  const result = await createDraft({ to, subject, body });
  return {
    action: type,
    success: true,
    result,
  };
}

export async function handleGmailSendDraft(params: ActionParams, type: string): Promise<ActionResult> {
  const { sendDraft, isGmailConfigured } = await import("@/lib/integrations/gmail");
  
  if (!isGmailConfigured()) {
    return {
      action: type,
      success: false,
      error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md",
    };
  }

  const draftId = String(params.draftId || "");

  if (!draftId) {
    return {
      action: type,
      success: false,
      error: "draftId is a required param",
    };
  }

  const result = await sendDraft(draftId);
  return {
    action: type,
    success: true,
    result,
  };
}

export async function handleGoogleGetReviewStats(params: ActionParams, type: string): Promise<ActionResult> {
  const { getReviewStats } = await import("@/lib/integrations/google-reviews");
  const stats = await getReviewStats();
  return {
    action: type,
    success: true,
    result: stats,
  };
}

export async function handleGoogleGetUnrespondedReviews(params: ActionParams, type: string): Promise<ActionResult> {
  const { getUnrespondedReviews } = await import("@/lib/integrations/google-reviews");
  const minRating = typeof params.minRating === "number" ? params.minRating : 1;
  const maxRating = typeof params.maxRating === "number" ? params.maxRating : 3;
  
  const reviews = await getUnrespondedReviews(minRating, maxRating);
  return {
    action: type,
    success: true,
    result: { count: reviews.length, reviews },
  };
}

export async function handleGoogleDraftReviewResponse(params: ActionParams, type: string): Promise<ActionResult> {
  const { reviewResponseChain } = await import("@/lib/integrations/chain");
  const reviewerName = String(params.reviewerName || "Customer");
  const rating = Number(params.rating ?? 5);
  const reviewText = String(params.reviewText || "");
  const platform = String(params.platform || "Google");
  const clickupListId = String(params.clickupListId || process.env.CLICKUP_DEFAULT_LIST_ID || "");

  if (!clickupListId) {
    return {
      action: type,
      success: false,
      error: "clickupListId parameter (or CLICKUP_DEFAULT_LIST_ID env) required to draft review response",
    };
  }

  const chainResult = await reviewResponseChain({
    reviewerName,
    rating,
    reviewText,
    platform,
    clickupListId,
  });

  return {
    action: type,
    success: chainResult.status !== "failed",
    result: chainResult,
  };
}

export async function handleGoogleMarkReviewResponded(params: ActionParams, type: string): Promise<ActionResult> {
  const { markReviewResponded } = await import("@/lib/integrations/google-reviews");
  const reviewId = String(params.reviewId || "");
  const responseText = String(params.responseText || "");

  if (!reviewId || !responseText) {
    return {
      action: type,
      success: false,
      error: "reviewId and responseText are required params",
    };
  }

  await markReviewResponded(reviewId, responseText);
  return {
    action: type,
    success: true,
    result: { markedResponded: true, reviewId },
  };
}
