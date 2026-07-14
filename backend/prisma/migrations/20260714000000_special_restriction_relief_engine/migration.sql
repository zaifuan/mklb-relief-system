-- Feature: Sekatan Khas Relief (halaman Super Admin) — SSOT tunggal bagi
-- sekatan relief kekal, menggantikan KATEGORI_EXEMPT / NAMA_EXEMPT / magic
-- target "LELAKI". ADDITIVE sahaja: tiada jadual lain diubah, tiada baris
-- sedia ada dipadam. Baris special_restrictions sedia ada kekal (default
-- restrictionType = SPECIFIC_TIME, teacherId = NULL) — diklasifikasikan
-- semula & dipautkan oleh skrip migrasi data idempotent berasingan
-- (prisma/migrateSpecialRestrictions.js), BUKAN oleh migration.sql ini.

-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('FULL_WEEK', 'SPECIFIC_DAYS', 'SPECIFIC_TIME');

-- AlterTable: tambah teacherId + restrictionType; masaDari/masaHingga jadi nullable
-- (FULL_WEEK & SPECIFIC_DAYS tidak memerlukan julat waktu).
ALTER TABLE "special_restrictions"
  ADD COLUMN "teacherId" INTEGER,
  ADD COLUMN "restrictionType" "RestrictionType" NOT NULL DEFAULT 'SPECIFIC_TIME',
  ALTER COLUMN "masaDari" DROP NOT NULL,
  ALTER COLUMN "masaHingga" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "special_restrictions_teacherId_idx" ON "special_restrictions"("teacherId");

-- AddForeignKey
ALTER TABLE "special_restrictions" ADD CONSTRAINT "special_restrictions_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
