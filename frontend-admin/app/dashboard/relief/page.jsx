'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';

const STATUS_BARIS = { CADANGAN: 'Cadangan', DISAHKAN: 'Disahkan', BATAL: 'Batal' };
const STATUS_BATCH = { DRAF: 'Draf', DIJANA: 'Dijana', DIHANTAR: 'Dihantar', SELESAI: 'Selesai' };
const TERKUNCI = ['DIHANTAR', 'SELESAI'];

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

export default function ReliefDashboard() {
  const [tarikh, setTarikh] = useState(() => todayKL());
  const [data, setData] = useState(null); // { status, ringkasan, assignments, generatedBy, generatedAt }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // jana / jana semula
  const [rowBusy, setRowBusy] = useState(0); // id baris sedang diproses
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  async function act(id, kind) {
    if (rowBusy) return;
    setRowBusy(id);
    setError('');
    try {
      if (kind === 'confirm') await api.relief.confirm(id);
      else await api.relief.cancel(id);
      await load(tarikh);
    } catch (e) {
      setError(e.message || 'Gagal mengemas kini baris');
    } finally {
      setRowBusy(0);
    }
  }

  const r = data?.ringkasan || { slot: 0, terisi: 0, kosong: 0, tier2: 0 };
  const rows = data?.assignments || [];

  return (
    <div className="wrap">
      <header className="bar">
        <div className="brand">
          <Link href="/dashboard" className="back">← Dashboard</Link>
          <h1 className="title">Jadual Relief</h1>
        </div>
      </header>

      <main className="main">
        {/* Toolbar: tarikh + tindakan */}
        <div className="toolbar">
          <input
            type="date"
            className="inp"
            value={tarikh}
            onChange={(e) => setTarikh(e.target.value)}
            aria-label="Tarikh"
          />
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
            Jana semula serta sahkan/batal baris tidak dibenarkan.
          </div>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
        {!error && notice && <div className="notice" role="status">{notice}</div>}

        {/* Ringkasan */}
        {data && (
          <>
            <section className="cards">
              <div className="statCard"><div className="statNum">{fmtDate(tarikh)}</div><div className="statLbl">Tarikh</div></div>
              <div className="statCard"><div className="statNum">{r.slot}</div><div className="statLbl">Jumlah Slot</div></div>
              <div className="statCard"><div className="statNum">{r.terisi}</div><div className="statLbl">Terisi</div></div>
              <div className="statCard"><div className="statNum">{r.kosong}</div><div className="statLbl">Kosong</div></div>
              <div className="statCard"><div className="statNum">{r.tier2}</div><div className="statLbl">Relief Kedua (2×)</div></div>
              <div className="statCard">
                <div className="statNum sm"><span className={`badge batch ${(data.status || '').toLowerCase()}`}>{STATUS_BATCH[data.status] || data.status}</span></div>
                <div className="statLbl">Status Batch</div>
              </div>
            </section>
            {data.generatedBy && (
              <p className="meta">Dijana oleh {data.generatedBy} • {fmtDateTime(data.generatedAt)}</p>
            )}
          </>
        )}

        {/* Jadual */}
        {data && (
          <div className="tableWrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Status</th><th>Guru Tidak Hadir</th><th>Kelas</th><th>Subjek</th>
                  <th>Masa</th><th>Guru Ganti</th><th>Kategori</th><th>Catatan</th><th>Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="empty">Memuatkan…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="empty">Tiada baris relief.</td></tr>
                ) : (
                  rows.map((a) => (
                    <tr key={a.id}>
                      <td><span className={`badge ${a.status.toLowerCase()}`}>{STATUS_BARIS[a.status] || a.status}</span></td>
                      <td>{a.guruTakHadir}</td>
                      <td>{a.kelas}</td>
                      <td>{a.subjek || '-'}</td>
                      <td className="mono">{a.masa}</td>
                      <td>
                        {a.guruGanti ? (
                          <>
                            {a.guruGanti}
                            {a.isTier2 && <span className="chip">2×</span>}
                          </>
                        ) : (
                          <span className="muted">Tiada calon sesuai</span>
                        )}
                      </td>
                      <td>{a.kategori || '-'}</td>
                      <td>{a.auditNote || '-'}</td>
                      <td>
                        {a.status === 'CADANGAN' && !locked ? (
                          <div className="act">
                            <button className="mini ok" disabled={rowBusy === a.id} onClick={() => act(a.id, 'confirm')}>
                              {rowBusy === a.id ? '…' : 'Sahkan'}
                            </button>
                            <button className="mini no" disabled={rowBusy === a.id} onClick={() => act(a.id, 'cancel')}>
                              Batal
                            </button>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!data && !loading && (
          <div className="tableWrap">
            <div className="empty">
              {notice || 'Belum dijana untuk tarikh ini.'}
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        .wrap { min-height: 100vh; background: #eef3f1; }
        .bar { padding: 14px 18px; background: #fff; border-bottom: 1px solid #dce5e2; }
        .back { font-size: 13px; color: #0f766e; text-decoration: none; }
        .back:hover { text-decoration: underline; }
        .title { margin: 4px 0 0; font-size: 19px; font-weight: 700; color: #0f2a23; }
        .main { max-width: 1100px; margin: 0 auto; padding: 18px 16px 48px; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
        .inp { padding: 9px 11px; font-size: 14px; color: #0f2a23; background: #fff; border: 1px solid #d3ded9; border-radius: 9px; outline: none; }
        .inp:focus-visible { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.15); }
        .btn { padding: 9px 15px; font-size: 14px; font-weight: 600; color: #fff; background: #0f766e; border: none; border-radius: 9px; cursor: pointer; }
        .btn:hover:not(:disabled) { background: #0b5e57; }
        .btn:disabled { opacity: .6; cursor: progress; }
        .btn.ghost { color: #0f766e; background: #f1f5f4; border: 1px solid #d3ded9; }
        .btn.ghost:hover:not(:disabled) { background: #e7eeec; }
        .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 12px; }
        .statCard { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; padding: 16px; }
        .statNum { font-size: 24px; font-weight: 700; color: #0f766e; }
        .statNum.sm { font-size: 14px; }
        .statLbl { font-size: 12px; color: #5b716a; margin-top: 4px; }
        .meta { margin: 0 0 14px; font-size: 12.5px; color: #5b716a; }
        .alert { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 9px; }
        .notice { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #3b544c; background: #f1f5f4; border: 1px solid #d3ded9; border-radius: 9px; }
        .notice.locked { color: #92400e; background: #fef6e7; border-color: #f5e0b8; }
        .tableWrap { overflow-x: auto; background: #fff; border: 1px solid #dce5e2; border-radius: 12px; }
        .tbl { width: 100%; border-collapse: collapse; min-width: 980px; font-size: 13.5px; }
        .tbl th { text-align: left; padding: 11px 12px; background: #f1f5f4; color: #3b544c; font-weight: 600; border-bottom: 1px solid #dce5e2; white-space: nowrap; }
        .tbl td { padding: 11px 12px; border-bottom: 1px solid #eef2f0; color: #233a33; white-space: nowrap; }
        .tbl tr:last-child td { border-bottom: none; }
        .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
        .empty { text-align: center; color: #80958e; padding: 28px 0; }
        .muted { color: #80958e; font-style: italic; }
        .badge { display: inline-block; padding: 3px 10px; font-size: 12px; font-weight: 600; border-radius: 999px; }
        .badge.cadangan { color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; }
        .badge.disahkan { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
        .badge.batal { color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; }
        .badge.batch { color: #3b544c; background: #eef2f0; border: 1px solid #d3ded9; }
        .badge.batch.dijana { color: #0b5e57; background: #e6f4f0; border-color: #c2e3da; }
        .badge.batch.dihantar, .badge.batch.selesai { color: #1d4ed8; background: #eaf0fe; border-color: #cdddfb; }
        .chip { display: inline-block; margin-left: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; border-radius: 999px; }
        .act { display: flex; gap: 6px; }
        .mini { padding: 6px 10px; font-size: 12.5px; font-weight: 600; border-radius: 8px; border: 1px solid; cursor: pointer; background: #fff; }
        .mini.ok { color: #fff; background: #0f766e; border-color: #0f766e; }
        .mini.ok:hover:not(:disabled) { background: #0b5e57; }
        .mini.no { color: #b42318; border-color: #fcd2cd; }
        .mini.no:hover:not(:disabled) { background: #fef3f2; }
        .mini:disabled { opacity: .6; cursor: progress; }
        @media (max-width: 860px) {
          .cards { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 520px) {
          .cards { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
