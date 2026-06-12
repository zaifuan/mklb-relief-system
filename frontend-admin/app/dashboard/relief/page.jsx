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
// Tidak menyentuh enjin; hanya paparan.
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

  const rows = useMemo(() => data?.assignments || [], [data]);

  // ── Statistik paparan (bukan enjin) ──
  const stat = useMemo(() => {
    const guruAbsen = new Set(rows.map((a) => a.guruTakHadir));
    const gantiSet = new Set(rows.filter((a) => a.guruGanti).map((a) => a.guruGanti.trim().toUpperCase()));
    return {
      guruAbsen: guruAbsen.size,
      slot: rows.length,
      ganti: gantiSet.size,
      kosong: rows.filter((a) => !a.guruGanti).length,
      tier2: rows.filter((a) => a.isTier2).length,
    };
  }, [rows]);

  // Berapa kali setiap guru ganti menerima relief pada tarikh ini (status aktif)
  const reliefCount = useMemo(() => {
    const m = new Map();
    for (const a of rows) {
      if (a.guruGanti && a.status !== 'BATAL') {
        const k = a.guruGanti.trim().toUpperCase();
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
    return m;
  }, [rows]);
  const reliefCountOf = (name) => (name ? reliefCount.get(name.trim().toUpperCase()) || 0 : 0);

  // ── Kumpul ikut Guru Tidak Hadir (A–Z), slot ikut masa mula ──
  const groups = useMemo(() => {
    const map = new Map();
    for (const a of rows) {
      const key = a.guruTakHadir || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    const arr = [...map.entries()].map(([guru, slots]) => ({
      guru,
      slots: slots.slice().sort((x, y) => {
        const sx = slotStartMinit(x.masa);
        const sy = slotStartMinit(y.masa);
        if (sx !== sy) return sx - sy;
        return String(x.masa).localeCompare(String(y.masa));
      }),
    }));
    arr.sort((a, b) => a.guru.localeCompare(b.guru, 'ms'));
    return arr;
  }, [rows]);

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
          <h1 className="title">Jadual Relief</h1>
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

        {/* Kad ringkasan */}
        {data && (
          <>
            <section className="cards">
              <div className="statCard"><div className="statNum">{stat.guruAbsen}</div><div className="statLbl">Guru Tidak Hadir</div></div>
              <div className="statCard"><div className="statNum">{stat.slot}</div><div className="statLbl">Slot Relief</div></div>
              <div className="statCard"><div className="statNum">{stat.ganti}</div><div className="statLbl">Guru Ganti Digunakan</div></div>
              <div className={`statCard${stat.kosong ? ' danger' : ''}`}><div className="statNum">{stat.kosong}</div><div className="statLbl">Tiada Guru Ganti</div></div>
              <div className="statCard"><div className="statNum">{stat.tier2}</div><div className="statLbl">Relief Kedua (2×)</div></div>
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

        {/* Paparan berkumpul ikut guru tidak hadir */}
        {data && (
          loading ? (
            <div className="panel empty">Memuatkan…</div>
          ) : groups.length === 0 ? (
            <div className="panel empty">Tiada baris relief.</div>
          ) : (
            <div className="groups">
              {groups.map((g) => (
                <section className="grp" key={g.guru}>
                  <div className="grpHead">
                    <span className="grpName">{g.guru}</span>
                    <span className="grpCount">{g.slots.length} slot</span>
                  </div>
                  <div className="grpSlots">
                    {g.slots.map((a) => {
                      const b = badgeFor(a);
                      const cnt = reliefCountOf(a.guruGanti);
                      return (
                        <div className="slot" key={a.id}>
                          <div className="slotTime">{a.masa}</div>
                          <div className="slotBody">
                            {a.guruGanti ? (
                              <div className="gantiLine">
                                <span className="gantiName">Guru Ganti: <b>{a.guruGanti}</b></span>
                                {cnt > 0 && <span className="reliefChip">{cnt} relief hari ini</span>}
                              </div>
                            ) : (
                              <div className="warnRow">⚠️ Tiada guru ganti ditemui untuk slot ini.</div>
                            )}
                            <div className="slotMeta">
                              {a.kelas}
                              {a.subjek ? ` · ${a.subjek}` : ''}
                              {a.isTier2 ? ' · 2×' : ''}
                              {a.auditNote && a.guruGanti ? ` · ${a.auditNote}` : ''}
                            </div>
                          </div>
                          <div className="slotRight">
                            <span className={`badge ${b.cls}`}>{b.label}</span>
                            {a.status === 'CADANGAN' && !locked && (
                              <div className="act">
                                <button className="mini ok" disabled={rowBusy === a.id} onClick={() => act(a.id, 'confirm')}>
                                  {rowBusy === a.id ? '…' : 'Sahkan'}
                                </button>
                                <button className="mini no" disabled={rowBusy === a.id} onClick={() => act(a.id, 'cancel')}>
                                  Batal
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )
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
        .statCard.danger { border-color: #fcd2cd; background: #fff7f6; }
        .statCard.danger .statNum { color: #b42318; }
        .statNum { font-size: 24px; font-weight: 700; color: #0f766e; }
        .statNum.sm { font-size: 14px; }
        .statLbl { font-size: 12px; color: #5b716a; margin-top: 4px; }
        .meta { margin: 0 0 16px; font-size: 12.5px; color: #5b716a; }

        .alert { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 9px; }
        .notice { margin: 0 0 14px; padding: 10px 12px; font-size: 13px; color: #3b544c; background: #f1f5f4; border: 1px solid #d3ded9; border-radius: 9px; }
        .notice.locked { color: #92400e; background: #fef6e7; border-color: #f5e0b8; }
        .panel { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; }
        .empty { text-align: center; color: #80958e; padding: 28px 16px; }

        /* Kumpulan guru tidak hadir */
        .groups { display: flex; flex-direction: column; gap: 14px; }
        .grp { background: #fff; border: 1px solid #dce5e2; border-radius: 12px; overflow: hidden; }
        .grpHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 16px; background: #0f766e; color: #fff; }
        .grpName { font-size: 15px; font-weight: 700; letter-spacing: .2px; word-break: break-word; }
        .grpCount { flex: none; font-size: 12px; font-weight: 600; color: #d7ece7; background: rgba(255,255,255,0.14); padding: 3px 10px; border-radius: 999px; }
        .grpSlots { display: flex; flex-direction: column; }

        .slot { display: flex; align-items: flex-start; gap: 14px; padding: 13px 16px; border-top: 1px solid #eef2f0; }
        .grpSlots .slot:first-child { border-top: none; }
        .slotTime { flex: none; width: 108px; font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 600; color: #0f2a23; padding-top: 2px; }
        .slotBody { flex: 1 1 auto; min-width: 0; }
        .gantiLine { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .gantiName { font-size: 14px; color: #233a33; word-break: break-word; }
        .gantiName b { color: #0f2a23; }
        .reliefChip { flex: none; font-size: 11px; font-weight: 700; color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; padding: 1px 8px; border-radius: 999px; }
        .warnRow { font-size: 13.5px; font-weight: 600; color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; border-radius: 8px; padding: 7px 10px; }
        .slotMeta { margin-top: 4px; font-size: 12px; color: #5b716a; word-break: break-word; }
        .slotRight { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }

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
          .cards { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 560px) {
          .cards { grid-template-columns: repeat(2, 1fr); }
          /* Card view mesra mobile: slot disusun menegak, nama penuh */
          .slot { flex-direction: column; gap: 8px; }
          .slotTime { width: auto; font-size: 14px; }
          .slotRight { flex-direction: row; align-items: center; justify-content: space-between; width: 100%; }
        }
      `}</style>
    </div>
  );
}
