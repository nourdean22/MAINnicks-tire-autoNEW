const placeholderDatabaseUrl = "postgresql://user:password@localhost:5432/statenour";

function readDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || "";
}

export const isDemoMode = !readDatabaseUrl() || readDatabaseUrl() === placeholderDatabaseUrl;

export function getRuntimeLabel() {
  return isDemoMode ? "DEMO DATA" : "POSTGRES";
}
