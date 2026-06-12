'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';

const STATUS_LABEL = { AKTIF: 'Aktif', DIBATALKAN: 'Dibatalkan', SELESAI: 'Selesai' };
const STATUS_LIST = ['AKTIF', 'DIBATALKAN', 'SELESAI'];

function fmtDate(iso) {
  if (!iso) return '-';
  const d = String(iso).slice(0, 10).split('-'); // YYYY-MM-DD
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
}
function fmtDateTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
function todayKL() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default function AbsenceDashboard() {
  const [role, setRole] = useState(null);
  const [opts, setOpts] = useState({ teachers: [], sebab: [], jenis: [] });
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState({ tarikh: '', status: 'AKTIF', sebab: '', guru: '', q: '' });

  const [selected, setSelected] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  // Telegram snapshot (Fasa 8)
  const [tg, setTg] = useState(null); // { tarikh, text, jumlahGuru, adaRekod, telegramSedia }
  const [tgLoading, setTgLoading] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgError, setTgError] = useState('');
  const [tgInfo, setTgInfo] = useState('');

  const sebabLabel = (v) => opts.sebab.find((s) => s.value === v)?.label || v;
  const jenisLabel = (v) => opts.jenis.find((j) => j.value === v)?.label || v;
  const isSuper = role === 'SUPER_ADMIN';

  const loadList = useCallback(async (f) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminAbsence.list(f);
      setRecords(data.records || []);
    } catch (e) {
      setError(e.message || 'Gagal memuat senarai');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.adminAbsence.summary());
    } catch {
      /* abaikan kad jika gagal */
    }
  }, []);

  useEffect(() => {
    api.me().then((u) => setRole(u.role)).catch(() => {});
    api.publicOptions().then((o) => setOpts(o)).catch(() => {});
    loadSummary();
    loadList({ status: 'AKTIF' });
  }, [loadList, loadSummary]);

  function setF(k, v) {
    setFilters((f) => ({ ...f, [k]: v }));
  }
  function tapis(e) {
    e?.preventDefault();
    loadList(filters);
  }
  function reset() {
    const f = { tarikh: '', status: 'AKTIF', sebab: '', guru: '', q: '' };
    setFilters(f);
    loadList(f);
  }

  async function openDetail(id) {
    setModalError('');
    try {
      const rec = await api.adminAbsence.get(id);
      setSelected(rec);
    } catch (e) {
      setError(e.message || 'Gagal membuka rekod');
    }
  }

  async function changeStatus(status) {
    if (!selected || modalBusy) return;
    setModalBusy(true);
    setModalError('');
    try {
      await api.adminAbsence.updateStatus(selected.id, status);
      setSelected({ ...selected, statusBorang: status });
      await Promise.all([loadList(filters), loadSummary()]);
    } catch (e) {
      setModalError(e.message || 'Gagal kemaskini status');
    } finally {
      setModalBusy(false);
    }
  }

  async function padam() {
    if (!selected || modalBusy) return;
    if (!confirm(`Padam rekod ${selected.reference}? (soft delete — boleh dipulihkan)`)) return;
    setModalBusy(true);
    setModalError('');
    try {
      await api.adminAbsence.remove(selected.id);
      setSelected(null);
      await Promise.all([loadList(filters), loadSummary()]);
    } catch (e) {
      setModalError(e.message || 'Gagal memadam rekod');
    } finally {
      setModalBusy(false);
    }
  }

  // ── Telegram snapshot (Fasa 8) ──
  async function openTelegram() {
    const tarikh = filters.tarikh || todayKL();
    setTg({ tarikh, text: '', jumlahGuru: 0, adaRekod: false, telegramSedia: true });
    setTgError('');
    setTgInfo('');
    setTgLoading(true);
    try {
      const d = await api.telegram.preview(tarikh);
      setTg({ ...d, tarikh });
    } catch (e) {
      setTgError(e.message || 'Gagal menjana pratonton snapshot');
    } finally {
      setTgLoading(false);
    }
  }

  function closeTelegram() {
    if (tgBusy) return;
    setTg(null);
    setTgError('');
    setTgInfo('');
  }

  async function hantarTelegram() {
    if (!tg || tgBusy) return;
    if (!confirm('Hantar snapshot ketidakhadiran ke group Telegram sekolah?')) return;
    setTgBusy(true);
    setTgError('');
    setTgInfo('');
    try {
      const res = await api.telegram.send(tg.tarikh);
      if (res.status === 'OK') {
        setTgInfo(`✅ Berjaya dihantar (${res.jumlahGuru} guru) pada ${res.masa}.`);
      } else if (res.status === 'TIADA') {
        setTgInfo(res.mesej || 'Tiada rekod — tiada mesej dihantar.');
      } else {
        setTgError(res.mesej || 'Gagal menghantar.');
      }
    } catch (e) {
      setTgError(e.message || 'Gagal menghantar snapshot');
    } finally {
      setTgBusy(false);
    }
  }

  const cards = [
    { k: 'hariIni', label: 'Ketidakhadiran Hari Ini' },
    { k: 'mingguIni', label: 'Ketidakhadiran Minggu Ini' },
    { k: 'aktif', label: 'Rekod Aktif' },
    { k: 'dibatalkan', label: 'Rekod Dibatalkan' },
  ];

  return (
    <div className="wrap">
      <header className="bar">
        <div className="brand">
          <Link href="/dashboard" className="back">← Dashboard</Link>
          <h1 className="title">Ketidakhadiran Guru</h1>
        </div>
      </header>

      <main className="main">
        {/* Kad ringkasan */}
        <section className="cards">
          {cards.map((c) => (
            <div className="statCard" key={c.k}>
              <div className="statNum">{summary ? summary[c.k] : '—'}</div>
              <div className="statLbl">{c.label}</div>
            </div>
          ))}
        </section>

        {/* Telegram snapshot (Fasa 8) */}
        <div className="tgbar">
          <button type="button" className="btn ghost" onClick={openTelegram}>
            Pratonton Snapshot Telegram
          </button>
          {isSuper && (
            <button type="button" className="btn" onClick={openTelegram}>
              Hantar Snapshot Telegram
            </button>
          )}
          <span className="tgHint">Snapshot untuk {filters.tarikh ? fmtDate(filters.tarikh) : 'hari ini'}</span>
        </div>

        {/* Penapis */}
        <form className="filters" onSubmit={tapis}>
          <input type="date" className="inp" value={filters.tarikh} onChange={(e) => setF('tarikh', e.target.value)} aria-label="Tarikh" />
          <select className="inp" value={filters.status} onChange={(e) => setF('status', e.target.value)} aria-label="Status">
            <option value="">Semua status</option>
            {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="inp" value={filters.sebab} onChange={(e) => setF('sebab', e.target.value)} aria-label="Sebab">
            <option value="">Semua sebab</option>
            {opts.sebab.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="inp" value={filters.guru} onChange={(e) => setF('guru', e.target.value)} aria-label="Guru">
            <option value="">Semua guru</option>
            {opts.teachers.map((t) => <option key={t.id} value={t.nama}>{t.nama}</option>)}
          </select>
          <input type="text" className="inp grow" placeholder="Cari nama / reference" value={filters.q} onChange={(e) => setF('q', e.target.value)} aria-label="Carian" />
          <button type="submit" className="btn">Tapis</button>
          <button type="button" className="btn ghost" onClick={reset}>Set semula</button>
        </form>

        {error && <div className="alert" role="alert">{error}</div>}

        {/* Jadual */}
        <div className="tableWrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Reference</th><th>Tarikh</th><th>Hari</th><th>Nama Guru</th>
                <th>Sebab</th><th>Jenis</th><th>Masa Mula</th><th>Status</th><th>Tarikh Hantar</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="empty">Memuatkan…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={10} className="empty">Tiada rekod.</td></tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.reference || '-'}</td>
                    <td>{fmtDate(r.tarikh)}</td>
                    <td>{r.hari}</td>
                    <td>{r.guruNama}</td>
                    <td>{sebabLabel(r.sebabKategori)}</td>
                    <td>{jenisLabel(r.jenis)}</td>
                    <td>{r.masaMula || '-'}</td>
                    <td><span className={`badge ${r.statusBorang.toLowerCase()}`}>{STATUS_LABEL[r.statusBorang]}</span></td>
                    <td>{fmtDateTime(r.createdAt)}</td>
                    <td><button className="link" onClick={() => openDetail(r.id)}>Urus</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal butiran */}
      {selected && (
        <div className="overlay" onClick={() => !modalBusy && setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mHead">
              <span className="mono ref">{selected.reference || '-'}</span>
              <button className="x" onClick={() => setSelected(null)} aria-label="Tutup">×</button>
            </div>

            <dl className="detail">
              <div><dt>Nama guru</dt><dd>{selected.guruNama}</dd></div>
              <div><dt>Tarikh</dt><dd>{fmtDate(selected.tarikh)} ({selected.hari})</dd></div>
              <div><dt>Sebab</dt><dd>{sebabLabel(selected.sebabKategori)}</dd></div>
              <div><dt>Jenis</dt><dd>{jenisLabel(selected.jenis)}{selected.masaMula ? ` — ${selected.masaMula}` : ''}</dd></div>
              <div><dt>Catatan</dt><dd>{selected.sebabDetail || '—'}</dd></div>
              <div><dt>Status</dt><dd><span className={`badge ${selected.statusBorang.toLowerCase()}`}>{STATUS_LABEL[selected.statusBorang]}</span></dd></div>
              <div><dt>Tarikh hantar</dt><dd>{fmtDateTime(selected.createdAt)}</dd></div>
            </dl>

            {modalError && <div className="alert" role="alert">{modalError}</div>}

            <div className="mLbl">Kemaskini status</div>
            <div className="statusBtns">
              {STATUS_LIST.map((s) => (
                <button
                  key={s}
                  className={`sBtn ${selected.statusBorang === s ? 'on' : ''}`}
                  disabled={modalBusy || selected.statusBorang === s}
                  onClick={() => changeStatus(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>

            {isSuper && (
              <button className="btn danger full" disabled={modalBusy} onClick={padam}>
                Padam rekod (Super Admin)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Modal snapshot Telegram (Fasa 8) */}
      {tg && (
        <div className="overlay" onClick={closeTelegram}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mHead">
              <span className="ref">Snapshot Telegram — {fmtDate(tg.tarikh)}</span>
              <button className="x" onClick={closeTelegram} aria-label="Tutup">×</button>
            </div>

            {tgLoading ? (
              <p className="tgMuted">Menjana pratonton…</p>
            ) : (
              <>
                <p className="tgMeta">
                  {tg.jumlahGuru} guru tidak hadir (AKTIF)
                  {!tg.telegramSedia && ' • token Telegram belum diset di server'}
                </p>
                <pre className="tgText">{tg.text}</pre>

                {tgError && <div className="alert" role="alert">{tgError}</div>}
                {tgInfo && <div className="tgNote" role="status">{tgInfo}</div>}

                <div className="tgActions">
                  <button className="btn ghost" onClick={closeTelegram} disabled={tgBusy}>
                    Tutup
                  </button>
                  {isSuper && (
                    <button
                      className="btn"
                      onClick={hantarTelegram}
                      disabled={tgBusy || !tg.adaRekod || !tg.telegramSedia}
                    >
                      {tgBusy ? 'Menghantar…' : 'Hantar ke Telegram'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .wrap { min-height: 100vh; background: #eef3f1; }
        .bar { padding: 14px 18px; background: #fff; border-bottom: 1px solid #dce5e2; }
        .back { font-size: 13px; color: #0f766e; text-decoration: none; }
        .back:hover { text-decoration: underline; }
        .title { margin: 4px 0 0; font-size: 19px; font-weight: 700; color: #0f2a23; }
        .main { max-width: 1100px; margin: 0 auto; padding: 18px 16px 48px; }
        .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
        .statCard { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; padding: 16px; }
        .statNum { font-size: 26px; font-weight: 700; color: #0f766e; }
        .statLbl { font-size: 12.5px; color: #5b716a; margin-top: 4px; }
        .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .inp { padding: 9px 11px; font-size: 14px; color: #0f2a23; background: #fff; border: 1px solid #d3ded9; border-radius: 9px; outline: none; }
        .inp:focus-visible { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.15); }
        .inp.grow { flex: 1; min-width: 160px; }
        .btn { padding: 9px 15px; font-size: 14px; font-weight: 600; color: #fff; background: #0f766e; border: none; border-radius: 9px; cursor: pointer; }
        .btn:hover:not(:disabled) { background: #0b5e57; }
        .btn:disabled { opacity: .6; cursor: progress; }
        .btn.ghost { color: #0f766e; background: #f1f5f4; border: 1px solid #d3ded9; }
        .btn.ghost:hover { background: #e7eeec; }
        .btn.danger { color: #fff; background: #b42318; }
        .btn.danger:hover:not(:disabled) { background: #921a12; }
        .btn.full { width: 100%; margin-top: 16px; }
        .alert { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 9px; }
        .tableWrap { overflow-x: auto; background: #fff; border: 1px solid #dce5e2; border-radius: 12px; }
        .tbl { width: 100%; border-collapse: collapse; min-width: 880px; font-size: 13.5px; }
        .tbl th { text-align: left; padding: 11px 12px; background: #f1f5f4; color: #3b544c; font-weight: 600; border-bottom: 1px solid #dce5e2; white-space: nowrap; }
        .tbl td { padding: 11px 12px; border-bottom: 1px solid #eef2f0; color: #233a33; white-space: nowrap; }
        .tbl tr:last-child td { border-bottom: none; }
        .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
        .empty { text-align: center; color: #80958e; padding: 28px 0; }
        .link { border: none; background: none; color: #0f766e; font-weight: 600; font-size: 13.5px; cursor: pointer; padding: 0; }
        .link:hover { text-decoration: underline; }
        .badge { display: inline-block; padding: 3px 10px; font-size: 12px; font-weight: 600; border-radius: 999px; }
        .badge.aktif { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
        .badge.dibatalkan { color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; }
        .badge.selesai { color: #1d4ed8; background: #eaf0fe; border: 1px solid #cdddfb; }
        .overlay { position: fixed; inset: 0; background: rgba(15,42,35,0.4); display: grid; place-items: center; padding: 16px; z-index: 50; }
        .modal { width: 100%; max-width: 440px; background: #fff; border-radius: 16px; padding: 20px; max-height: 88vh; overflow-y: auto; }
        .mHead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .ref { font-size: 15px; font-weight: 700; color: #0f2a23; }
        .x { border: none; background: #f1f5f4; width: 30px; height: 30px; border-radius: 8px; font-size: 18px; color: #5b716a; cursor: pointer; }
        .detail { margin: 0 0 6px; }
        .detail > div { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid #eef2f0; }
        .detail dt { font-size: 13px; color: #6b8079; flex: none; }
        .detail dd { margin: 0; font-size: 13.5px; font-weight: 600; color: #0f2a23; text-align: right; }
        .mLbl { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: #2b3f39; }
        .statusBtns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .sBtn { padding: 9px 8px; font-size: 13px; font-weight: 600; color: #3b544c; background: #f1f5f4; border: 1px solid #d3ded9; border-radius: 9px; cursor: pointer; }
        .sBtn.on { color: #fff; background: #0f766e; border-color: #0f766e; }
        .sBtn:disabled { cursor: default; }
        .tgbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
        .tgHint { font-size: 12.5px; color: #5b716a; }
        .tgMeta { margin: 0 0 10px; font-size: 13px; color: #5b716a; }
        .tgMuted { color: #80958e; font-size: 14px; padding: 8px 0; }
        .tgText { margin: 0 0 12px; padding: 12px 14px; background: #f1f5f4; border: 1px solid #dce5e2; border-radius: 10px; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; line-height: 1.55; color: #233a33; white-space: pre-wrap; word-break: break-word; max-height: 48vh; overflow-y: auto; }
        .tgNote { margin: 0 0 12px; padding: 10px 12px; font-size: 13px; color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; border-radius: 9px; }
        .tgActions { display: flex; justify-content: flex-end; gap: 8px; }
        @media (max-width: 640px) {
          .cards { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
