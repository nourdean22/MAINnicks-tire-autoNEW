const STORE_NAME = "Nick's Tire & Auto";
const STORE_PHONE = "(216) 862-0005";
const GBP_REVIEW_URL = "https://search.google.com/local/writereview?placeid=ChIJSWRRLdr_MIgRxdlMIMPcqww";
const REFERRAL_URL = "https://nickstire.org/refer";

function segs(msg) {
  return msg.length <= 160 ? 1 : Math.ceil(msg.length / 153);
}

// Current messages
const recent = `Hi John, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nIf you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n${GBP_REVIEW_URL}\n\nKnow someone who needs reliable auto service? Refer them to us: ${REFERRAL_URL}\n\nThank you! — Nick's Team\n${STORE_PHONE}`;

const lapsed = `Hi John, this is ${STORE_NAME}. Thank you for trusting us with your vehicle. We hope it's running great!\n\nIf you had a good experience, a quick Google review means a lot:\n${GBP_REVIEW_URL}\n\nRefer a friend or family member: ${REFERRAL_URL}\n\nWe'd love to see you again. — Nick's Team\n${STORE_PHONE}`;

// Campaign message (from retryCampaign)
const campaign = `Hi John, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nIf you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n${GBP_REVIEW_URL}\n\nKnow someone who needs reliable auto service? Refer them to us: nickstire.org/refer\n\nThank you! — Nick's Team\n${STORE_PHONE}`;

console.log("=== CURRENT MESSAGE LENGTHS ===\n");
console.log(`Campaign msg:         ${campaign.length} chars → ${segs(campaign)} segments → $${(segs(campaign) * 0.0079).toFixed(4)}/msg`);
console.log(`Recent follow-up:     ${recent.length} chars → ${segs(recent)} segments → $${(segs(recent) * 0.0079).toFixed(4)}/msg`);
console.log(`Lapsed follow-up:     ${lapsed.length} chars → ${segs(lapsed)} segments → $${(segs(lapsed) * 0.0079).toFixed(4)}/msg`);

// Optimized messages using nickstire.org/review instead of full Google URL
const REVIEW_SHORT = "nickstire.org/review";
const REFER_SHORT = "nickstire.org/refer";

const optCampaign = `Hi John, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nGot 30 sec? A Google review helps other Cleveland drivers find honest repair:\n${REVIEW_SHORT}\n\nRefer a friend: ${REFER_SHORT}\n— Nick's Team ${STORE_PHONE}`;

const optRecent = `Hi John, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nGot 30 sec? A Google review helps other Cleveland drivers find honest repair:\n${REVIEW_SHORT}\n\nRefer a friend: ${REFER_SHORT}\n— Nick's Team ${STORE_PHONE}`;

const optLapsed = `Hi John, this is ${STORE_NAME}. Thank you for trusting us with your vehicle!\n\nA quick Google review means a lot to us:\n${REVIEW_SHORT}\n\nRefer a friend: ${REFER_SHORT}\nWe'd love to see you again. — Nick's Team ${STORE_PHONE}`;

console.log("\n=== OPTIMIZED MESSAGE LENGTHS ===\n");
console.log(`Opt Campaign/Recent:  ${optCampaign.length} chars → ${segs(optCampaign)} segments → $${(segs(optCampaign) * 0.0079).toFixed(4)}/msg`);
console.log(`Opt Lapsed:           ${optLapsed.length} chars → ${segs(optLapsed)} segments → $${(segs(optLapsed) * 0.0079).toFixed(4)}/msg`);

console.log("\n=== COST COMPARISON (1,631 remaining sends) ===\n");
const remaining = 1631;
const currentCost = remaining * segs(campaign) * 0.0079;
const optCost = remaining * segs(optCampaign) * 0.0079;
console.log(`Current (3 segs):     $${currentCost.toFixed(2)}`);
console.log(`Optimized (2 segs):   $${optCost.toFixed(2)}`);
console.log(`SAVINGS:              $${(currentCost - optCost).toFixed(2)} (${((1 - optCost/currentCost) * 100).toFixed(0)}% reduction)`);

// Also check: cost already spent on 250 messages
const spent = 250 * segs(campaign) * 0.0079;
console.log(`\nAlready spent (250 × 3 segs): $${spent.toFixed(2)}`);
console.log(`Would have been (250 × 2 segs): $${(250 * 2 * 0.0079).toFixed(2)}`);

// Print optimized messages
console.log("\n=== OPTIMIZED CAMPAIGN MESSAGE ===");
console.log(optCampaign);
console.log("\n=== OPTIMIZED LAPSED MESSAGE ===");
console.log(optLapsed);

// Verify with longest names
console.log("\n=== NAME LENGTH STRESS TEST ===");
for (const name of ["Jo", "John", "Christopher", "Alexandrina"]) {
  const m = `Hi ${name}, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nGot 30 sec? A Google review helps other Cleveland drivers find honest repair:\n${REVIEW_SHORT}\n\nRefer a friend: ${REFER_SHORT}\n— Nick's Team ${STORE_PHONE}`;
  console.log(`  "${name}" → ${m.length} chars → ${segs(m)} segments`);
}
