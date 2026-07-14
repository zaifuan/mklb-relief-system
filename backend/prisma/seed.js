// ════════════════════════════════════════════════════════════
//  Seed — Sistem Auto Jana Jadual Guru Ganti (Fasa 1)
//  Idempotent: selamat dijalankan berulang kali (guna upsert).
//  Seed kategori, peranan, 5 akaun admin, sekatan khas, tetapan.
//  NOTA: Master data (guru, jadual) di-sync dari Sheet pada Fasa 2.
// ════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || 'ubah1234';

async function main() {
  console.log('🌱 Memulakan seed...');

  // ── 1) Kategori guru ──
  // BERSARA (2026-07-14): isReliefExempt TIDAK LAGI ditetapkan oleh seed dalam
  // apa jua keadaan (termasuk PENTADBIR) — medan kekal dalam schema untuk
  // keserasian sahaja, tetapi Relief Engine tidak lagi membacanya (lihat
  // reliefConfig.js). `update: {}` memastikan nilai sedia ada TIDAK disentuh;
  // `create` guna default schema (false) bagi kategori baharu.
  const categories = ['PENTADBIR', 'BIASA', 'PSS', 'KAUNSELOR', 'PRAKTIKAL'];
  for (const nama of categories) {
    await prisma.teacherCategory.upsert({
      where: { nama },
      update: {},
      create: { nama },
    });
  }
  console.log(`  ✓ ${categories.length} kategori guru`);

  // ── 2) Peranan ──
  const roles = [
    {
      nama: 'SUPER_ADMIN',
      permissions: {
        manageUsers: true,
        manageSettings: true,
        manageDutyDays: true,
        syncSheet: true,
        sendSnapshot: true,
        generateRelief: true,
        editRelief: true,
        viewReports: true,
      },
    },
    {
      nama: 'ADMIN',
      permissions: {
        manageUsers: false,
        manageSettings: false,
        manageDutyDays: false,
        syncSheet: false,
        sendSnapshot: false,
        generateRelief: true,
        editRelief: true,
        viewReports: true,
      },
    },
  ];
  for (const r of roles) {
    await prisma.role.upsert({
      where: { nama: r.nama },
      update: { permissions: r.permissions },
      create: r,
    });
  }
  console.log(`  ✓ ${roles.length} peranan`);

  const superRole = await prisma.role.findUnique({ where: { nama: 'SUPER_ADMIN' } });
  const adminRole = await prisma.role.findUnique({ where: { nama: 'ADMIN' } });

  // ── 3) Akaun umum (tidak bergantung nama individu — AJK boleh bertukar setiap tahun) ──
  const accounts = [
    { username: 'ketuaadmin', password: 'zai5667', roleId: superRole.id, label: 'Super Admin' },
    { username: 'adminjadual', password: 'aft6003', roleId: adminRole.id, label: 'Admin' },
  ];
  const keepUsernames = accounts.map((a) => a.username);
  for (const a of accounts) {
    const hash = await bcrypt.hash(a.password, 10);
    await prisma.user.upsert({
      where: { username: a.username },
      // Jangan tukar passwordHash sedia ada (kekal jika Super Admin telah mengubahnya)
      update: { roleId: a.roleId, isActive: true },
      create: { nama: a.label, username: a.username, passwordHash: hash, roleId: a.roleId, isActive: true },
    });
  }
  // Nyahaktif sebarang akaun lain (cth akaun individu lama) — tidak dipadam supaya audit kekal
  const dimatikan = await prisma.user.updateMany({
    where: { username: { notIn: keepUsernames } },
    data: { isActive: false },
  });
  console.log(`  ✓ ${accounts.length} akaun umum (ketuaadmin / adminjadual); ${dimatikan.count} akaun lama dinyahaktifkan`);

  // ── 4) Sekatan Khas Relief ──
  // BERSARA (2026-07-14): seed TIDAK LAGI menyentuh jadual special_restrictions
  // dalam apa jua cara (tiada deleteMany, tiada createMany/upsert). Sebelum ini
  // blok ini memadam & menulis semula sekatan hardcode PADA SETIAP RESTART
  // container (SEED_ON_START=true secara default dalam docker-entrypoint.sh),
  // yang bermakna sebarang sekatan yang ditetapkan Super Admin melalui halaman
  // "Sekatan Khas Relief" akan HILANG setiap kali backend restart/redeploy.
  // Sekatan kini diurus SEPENUHNYA melalui halaman Super Admin (CRUD di
  // specialRestriction.controller.js) dan/atau skrip migrasi satu-kali
  // idempotent (prisma/migrateSpecialRestrictions.js) — BUKAN oleh seed.
  console.log('  ⏭️  Sekatan Khas Relief dilangkau (diurus oleh Super Admin — lihat migrateSpecialRestrictions.js)');

  // ── 5) Tetapan sistem (parameter enjin — tidak hardcode) ──
  // BERSARA (2026-07-14): 'nama_exempt' dibuang daripada senarai ini — seed
  // tidak lagi menulis/menulis-semula NAMA_EXEMPT (lihat reliefConfig.js).
  // Baris sedia ada (jika ada, daripada deploy lama) TIDAK disentuh oleh upsert
  // di bawah kerana kunci ini tiada dalam senarai `settings`.
  const settings = [
    { key: 'nama_sekolah', value: 'SABK MAAHAD AL KHAIR LIL BANAT' },
    { key: 'relief_had_default', value: 1 }, // 1 relief/hari untuk semua guru
    { key: 'threshold_pass2', value: 10 }, // ambang PASS 2
    { key: 'tier2_max_slot_mengajar', value: 2 }, // syarat relief kedua
    { key: 'snapshot_cron', value: '1 0 * * *' }, // 00:01 setiap hari
    { key: 'telegram_snapshot_cron', value: '30 5 * * *' }, // 05:30 setiap hari
    { key: 'logo_url', value: 'https://raw.githubusercontent.com/zaifuan/assests/main/logos/aft6003.png' },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log(`  ✓ ${settings.length} tetapan sistem`);

  console.log('✅ Seed selesai.');
}

main()
  .catch((e) => {
    console.error('❌ Seed gagal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
