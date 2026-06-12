// ════════════════════════════════════════════════════════════
//  syncJadual — tab "JADUAL GURU" → jadual teacher_schedule
//  Strategi: padam semua → masuk semula (sheet = sumber kebenaran).
// ════════════════════════════════════════════════════════════

import { TABS, COLUMNS, REQUIRED, pickRow, ensureHeaders } from './sheetConfig.js';

export function prepareJadual({ headers, rows }) {
  ensureHeaders(headers, COLUMNS.jadual, REQUIRED.jadual, TABS.jadual);

  const out = [];
  let skipped = 0;

  for (const raw of rows) {
    const p = pickRow(raw, COLUMNS.jadual);
    const hari = (p.hari || '').trim().toUpperCase();
    const masa = (p.masa || '').trim();
    const guru = (p.guru || '').trim();

    // Wajib: hari, masa, guru
    if (!hari || !masa || !guru) {
      skipped++;
      continue;
    }

    out.push({
      hari,
      slot: (p.slot || '').trim() || null,
      masa,
      guru,
      kelas: (p.kelas || '').trim(), // "FREE"/kosong = waktu lapang
      subjek: (p.subjek || '').trim() || null,
    });
  }

  if (out.length === 0) {
    throw new Error(`Tab "${TABS.jadual}" tiada baris sah — sync dibatalkan (elak kosongkan teacher_schedule).`);
  }

  return { rows: out, total: rows.length, valid: out.length, skipped };
}

export async function writeJadual(tx, prepared) {
  await tx.teacherSchedule.deleteMany({});
  await tx.teacherSchedule.createMany({ data: prepared.rows });
  return prepared.rows.length;
}
