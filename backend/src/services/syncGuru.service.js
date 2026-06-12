// ════════════════════════════════════════════════════════════
//  syncGuru — tab "KATEGORI GURU" → jadual teachers (+ teacher_categories)
//  Strategi: upsert ikut nama; nyahaktif (isActive=false) jika tiada dalam sheet.
// ════════════════════════════════════════════════════════════

import { TABS, COLUMNS, REQUIRED, pickRow, ensureHeaders } from './sheetConfig.js';

export function prepareGuru({ headers, rows }) {
  ensureHeaders(headers, COLUMNS.guru, REQUIRED.guru, TABS.guru);

  const map = new Map(); // nama → { nama, kategori }
  let skipped = 0;

  for (const raw of rows) {
    const { nama, kategori } = pickRow(raw, COLUMNS.guru);
    const namaClean = (nama || '').trim();
    const katClean = (kategori || '').trim().toUpperCase();
    if (!namaClean) {
      skipped++;
      continue;
    }
    map.set(namaClean, { nama: namaClean, kategori: katClean || 'BIASA' });
  }

  const teachers = [...map.values()];
  if (teachers.length === 0) {
    throw new Error(`Tab "${TABS.guru}" tiada guru sah — sync dibatalkan (elak nyahaktif semua guru).`);
  }

  const presentNames = teachers.map((t) => t.nama);
  const categories = [...new Set(teachers.map((t) => t.kategori))];

  return { teachers, presentNames, categories, total: rows.length, valid: teachers.length, skipped };
}

export async function writeGuru(tx, prepared) {
  // 1) Pastikan kategori wujud (jangan timpa flag exempt sedia ada, cth PENTADBIR)
  for (const nama of prepared.categories) {
    await tx.teacherCategory.upsert({
      where: { nama },
      update: {},
      create: { nama, isReliefExempt: nama === 'PENTADBIR' },
    });
  }

  // 2) Upsert guru
  for (const t of prepared.teachers) {
    await tx.teacher.upsert({
      where: { nama: t.nama },
      update: { kategori: t.kategori, isActive: true },
      create: { nama: t.nama, kategori: t.kategori, isActive: true },
    });
  }

  // 3) Nyahaktif guru yang tiada dalam sheet
  const deactivated = await tx.teacher.updateMany({
    where: { nama: { notIn: prepared.presentNames }, isActive: true },
    data: { isActive: false },
  });

  return { upserted: prepared.teachers.length, deactivated: deactivated.count };
}
