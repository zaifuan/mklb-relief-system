-- K05: penanda pelarasan manual (additive, default false — tiada kesan pada baris sedia ada)
ALTER TABLE "relief_assignments" ADD COLUMN "diubahManual" BOOLEAN NOT NULL DEFAULT false;
