-- Tetapan Khas Jadual (harian) — jadual & enum BAHARU (additive).
-- Tiada kesan kepada absence_records, relief_assignments, atau data sync.

CREATE TYPE "SpecialSettingType" AS ENUM ('TEACHER_EXCLUSION', 'CLASS_EXCLUSION', 'PRIORITY_CLASS');

CREATE TABLE "daily_special_settings" (
    "id" SERIAL NOT NULL,
    "tarikh" DATE NOT NULL,
    "jenis" "SpecialSettingType" NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "daily_special_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_special_settings_tarikh_jenis_target_key" ON "daily_special_settings" ("tarikh", "jenis", "target");
CREATE INDEX "daily_special_settings_tarikh_idx" ON "daily_special_settings" ("tarikh");
