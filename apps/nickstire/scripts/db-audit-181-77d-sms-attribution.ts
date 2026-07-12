/**
 * wave-181.77 part 4 · audit the wave-181.51 SMS instrumentation tables.
 *
 * SMS attribution path (added wave-181.51):
 *   - sms_messages adds: replyCount, firstReplyAt, optOutAt,
 *     convertedCount, attributedBookingId, attributedAt, variantKey
 *   - recordSmsReply() writes on inbound · scans recent outbound for
 *     same phone within 7d to attribute
 *
 * Check:
 *   1. Are the new columns indexed for the hot lookup paths?
 *   2. Does the reply-attribution scan use an index (or full-table)?
 *   3. The conversion attribution writes — what's the index strategy?
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  console.log("\n═══ sms_messages new attribution columns ═══\n");
  const [cols] = await conn.query("SHOW COLUMNS FROM sms_messages");
  const target = (cols as Array<{ Field: string; Type: string; Null: string; Key: string }>)
    .filter((r) => /reply|optOut|converted|attributed|variant/i.test(r.Field));
  console.log(JSON.stringify(target, null, 2));

  console.log("\n═══ EXPLAIN: recordSmsReply attribution scan ═══\n");
  // Pattern: find most-recent outbound to this phone within 7d that's NOT opted out
  const [exp1] = await conn.query(`
    EXPLAIN SELECT m.id, m.body, m.variantKey, m.firstReplyAt
    FROM sms_messages m
    INNER JOIN sms_conversations c ON c.id = m.conversationId
    WHERE c.phone = '+12168620005'
      AND m.direction = 'outbound'
      AND m.createdAt > NOW() - INTERVAL 7 DAY
    ORDER BY m.createdAt DESC
    LIMIT 1
  `);
  console.log(JSON.stringify(exp1, null, 2));

  console.log("\n═══ EXPLAIN: conversion attribution scan (booking_created event) ═══\n");
  // Pattern: same phone, outbound within 14d, no conversion yet
  const [exp2] = await conn.query(`
    EXPLAIN SELECT m.id, m.variantKey, m.convertedCount
    FROM sms_messages m
    INNER JOIN sms_conversations c ON c.id = m.conversationId
    WHERE c.phone = '+12168620005'
      AND m.direction = 'outbound'
      AND m.createdAt > NOW() - INTERVAL 14 DAY
      AND m.attributedBookingId IS NULL
    ORDER BY m.createdAt DESC
    LIMIT 1
  `);
  console.log(JSON.stringify(exp2, null, 2));

  console.log("\n═══ EXPLAIN: summary30d tier rollup (admin tile · 60s refresh) ═══\n");
  const [exp3] = await conn.query(`
    EXPLAIN SELECT variantKey, COUNT(*) AS sent, SUM(replyCount > 0) AS replied, SUM(convertedCount > 0) AS converted, SUM(optOutAt IS NOT NULL) AS optedOut
    FROM sms_messages
    WHERE direction = 'outbound' AND createdAt > NOW() - INTERVAL 30 DAY
    GROUP BY variantKey
  `);
  console.log(JSON.stringify(exp3, null, 2));

  // Row counts for context
  console.log("\n═══ row count + index summary ═══\n");
  const [rc] = await conn.query("SELECT COUNT(*) AS n FROM sms_messages WHERE direction = 'outbound' AND createdAt > NOW() - INTERVAL 30 DAY");
  console.log(`30d outbound sms count: ${JSON.stringify(rc)}`);

  const [idx] = await conn.query("SHOW INDEX FROM sms_messages");
  const cleaned = (idx as Array<{ Key_name: string; Column_name: string; Seq_in_index: number; Non_unique: number }>)
    .reduce<Record<string, { cols: string[]; unique: boolean }>>((acc, r) => {
      const k = r.Key_name;
      if (!acc[k]) acc[k] = { cols: [], unique: r.Non_unique === 0 };
      acc[k].cols[r.Seq_in_index - 1] = r.Column_name;
      return acc;
    }, {});
  console.log("\nsms_messages indexes:");
  console.log(JSON.stringify(cleaned, null, 2));
} finally {
  await conn.end();
}
