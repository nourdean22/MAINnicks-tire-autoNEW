import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    console.log("=== All New Bookings (Full Names) ===");
    const [newBookings] = await conn.execute(
      "SELECT id, name, phone, service, createdAt FROM bookings WHERE status = 'new' ORDER BY createdAt ASC"
    );
    for (const b of newBookings as any[]) {
      console.log(`  ID: ${b.id} | Date: ${b.createdAt.toISOString()} | Name: "${b.name}" | Phone: "${b.phone}" | Service: ${b.service}`);
    }

    console.log("\n=== All New Leads (Full Names) ===");
    const [newLeads] = await conn.execute(
      "SELECT id, name, phone, problem, createdAt FROM leads WHERE status = 'new' ORDER BY createdAt ASC"
    );
    for (const l of newLeads as any[]) {
      console.log(`  ID: ${l.id} | Date: ${l.createdAt.toISOString()} | Name: "${l.name}" | Phone: "${l.phone}" | Prob: ${l.problem}`);
    }

    console.log("\n=== Callbacks (Full Names) ===");
    const [newCallbacks] = await conn.execute(
      "SELECT id, name, phone, context, createdAt, status FROM callback_requests ORDER BY createdAt ASC"
    );
    for (const c of newCallbacks as any[]) {
      console.log(`  ID: ${c.id} | Status: ${c.status} | Date: ${c.createdAt.toISOString()} | Name: "${c.name}" | Phone: "${c.phone}"`);
    }

  } finally {
    await conn.end();
  }
}

main().catch(console.error);
