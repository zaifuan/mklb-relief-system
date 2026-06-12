-- ════════════════════════════════════════════════════════════
--  Migrasi Fasa 5 — status & soft delete (additive/rename selamat PG16)
--  • enum StatusBorang: BATAL → DIBATALKAN, tambah SELESAI
--  • absence_records: tambah deletedAt (soft delete)
-- ════════════════════════════════════════════════════════════

-- AlterEnum
ALTER TYPE "StatusBorang" RENAME VALUE 'BATAL' TO 'DIBATALKAN';
ALTER TYPE "StatusBorang" ADD VALUE 'SELESAI';

-- AlterTable
ALTER TABLE "absence_records" ADD COLUMN "deletedAt" TIMESTAMP(3);
