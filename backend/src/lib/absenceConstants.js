// ════════════════════════════════════════════════════════════
//  Constant borang ketidakhadiran — satu sumber kebenaran.
//  Nilai sebab DISELARASKAN untuk kegunaan format Telegram kelak.
// ════════════════════════════════════════════════════════════

export const SEBAB = ['MC', 'CRK', 'CTR', 'PROGRAM_SEKOLAH', 'PROGRAM_LUAR', 'LAIN_LAIN'];

// Sebab yang WAJIB ada catatan/detail (untuk paparan Telegram nanti)
export const SEBAB_PERLU_DETAIL = ['PROGRAM_SEKOLAH', 'PROGRAM_LUAR', 'LAIN_LAIN'];

export const JENIS = ['SEPANJANG_HARI', 'SEPARUH_HARI'];

export const SEBAB_LABEL = {
  MC: 'MC',
  CRK: 'CRK',
  CTR: 'CTR',
  PROGRAM_SEKOLAH: 'Program Sekolah',
  PROGRAM_LUAR: 'Program Luar',
  LAIN_LAIN: 'Lain-lain',
};

export const JENIS_LABEL = {
  SEPANJANG_HARI: 'Sepanjang Hari',
  SEPARUH_HARI: 'Separuh Hari',
};
