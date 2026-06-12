// ════════════════════════════════════════════════════════════
//  syncJadualKelas — tab "JADUAL KELAS" → jadual class_schedule
//  Strategi: padam semua → masuk semula. Diperlukan untuk Relief Engine.
// ════════════════════════════════════════════════════════════

import { TABS, COLUMNS, REQUIRED, pickRow, ensureHeaders } from './sheetConfig.js';

export function prepareJadualKelas({ headers, rows }) {
  ensureHeaders(headers, COLUMNS.jadualKelas, REQUIRED.jadualKelas, TABS.jadualKelas);

  const out = [];
  let skipped = 0;

  for (const raw of rows) {
    const p = pickRow(raw, COLUMNS.jadualKelas);
    const hari = (p.hari || '').trim().toUpperCase();
    const kelas = (p.kelas || '').trim();
    const masa = (p.masa || '').trim();

    // Wajib: hari, kelas, masa
    if (!hari || !kelas || !masa) {
      skipped++;
      continue;
    }

    out.push({
      hari,
      kelas,
      masa,
      namaGuru: (p.namaGuru || '').trim() || null,
      subjek: (p.subjek || '').trim() || null,
    });
  }

  if (out.length === 0) {
    throw new Error(`Tab "${TABS.jadualKelas}" tiada baris sah — sync dibatalkan (elak kosongkan class_schedule).`);
  }

  return { rows: out, total: rows.length, valid: out.length, skipped };
}

export async function writeJadualKelas(tx, prepared) {
  await tx.classSchedule.deleteMany({});
  await tx.classSchedule.createMany({ data: prepared.rows });
  return prepared.rows.length;
}
