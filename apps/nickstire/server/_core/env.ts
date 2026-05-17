function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`${key} environment variable is required`);
  return val;
}

export const ENV = {
  get cookieSecret() { return requireEnv("JWT_SECRET"); },
  get databaseUrl() { return requireEnv("DATABASE_URL"); },
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  shopEmail: process.env.SHOP_EMAIL ?? "",
  ceoEmail: process.env.CEO_EMAIL ?? "",
};
