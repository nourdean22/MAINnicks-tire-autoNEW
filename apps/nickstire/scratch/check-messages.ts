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
    console.log("=== Bookings Details ===");
    const [bookings] = await conn.execute(
      "SELECT id, name, phone, email, service, vehicle, message, createdAt FROM bookings ORDER BY createdAt ASC"
    );
    for (const b of bookings as any[]) {
      console.log(`ID: ${b.id}`);
      console.log(`  Name: "${b.name}"`);
      console.log(`  Phone: "${b.phone}"`);
      console.log(`  Email: "${b.email || 'N/A'}"`);
      console.log(`  Service: "${b.service}"`);
      console.log(`  Vehicle: "${b.vehicle || 'N/A'}"`);
      console.log(`  Message: "${b.message || 'N/A'}"`);
      console.log(`  Created: ${b.createdAt.toISOString()}`);
      console.log("-----------------------------------------");
    }
  } finally {
    await conn.end();
  }
}

main().catch(console.error);
