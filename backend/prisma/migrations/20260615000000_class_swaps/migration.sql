-- Feature: Pertukaran Kelas (Suka Sama Suka).
-- Jadual BERASINGAN — TIADA relasi ke relief_batches / relief_assignments,
-- jadi "Jana Semula Relief" TIDAK akan menyentuh data ini.
-- ADDITIVE sahaja: tiada jadual sedia ada diubah; tiada data sedia ada disentuh.

-- CreateTable
CREATE TABLE "class_swaps" (
    "id" SERIAL NOT NULL,
    "absenceRecordId" INTEGER,
    "guruAsal" TEXT NOT NULL,
    "guruGanti" TEXT NOT NULL,
    "teacherIdAsal" INTEGER,
    "teacherIdGanti" INTEGER,
    "scheduleId" INTEGER,
    "slot" TEXT,
    "hari" TEXT NOT NULL,
    "tarikh" DATE NOT NULL,
    "kelas" TEXT NOT NULL,
    "masa" TEXT NOT NULL,
    "subjek" TEXT,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_swaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_swaps_tarikh_idx" ON "class_swaps"("tarikh");

-- CreateIndex
CREATE INDEX "class_swaps_guruAsal_tarikh_idx" ON "class_swaps"("guruAsal", "tarikh");

-- CreateIndex
CREATE INDEX "class_swaps_absenceRecordId_idx" ON "class_swaps"("absenceRecordId");

-- AddForeignKey
ALTER TABLE "class_swaps" ADD CONSTRAINT "class_swaps_absenceRecordId_fkey" FOREIGN KEY ("absenceRecordId") REFERENCES "absence_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
