'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogos', 'Sep', 'Okt', 'Nov', 'Dis'];
function fmtTarikh(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
}
function fmtRange(mula, tamat) {
  if (!mula) return '';
  if (!tamat || tamat === mula) return fmtTarikh(mula);
  return `${fmtTarikh(mula)} – ${fmtTarikh(tamat)}`;
}
// Senarai masa formal selang 30 minit (07:00 pagi → 06:00 petang).
// Simpan nilai 24-jam "HH:MM"; papar "HH:MM pagi/tengah hari/petang".
function labelMasa24(value) {
  const [h, m] = String(value).split(':').map(Number);
  const suffix = h < 12 ? 'pagi' : h === 12 ? 'tengah hari' : 'petang';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}
const MASA_OPTIONS = (() => {
  const out = [];
  for (let minit = 7 * 60; minit <= 18 * 60; minit += 30) {
    const h = Math.floor(minit / 60);
    const m = minit % 60;
    const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    out.push({ value, label: labelMasa24(value), minit });
  }
  return out;
})();
function minitMasa24(value) {
  return MASA_OPTIONS.find((s) => s.value === value)?.minit ?? null;
}
function fmtMasaRange(masaMula, masaTamat) {
  if (!masaMula) return '';
  const tamat = masaTamat ? labelMasa24(masaTamat) : 'Tamat sekolah';
  return `${labelMasa24(masaMula)} – ${tamat}`;
}
function todayStr() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default function Page() {
  const [opts, setOpts] = useState(null);
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [optsError, setOptsError] = useState('');

  const [form, setForm] = useState({
    guruNama: '',
    tarikhMula: '',
    tarikhTamat: '',
    sebab: '',
    jenis: 'SEPANJANG_HARI',
    masaMula: '',
    masaTamat: '',
    catatan: '',
  });
  // Mod individu / kumpulan
  const [mode, setMode] = useState('individu'); // 'individu' | 'kumpulan'
  const [guruList, setGuruList] = useState([]); // senarai nama untuk Kumpulan
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Tab utama: Hantar Borang / Semak-Batal
  const [tab, setTab] = useState('hantar'); // 'hantar' | 'semak'
  const [checkNama, setCheckNama] = useState('');
  const [checkTarikh, setCheckTarikh] = useState('');
  const [checkRows, setCheckRows] = useState(null); // null = belum semak, [] = tiada
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkInfo, setCheckInfo] = useState('');
  const [checkBusyId, setCheckBusyId] = useState(null); // id rekod sedang dibatalkan

  // Modal julat tarikh cuti
  const [dateModal, setDateModal] = useState(false);
  const [tmpMula, setTmpMula] = useState('');
  const [tmpTamat, setTmpTamat] = useState('');
  const [modalErr, setModalErr] = useState('');

  // Modal masa (separuh hari)
  const [masaModal, setMasaModal] = useState(false);
  const [tmpMasaMula, setTmpMasaMula] = useState('');
  const [tmpMasaTamat, setTmpMasaTamat] = useState('');
  const [masaErr, setMasaErr] = useState('');

  useEffect(() => {
    api
      .options()
      .then(setOpts)
      .catch((e) => setOptsError(e.message || 'Gagal memuat senarai guru'))
      .finally(() => setLoadingOpts(false));
  }, []);

  const perluDetail = !!opts?.sebabPerluDetail?.includes(form.sebab);
  const separuh = form.jenis === 'SEPARUH_HARI';

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function tambahGuru(nama) {
    if (!nama) return;
    setGuruList((list) => (list.includes(nama) ? list : [...list, nama]));
  }
  function buangGuru(nama) {
    setGuruList((list) => list.filter((n) => n !== nama));
  }

  const labelSebab = (v) => opts?.sebab?.find((s) => s.value === v)?.label || v;
  const labelJenis = (v) => opts?.jenis?.find((j) => j.value === v)?.label || v;
  const STATUS_LABEL = { AKTIF: 'Aktif', DIBATALKAN: 'Dibatalkan', SELESAI: 'Selesai' };

  async function semakRekod() {
    if (!checkNama || !checkTarikh) {
      setCheckError('Sila pilih nama guru dan tarikh.');
      return;
    }
    setCheckError('');
    setCheckInfo('');
    setCheckLoading(true);
    try {
      const data = await api.check(checkNama, checkTarikh);
      setCheckRows(data.records || []);
    } catch (e) {
      setCheckError(e.message || 'Gagal menyemak rekod.');
      setCheckRows(null);
    } finally {
      setCheckLoading(false);
    }
  }

  async function batalRekod(id) {
    if (checkBusyId) return;
    if (!confirm('Adakah anda pasti mahu membatalkan rekod ini?')) return;
    setCheckError('');
    setCheckInfo('');
    setCheckBusyId(id);
    try {
      await api.cancel(id, checkNama);
      setCheckInfo('Rekod telah dibatalkan.');
      const data = await api.check(checkNama, checkTarikh); // refresh
      setCheckRows(data.records || []);
    } catch (e) {
      setCheckError(e.message || 'Gagal membatalkan rekod.');
    } finally {
      setCheckBusyId(null);
    }
  }

  function openDateModal() {
    const m = form.tarikhMula || todayStr();
    setTmpMula(m);
    setTmpTamat(form.tarikhTamat || m);
    setModalErr('');
    setDateModal(true);
  }
  function closeDateModal() {
    setDateModal(false);
    setModalErr('');
  }
  function confirmDate() {
    if (!tmpMula) {
      setModalErr('Sila pilih tarikh mula.');
      return;
    }
    const tamat = tmpTamat || tmpMula;
    if (tamat < tmpMula) {
      setModalErr('Tarikh tamat tidak boleh sebelum tarikh mula.');
      return;
    }
    setForm((f) => ({ ...f, tarikhMula: tmpMula, tarikhTamat: tamat }));
    setDateModal(false);
    setModalErr('');
  }

  // Minit slot dari opts (untuk susunan/validasi tamat > mula)
  function minitMasa(v) {
    return minitMasa24(v);
  }
  function openMasaModal() {
    setTmpMasaMula(form.masaMula || '');
    setTmpMasaTamat(form.masaTamat || '');
    setMasaErr('');
    setMasaModal(true);
  }
  function closeMasaModal() {
    setMasaModal(false);
    setMasaErr('');
  }
  function confirmMasa() {
    if (!tmpMasaMula) {
      setMasaErr('Sila pilih masa mula.');
      return;
    }
    if (tmpMasaTamat) {
      const sm = minitMasa(tmpMasaMula);
      const st = minitMasa(tmpMasaTamat);
      if (sm != null && st != null && st <= sm) {
        setMasaErr('Masa tamat mesti selepas masa mula.');
        return;
      }
    }
    setForm((f) => ({ ...f, masaMula: tmpMasaMula, masaTamat: tmpMasaTamat }));
    setMasaModal(false);
    setMasaErr('');
  }

  function validate() {
    if (mode === 'kumpulan') {
      if (guruList.length < 2) return 'Mod Kumpulan perlu sekurang-kurangnya 2 guru.';
    } else if (!form.guruNama) {
      return 'Sila pilih nama guru.';
    }
    if (!form.tarikhMula) return 'Sila pilih tarikh.';
    if (!form.sebab) return 'Sila pilih sebab ketidakhadiran.';
    if (separuh && !form.masaMula) return 'Sila pilih masa tidak hadir.';
    if (perluDetail && !form.catatan.trim()) return 'Catatan diperlukan untuk sebab yang dipilih.';
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        ...(mode === 'kumpulan' ? { guruNamaList: guruList } : { guruNama: form.guruNama }),
        tarikhMula: form.tarikhMula,
        tarikhTamat: form.tarikhTamat || form.tarikhMula,
        sebab: form.sebab,
        jenis: form.jenis,
        masaMula: separuh ? form.masaMula : undefined,
        masaTamat: separuh ? form.masaTamat || undefined : undefined,
        catatan: form.catatan.trim() || undefined,
      };
      const res = await api.submit(payload);
      setResult(res);
    } catch (err) {
      setError(err.message || 'Penghantaran gagal. Cuba lagi.');
      setSubmitting(false);
    }
  }

  function resetForm() {
    setForm({ guruNama: '', tarikhMula: '', tarikhTamat: '', sebab: '', jenis: 'SEPANJANG_HARI', masaMula: '', masaTamat: '', catatan: '' });
    setMode('individu');
    setGuruList([]);
    setResult(null);
    setError('');
    setSubmitting(false);
  }

  return (
    <main className="screen">
      <div className="grid-bg" aria-hidden="true" />

      <section className="card">
        <header className="head">
          <span className="mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="white" strokeWidth="1.6" />
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="white" strokeWidth="1.1" opacity="0.85" />
              <rect x="9" y="9" width="6" height="6" fill="#C9A227" />
            </svg>
          </span>
          <div>
            <div className="eyebrow">Borang Ketidakhadiran Guru</div>
            <div className="school">SABK Maahad Al-Khair Lil Banat</div>
          </div>
        </header>

        {/* Tab utama: Hantar Borang / Semak-Batal Rekod */}
        <div className="seg tabSeg" role="radiogroup" aria-label="Mod borang">
          <button
            type="button"
            role="radio"
            aria-checked={tab === 'hantar'}
            className={`segBtn ${tab === 'hantar' ? 'on' : ''}`}
            onClick={() => setTab('hantar')}
          >
            Hantar Borang
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={tab === 'semak'}
            className={`segBtn ${tab === 'semak' ? 'on' : ''}`}
            onClick={() => setTab('semak')}
          >
            Semak / Batal Rekod
          </button>
        </div>

        {tab === 'semak' ? (
          <div className="checkPanel">
            <label className="lbl" htmlFor="ckGuru">Nama guru</label>
            <select
              id="ckGuru"
              className="inp"
              value={checkNama}
              onChange={(e) => { setCheckNama(e.target.value); setCheckRows(null); setCheckInfo(''); }}
              disabled={loadingOpts || !!optsError}
            >
              <option value="">{loadingOpts ? 'Memuatkan…' : 'Pilih guru'}</option>
              {opts?.teachers?.map((t) => (
                <option key={t.id} value={t.nama}>{t.nama}</option>
              ))}
            </select>

            <label className="lbl" htmlFor="ckTarikh">Tarikh</label>
            <input
              id="ckTarikh"
              type="date"
              className="inp"
              value={checkTarikh}
              onChange={(e) => { setCheckTarikh(e.target.value); setCheckRows(null); setCheckInfo(''); }}
            />

            <button
              type="button"
              className="btn semakBtn"
              onClick={semakRekod}
              disabled={checkLoading || !checkNama || !checkTarikh}
            >
              {checkLoading ? 'Menyemak…' : 'Semak Rekod'}
            </button>

            {optsError && <p className="hint err">{optsError}</p>}
            {checkError && <p className="hint err">{checkError}</p>}
            {checkInfo && <p className="okMsg" role="status">{checkInfo}</p>}

            {checkRows !== null &&
              (checkRows.length === 0 ? (
                <p className="emptyMsg">Tiada rekod aktif ditemui.</p>
              ) : (
                <div className="recList">
                  {checkRows.map((r) => (
                    <div className="rec" key={r.id}>
                      <div className="recRow"><span className="recK">Tarikh</span><span className="recV">{fmtTarikh(String(r.tarikh).slice(0, 10))} ({r.hari})</span></div>
                      <div className="recRow"><span className="recK">Sebab</span><span className="recV">{labelSebab(r.sebabKategori)}</span></div>
                      <div className="recRow"><span className="recK">Jenis</span><span className="recV">{labelJenis(r.jenis)}</span></div>
                      {r.jenis === 'SEPARUH_HARI' && (r.masaMula || r.masaTamat) && (
                        <div className="recRow"><span className="recK">Masa</span><span className="recV">
                          {/^\d{1,2}:\d{2}$/.test(r.masaMula || '')
                            ? fmtMasaRange(r.masaMula, r.masaTamat)
                            : `${r.masaMula || '-'} – ${r.masaTamat || 'Tamat sekolah'}`}
                        </span></div>
                      )}
                      {r.sebabDetail && (
                        <div className="recRow"><span className="recK">Catatan</span><span className="recV">{r.sebabDetail}</span></div>
                      )}
                      <div className="recRow"><span className="recK">Status</span><span className="recV"><span className={`sBadge ${r.statusBorang.toLowerCase()}`}>{STATUS_LABEL[r.statusBorang] || r.statusBorang}</span></span></div>
                      {r.statusBorang === 'AKTIF' && (
                        <button
                          type="button"
                          className="btn danger full"
                          onClick={() => batalRekod(r.id)}
                          disabled={checkBusyId === r.id}
                        >
                          {checkBusyId === r.id ? 'Membatalkan…' : 'Batal Rekod'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        ) : result ? (
          <div className="done" role="status" aria-live="polite">
            <span className="check" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.2 4.2L19 7" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="doneTitle">Permohonan berjaya dihantar</h1>
            {(result.jumlahRekodBerjaya ?? result.dicipta ?? 0) > 0 ? (
              <>
                <p className="doneSub">
                  {result.jumlahRekodBerjaya ?? result.dicipta} rekod berjaya direkodkan
                </p>
                {((result.jumlahGuru ?? 1) > 1 || (result.jumlahHari ?? 1) > 1) && (
                  <p className="doneMeta">
                    ({result.jumlahGuru ?? 1} guru × {result.jumlahHari ?? 1} hari)
                  </p>
                )}
                {(result.duplicateSkipped ?? result.dilangkau ?? 0) > 0 && (
                  <p className="doneMeta">
                    {result.duplicateSkipped ?? result.dilangkau} rekod dilangkau (sudah wujud sebelum ini).
                  </p>
                )}
              </>
            ) : (
              <p className="doneSub">Semua rekod sudah direkod sebelum ini.</p>
            )}
            <button className="btn ghost" onClick={resetForm}>Hantar borang lain</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {/* Mod: Individu / Kumpulan */}
            <label className="lbl">Mod ketidakhadiran</label>
            <div className="seg" role="radiogroup" aria-label="Mod ketidakhadiran">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'individu'}
                className={`segBtn ${mode === 'individu' ? 'on' : ''}`}
                onClick={() => setMode('individu')}
              >
                Individu
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'kumpulan'}
                className={`segBtn ${mode === 'kumpulan' ? 'on' : ''}`}
                onClick={() => setMode('kumpulan')}
              >
                Kumpulan
              </button>
            </div>

            {mode === 'individu' ? (
              <>
                {/* Nama guru (individu) */}
                <label className="lbl" htmlFor="guru">Nama guru</label>
                <select
                  id="guru"
                  className="inp"
                  value={form.guruNama}
                  onChange={(e) => set('guruNama', e.target.value)}
                  disabled={loadingOpts || !!optsError}
                >
                  <option value="">{loadingOpts ? 'Memuatkan…' : 'Pilih guru'}</option>
                  {opts?.teachers?.map((t) => (
                    <option key={t.id} value={t.nama}>{t.nama}</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                {/* Nama guru (kumpulan — pilih ≥ 2) */}
                <label className="lbl" htmlFor="guruAdd">Nama guru (pilih 2 atau lebih)</label>
                <select
                  id="guruAdd"
                  className="inp"
                  value=""
                  onChange={(e) => tambahGuru(e.target.value)}
                  disabled={loadingOpts || !!optsError}
                >
                  <option value="">{loadingOpts ? 'Memuatkan…' : 'Tambah guru…'}</option>
                  {opts?.teachers
                    ?.filter((t) => !guruList.includes(t.nama))
                    .map((t) => (
                      <option key={t.id} value={t.nama}>{t.nama}</option>
                    ))}
                </select>
                {guruList.length > 0 && (
                  <div className="chips">
                    {guruList.map((nama) => (
                      <span className="chip" key={nama}>
                        {nama}
                        <button
                          type="button"
                          className="chipX"
                          onClick={() => buangGuru(nama)}
                          aria-label={`Buang ${nama}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="hint">
                  {guruList.length} guru dipilih{guruList.length < 2 ? ' — minimum 2 untuk Kumpulan' : ''}.
                </p>
              </>
            )}
            {optsError && <p className="hint err">{optsError}</p>}

            {/* Tarikh — field utama minimal + modal julat */}
            <label className="lbl" htmlFor="tarikhBtn">Tarikh tidak hadir</label>
            <button
              type="button"
              id="tarikhBtn"
              className={`inp dateField${form.tarikhMula ? '' : ' ph'}`}
              onClick={openDateModal}
            >
              <span>{form.tarikhMula ? fmtRange(form.tarikhMula, form.tarikhTamat) : 'Pilih tarikh'}</span>
              <svg className="cal" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M3 9h18M8 2.5v4M16 2.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>

            {/* Sebab */}
            <label className="lbl" htmlFor="sebab">Sebab ketidakhadiran</label>
            <select
              id="sebab"
              className="inp"
              value={form.sebab}
              onChange={(e) => set('sebab', e.target.value)}
            >
              <option value="">Pilih sebab</option>
              {opts?.sebab?.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            {/* Jenis */}
            <span className="lbl">Jenis ketidakhadiran</span>
            <div className="seg" role="radiogroup" aria-label="Jenis ketidakhadiran">
              {opts?.jenis?.map((j) => (
                <button
                  type="button"
                  key={j.value}
                  className={`segBtn ${form.jenis === j.value ? 'on' : ''}`}
                  role="radio"
                  aria-checked={form.jenis === j.value}
                  onClick={() => set('jenis', j.value)}
                >
                  {j.label}
                </button>
              ))}
            </div>

            {/* Masa tidak hadir (jika separuh hari) — pemilih, bukan taip bebas */}
            {separuh && (
              <>
                <label className="lbl" htmlFor="masaBtn">Masa tidak hadir</label>
                <button
                  type="button"
                  id="masaBtn"
                  className={`inp dateField${form.masaMula ? '' : ' ph'}`}
                  onClick={openMasaModal}
                >
                  <span>{form.masaMula ? fmtMasaRange(form.masaMula, form.masaTamat) : 'Pilih masa'}</span>
                  <svg className="cal" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}

            {/* Catatan */}
            <label className="lbl" htmlFor="catatan">
              Catatan {perluDetail ? <span className="req">(wajib)</span> : <span className="opt">(pilihan)</span>}
            </label>
            <textarea
              id="catatan"
              className="inp area"
              rows={3}
              placeholder={perluDetail ? 'Nyatakan butiran program / sebab' : 'Catatan tambahan (jika ada)'}
              value={form.catatan}
              onChange={(e) => set('catatan', e.target.value)}
            />

            {/* Lampiran — placeholder sahaja */}
            <span className="lbl">Lampiran</span>
            <div className="lampiran" aria-disabled="true">
              <span>Muat naik lampiran</span>
              <span className="soon">Akan datang</span>
            </div>

            {error && <div className="alert" role="alert" aria-live="assertive">{error}</div>}

            <button type="submit" className="btn" disabled={submitting || loadingOpts}>
              {submitting ? 'Menghantar…' : 'Hantar Borang'}
            </button>
          </form>
        )}
      </section>

      {dateModal && (
        <div className="overlay" onClick={closeDateModal}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="mHead">
              <span className="mTitle">Tarikh tidak hadir</span>
              <button type="button" className="x" onClick={closeDateModal} aria-label="Tutup">×</button>
            </div>

            <label className="lbl" htmlFor="mMula">Tarikh mula</label>
            <input
              id="mMula"
              type="date"
              className="inp"
              value={tmpMula}
              onChange={(e) => {
                const v = e.target.value;
                setTmpMula(v);
                if (!tmpTamat || tmpTamat < v) setTmpTamat(v);
              }}
            />

            <label className="lbl" htmlFor="mTamat">Tarikh tamat cuti</label>
            <input
              id="mTamat"
              type="date"
              className="inp"
              value={tmpTamat}
              min={tmpMula || undefined}
              onChange={(e) => setTmpTamat(e.target.value)}
            />
            <p className="hint">Cuti sehari? Pilih tarikh tamat yang sama dengan tarikh mula.</p>
            {modalErr && <p className="hint err">{modalErr}</p>}

            <div className="mActions">
              <button type="button" className="btn ghost mBtn" onClick={closeDateModal}>Batal</button>
              <button type="button" className="btn mBtn" onClick={confirmDate}>Sahkan</button>
            </div>
          </div>
        </div>
      )}

      {masaModal && (
        <div className="overlay" onClick={closeMasaModal}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="mHead">
              <span className="mTitle">Masa tidak hadir</span>
              <button type="button" className="x" onClick={closeMasaModal} aria-label="Tutup">×</button>
            </div>

            <label className="lbl" htmlFor="msMula">Masa mula tidak hadir</label>
            <select
              id="msMula"
              className="inp"
              value={tmpMasaMula}
              onChange={(e) => {
                const v = e.target.value;
                setTmpMasaMula(v);
                const sm = minitMasa(v);
                const st = minitMasa(tmpMasaTamat);
                if (v && tmpMasaTamat && sm != null && st != null && st <= sm) setTmpMasaTamat('');
              }}
            >
              <option value="">Pilih masa</option>
              {MASA_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <label className="lbl" htmlFor="msTamat">Masa tamat tidak hadir</label>
            <select id="msTamat" className="inp" value={tmpMasaTamat} onChange={(e) => setTmpMasaTamat(e.target.value)}>
              <option value="">Tamat sekolah</option>
              {MASA_OPTIONS.filter((s) => {
                const sm = minitMasa(tmpMasaMula);
                return sm == null || s.minit > sm;
              }).map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <p className="hint">Biar “Tamat sekolah” jika tidak hadir hingga waktu akhir persekolahan.</p>
            {masaErr && <p className="hint err">{masaErr}</p>}

            <div className="mActions">
              <button type="button" className="btn ghost mBtn" onClick={closeMasaModal}>Batal</button>
              <button type="button" className="btn mBtn" onClick={confirmMasa}>Sahkan</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .screen {
          position: relative;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding: 20px 16px 48px;
          background: #eef3f1;
          overflow: hidden;
        }
        .grid-bg {
          position: absolute;
          inset: -10%;
          background-image: linear-gradient(#e0e9e6 1px, transparent 1px),
            linear-gradient(90deg, #e0e9e6 1px, transparent 1px);
          background-size: 44px 44px;
          -webkit-mask-image: radial-gradient(circle at 50% 0%, #000 0%, transparent 60%);
          mask-image: radial-gradient(circle at 50% 0%, #000 0%, transparent 60%);
          pointer-events: none;
        }
        .card {
          position: relative;
          width: 100%;
          max-width: 460px;
          background: #fff;
          border: 1px solid #dce5e2;
          border-radius: 16px;
          padding: 22px 20px 24px;
          box-shadow: 0 1px 2px rgba(15, 42, 35, 0.04), 0 18px 40px -26px rgba(15, 42, 35, 0.26);
        }
        .head {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-bottom: 18px;
          margin-bottom: 18px;
          border-bottom: 1px solid #eef2f0;
        }
        .mark {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(160deg, #0f766e, #0b5e57);
        }
        .eyebrow {
          font-size: 15px;
          font-weight: 700;
          color: #0f2a23;
          line-height: 1.2;
        }
        .school {
          font-size: 12.5px;
          color: #5b716a;
          margin-top: 2px;
        }
        .lbl {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #2b3f39;
          margin: 15px 0 7px;
        }
        .req {
          color: #b42318;
          font-weight: 600;
        }
        .opt {
          color: #93a39d;
          font-weight: 500;
        }
        .inp {
          width: 100%;
          box-sizing: border-box;
          padding: 12px 13px;
          font-size: 16px; /* >=16px elak zoom auto di iOS */
          color: #0f2a23;
          background: #f7faf9;
          border: 1px solid #d3ded9;
          border-radius: 10px;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
        }
        .inp:focus-visible {
          border-color: #0f766e;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.16);
        }
        .area {
          resize: vertical;
          min-height: 64px;
          font-family: inherit;
        }
        .hint {
          margin: 6px 0 0;
          font-size: 12.5px;
        }
        .hint.err {
          color: #b42318;
        }
        .seg {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .segBtn {
          padding: 11px 10px;
          font-size: 14px;
          font-weight: 600;
          color: #3b544c;
          background: #f1f5f4;
          border: 1px solid #d3ded9;
          border-radius: 10px;
          cursor: pointer;
        }
        .segBtn.on {
          color: #fff;
          background: #0f766e;
          border-color: #0f766e;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 6px 6px 12px;
          font-size: 13.5px;
          font-weight: 600;
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
          border-radius: 999px;
        }
        .chipX {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          font-size: 16px;
          line-height: 1;
          color: #0b5e57;
          background: rgba(11, 94, 87, 0.12);
          border: none;
          border-radius: 50%;
          cursor: pointer;
        }
        .chipX:hover {
          background: rgba(11, 94, 87, 0.22);
        }
        .lampiran {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 13px;
          font-size: 13.5px;
          color: #93a39d;
          background: #f7faf9;
          border: 1px dashed #cfdbd6;
          border-radius: 10px;
        }
        .soon {
          font-size: 11px;
          font-weight: 600;
          color: #0f766e;
          background: #e6f4f0;
          padding: 3px 9px;
          border-radius: 999px;
        }
        .alert {
          margin-top: 16px;
          padding: 10px 12px;
          font-size: 13px;
          color: #b42318;
          background: #fef3f2;
          border: 1px solid #fcd2cd;
          border-radius: 9px;
        }
        .btn {
          width: 100%;
          margin-top: 20px;
          padding: 13px 16px;
          font-size: 15.5px;
          font-weight: 600;
          color: #fff;
          background: #0f766e;
          border: none;
          border-radius: 10px;
          cursor: pointer;
        }
        .btn:hover:not(:disabled) {
          background: #0b5e57;
        }
        .btn:focus-visible {
          outline: 2px solid #0b5e57;
          outline-offset: 2px;
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .btn.ghost {
          color: #0f766e;
          background: #f1f5f4;
          border: 1px solid #d3ded9;
        }
        .btn.ghost:hover:not(:disabled) {
          background: #e7eeec;
        }
        .btn.danger {
          color: #fff;
          background: #b42318;
        }
        .btn.danger:hover:not(:disabled) {
          background: #921a12;
        }
        .btn.full {
          width: 100%;
          margin-top: 12px;
        }
        .tabSeg {
          margin: 4px 0 18px;
        }
        .semakBtn {
          width: 100%;
          margin-top: 16px;
        }
        .okMsg {
          margin: 12px 0 0;
          padding: 10px 12px;
          font-size: 13.5px;
          font-weight: 600;
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
          border-radius: 9px;
        }
        .emptyMsg {
          margin: 18px 0 4px;
          padding: 18px;
          text-align: center;
          font-size: 14px;
          color: #5f7a72;
          background: #f4f7f6;
          border: 1px dashed #cdd9d4;
          border-radius: 10px;
        }
        .recList {
          margin-top: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .rec {
          padding: 14px 16px;
          background: #fafcfb;
          border: 1px solid #e3ebe8;
          border-radius: 12px;
        }
        .recRow {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          padding: 7px 0;
          border-bottom: 1px solid #eef2f0;
        }
        .recRow:last-of-type {
          border-bottom: none;
        }
        .recK {
          flex: none;
          font-size: 13px;
          color: #6b8079;
        }
        .recV {
          font-size: 13.5px;
          font-weight: 600;
          color: #0f2a23;
          text-align: right;
        }
        .sBadge {
          display: inline-block;
          padding: 3px 10px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 999px;
        }
        .sBadge.aktif {
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
        }
        .sBadge.dibatalkan {
          color: #b42318;
          background: #fef3f2;
          border: 1px solid #fcd2cd;
        }
        .sBadge.selesai {
          color: #1d4ed8;
          background: #eaf0fe;
          border: 1px solid #cdddfb;
        }
        .done {
          text-align: center;
          padding: 10px 4px 4px;
        }
        .check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: #0f766e;
          margin-bottom: 14px;
        }
        .doneTitle {
          margin: 0 0 4px;
          font-size: 20px;
          color: #0f2a23;
          font-weight: 700;
        }
        .doneSub {
          margin: 0 0 4px;
          font-size: 14px;
          color: #5b716a;
        }
        .doneMeta {
          margin: 2px 0 0;
          font-size: 13.5px;
          font-weight: 600;
          color: #5f7a72;
        }
        .done .btn {
          margin-top: 18px;
        }
        .ref {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
          border-radius: 12px;
          padding: 14px;
          margin-bottom: 20px;
        }
        .dateField {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          text-align: left;
          cursor: pointer;
        }
        .dateField.ph {
          color: #93a39d;
        }
        .dateField .cal {
          flex: none;
          color: #5b716a;
        }
        .refList {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 20px;
        }
        .refItem {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
          border-radius: 10px;
          padding: 10px 12px;
        }
        .overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          background: rgba(15, 42, 35, 0.42);
        }
        .modal {
          width: 100%;
          max-width: 380px;
          background: #fff;
          border: 1px solid #dce5e2;
          border-radius: 16px;
          padding: 18px 18px 20px;
          box-shadow: 0 20px 50px -20px rgba(15, 42, 35, 0.45);
        }
        .mHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 2px;
        }
        .mTitle {
          font-size: 15.5px;
          font-weight: 700;
          color: #0f2a23;
        }
        .x {
          border: none;
          background: transparent;
          font-size: 24px;
          line-height: 1;
          color: #80958e;
          cursor: pointer;
          padding: 0 4px;
        }
        .x:hover {
          color: #0f2a23;
        }
        .mActions {
          display: flex;
          gap: 10px;
          margin-top: 18px;
        }
        .mBtn {
          margin-top: 0;
          flex: 1;
        }
        @media (prefers-reduced-motion: no-preference) {
          .inp,
          .btn,
          .segBtn {
            transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
          }
        }
      `}</style>
    </main>
  );
}
