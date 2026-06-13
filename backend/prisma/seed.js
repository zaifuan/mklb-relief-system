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
  const categories = [
    { nama: 'PENTADBIR', isReliefExempt: true }, // KATEGORI_EXEMPT
    { nama: 'BIASA', isReliefExempt: false },
    { nama: 'PSS', isReliefExempt: false },
    { nama: 'KAUNSELOR', isReliefExempt: false },
    { nama: 'PRAKTIKAL', isReliefExempt: false },
  ];
  for (const c of categories) {
    await prisma.teacherCategory.upsert({
      where: { nama: c.nama },
      update: { isReliefExempt: c.isReliefExempt },
      create: c,
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

  // ── 4) Sekatan khas (dari CONFIG.SEKATAN_KHAS — logik dikekalkan) ──
  const restrictions = [
    { target: 'ZURAINI BINTI IBRAHIM', hariList: ['SELASA'], masaDari: '11.00', masaHingga: '14.30' },
    { target: 'SITI AMIRA BINTI MOHD DIN', hariList: ['SELASA'], masaDari: '11.00', masaHingga: '14.30' },
    { target: 'ZULAIKAH BINTI MOHD NGAT', hariList: ['ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT'], masaDari: '00.00', masaHingga: '23.59' },
    { target: 'SUHAINA BINTI SHARIPUDDIN', hariList: ['JUMAAT'], masaDari: '11.35', masaHingga: '12.35' },
    { target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', hariList: ['ISNIN', 'SELASA', 'RABU'], masaDari: '13.00', masaHingga: '13.30' },
    { target: 'MOHAMAD ZAIFUAN BIN ZULKAFLEE', hariList: ['KHAMIS'], masaDari: '12.30', masaHingga: '13.00' },
    { target: 'HANIZA BINTI MUSTAPHA', hariList: ['SELASA', 'RABU', 'KHAMIS'], masaDari: '07.40', masaHingga: '09.10' },
    { target: 'LELAKI', hariList: ['JUMAAT'], masaDari: '12.05', masaHingga: '12.35' },
    { target: 'MOHD SHARIFUDDIN BIN ABDUL LATIF', hariList: ['ISNIN', 'SELASA', 'RABU'], masaDari: '13.30', masaHingga: '14.30' },
  ];
  // Config-like & kecil → padam dan tulis semula (idempotent penuh)
  await prisma.specialRestriction.deleteMany({});
  await prisma.specialRestriction.createMany({ data: restrictions });
  console.log(`  ✓ ${restrictions.length} sekatan khas (SEKATAN_KHAS)`);

  // ── 5) Tetapan sistem (parameter enjin — tidak hardcode) ──
  const settings = [
    { key: 'nama_sekolah', value: 'SABK MAAHAD AL KHAIR LIL BANAT' },
    { key: 'nama_exempt', value: ['HANIZA BINTI MUSTAPHA'] }, // NAMA_EXEMPT (boleh edit)
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
