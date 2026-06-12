'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api.js';

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

export default function ReliefDashboard() {
  const [tarikh, setTarikh] = useState(() => todayKL());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState(0);
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

  // Statistik ringkas (paparan; bukan enjin)
  const stat = useMemo(() => {
    const rows = data?.assignments || [];
    return {
      guruAbsen: new Set(rows.map((a) => a.guruTakHadir)).size,
      slot: rows.length,
      ganti: new Set(rows.filter((a) => a.guruGanti).map((a) => a.guruGanti.trim().toUpperCase())).size,
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

  function badgeFor(a) {
    if (!a.guruGanti) return { cls: 'tiada', label: 'Tiada Guru Ganti' };
    if (a.status === 'DISAHKAN') return { cls: 'disahkan', label: 'Disahkan' };
    if (a.status === 'BATAL') return { cls: 'batal', label: 'Batal' };
    return { cls: 'belum', label: 'Belum Disahkan' };
  }

  return (
    <div className="wrap">
      <header className="bar">
        <div className="brand">
          <Link href="/dashboard" className="back">← Dashboard</Link>
          <h1 className="title">Jadual Guru Ganti</h1>
        </div>
      </header>

      <main className="main">
        {/* Toolbar */}
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
          </>
        )}

        {/* Jadual ringkas */}
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
                  <th className="cAct">Status / Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="empty">Memuatkan…</td></tr>
                ) : rowsSorted.length === 0 ? (
                  <tr><td colSpan={8} className="empty">Tiada baris relief.</td></tr>
                ) : (
                  rowsSorted.map((a, i) => {
                    const { mula, tamat } = splitMasa(a.masa);
                    const b = badgeFor(a);
                    return (
                      <tr key={a.id}>
                        <td className="cNo">{i + 1}</td>
                        <td className="cName">{a.guruTakHadir}</td>
                        <td><span className="kelas">{a.kelas}</span></td>
                        <td>{a.subjek ? <span className="subj">{a.subjek}</span> : <span className="muted">—</span>}</td>
                        <td className="mono">{mula}</td>
                        <td className="mono">{tamat}</td>
                        <td className="cGanti">
                          {a.guruGanti ? (
                            <select className="ganti" aria-label="Guru ganti">
                              <option>{a.guruGanti}</option>
                            </select>
                          ) : (
                            <span className="tiadaGanti">Tiada guru ganti</span>
                          )}
                        </td>
                        <td className="cAct">
                          <div className="actwrap">
                            <span className={`badge ${b.cls}`}>{b.label}</span>
                            {a.status === 'CADANGAN' && !locked && (
                              <span className="act">
                                <button className="mini ok" disabled={rowBusy === a.id} onClick={() => act(a.id, 'confirm')}>
                                  {rowBusy === a.id ? '…' : 'Sahkan'}
                                </button>
                                <button className="mini no" disabled={rowBusy === a.id} onClick={() => act(a.id, 'cancel')}>
                                  Batal
                                </button>
                              </span>
                            )}
                          </div>
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
        .notice { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #3b544c; background: #f1f5f4; border: 1px solid #d3ded9; border-radius: 9px; }
        .notice.locked { color: #92400e; background: #fef6e7; border-color: #f5e0b8; }
        .panel { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; }
        .empty { text-align: center; color: #80958e; padding: 28px 16px; }

        /* Jadual */
        .tableWrap { overflow-x: auto; background: #fff; border: 1px solid #dce5e2; border-radius: 14px; -webkit-overflow-scrolling: touch; }
        .tbl { width: 100%; border-collapse: collapse; min-width: 960px; font-size: 13.5px; }
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

        .cGanti { min-width: 240px; }
        .ganti { width: 100%; max-width: 320px; padding: 8px 10px; font-size: 13px; color: #233a33; background: #fff; border: 1px solid #d3ded9; border-radius: 9px; outline: none; cursor: pointer; }
        .ganti:focus-visible { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.15); }
        .tiadaGanti { display: inline-block; font-size: 12.5px; font-weight: 600; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 9px; padding: 7px 12px; white-space: nowrap; }

        .cAct { min-width: 210px; }
        .actwrap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
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
