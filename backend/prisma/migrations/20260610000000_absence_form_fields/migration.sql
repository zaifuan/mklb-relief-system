-- ════════════════════════════════════════════════════════════
--  Migrasi Fasa 4 — medan borang ketidakhadiran (additive sahaja)
--  Tambah: jenis, masaMula, reference. Tiada lajur lama diubah/dipadam.
-- ════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "absence_records" ADD COLUMN "jenis" TEXT NOT NULL DEFAULT 'SEPANJANG_HARI';
ALTER TABLE "absence_records" ADD COLUMN "masaMula" TEXT;
ALTER TABLE "absence_records" ADD COLUMN "reference" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "absence_records_reference_key" ON "absence_records"("reference");
