-- Separuh hari sebagai JULAT MASA: tambah kolum masaTamat (ADDITIVE, nullable).
-- null = "Tamat sekolah" (julat hingga akhir hari). Tiada kesan data sedia ada.
ALTER TABLE "absence_records" ADD COLUMN IF NOT EXISTS "masaTamat" TEXT;
