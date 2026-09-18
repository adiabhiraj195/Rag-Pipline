-- CreateTable
CREATE TABLE IF NOT EXISTS "organisations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "users" 
    ALTER COLUMN "role" SET DEFAULT 'Customer',
    ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "is_verified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "organisation_id" UUID;

-- AlterTable
ALTER TABLE "documents" 
    ADD COLUMN IF NOT EXISTS "organisation_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organisations_name_key" ON "organisations"("name");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_organisation_id_fkey'
    ) THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_organisation_id_fkey'
    ) THEN
        ALTER TABLE "documents" ADD CONSTRAINT "documents_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

