// ════════════════════════════════════════════════════════════
//  migrateSpecialRestrictions.js — migrasi data SATU-KALI, idempotent.
//
//  Memindahkan SEMUA sumber sekatan relief warisan kepada rekod
//  special_restrictions individu (SSOT tunggal untuk "Sekatan Khas Relief"):
//    1. Kategori PENTADBIR (guru AKTIF)               → FULL_WEEK individu
//    2. system_settings['nama_exempt'] (guru sepadan) → FULL_WEEK individu
//    3. Rekod special_restrictions sedia ada           → klasifikasi semula
//       ikut bentuk data (FULL_WEEK / SPECIFIC_DAYS / SPECIFIC_TIME) +
//       pautkan teacherId (padanan nama, guru aktif ATAU tidak aktif)
//    4. target='LELAKI' (guru lelaki AKTIF, pengesanan " BIN " — SAMA
//       seperti heuristik asal candidate.service.js, HANYA dalam skrip
//       migrasi ini) → SPECIFIC_TIME individu bagi SETIAP guru lelaki aktif;
//       rekod LELAKI itu sendiri DIPADAM selepas berjaya dikembangkan
//       (magic string tidak boleh kekal dalam database — arahan ZAI).
//    5. Sekatan pendua: mana-mana guru yang menerima FULL_WEEK baharu
//       (langkah 1/2) akan menyahaktifkan rekod aktif LAIN bagi teacherId
//       yang sama (FULL_WEEK menggantikan sepenuhnya sekatan lemah); guru
//       lelaki yang sudah/akan mempunyai FULL_WEEK dilangkau daripada
//       pengembangan LELAKI (elak baris berlebihan).
//
//  Guru yang tidak dapat dipadankan dengan jadual Teacher TIDAK menggagalkan
//  skrip — dilaporkan dalam `unmatchedNamaExempt` / `unmatchedLegacyRows`.
//
//  IDEMPOTEN: setiap langkah menyemak keadaan SEDIA ADA (find-or-create
//  ikut teacherId+restrictionType+hariList+masaDari+masaHingga) sebelum
//  mencipta rekod baharu — jalankan berkali-kali TIDAK menghasilkan pendua.
//
//  Jalankan SECARA MANUAL selepas migration.sql (schema) berjaya:
//    node prisma/migrateSpecialRestrictions.js
//  (BUKAN sebahagian docker-entrypoint.sh — ini operasi satu-kali yang
//  disengajakan tidak automatik, supaya tidak berulang setiap restart.)
// ════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import { normalkanMasa } from '../src/lib/timeUtil.js';
import { ALL_HARI, sortHari, sameHariSet } from '../src/lib/hariUtil.js';

const norm = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const normTime = (t) => (t == null ? null : normalkanMasa(t));

// ════════════════════════════════════════════════════════════
//  planMigration — PURE (tiada I/O). Ambil snapshot data mentah, pulangkan
//  rancangan tindakan penuh. Diuji unit tanpa DB — lihat
//  __tests__/migrate-special-restrictions.test.js.
//
//  input:
//    pentadbirActiveTeachers   [{ id, nama }]   guru AKTIF, kategori PENTADBIR
//    namaExemptList            string[]         raw system_settings['nama_exempt']
//    allTeachers               [{ id, nama, isActive }]  SEMUA guru (utk padanan)
//    existingRestrictions      [{ id, target, hariList, masaDari, masaHingga,
//                                 restrictionType, teacherId, isActive }]
// ════════════════════════════════════════════════════════════
export function planMigration({
  pentadbirActiveTeachers = [],
  namaExemptList = [],
  allTeachers = [],
  existingRestrictions = [],
}) {
  const byNormName = new Map(allTeachers.map((t) => [norm(t.nama), t]));
  const activeMaleTeachers = allTeachers.filter((t) => t.isActive && norm(t.nama).includes(' BIN '));

  const unmatchedNamaExempt = [];
  const unmatchedLegacyRows = [];

  // ── Set teacherId → { hariList, masaDari, masaHingga } bagi rekod FULL_WEEK
  //    SEDIA ADA (aktif) — supaya kita tahu siapa yang SUDAH dilindungi. ──
  const alreadyFullWeekTeacherIds = new Set();
  for (const r of existingRestrictions) {
    if (!r.isActive || !r.teacherId) continue;
    const isCanonicalFullWeek = r.restrictionType === 'FULL_WEEK';
    const isLegacyFullWeekShape =
      r.masaDari === '00.00' &&
      (r.masaHingga === '23.59' || r.masaHingga === '24.00') &&
      sameHariSet(r.hariList, ALL_HARI);
    if (isCanonicalFullWeek || isLegacyFullWeekShape) alreadyFullWeekTeacherIds.add(r.teacherId);
  }

  // ── 1) PENTADBIR aktif → FULL_WEEK ──
  const createFullWeek = []; // { teacherId, nama, sourceReason }
  const grantingFullWeekIds = new Set(alreadyFullWeekTeacherIds); // set kumulatif "akan ada FULL_WEEK selepas run ini"

  for (const t of pentadbirActiveTeachers) {
    if (grantingFullWeekIds.has(t.id)) continue; // sudah ada — idempoten, langkau
    createFullWeek.push({ teacherId: t.id, nama: t.nama, sourceReason: 'KATEGORI_PENTADBIR' });
    grantingFullWeekIds.add(t.id);
  }

  // ── 2) nama_exempt → FULL_WEEK ──
  for (const rawNama of namaExemptList) {
    const t = byNormName.get(norm(rawNama));
    if (!t) {
      unmatchedNamaExempt.push(rawNama);
      continue;
    }
    if (grantingFullWeekIds.has(t.id)) continue; // sudah ada (PENTADBIR atau nama_exempt lain) — langkau
    createFullWeek.push({ teacherId: t.id, nama: t.nama, sourceReason: 'NAMA_EXEMPT' });
    grantingFullWeekIds.add(t.id);
  }

  // ── 3) Klasifikasi semula rekod sedia ada (KECUALI target='LELAKI', layan berasingan) ──
  const reclassify = []; // { id, restrictionType, hariList, masaDari, masaHingga, teacherId }
  const deactivate = []; // { id, reason }
  const lelakiSourceRows = [];

  for (const r of existingRestrictions) {
    if (norm(r.target) === 'LELAKI') {
      lelakiSourceRows.push(r);
      continue;
    }

    const matchedTeacher = byNormName.get(norm(r.target));
    const teacherId = r.teacherId || matchedTeacher?.id || null;
    if (!matchedTeacher && !r.teacherId) unmatchedLegacyRows.push({ id: r.id, target: r.target });

    // Rekod sudah kanonik (masaDari null ⇒ FULL_WEEK/SPECIFIC_DAYS terhasil
    // daripada larian migrasi terdahulu) — JANGAN derive semula drpd raw
    // fields (null tidak lagi sepadan corak "00.00"). Hanya pastikan teacherId
    // masih dipautkan jika belum.
    if (r.masaDari === null) {
      if (teacherId !== r.teacherId) {
        reclassify.push({
          id: r.id,
          restrictionType: r.restrictionType,
          hariList: r.hariList,
          masaDari: null,
          masaHingga: null,
          teacherId,
        });
      }
    } else {
      const days = sortHari(r.hariList || []);
      const isFullDayRange = r.masaDari === '00.00' && (r.masaHingga === '23.59' || r.masaHingga === '24.00');
      let target;
      if (isFullDayRange && days.length === ALL_HARI.length) {
        target = { restrictionType: 'FULL_WEEK', hariList: [], masaDari: null, masaHingga: null };
      } else if (isFullDayRange) {
        target = { restrictionType: 'SPECIFIC_DAYS', hariList: days, masaDari: null, masaHingga: null };
      } else {
        target = {
          restrictionType: 'SPECIFIC_TIME',
          hariList: days,
          masaDari: normTime(r.masaDari),
          masaHingga: normTime(r.masaHingga),
        };
      }
      reclassify.push({ id: r.id, ...target, teacherId });
    }

    // Sekatan pendua (Keputusan ZAI #3, digeneralisasikan): jika teacher ini
    // AKAN mendapat FULL_WEEK aktif (langkah 1/2), rekod SEDIA ADA yang lain
    // (waktu/hari sahaja) menjadi berlebihan — nyahaktifkan (bukan padam,
    // supaya audit kekal). Semak `r.isActive` supaya larian berulang tidak
    // menambah nota migrasi pendua pada rekod yang sudah dinyahaktifkan.
    if (
      r.isActive &&
      teacherId &&
      grantingFullWeekIds.has(teacherId) &&
      !(r.restrictionType === 'FULL_WEEK' && r.masaDari === null)
    ) {
      deactivate.push({ id: r.id, reason: `Digantikan oleh sekatan FULL_WEEK baharu (teacherId ${teacherId}) — lihat log migrasi.` });
    }
  }

  // ── 4) target='LELAKI' → SPECIFIC_TIME individu bagi guru lelaki AKTIF ──
  //     (dilangkau jika guru itu sudah/akan mempunyai FULL_WEEK aktif)
  const createSpecificTimeForLelaki = []; // { teacherId, nama, hariList, masaDari, masaHingga }
  const skippedLelakiAlreadyFullWeek = []; // { teacherId, nama }
  const lelakiRowsToDelete = [];

  if (lelakiSourceRows.length > 0) {
    for (const lr of lelakiSourceRows) {
      lelakiRowsToDelete.push({ id: lr.id, reason: 'Magic target LELAKI dikembangkan kepada rekod individu & dipadam.' });
      const days = sortHari(lr.hariList || []);
      const masaDari = normTime(lr.masaDari);
      const masaHingga = normTime(lr.masaHingga);

      for (const t of activeMaleTeachers) {
        if (grantingFullWeekIds.has(t.id)) {
          skippedLelakiAlreadyFullWeek.push({ teacherId: t.id, nama: t.nama });
          continue;
        }
        // Idempoten: jangan cipta jika rekod SAMA TEPAT (teacherId+jenis+hari+masa)
        // sudah wujud (sedia ada ATAU baharu dirancang dlm langkah ini).
        const alreadyExists = existingRestrictions.some(
          (r) =>
            r.teacherId === t.id &&
            r.restrictionType === 'SPECIFIC_TIME' &&
            normTime(r.masaDari) === masaDari &&
            normTime(r.masaHingga) === masaHingga &&
            sameHariSet(r.hariList, days)
        );
        const alreadyPlanned = createSpecificTimeForLelaki.some(
          (p) => p.teacherId === t.id && sameHariSet(p.hariList, days) && p.masaDari === masaDari && p.masaHingga === masaHingga
        );
        if (alreadyExists || alreadyPlanned) continue;

        createSpecificTimeForLelaki.push({ teacherId: t.id, nama: t.nama, hariList: days, masaDari, masaHingga });
      }
    }
  }

  return {
    createFullWeek,
    reclassify,
    deactivate,
    createSpecificTimeForLelaki,
    skippedLelakiAlreadyFullWeek,
    lelakiRowsToDelete,
    unmatchedNamaExempt,
    unmatchedLegacyRows,
  };
}

// ════════════════════════════════════════════════════════════
//  runMigration — laksanakan plan() di atas pangkalan data SEBENAR.
//  Bukan fungsi tulen (I/O) — tidak diuji unit secara langsung; logik
//  keputusan sepenuhnya berada dalam planMigration() yang diuji berasingan.
// ════════════════════════════════════════════════════════════
export async function runMigration(prisma) {
  const [pentadbirActiveTeachers, allTeachers, namaExemptSetting, existingRestrictions] = await Promise.all([
    prisma.teacher.findMany({ where: { isActive: true, kategori: 'PENTADBIR' }, select: { id: true, nama: true } }),
    prisma.teacher.findMany({ select: { id: true, nama: true, isActive: true } }),
    prisma.systemSetting.findUnique({ where: { key: 'nama_exempt' } }),
    prisma.specialRestriction.findMany(),
  ]);

  const namaExemptList = Array.isArray(namaExemptSetting?.value) ? namaExemptSetting.value : [];

  const plan = planMigration({
    pentadbirActiveTeachers,
    namaExemptList,
    allTeachers,
    existingRestrictions,
  });

  const report = {
    fullWeekCreated: [],
    reclassified: [],
    deactivated: [],
    lelakiExpanded: [],
    lelakiSkippedAlreadyFullWeek: plan.skippedLelakiAlreadyFullWeek,
    lelakiRowsDeleted: [],
    unmatchedNamaExempt: plan.unmatchedNamaExempt,
    unmatchedLegacyRows: plan.unmatchedLegacyRows,
  };

  await prisma.$transaction(async (tx) => {
    for (const c of plan.createFullWeek) {
      const row = await tx.specialRestriction.create({
        data: {
          teacherId: c.teacherId,
          target: c.nama,
          restrictionType: 'FULL_WEEK',
          hariList: [],
          masaDari: null,
          masaHingga: null,
          catatan: `Migrasi automatik (${c.sourceReason}) — ${new Date().toISOString().slice(0, 10)}`,
        },
      });
      report.fullWeekCreated.push({ id: row.id, nama: c.nama, source: c.sourceReason });
    }

    for (const r of plan.reclassify) {
      await tx.specialRestriction.update({
        where: { id: r.id },
        data: {
          teacherId: r.teacherId,
          restrictionType: r.restrictionType,
          hariList: r.hariList,
          masaDari: r.masaDari,
          masaHingga: r.masaHingga,
        },
      });
      report.reclassified.push({ id: r.id, restrictionType: r.restrictionType });
    }

    for (const d of plan.deactivate) {
      const existing = await tx.specialRestriction.findUnique({ where: { id: d.id }, select: { catatan: true } });
      await tx.specialRestriction.update({
        where: { id: d.id },
        data: {
          isActive: false,
          catatan: [existing?.catatan, `[Migrasi] ${d.reason}`].filter(Boolean).join(' | '),
        },
      });
      report.deactivated.push({ id: d.id, reason: d.reason });
    }

    for (const c of plan.createSpecificTimeForLelaki) {
      const row = await tx.specialRestriction.create({
        data: {
          teacherId: c.teacherId,
          target: c.nama,
          restrictionType: 'SPECIFIC_TIME',
          hariList: c.hariList,
          masaDari: c.masaDari,
          masaHingga: c.masaHingga,
          catatan: `Migrasi automatik (LELAKI → individu) — ${new Date().toISOString().slice(0, 10)}`,
        },
      });
      report.lelakiExpanded.push({ id: row.id, nama: c.nama });
    }

    for (const del of plan.lelakiRowsToDelete) {
      await tx.specialRestriction.delete({ where: { id: del.id } });
      report.lelakiRowsDeleted.push(del.id);
    }
  });

  return report;
}

// ── CLI entrypoint (jalankan terus: node prisma/migrateSpecialRestrictions.js) ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  console.log('🔄 Menjalankan migrasi Sekatan Khas Relief (idempotent)...\n');
  runMigration(prisma)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      console.log('\n✅ Migrasi selesai.');
      if (report.unmatchedNamaExempt.length || report.unmatchedLegacyRows.length) {
        console.log('\n⚠️  SEMAKAN MANUAL DIPERLUKAN — nama berikut tidak dapat dipadankan:');
        if (report.unmatchedNamaExempt.length) console.log('  nama_exempt:', report.unmatchedNamaExempt);
        if (report.unmatchedLegacyRows.length) console.log('  rekod sekatan lama:', report.unmatchedLegacyRows);
      }
    })
    .catch((e) => {
      console.error('❌ Migrasi gagal:', e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
