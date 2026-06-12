// ════════════════════════════════════════════════════════════
//  syncPengecualian — tab "pengecualian_relief" → jadual relief_exclusions
//  Strategi: padam semua → masuk semula (import data sedia ada).
//  NOTA: keputusan terkunci ialah pengecualian diurus melalui panel kelak.
//  Bila panel siap, set SYNC_PENGECUALIAN=false supaya tab ini tak ditimpa.
// ════════════════════════════════════════════════════════════

import { TABS, COLUMNS, REQUIRED, pickRow, ensureHeaders } from './sheetConfig.js';

function parseTarikh(s) {
  const v = (s || '').trim();
  if (!v) return null;
  let m;
  // YYYY-MM-DD
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  // DD/MM/YYYY atau DD-MM-YYYY atau DD.MM.YYYY
  if ((m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) {
    return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseMod(s) {
  const v = (s || '').toUpperCase().replace(/[_\s]+/g, ' ').trim();
  if (v.includes('SEPANJANG') || v === 'HARI') return 'SEPANJANG_HARI';
  if (v.includes('SLOT')) return 'SLOT';
  return null;
}

export function preparePengecualian({ headers, rows }) {
  ensureHeaders(headers, COLUMNS.pengecualian, REQUIRED.pengecualian, TABS.pengecualian);

  const out = [];
  let skipped = 0;
  const issues = [];

  rows.forEach((raw, i) => {
    const p = pickRow(raw, COLUMNS.pengecualian);
    const nama = (p.nama || '').trim();
    if (!nama) {
      skipped++;
      return;
    }

    const tarikh = parseTarikh(p.tarikh);
    const mod = parseMod(p.mod);

    if (!tarikh) {
      skipped++;
      issues.push(`Baris ${i + 2}: tarikh tidak sah ("${p.tarikh}")`);
      return;
    }
    if (!mod) {
      skipped++;
      issues.push(`Baris ${i + 2}: MOD tidak dikenali ("${p.mod}")`);
      return;
    }

    out.push({
      guruNama: nama,
      tarikh,
      mod,
      masaDari: (p.masaDari || '').trim() || null,
      masaHingga: (p.masaHingga || '').trim() || null,
      createdBy: 'SYNC',
    });
  });

  // Pengecualian boleh kosong secara sah — tidak baling ralat jika 0.
  return { rows: out, total: rows.length, valid: out.length, skipped, issues };
}

export async function writePengecualian(tx, prepared) {
  await tx.reliefExclusion.deleteMany({});
  if (prepared.rows.length > 0) {
    await tx.reliefExclusion.createMany({ data: prepared.rows });
  }
  return prepared.rows.length;
}
