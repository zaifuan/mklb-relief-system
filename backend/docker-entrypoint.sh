#!/bin/sh
set -e

echo "⏳ Menyemak sambungan & menjalankan migrasi..."
npx prisma migrate deploy

if [ "$SEED_ON_START" != "false" ]; then
  echo "🌱 Menjalankan seed (idempotent)..."
  node prisma/seed.js
fi

echo "🚀 Memulakan relief-backend..."
exec node src/server.js
