-- Tambah sokongan masa pada Tetapan Khas Jadual (ADDITIVE).
-- Baris sedia ada → scope = FULL_DAY (default), masa null (kekal kelakuan asal).
CREATE TYPE "SpecialSettingScope" AS ENUM ('FULL_DAY', 'TIME_RANGE');

ALTER TABLE "daily_special_settings"
  ADD COLUMN "scope" "SpecialSettingScope" NOT NULL DEFAULT 'FULL_DAY',
  ADD COLUMN "masaMula" TEXT,
  ADD COLUMN "masaTamat" TEXT;
