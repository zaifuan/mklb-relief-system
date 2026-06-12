'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Page() {
  const [opts, setOpts] = useState(null);
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [optsError, setOptsError] = useState('');

  const [form, setForm] = useState({
    guruNama: '',
    tarikh: '',
    sebab: '',
    jenis: 'SEPANJANG_HARI',
    masaMula: '',
    catatan: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');

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

  function validate() {
    if (!form.guruNama) return 'Sila pilih nama guru.';
    if (!form.tarikh) return 'Sila pilih tarikh.';
    if (!form.sebab) return 'Sila pilih sebab ketidakhadiran.';
    if (separuh && !form.masaMula.trim()) return 'Sila isi masa mula untuk separuh hari.';
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
        guruNama: form.guruNama,
        tarikh: form.tarikh,
        sebab: form.sebab,
        jenis: form.jenis,
        masaMula: separuh ? form.masaMula.trim() : undefined,
        catatan: form.catatan.trim() || undefined,
      };
      const res = await api.submit(payload);
      setReference(res.reference);
    } catch (err) {
      setError(err.message || 'Penghantaran gagal. Cuba lagi.');
      setSubmitting(false);
    }
  }

  function resetForm() {
    setForm({ guruNama: '', tarikh: '', sebab: '', jenis: 'SEPANJANG_HARI', masaMula: '', catatan: '' });
    setReference('');
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

        {reference ? (
          <div className="done" role="status" aria-live="polite">
            <span className="check" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.2 4.2L19 7" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <h1 className="doneTitle">Permohonan diterima</h1>
            <p className="doneSub">Sila simpan nombor rujukan ini sebagai bukti penghantaran.</p>
            <div className="ref">{reference}</div>
            <button className="btn ghost" onClick={resetForm}>Hantar borang lain</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {/* Nama guru */}
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
            {optsError && <p className="hint err">{optsError}</p>}

            {/* Tarikh */}
            <label className="lbl" htmlFor="tarikh">Tarikh tidak hadir</label>
            <input
              id="tarikh"
              type="date"
              className="inp"
              value={form.tarikh}
              onChange={(e) => set('tarikh', e.target.value)}
            />

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

            {/* Masa mula (jika separuh hari) */}
            {separuh && (
              <>
                <label className="lbl" htmlFor="masa">Masa mula tidak hadir</label>
                <input
                  id="masa"
                  type="text"
                  className="inp"
                  placeholder="cth: Slot 3 atau 10:00"
                  value={form.masaMula}
                  onChange={(e) => set('masaMula', e.target.value)}
                />
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
          margin: 0 0 18px;
          font-size: 14px;
          color: #5b716a;
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
