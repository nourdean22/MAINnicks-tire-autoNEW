-- CreateTable
CREATE TABLE IF NOT EXISTS "content_nodes" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "category" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "contacts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" VARCHAR(32) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "psychProfile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bookings" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "cal_event_id" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreements" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signed_at" TIMESTAMP(3),
    "signature_metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "products" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "stripe_price_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "orders" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "stripe_session_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "financial_transactions" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "payee" TEXT NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "plaid_transaction_id" TEXT,
    "manual_override_category" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "investment_holdings" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shares" DECIMAL(12,4) NOT NULL,
    "cost_basis_cents" INTEGER NOT NULL,
    "current_price_cents" INTEGER NOT NULL,
    "last_updated_at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "short_links" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "campaign" VARCHAR(64),
    "medium" VARCHAR(64),
    "source" VARCHAR(64),
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "link_clicks" (
    "id" TEXT NOT NULL,
    "short_link_id" TEXT NOT NULL,
    "ip_hash" VARCHAR(64) NOT NULL,
    "user_agent" TEXT,
    "referrer" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "content_nodes_slug_key" ON "content_nodes"("slug");
CREATE INDEX IF NOT EXISTS "content_nodes_category_published_idx" ON "content_nodes"("category", "published");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_email_key" ON "contacts"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_phone_key" ON "contacts"("phone");
CREATE INDEX IF NOT EXISTS "contacts_role_status_idx" ON "contacts"("role", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_contact_id_idx" ON "bookings"("contact_id");
CREATE INDEX IF NOT EXISTS "bookings_start_time_idx" ON "bookings"("start_time");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreements_contact_id_idx" ON "agreements"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_contact_id_idx" ON "orders"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "financial_transactions_plaid_transaction_id_key" ON "financial_transactions"("plaid_transaction_id");
CREATE INDEX IF NOT EXISTS "financial_transactions_date_category_idx" ON "financial_transactions"("date", "category");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "investment_holdings_symbol_key" ON "investment_holdings"("symbol");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "link_clicks_short_link_id_clicked_at_idx" ON "link_clicks"("short_link_id", "clicked_at");

-- AddForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_contact_id_fkey";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_contact_id_fkey";
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_contact_id_fkey";
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_product_id_fkey";
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_clicks" DROP CONSTRAINT IF EXISTS "link_clicks_short_link_id_fkey";
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
