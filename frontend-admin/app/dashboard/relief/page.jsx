'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';

const STATUS_BATCH = { DRAF: 'Draf', DIJANA: 'Dijana', DIHANTAR: 'Dihantar', SELESAI: 'Selesai' };
const TERKUNCI = ['DIHANTAR', 'SELESAI'];
const TIADA = 'TIADA_PENGGANTI'; // nilai stabil; dipapar sebagai "TIADA PENGGANTI"

function todayKL() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function fmtDate(iso) {
  if (!iso) return '-';
  const d = String(iso).slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
}
function fmtDateTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
// Minit mula slot — untuk SUSUNAN sahaja (kuirk 12-jam: jam 1–6 = petang).
function slotStartMinit(masa) {
  const clean = String(masa || '').replace(/[–—]/g, '-').replace(/\s/g, '');
  const start = clean.split('-')[0];
  const m = start.match(/^(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!m) return 9999;
  let h = parseInt(m[1], 10);
  const mi = parseInt(m[2] || '0', 10);
  if (h >= 1 && h <= 6) h += 12;
  return h * 60 + mi;
}
// Pecah "9.45–10.15" → { mula:"9.45", tamat:"10.15" }
function splitMasa(masa) {
  const clean = String(masa || '').replace(/[–—]/g, '-');
  const i = clean.indexOf('-');
  if (i < 0) return { mula: clean.trim(), tamat: '' };
  return { mula: clean.slice(0, i).trim(), tamat: clean.slice(i + 1).trim() };
}

// Tab Tetapan Khas Jadual (dalam page relief)
const SS_TABS = [
  { key: 'guru', label: 'Guru', jenis: 'TEACHER_EXCLUSION', src: 'teachers', listKey: 'teacherExclusions', mark: '✓', pilih: 'Pilih guru', empty: 'Tiada guru dikecualikan.', nota: 'Guru hadir tetapi tidak boleh menerima relief (cth: bertugas peperiksaan, lawatan, pengacara).' },
  { key: 'kelas', label: 'Kelas', jenis: 'CLASS_EXCLUSION', src: 'classes', listKey: 'classExclusions', mark: '✓', pilih: 'Pilih kelas', empty: 'Tiada kelas dikecualikan.', nota: 'Kelas tidak perlu relief walaupun guru asal tidak hadir (cth: program sekolah, ceramah, dewan peperiksaan).' },
  { key: 'keutamaan', label: 'Keutamaan', jenis: 'PRIORITY_CLASS', src: 'classes', listKey: 'priorityClasses', mark: '★', pilih: 'Pilih kelas', empty: 'Tiada kelas keutamaan.', nota: 'Kelas ini didahulukan ketika jana relief (cth: STAM, kelas peperiksaan).' },
];

// Label masa "HH:MM" (24-jam) → "08:00 pagi" / "12:00 tengah hari" / "01:00 petang"
function labelMasa(hhmm) {
  if (!hhmm) return '';
  const [h, m] = String(hhmm).split(':').map(Number);
  const mm = String(m || 0).padStart(2, '0');
  if (h < 12) return `${String(h).padStart(2, '0')}:${mm} pagi`;
  if (h === 12) return `12:${mm} tengah hari`;
  return `${String(h - 12).padStart(2, '0')}:${mm} petang`;
}
// Senarai masa formal (sama gaya borang) — 07:00 hingga 15:00, langkah 30 minit
const MASA_LIST = (() => {
  const out = [];
  for (let t = 7 * 60; t <= 15 * 60; t += 30) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    out.push({ value: v, label: labelMasa(v) });
  }
  return out;
})();
// Paparan scope/masa untuk senarai aktif
function fmtScope(item) {
  if (item.scope !== 'TIME_RANGE') return 'Sepanjang Hari';
  const mula = item.masaMula ? labelMasa(item.masaMula) : '?';
  const tamat = item.masaTamat ? labelMasa(item.masaTamat) : 'Tamat sekolah';
  return `${mula} – ${tamat}`;
}

export default function ReliefDashboard() {
  const [tarikh, setTarikh] = useState(() => todayKL());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // ── Tetapan Khas Jadual (dalam page relief) ──
  const [ssOpts, setSsOpts] = useState({ teachers: [], classes: [] });
  const [ssData, setSsData] = useState(null);
  const [ssTab, setSsTab] = useState('guru');
  const [ssChips, setSsChips] = useState([]); // target dipilih (multi-select)
  const [ssScope, setSsScope] = useState('FULL_DAY');
  const [ssMula, setSsMula] = useState('');
  const [ssTamat, setSsTamat] = useState(''); // '' = Tamat sekolah
  const [ssModal, setSsModal] = useState(false);
  const [mScope, setMScope] = useState('FULL_DAY'); // temp dalam modal
  const [mMula, setMMula] = useState('');
  const [mTamat, setMTamat] = useState('');
  const [ssBusy, setSsBusy] = useState(false);
  const [ssError, setSsError] = useState('');

  const locked = !!data && TERKUNCI.includes(data.status);

  const load = useCallback(async (t) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const d = await api.relief.get(t);
      setData(d);
    } catch (e) {
      if (e.status === 404) {
        setData(null);
        setNotice('Belum dijana untuk tarikh ini. Klik “Jana Relief”.');
      } else {
        setError(e.message || 'Gagal memuat jadual relief');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tarikh);
  }, [tarikh, load]);

  // Muat senarai guru/kelas sekali
  useEffect(() => {
    let alive = true;
    api.specialSettings
      .options()
      .then((o) => {
        if (alive) setSsOpts({ teachers: o.teachers || [], classes: o.classes || [] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Muat tetapan khas bila tarikh berubah
  const loadSs = useCallback(async (t) => {
    if (!t) {
      setSsData(null);
      return;
    }
    try {
      const d = await api.specialSettings.list(t);
      setSsData(d);
    } catch (e) {
      setSsError(e.message || 'Gagal memuat tetapan khas.');
    }
  }, []);

  useEffect(() => {
    loadSs(tarikh);
  }, [tarikh, loadSs]);

  function ssTukarTab(key) {
    setSsTab(key);
    setSsChips([]);
    setSsScope('FULL_DAY');
    setSsMula('');
    setSsTamat('');
    setSsError('');
  }
  function tambahChip(nama) {
    if (!nama) return;
    setSsChips((list) => (list.includes(nama) ? list : [...list, nama]));
  }
  function buangChip(nama) {
    setSsChips((list) => list.filter((n) => n !== nama));
  }
  function bukaModal() {
    setMScope(ssScope);
    setMMula(ssMula);
    setMTamat(ssTamat);
    setSsModal(true);
  }
  function sahkanModal() {
    if (mScope === 'TIME_RANGE') {
      if (!mMula) {
        setSsError('Sila pilih masa mula.');
        return;
      }
      if (mTamat && mTamat <= mMula) {
        setSsError('Masa tamat mesti selepas masa mula.');
        return;
      }
    }
    setSsScope(mScope);
    setSsMula(mScope === 'TIME_RANGE' ? mMula : '');
    setSsTamat(mScope === 'TIME_RANGE' ? mTamat : '');
    setSsError('');
    setSsModal(false);
  }
  async function ssTambah() {
    const cur = SS_TABS.find((t) => t.key === ssTab);
    if (ssChips.length === 0 || ssBusy || !tarikh) return;
    setSsBusy(true);
    setSsError('');
    try {
      const payload = { tarikh, jenis: cur.jenis, targets: ssChips, scope: ssScope };
      if (ssScope === 'TIME_RANGE') {
        payload.masaMula = ssMula;
        payload.masaTamat = ssTamat || null; // '' = Tamat sekolah
      }
      await api.specialSettings.create(payload);
      setSsChips([]);
      setSsScope('FULL_DAY');
      setSsMula('');
      setSsTamat('');
      await loadSs(tarikh);
    } catch (e) {
      setSsError(e.message || 'Gagal menambah tetapan.');
    } finally {
      setSsBusy(false);
    }
  }
  async function ssPadam(id) {
    if (ssBusy) return;
    setSsBusy(true);
    setSsError('');
    try {
      await api.specialSettings.remove(id);
      await loadSs(tarikh);
    } catch (e) {
      setSsError(e.message || 'Gagal memadam tetapan.');
    } finally {
      setSsBusy(false);
    }
  }

  async function jana(isRegen) {
    if (busy || locked) return;
    if (
      isRegen &&
      !window.confirm(
        'Jana semula akan MEMBUANG dan menjana semula baris CADANGAN sahaja.\n\nBaris DISAHKAN dan BATAL akan KEKAL.\n\nTeruskan?'
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api.relief.generate(tarikh);
      if (!r.batchId) {
        setData(null);
        setNotice(r.mesej || 'Tiada cadangan dijana untuk tarikh ini.');
      } else {
        await load(tarikh);
      }
    } catch (e) {
      if (e.status === 409) setError(e.message || 'Batch terkunci — tidak boleh jana semula.');
      else setError(e.message || 'Gagal menjana jadual relief');
    } finally {
      setBusy(false);
    }
  }

  async function tukarGuru(id, guruGanti) {
    if (rowBusy || locked) return;
    setRowBusy(id);
    setError('');
    try {
      await api.relief.updateTeacher(id, guruGanti);
      // Kemas kini setempat (tidak perlu reload penuh) — kekalkan status & calon
      setData((d) =>
        d
          ? { ...d, assignments: d.assignments.map((a) => (a.id === id ? { ...a, guruGanti } : a)) }
          : d
      );
    } catch (e) {
      setError(e.message || 'Gagal menukar guru ganti');
      await load(tarikh); // selaras semula jika gagal
    } finally {
      setRowBusy(0);
    }
  }

  async function janaPdf() {
    if (pdfBusy || !data || rowsSorted.length === 0) return;
    setPdfBusy(true);
    setError('');
    try {
      const blob = await api.relief.pdf(tarikh);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jadual-ganti-${tarikh}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e.message || 'Gagal menjana PDF');
    } finally {
      setPdfBusy(false);
    }
  }

  // Statistik ringkas (paparan; bukan enjin)
  const stat = useMemo(() => {
    const rows = data?.assignments || [];
    return {
      guruAbsen: new Set(rows.map((a) => a.guruTakHadir)).size,
      slot: rows.length,
      ganti: new Set(
        rows.filter((a) => a.guruGanti && a.guruGanti !== TIADA).map((a) => a.guruGanti.trim().toUpperCase())
      ).size,
    };
  }, [data]);

  // Susun: nama guru tidak hadir A–Z, kemudian masa mula ↑, kemudian kelas
  const rowsSorted = useMemo(() => {
    return (data?.assignments || []).slice().sort((a, b) => {
      const byNama = String(a.guruTakHadir).localeCompare(String(b.guruTakHadir), 'ms');
      if (byNama !== 0) return byNama;
      const sa = slotStartMinit(a.masa);
      const sb = slotStartMinit(b.masa);
      if (sa !== sb) return sa - sb;
      return String(a.kelas).localeCompare(String(b.kelas), 'ms');
    });
  }, [data]);

  // Dropdown guru ganti — nama sahaja + "TIADA PENGGANTI"; sentiasa boleh diubah
  function gantiSelect(a) {
    const cands = a.candidates || [];
    return (
      <select
        className="inp gantiSel"
        aria-label="Guru ganti"
        value={a.guruGanti || ''}
        disabled={locked || rowBusy === a.id}
        onChange={(e) => tukarGuru(a.id, e.target.value)}
      >
        <option value="" disabled>— Pilih guru ganti —</option>
        <option value={TIADA}>TIADA PENGGANTI</option>
        {a.guruGanti && a.guruGanti !== TIADA && !cands.some((c) => c.nama === a.guruGanti) && (
          <option value={a.guruGanti}>{a.guruGanti}</option>
        )}
        {cands.map((c) => (
          <option key={c.nama} value={c.nama}>{c.nama}</option>
        ))}
      </select>
    );
  }

  const ssCur = SS_TABS.find((t) => t.key === ssTab);
  const ssSource = ssCur.src === 'teachers' ? ssOpts.teachers : ssOpts.classes;
  const ssActive = ssData ? ssData[ssCur.listKey] || [] : [];
  const ssActiveSet = new Set(ssActive.map((x) => x.target));
  const ssAvail = ssSource.filter((x) => !ssActiveSet.has(x) && !ssChips.includes(x));
  const ssScopeLabel =
    ssScope === 'TIME_RANGE'
      ? `${ssMula ? labelMasa(ssMula) : '?'} – ${ssTamat ? labelMasa(ssTamat) : 'Tamat sekolah'}`
      : 'Sepanjang Hari';

  return (
    <div className="wrap">
      <header className="bar">
        <div className="brand">
          <Link href="/dashboard" className="back">← Dashboard</Link>
          <h1 className="title">Jadual Guru Ganti</h1>
        </div>
      </header>

      <main className="main">
        {/* Tarikh */}
        <div className="toolbar">
          <input
            type="date"
            className="inp"
            value={tarikh}
            onChange={(e) => setTarikh(e.target.value)}
            aria-label="Tarikh"
          />
        </div>

        {/* Tetapan Khas Jadual — sebelum Jana Relief */}
        {!locked && (
          <section className="ss">
            <div className="ssHead">Tetapan Khas Jadual</div>
            <p className="ssSub">Berkuat kuasa pada tarikh dipilih sahaja. Tetapkan sebelum Jana Relief.</p>
            <div className="ssTabs" role="tablist" aria-label="Jenis tetapan">
              {SS_TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={ssTab === t.key}
                  className={`ssTab ${ssTab === t.key ? 'on' : ''}`}
                  onClick={() => ssTukarTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="ssNota">{ssCur.nota}</p>
            {ssError && <div className="alert" role="alert">{ssError}</div>}

            {/* Multi-select → chip */}
            <select
              className="inp grow"
              value=""
              onChange={(e) => { tambahChip(e.target.value); e.target.value = ''; }}
              aria-label={ssCur.pilih}
            >
              <option value="">{ssCur.pilih} (boleh lebih dari satu)…</option>
              {ssAvail.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
            {ssChips.length > 0 && (
              <div className="chips">
                {ssChips.map((nama) => (
                  <span className="chip" key={nama}>
                    {nama}
                    <button type="button" className="chipX" onClick={() => buangChip(nama)} aria-label={`Buang ${nama}`}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Masa + Tambah */}
            <div className="ssMasaRow">
              <button type="button" className="btn ghost ssMasaBtn" onClick={bukaModal}>
                Tetapkan Masa: <b>{ssScopeLabel}</b>
              </button>
              <button className="btn add" onClick={ssTambah} disabled={ssChips.length === 0 || ssBusy}>
                {ssBusy ? 'Menambah…' : `+ Tambah${ssChips.length ? ` (${ssChips.length})` : ''}`}
              </button>
            </div>

            {ssActive.length === 0 ? (
              <p className="ssEmpty">{ssCur.empty}</p>
            ) : (
              <ul className="ssList">
                {ssActive.map((item) => (
                  <li className="ssItem" key={item.id}>
                    <span className="ssMark">{ssCur.mark}</span>
                    <span className="ssInfo">
                      <span className="ssTarget">{item.target}</span>
                      <span className="ssMasa">{fmtScope(item)}</span>
                    </span>
                    <button className="ssDel" onClick={() => ssPadam(item.id)} disabled={ssBusy} aria-label={`Padam ${item.target}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Modal: Tetapkan Masa */}
        {ssModal && (
          <div className="modalBg" role="dialog" aria-modal="true" onClick={() => setSsModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modalTitle">Tetapkan Masa</div>
              <div className="seg2" role="radiogroup" aria-label="Skop masa">
                <button type="button" role="radio" aria-checked={mScope === 'FULL_DAY'} className={`seg2Btn ${mScope === 'FULL_DAY' ? 'on' : ''}`} onClick={() => setMScope('FULL_DAY')}>Sepanjang Hari</button>
                <button type="button" role="radio" aria-checked={mScope === 'TIME_RANGE'} className={`seg2Btn ${mScope === 'TIME_RANGE' ? 'on' : ''}`} onClick={() => setMScope('TIME_RANGE')}>Masa Tertentu</button>
              </div>
              {mScope === 'TIME_RANGE' && (
                <div className="mFields">
                  <label className="mLbl" htmlFor="mMula">Masa mula</label>
                  <select id="mMula" className="inp" value={mMula} onChange={(e) => setMMula(e.target.value)}>
                    <option value="">Pilih masa mula…</option>
                    {MASA_LIST.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <label className="mLbl" htmlFor="mTamat">Masa tamat</label>
                  <select id="mTamat" className="inp" value={mTamat} onChange={(e) => setMTamat(e.target.value)}>
                    <option value="">Tamat sekolah</option>
                    {MASA_LIST.filter((o) => !mMula || o.value > mMula).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              <div className="modalBtns">
                <button type="button" className="btn ghost" onClick={() => setSsModal(false)}>Batal</button>
                <button type="button" className="btn" onClick={sahkanModal}>Sahkan</button>
              </div>
            </div>
          </div>
        )}

        {/* Tindakan: Jana / Refresh */}
        <div className="toolbar">
          {data && !locked ? (
            <button className="btn" onClick={() => jana(true)} disabled={busy}>
              {busy ? 'Menjana…' : 'Jana Semula'}
            </button>
          ) : (
            !locked && (
              <button className="btn" onClick={() => jana(false)} disabled={busy}>
                {busy ? 'Menjana…' : 'Jana Relief'}
              </button>
            )
          )}
          <button className="btn ghost" onClick={() => load(tarikh)} disabled={loading || busy}>
            Refresh
          </button>
        </div>

        {locked && (
          <div className="notice locked" role="status">
            Batch ini berstatus <b>{STATUS_BATCH[data.status] || data.status}</b> dan telah dikunci.
            Jana semula serta perubahan guru ganti tidak dibenarkan.
          </div>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
        {!error && notice && <div className="notice" role="status">{notice}</div>}

        {/* Statistik ringkas */}
        {data && (
          <>
            <section className="cards">
              <div className="statCard"><div className="statNum">{stat.guruAbsen}</div><div className="statLbl">Guru Tak Hadir</div></div>
              <div className="statCard"><div className="statNum">{stat.slot}</div><div className="statLbl">Slot Relief</div></div>
              <div className="statCard"><div className="statNum">{stat.ganti}</div><div className="statLbl">Guru Ganti Digunakan</div></div>
              <div className="statCard">
                <div className="statNum sm"><span className={`badge batch ${(data.status || '').toLowerCase()}`}>{STATUS_BATCH[data.status] || data.status}</span></div>
                <div className="statLbl">Status Batch</div>
              </div>
            </section>
            <p className="meta">
              Tarikh {fmtDate(tarikh)}
              {data.generatedBy ? ` · dijana oleh ${data.generatedBy} • ${fmtDateTime(data.generatedAt)}` : ''}
            </p>

            {/* Bar tindakan utama */}
            <div className="actionsBar">
              <button className="btn pdf" onClick={janaPdf} disabled={pdfBusy || rowsSorted.length === 0}>
                {pdfBusy ? 'Menjana PDF…' : 'Jana PDF'}
              </button>
            </div>
          </>
        )}

        {/* Senarai relief — jadual compact (semua skrin; mobile boleh swipe kiri-kanan) */}
        {data && (
          <div className="tableWrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="cNo">#</th>
                  <th className="cName">Guru Tak Hadir</th>
                  <th>Kelas</th>
                  <th>Subjek</th>
                  <th>Mula</th>
                  <th>Tamat</th>
                  <th className="cGanti">Guru Ganti</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="empty">Memuatkan…</td></tr>
                ) : rowsSorted.length === 0 ? (
                  <tr><td colSpan={7} className="empty">Tiada baris relief.</td></tr>
                ) : (
                  rowsSorted.map((a, i) => {
                    const { mula, tamat } = splitMasa(a.masa);
                    return (
                      <tr key={a.id}>
                        <td className="cNo">{i + 1}</td>
                        <td className="cName">{a.guruTakHadir}</td>
                        <td><span className="kelas">{a.kelas}</span></td>
                        <td>{a.subjek ? <span className="subj">{a.subjek}</span> : <span className="muted">—</span>}</td>
                        <td className="mono">{mula}</td>
                        <td className="mono">{tamat}</td>
                        <td className="cGanti">
                          {gantiSelect(a)}
                          {rowBusy === a.id && <span className="saving"> …</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {!data && !loading && (
          <div className="panel empty">{notice || 'Belum dijana untuk tarikh ini.'}</div>
        )}
      </main>

      <style jsx>{`
        .wrap { min-height: 100vh; background: #eef3f1; }
        .bar { padding: 14px 18px; background: #fff; border-bottom: 1px solid #dce5e2; }
        .back { font-size: 13px; color: #0f766e; text-decoration: none; }
        .back:hover { text-decoration: underline; }
        .title { margin: 4px 0 0; font-size: 19px; font-weight: 700; color: #0f2a23; }
        .main { max-width: 1180px; margin: 0 auto; padding: 18px 16px 48px; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
        .inp { padding: 9px 11px; font-size: 14px; color: #0f2a23; background: #fff; border: 1px solid #d3ded9; border-radius: 9px; outline: none; }
        .inp:focus-visible { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.15); }
        .btn { padding: 9px 15px; font-size: 14px; font-weight: 600; color: #fff; background: #0f766e; border: none; border-radius: 9px; cursor: pointer; }
        .btn:hover:not(:disabled) { background: #0b5e57; }
        .btn:disabled { opacity: .6; cursor: progress; }
        .btn.ghost { color: #0f766e; background: #f1f5f4; border: 1px solid #d3ded9; }
        .btn.ghost:hover:not(:disabled) { background: #e7eeec; }

        .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
        .statCard { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; padding: 16px; }
        .statNum { font-size: 24px; font-weight: 700; color: #0f766e; }
        .statNum.sm { font-size: 14px; }
        .statLbl { font-size: 12px; color: #5b716a; margin-top: 4px; }
        .meta { margin: 0 0 16px; font-size: 12.5px; color: #5b716a; }

        .alert { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 9px; }
        .ss { margin: 0 0 16px; padding: 16px; background: #fafcfb; border: 1px solid #dce5e2; border-radius: 14px; }
        .ssHead { font-size: 15px; font-weight: 700; color: #0f2a23; }
        .ssSub { margin: 4px 0 12px; font-size: 12.5px; color: #5b716a; }
        .ssTabs { display: flex; gap: 6px; padding: 4px; background: #eef3f1; border-radius: 11px; }
        .ssTab { flex: 1; padding: 9px 8px; font-size: 13.5px; font-weight: 600; color: #2b3f39; background: transparent; border: none; border-radius: 8px; cursor: pointer; }
        .ssTab.on { color: #fff; background: #0f766e; }
        .ssNota { margin: 10px 0 12px; font-size: 12px; color: #6b8079; line-height: 1.5; }
        .ssAdder { display: flex; gap: 8px; align-items: stretch; }
        .grow { flex: 1; }
        .add { flex: none; padding: 0 16px; white-space: nowrap; }
        .ssList { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .ssItem { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff; border: 1px solid #e3ebe8; border-radius: 10px; }
        .ssMark { flex: none; color: #0f766e; font-weight: 700; }
        .ssTarget { font-size: 14px; font-weight: 600; color: #0f2a23; }
        .ssInfo { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .ssMasa { font-size: 12px; color: #5f7a72; }
        .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; font-size: 13px; font-weight: 600; color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; border-radius: 999px; }
        .chipX { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; font-size: 16px; line-height: 1; color: #0b5e57; background: rgba(11,94,87,0.12); border: none; border-radius: 50%; cursor: pointer; }
        .chipX:hover { background: rgba(11,94,87,0.22); }
        .ssMasaRow { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; margin-top: 12px; }
        .ssMasaBtn { flex: 1; text-align: left; min-width: 180px; }
        .modalBg { position: fixed; inset: 0; background: rgba(15,42,35,0.45); display: flex; align-items: center; justify-content: center; padding: 18px; z-index: 50; }
        .modal { width: 100%; max-width: 380px; background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 20px 50px -20px rgba(15,42,35,0.5); }
        .modalTitle { font-size: 16px; font-weight: 700; color: #0f2a23; margin-bottom: 14px; }
        .seg2 { display: flex; gap: 6px; padding: 4px; background: #eef3f1; border-radius: 11px; }
        .seg2Btn { flex: 1; padding: 9px 8px; font-size: 13.5px; font-weight: 600; color: #2b3f39; background: transparent; border: none; border-radius: 8px; cursor: pointer; }
        .seg2Btn.on { color: #fff; background: #0f766e; }
        .mFields { margin-top: 14px; }
        .mLbl { display: block; font-size: 13px; font-weight: 600; color: #2b3f39; margin: 10px 0 6px; }
        .modalBtns { display: flex; gap: 8px; margin-top: 18px; }
        .modalBtns .btn { flex: 1; }
        .ssEmpty { margin: 14px 0 0; padding: 16px; text-align: center; font-size: 13px; color: #5f7a72; background: #fff; border: 1px dashed #cdd9d4; border-radius: 10px; }
        .ssDel { flex: none; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; line-height: 1; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 8px; cursor: pointer; }
        .ssDel:hover:not(:disabled) { background: #fde3df; }
        .ssDel:disabled { opacity: 0.5; cursor: not-allowed; }
        .ssEmpty { margin: 14px 0 0; padding: 16px; text-align: center; font-size: 13px; color: #5f7a72; background: #fff; border: 1px dashed #cdd9d4; border-radius: 10px; }
        .notice { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #3b544c; background: #f1f5f4; border: 1px solid #d3ded9; border-radius: 9px; }
        .notice.locked { color: #92400e; background: #fef6e7; border-color: #f5e0b8; }
        .panel { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; }
        .empty { text-align: center; color: #80958e; padding: 28px 16px; }

        /* Bar tindakan utama */
        .actionsBar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 0 16px; }
        .btn.big { padding: 12px 20px; font-size: 15px; border-radius: 11px; }
        .btn:disabled { opacity: .55; cursor: not-allowed; }
        .btn.pdf { padding: 12px 22px; font-size: 15px; border-radius: 11px; }

        .gantiSel { width: 100%; cursor: pointer; }
        .gantiSel:focus-visible { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.15); }
        .gantiSel:disabled { background: #f4f7f6; color: #5f7a72; cursor: not-allowed; }
        .saving { display: inline-block; margin-left: 6px; font-size: 12px; color: #5f7a72; }

        /* Jadual */
        .tableWrap { overflow-x: auto; background: #fff; border: 1px solid #dce5e2; border-radius: 14px; -webkit-overflow-scrolling: touch; }
        .tbl { width: 100%; border-collapse: collapse; min-width: 880px; font-size: 13.5px; }
        .tbl th { text-align: left; padding: 12px 14px; background: #0f766e; color: #fff; font-weight: 600; font-size: 12.5px; white-space: nowrap; }
        .tbl th:first-child { border-top-left-radius: 14px; }
        .tbl th:last-child { border-top-right-radius: 14px; }
        .tbl td { padding: 11px 14px; border-top: 1px solid #eef2f0; color: #233a33; vertical-align: middle; }
        .tbl tbody tr:hover { background: #f7faf9; }
        .cNo { width: 44px; text-align: center; font-weight: 700; color: #5b716a; }
        td.cNo { color: #0f2a23; }
        .cName { min-width: 240px; }
        td.cName { font-weight: 600; color: #0f2a23; white-space: nowrap; }
        .mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; white-space: nowrap; }
        .muted { color: #9aa8a2; }
        .kelas { display: inline-block; font-weight: 700; font-size: 12.5px; color: #0f2a23; white-space: nowrap; }
        .subj { display: inline-block; padding: 2px 9px; font-size: 11px; font-weight: 700; letter-spacing: .02em; color: #3b5bdb; background: #eef2ff; border: 1px solid #dbe4ff; border-radius: 999px; white-space: nowrap; }

        .cGanti { min-width: 300px; }
        .cGanti .gantiSel { max-width: 380px; padding: 8px 10px; font-size: 13px; }
        .badge { display: inline-block; padding: 3px 10px; font-size: 12px; font-weight: 600; border-radius: 999px; white-space: nowrap; }
        .badge.disahkan { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
        .badge.belum { color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; }
        .badge.tiada { color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; }
        .badge.batal { color: #6b7280; background: #f3f4f6; border: 1px solid #e0e3e7; }
        .badge.batch { color: #3b544c; background: #eef2f0; border: 1px solid #d3ded9; }
        .badge.batch.dijana { color: #0b5e57; background: #e6f4f0; border-color: #c2e3da; }
        .badge.batch.dihantar, .badge.batch.selesai { color: #1d4ed8; background: #eaf0fe; border-color: #cdddfb; }
        .act { display: flex; gap: 6px; }
        .mini { padding: 6px 10px; font-size: 12.5px; font-weight: 600; border-radius: 8px; border: 1px solid; cursor: pointer; background: #fff; }
        .mini.ok { color: #fff; background: #0f766e; border-color: #0f766e; }
        .mini.ok:hover:not(:disabled) { background: #0b5e57; }
        .mini.no { color: #b42318; border-color: #fcd2cd; }
        .mini.no:hover:not(:disabled) { background: #fef3f2; }
        .mini:disabled { opacity: .6; cursor: progress; }

        @media (max-width: 860px) {
          .cards { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
