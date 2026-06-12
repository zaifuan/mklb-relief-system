-- Fasa 9: tambah nilai 'PEMBATALAN' ke enum TelegramJenis (ADDITIVE sahaja).
-- Selamat pada PostgreSQL 16. Tiada perubahan data; tiada kesan jadual lain.
ALTER TYPE "TelegramJenis" ADD VALUE IF NOT EXISTS 'PEMBATALAN';
