-- Rekod kumpulan: tambah kolum groupReference (ADDITIVE, nullable) + index.
-- Semua rekod daripada satu submit kumpulan berkongsi nilai GRP-YYYYMMDD-NNN.
-- null = rekod individu. Tiada kesan data sedia ada.
ALTER TABLE "absence_records" ADD COLUMN IF NOT EXISTS "groupReference" TEXT;
CREATE INDEX IF NOT EXISTS "absence_records_groupReference_idx" ON "absence_records" ("groupReference");
