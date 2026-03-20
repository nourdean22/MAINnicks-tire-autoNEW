/**
 * SMS Campaign Audit Script
 * Pulls message logs from Twilio API and analyzes delivery rates, costs, and failures.
 */
import twilio from "twilio";

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

if (!sid || !token) {
  console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  process.exit(1);
}

const client = twilio(sid, token);

async function audit() {
  console.log("=== TWILIO SMS CAMPAIGN AUDIT ===\n");
  console.log(`Account SID: ${sid.substring(0, 10)}...`);
  console.log(`From Number: ${fromNumber}\n`);

  // 1. Get account balance
  try {
    const balance = await client.balance.fetch();
    console.log(`💰 Account Balance: $${parseFloat(balance.balance).toFixed(2)} ${balance.currency}`);
  } catch (e) {
    console.log(`💰 Account Balance: Unable to fetch (${e.message})`);
  }

  // 2. Pull all messages sent from our number
  console.log("\n--- Fetching message logs from Twilio ---");
  let allMessages = [];
  try {
    const messages = await client.messages.list({
      from: fromNumber,
      limit: 1000,
    });
    allMessages = messages;
    console.log(`Total messages found: ${allMessages.length}\n`);
  } catch (e) {
    console.error(`Failed to fetch messages: ${e.message}`);
    // Try without from filter
    try {
      const messages = await client.messages.list({ limit: 500 });
      allMessages = messages;
      console.log(`Total messages found (all): ${allMessages.length}\n`);
    } catch (e2) {
      console.error(`Also failed: ${e2.message}`);
      process.exit(1);
    }
  }

  if (allMessages.length === 0) {
    console.log("No messages found in Twilio logs.");
    return;
  }

  // 3. Status breakdown
  const statusCounts = {};
  const errorCodes = {};
  let totalCost = 0;
  let totalSegments = 0;
  const msgByDate = {};
  const failedNumbers = [];

  for (const msg of allMessages) {
    // Status
    const status = msg.status;
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    // Cost
    const cost = parseFloat(msg.price || "0");
    totalCost += Math.abs(cost);

    // Segments
    const segments = parseInt(msg.numSegments || "1");
    totalSegments += segments;

    // Error codes
    if (msg.errorCode) {
      const key = `${msg.errorCode}: ${msg.errorMessage || "Unknown"}`;
      errorCodes[key] = (errorCodes[key] || 0) + 1;
    }

    // Failed numbers
    if (status === "failed" || status === "undelivered") {
      failedNumbers.push({
        to: msg.to,
        status,
        errorCode: msg.errorCode,
        errorMessage: msg.errorMessage,
        date: msg.dateSent,
      });
    }

    // By date
    const dateKey = msg.dateSent
      ? new Date(msg.dateSent).toISOString().split("T")[0]
      : "unknown";
    msgByDate[dateKey] = (msgByDate[dateKey] || 0) + 1;
  }

  // 4. Print results
  console.log("=== DELIVERY STATUS BREAKDOWN ===");
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / allMessages.length) * 100).toFixed(1);
    console.log(`  ${status}: ${count} (${pct}%)`);
  }

  console.log(`\n=== COST ANALYSIS ===`);
  console.log(`  Total messages: ${allMessages.length}`);
  console.log(`  Total segments: ${totalSegments}`);
  console.log(`  Avg segments/msg: ${(totalSegments / allMessages.length).toFixed(2)}`);
  console.log(`  Total cost: $${totalCost.toFixed(4)}`);
  console.log(`  Avg cost/msg: $${(totalCost / allMessages.length).toFixed(4)}`);
  console.log(`  Avg cost/segment: $${totalSegments > 0 ? (totalCost / totalSegments).toFixed(4) : "N/A"}`);

  if (Object.keys(errorCodes).length > 0) {
    console.log(`\n=== ERROR CODES ===`);
    for (const [code, count] of Object.entries(errorCodes).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}`);
    }
  }

  console.log(`\n=== MESSAGES BY DATE ===`);
  for (const [date, count] of Object.entries(msgByDate).sort()) {
    console.log(`  ${date}: ${count}`);
  }

  if (failedNumbers.length > 0) {
    console.log(`\n=== FAILED/UNDELIVERED MESSAGES (${failedNumbers.length}) ===`);
    // Group by error
    const byError = {};
    for (const f of failedNumbers) {
      const key = f.errorCode || "unknown";
      if (!byError[key]) byError[key] = [];
      byError[key].push(f.to);
    }
    for (const [code, numbers] of Object.entries(byError)) {
      console.log(`  Error ${code}: ${numbers.length} numbers`);
      // Show first 5
      numbers.slice(0, 5).forEach((n) => console.log(`    - ${n}`));
      if (numbers.length > 5) console.log(`    ... and ${numbers.length - 5} more`);
    }
  }

  // 5. Message length analysis (sample first 10)
  console.log(`\n=== MESSAGE LENGTH ANALYSIS (sample) ===`);
  const sampleMsgs = allMessages.slice(0, 10);
  for (const msg of sampleMsgs) {
    const bodyLen = (msg.body || "").length;
    const segs = parseInt(msg.numSegments || "1");
    console.log(`  To: ${msg.to} | Len: ${bodyLen} chars | Segments: ${segs} | Status: ${msg.status} | Cost: $${Math.abs(parseFloat(msg.price || "0")).toFixed(4)}`);
  }

  // 6. Segment distribution
  const segDist = {};
  for (const msg of allMessages) {
    const segs = parseInt(msg.numSegments || "1");
    segDist[segs] = (segDist[segs] || 0) + 1;
  }
  console.log(`\n=== SEGMENT DISTRIBUTION ===`);
  for (const [segs, count] of Object.entries(segDist).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const pct = ((count / allMessages.length) * 100).toFixed(1);
    console.log(`  ${segs} segment(s): ${count} messages (${pct}%)`);
  }

  // 7. Recommendations
  console.log(`\n=== OPTIMIZATION RECOMMENDATIONS ===`);
  const avgSegs = totalSegments / allMessages.length;
  if (avgSegs > 1.5) {
    console.log(`  ⚠️  HIGH SEGMENT COUNT: Average ${avgSegs.toFixed(2)} segments/msg.`);
    console.log(`     SMS costs $0.0079/segment. Reducing to 1 segment saves ~$${((avgSegs - 1) * 0.0079 * 1631).toFixed(2)} on remaining 1,631 sends.`);
    console.log(`     → Keep messages under 160 chars for 1 segment.`);
  }
  if (failedNumbers.length > 0) {
    const failRate = (failedNumbers.length / allMessages.length * 100).toFixed(1);
    console.log(`  ⚠️  FAILURE RATE: ${failRate}% (${failedNumbers.length}/${allMessages.length})`);
    console.log(`     → Mark failed numbers to skip on retry, saving ~$${(failedNumbers.length * avgSegs * 0.0079).toFixed(2)}`);
  }
}

audit().catch(console.error);
