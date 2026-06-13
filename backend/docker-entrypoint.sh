#!/bin/sh
set -e

# Nota: docker-compose bind-mount (./backend:/app) + named volume
# (backend_node_modules:/app/node_modules). Named volume TIDAK auto-segerak
# dengan imej selepas build, jadi pakej baharu (cth: pdfkit) tidak muncul.
# Maka kita segerakkan dependency dari package.json setiap kali mula.
echo "📦 Menyegerakkan dependencies (npm install)..."
npm install --prefer-offline --no-audit --no-fund || echo "⚠️  npm install gagal — guna node_modules sedia ada."

echo "🧬 Menjana Prisma Client..."
npx prisma generate

# Sokong arahan one-off (cth: docker compose run --rm backend npm ls pdfkit)
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "⏳ Menyemak sambungan & menjalankan migrasi..."
npx prisma migrate deploy

if [ "$SEED_ON_START" != "false" ]; then
  echo "🌱 Menjalankan seed (idempotent)..."
  node prisma/seed.js
fi

echo "🚀 Memulakan relief-backend..."
exec node src/server.js
