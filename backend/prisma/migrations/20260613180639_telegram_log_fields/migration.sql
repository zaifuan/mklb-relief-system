-- FASA 7: medan tambahan telegram_logs (additive, semua nullable).
-- Selaras prompt #12: trigger_type, total_records, success, error_message.
ALTER TABLE "telegram_logs" ADD COLUMN "triggerType" TEXT;
ALTER TABLE "telegram_logs" ADD COLUMN "totalRecords" INTEGER;
ALTER TABLE "telegram_logs" ADD COLUMN "success" BOOLEAN;
ALTER TABLE "telegram_logs" ADD COLUMN "errorMessage" TEXT;
