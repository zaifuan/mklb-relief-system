-- Tukar nama nilai enum peranan: ADMIN_RELIEF → ADMIN.
-- RENAME VALUE menukar nilai di tempat; semua baris roles & users sedia ada
-- yang merujuk ADMIN_RELIEF akan terus merujuk ADMIN secara automatik.
-- Tiada kesan kepada absence_records, relief_assignments, atau data sync.
ALTER TYPE "RoleName" RENAME VALUE 'ADMIN_RELIEF' TO 'ADMIN';
