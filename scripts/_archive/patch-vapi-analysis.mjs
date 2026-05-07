/**
 * One-off Vapi PATCH script — surgical analysis-plan merge.
 *
 * Updates ONLY the analysisPlan on the existing "Nick" assistant
 * (id 150fe622-...). Leaves voice, model, prompt, tools, transcriber,
 * voicemail, server URL, knowledge base, forwarding number untouched.
 *
 * Adds:
 *  · summaryPlan (2-3 sentence call summary)
 *  · successEvaluationPlan (PASS/FAIL rubric)
 *  · structuredDataPlan (extract callType/tireSize/vehicle/sentiment/outcome)
 *
 * Per Option C from the audit: "merge the best of both."
 *
 * Usage: node --env-file=.env scripts/patch-vapi-analysis.mjs
 */

const ASSISTANT_ID = "150fe622-0b9f-4b03-b8c7-3063812717ae";
const VAPI_API_KEY = process.env.VAPI_API_KEY;

if (!VAPI_API_KEY) {
  console.error("VAPI_API_KEY not set");
  process.exit(1);
}

const analysisPlan = {
  summaryPlan: {
    enabled: true,
    timeoutSeconds: 30,
    messages: [
      {
        role: "system",
        content:
          "You are a call analyst for Nick's Tire & Auto. Summarize this call in 2-3 sentences. Be concrete: what the customer wanted, what was agreed, what action is needed. Specifics like tire size, vehicle, booked day, manager-transfer outcome. No filler.",
      },
      { role: "user", content: "Transcript:\n{{transcript}}" },
    ],
  },
  successEvaluationPlan: {
    enabled: true,
    timeoutSeconds: 30,
    rubric: "PassFail",
    messages: [
      {
        role: "system",
        content:
          "Evaluate whether this Nick's Tire & Auto call was successful. PASS = customer's question was answered AND (a) booking was made, OR (b) callback scheduled, OR (c) customer transferred to manager, OR (d) customer left with the info they needed. FAIL = customer hung up unsatisfied, AI made things up, AI failed to capture name/phone, customer asked for human and didn't get one, or transferCall failed and submitCallback was not called as fallback.",
      },
      { role: "user", content: "Transcript:\n{{transcript}}" },
    ],
  },
  structuredDataPlan: {
    enabled: true,
    timeoutSeconds: 30,
    schema: {
      type: "object",
      properties: {
        callType: {
          type: "string",
          enum: [
            "tire_inquiry",
            "repair_question",
            "booking",
            "callback",
            "info_only",
            "complaint",
            "voicemail",
            "wrong_number",
            "other",
          ],
          description: "Primary intent of the call.",
        },
        customerName: { type: "string", description: "Customer name if given." },
        customerPhone: { type: "string", description: "Phone number if captured." },
        vehicle: {
          type: "string",
          description: "Year/make/model if mentioned (e.g. '2017 Honda Civic').",
        },
        tireSize: {
          type: "string",
          description: "Tire size like '215/55R16' if mentioned.",
        },
        serviceMentioned: {
          type: "string",
          description: "Service or part discussed (used tires, brakes, oil, etc.).",
        },
        bookedDay: {
          type: "string",
          description: "Day they agreed to come in, if any.",
        },
        sentiment: {
          type: "string",
          enum: ["positive", "neutral", "negative"],
          description: "Customer mood during the call.",
        },
        outcome: {
          type: "string",
          enum: [
            "booked",
            "callback_scheduled",
            "info_given",
            "transferred_to_manager",
            "escalated",
            "lost",
            "no_phone",
            "voicemail",
          ],
          description: "What happened by end of call.",
        },
        transferAttempted: {
          type: "boolean",
          description: "Did Nick attempt a manager transfer (transferCall tool)?",
        },
        transferSucceeded: {
          type: "boolean",
          description: "Did the transfer connect to the manager line?",
        },
        followUpNeeded: {
          type: "boolean",
          description: "Does someone need to call this person back?",
        },
        urgencyDetected: {
          type: "string",
          enum: ["low", "medium", "high"],
          description:
            "Stranded / blew out / can't drive = high. Routine inquiry = low.",
        },
      },
      required: ["callType", "outcome"],
    },
    messages: [
      {
        role: "system",
        content:
          "Extract structured data from this Nick's Tire & Auto call. If a field is unknown, omit it. Don't guess. Tire-stock calls usually result in 'transferred_to_manager' since Nick warm-transfers to the manager.",
      },
      { role: "user", content: "Transcript:\n{{transcript}}" },
    ],
  },
};

console.log("Patching Vapi assistant", ASSISTANT_ID);
console.log("Adding: summaryPlan, successEvaluationPlan, structuredDataPlan");
console.log("Leaving alone: voice, model, prompt, tools, transcriber, voicemail, server, knowledge base, forwarding number");

const res = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${VAPI_API_KEY}`,
  },
  body: JSON.stringify({ analysisPlan }),
});

const text = await res.text();
console.log("\nStatus:", res.status);
if (!res.ok) {
  console.error("Body:", text.slice(0, 1000));
  process.exit(1);
}

let data;
try {
  data = JSON.parse(text);
} catch {
  data = null;
}

if (data?.analysisPlan) {
  console.log("\n✓ analysisPlan applied:");
  console.log("  · summaryPlan.enabled:", data.analysisPlan.summaryPlan?.enabled);
  console.log("  · successEvaluationPlan.enabled:", data.analysisPlan.successEvaluationPlan?.enabled);
  console.log("  · structuredDataPlan.enabled:", data.analysisPlan.structuredDataPlan?.enabled);
}
console.log("\n✓ Existing fields preserved:");
console.log("  · name:", data?.name);
console.log("  · model.provider:", data?.model?.provider, "·", data?.model?.model);
console.log("  · voice.provider:", data?.voice?.provider, "·", data?.voice?.voiceId);
console.log("  · transcriber:", data?.transcriber?.provider, "·", data?.transcriber?.model);
console.log("  · firstMessage:", data?.firstMessage?.slice(0, 80));
console.log("  · forwardingPhoneNumber:", data?.forwardingPhoneNumber);
console.log("  · model.toolIds count:", data?.model?.toolIds?.length);
console.log("  · knowledgeBase fileIds count:", data?.model?.knowledgeBase?.fileIds?.length);
console.log("\nDone.");
