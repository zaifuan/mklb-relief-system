-- ════════════════════════════════════════════════════════════
--  Migrasi awal — Sistem Auto Jana Jadual Guru Ganti (Fasa 1)
--  Dijana untuk dipadankan dengan schema.prisma.
--  Akan diaplikasi melalui: prisma migrate deploy
-- ════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "StatusBorang" AS ENUM ('AKTIF', 'BATAL');
CREATE TYPE "ReliefBatchStatus" AS ENUM ('DRAF', 'DIJANA', 'DIHANTAR', 'SELESAI');
CREATE TYPE "ReliefRowStatus" AS ENUM ('CADANGAN', 'DISAHKAN', 'BATAL');
CREATE TYPE "ExclusionMod" AS ENUM ('SEPANJANG_HARI', 'SLOT');
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'ADMIN_RELIEF');
CREATE TYPE "TelegramJenis" AS ENUM ('SNAPSHOT', 'REALTIME', 'MANUAL', 'RELIEF_PDF');
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'OK', 'FAIL');

-- CreateTable
CREATE TABLE "teacher_categories" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "isReliefExempt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teacher_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teachers" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classes" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teacher_schedule" (
    "id" SERIAL NOT NULL,
    "hari" TEXT NOT NULL,
    "slot" TEXT,
    "masa" TEXT NOT NULL,
    "guru" TEXT NOT NULL,
    "kelas" TEXT NOT NULL,
    "subjek" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teacher_schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "class_schedule" (
    "id" SERIAL NOT NULL,
    "hari" TEXT NOT NULL,
    "kelas" TEXT NOT NULL,
    "masa" TEXT NOT NULL,
    "namaGuru" TEXT,
    "subjek" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "class_schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "absence_records" (
    "id" SERIAL NOT NULL,
    "guruNama" TEXT NOT NULL,
    "hari" TEXT NOT NULL,
    "tarikh" DATE NOT NULL,
    "sebabKategori" TEXT NOT NULL,
    "sebabDetail" TEXT,
    "kelas" TEXT NOT NULL DEFAULT '-',
    "perluGanti" BOOLEAN NOT NULL DEFAULT true,
    "statusBorang" "StatusBorang" NOT NULL DEFAULT 'AKTIF',
    "subjek" TEXT,
    "submittedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "absence_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_snapshots" (
    "id" SERIAL NOT NULL,
    "tarikh" DATE NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "relief_batches" (
    "id" SERIAL NOT NULL,
    "tarikh" DATE NOT NULL,
    "status" "ReliefBatchStatus" NOT NULL DEFAULT 'DRAF',
    "snapshotId" INTEGER,
    "generatedBy" TEXT,
    "generatedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "relief_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "relief_assignments" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "guruTakHadir" TEXT NOT NULL,
    "tarikh" DATE NOT NULL,
    "kelas" TEXT NOT NULL,
    "masa" TEXT NOT NULL,
    "hari" TEXT NOT NULL,
    "guruGanti" TEXT,
    "kategori" TEXT,
    "status" "ReliefRowStatus" NOT NULL DEFAULT 'CADANGAN',
    "isTier2" BOOLEAN NOT NULL DEFAULT false,
    "auditNote" TEXT,
    "subjek" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "relief_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "relief_exclusions" (
    "id" SERIAL NOT NULL,
    "guruNama" TEXT NOT NULL,
    "tarikh" DATE NOT NULL,
    "mod" "ExclusionMod" NOT NULL DEFAULT 'SEPANJANG_HARI',
    "masaDari" TEXT,
    "masaHingga" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "relief_exclusions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "special_restrictions" (
    "id" SERIAL NOT NULL,
    "target" TEXT NOT NULL,
    "hariList" TEXT[],
    "masaDari" TEXT NOT NULL,
    "masaHingga" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "catatan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "special_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "nama" "RoleName" NOT NULL,
    "permissions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "nama" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_assignments" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "hariBertugas" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "admin_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_logs" (
    "id" SERIAL NOT NULL,
    "tarikh" DATE,
    "jenis" "TelegramJenis" NOT NULL,
    "messageText" TEXT,
    "telegramMessageId" TEXT,
    "status" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_logs" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "recordsSynced" JSONB,
    "error" TEXT,
    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_settings" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique)
CREATE UNIQUE INDEX "teacher_categories_nama_key" ON "teacher_categories"("nama");
CREATE UNIQUE INDEX "teachers_nama_key" ON "teachers"("nama");
CREATE UNIQUE INDEX "classes_nama_key" ON "classes"("nama");
CREATE UNIQUE INDEX "daily_snapshots_tarikh_key" ON "daily_snapshots"("tarikh");
CREATE UNIQUE INDEX "relief_batches_tarikh_key" ON "relief_batches"("tarikh");
CREATE UNIQUE INDEX "roles_nama_key" ON "roles"("nama");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "admin_assignments_userId_key" ON "admin_assignments"("userId");
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex (regular)
CREATE INDEX "teacher_schedule_hari_guru_idx" ON "teacher_schedule"("hari", "guru");
CREATE INDEX "teacher_schedule_hari_kelas_idx" ON "teacher_schedule"("hari", "kelas");
CREATE INDEX "class_schedule_hari_kelas_idx" ON "class_schedule"("hari", "kelas");
CREATE INDEX "absence_records_tarikh_statusBorang_idx" ON "absence_records"("tarikh", "statusBorang");
CREATE INDEX "absence_records_guruNama_tarikh_idx" ON "absence_records"("guruNama", "tarikh");
CREATE INDEX "relief_assignments_tarikh_idx" ON "relief_assignments"("tarikh");
CREATE INDEX "relief_assignments_batchId_idx" ON "relief_assignments"("batchId");
CREATE INDEX "relief_assignments_guruGanti_tarikh_idx" ON "relief_assignments"("guruGanti", "tarikh");
CREATE INDEX "relief_exclusions_tarikh_idx" ON "relief_exclusions"("tarikh");
CREATE INDEX "telegram_logs_tarikh_idx" ON "telegram_logs"("tarikh");
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "relief_batches" ADD CONSTRAINT "relief_batches_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "daily_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "relief_assignments" ADD CONSTRAINT "relief_assignments_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "relief_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_assignments" ADD CONSTRAINT "admin_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
