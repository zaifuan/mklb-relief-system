// ════════════════════════════════════════════════════════════
//  sheetConfig — konfigurasi sumber Google Sheet (boleh dilaras)
//  Nama tab dari .env; pemetaan lajur (alias) di sini.
//  Padanan header TIDAK case-sensitive (di-normalize: UPPERCASE + trim).
// ════════════════════════════════════════════════════════════

export const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
export const HEADER_ROW = parseInt(process.env.SHEET_HEADER_ROW || '1', 10);
export const SYNC_PENGECUALIAN = (process.env.SYNC_PENGECUALIAN || 'true') !== 'false';

// Nama tab sebenar (default ikut fail Excel asal; boleh override via .env)
export const TABS = {
  guru: process.env.SHEET_TAB_GURU || 'KATEGORI GURU',
  jadual: process.env.SHEET_TAB_JADUAL || 'JADUAL GURU',
  jadualKelas: process.env.SHEET_TAB_JADUAL_KELAS || 'JADUAL KELAS',
  pengecualian: process.env.SHEET_TAB_PENGECUALIAN || 'pengecualian_relief',
};

// Pemetaan: medan DB → senarai nama lajur yang diterima (alias)
export const COLUMNS = {
  guru: {
    nama: ['GURU', 'NAMA GURU', 'NAMA'],
    kategori: ['KATEGORI', 'JAWATAN'],
  },
  jadual: {
    hari: ['HARI'],
    slot: ['SLOT'],
    masa: ['MASA'],
    guru: ['GURU', 'NAMA GURU'],
    kelas: ['KELAS'],
    subjek: ['SUBJEK', 'MATA PELAJARAN'],
  },
  jadualKelas: {
    hari: ['HARI'],
    kelas: ['KELAS'],
    masa: ['MASA'],
    namaGuru: ['NAMA GURU', 'GURU'],
    subjek: ['SUBJEK', 'MATA PELAJARAN'],
  },
  pengecualian: {
    nama: ['NAMA', 'GURU', 'NAMA GURU'],
    tarikh: ['TARIKH'],
    mod: ['MOD'],
    masaDari: ['MASA_DARI', 'MASA DARI'],
    masaHingga: ['MASA_HINGGA', 'MASA HINGGA'],
  },
};

// Medan yang WAJIB ada (sekurang-kurangnya satu alias hadir sebagai header)
export const REQUIRED = {
  guru: ['nama', 'kategori'],
  jadual: ['hari', 'masa', 'guru'],
  jadualKelas: ['hari', 'kelas', 'masa'],
  pengecualian: ['nama', 'tarikh', 'mod'],
};

// ── Helpers ──

export function normalizeHeader(h) {
  return String(h ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// Ambil nilai medan dari baris (objek dikunci oleh header ter-normalize)
export function pickRow(row, columnMap) {
  const out = {};
  for (const [field, aliases] of Object.entries(columnMap)) {
    let val = '';
    for (const alias of aliases) {
      const key = normalizeHeader(alias);
      if (key in row) {
        val = row[key];
        break;
      }
    }
    out[field] = val;
  }
  return out;
}

// Pastikan header wajib hadir; jika tiada → baling ralat (batalkan sync)
export function ensureHeaders(headers, columnMap, requiredFields, tabLabel) {
  const hset = new Set(headers);
  const missing = [];
  for (const field of requiredFields) {
    const aliases = (columnMap[field] || []).map(normalizeHeader);
    if (!aliases.some((a) => hset.has(a))) missing.push(field);
  }
  if (missing.length) {
    throw new Error(
      `Tab "${tabLabel}": lajur wajib tiada untuk medan [${missing.join(', ')}]. ` +
        `Header dijumpai: ${headers.join(', ') || '(kosong)'}`
    );
  }
}
