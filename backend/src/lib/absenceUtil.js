// ════════════════════════════════════════════════════════════
//  Util borang ketidakhadiran
//  - hariDari(tarikh): nama hari Melayu dari tarikh (UTC, elak anjakan TZ)
//  - generateReference(tx, tarikhDate): ABS-YYYYMMDD-NNN (turutan harian)
// ════════════════════════════════════════════════════════════

const HARI_MAP = ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'];

export function hariDari(tarikh) {
  let y, m, d;
  if (typeof tarikh === 'string') {
    const mm = tarikh.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!mm) {
      const dt = new Date(tarikh);
      return HARI_MAP[dt.getUTCDay()];
    }
    y = +mm[1];
    m = +mm[2];
    d = +mm[3];
  } else {
    const dt = new Date(tarikh);
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }
  return HARI_MAP[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// NNN = bilangan rekod sedia ada untuk tarikh ketidakhadiran yang sama + 1
export async function generateReference(tx, tarikhDate) {
  const y = tarikhDate.getUTCFullYear();
  const m = String(tarikhDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tarikhDate.getUTCDate()).padStart(2, '0');

  const count = await tx.absenceRecord.count({ where: { tarikh: tarikhDate } });
  const nnn = String(count + 1).padStart(3, '0');
  return `ABS-${y}${m}${d}-${nnn}`;
}
