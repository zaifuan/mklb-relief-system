'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api.js';
import { clearToken } from '../../../lib/auth.js';

const PRESETS = ['05:00', '05:15', '05:30', '05:45', '06:00'];

export default function TetapanTelegramPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [autoSnapshot, setAutoSnapshot] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [snapshotTime, setSnapshotTime] = useState('05:30');
  const [status, setStatus] = useState(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const isCustom = !PRESETS.includes(snapshotTime);

  async function muatStatus() {
    try {
      const st = await api.telegram.status();
      setStatus(st);
    } catch {
      /* status tidak kritikal */
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (!alive) return;
        if (me.role !== 'SUPER_ADMIN') {
          router.replace('/dashboard');
          return;
        }
        setAllowed(true);
        const s = await api.telegram.settings.get();
        if (!alive) return;
        setAutoSnapshot(!!s.autoSnapshot);
        setRealtime(!!s.realtime);
        setSnapshotTime(s.snapshotTime || '05:30');
        await muatStatus();
      } catch (e) {
        if (e.status === 401) {
          clearToken();
          router.replace('/login');
        } else if (e.status === 403) {
          router.replace('/dashboard');
        } else {
          setError(e.message || 'Gagal memuatkan tetapan Telegram.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function simpan() {
    if (saving) return;
    setError('');
    setInfo('');
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(snapshotTime)) {
      setError('Masa snapshot tidak sah (perlu format HH:MM).');
      return;
    }
    setSaving(true);
    try {
      const s = await api.telegram.settings.update({ autoSnapshot, realtime, snapshotTime });
      setAutoSnapshot(!!s.autoSnapshot);
      setRealtime(!!s.realtime);
      setSnapshotTime(s.snapshotTime);
      setInfo('Tetapan Telegram disimpan.');
      await muatStatus();
    } catch (e) {
      setError(e.message || 'Gagal menyimpan tetapan.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="wrap">
        <p className="muted">Memuatkan…</p>
        <style jsx>{styles}</style>
      </main>
    );
  }
  if (!allowed) return null;

  return (
    <main className="wrap">
      <header className="top">
        <Link href="/dashboard" className="back">
          ← Dashboard
        </Link>
        <h1>Tetapan Telegram</h1>
      </header>

      {/* Status semasa */}
      <section className="card">
        <h2>Status Semasa</h2>
        <div className="statusGrid">
          <div className="stat">
            <span className="lbl">Bot Telegram</span>
            <span className={`tag ${status?.botConnected ? 'ok' : 'off'}`}>
              {status?.botConnected ? '✓ Connected' : '✗ Belum diset'}
            </span>
          </div>
          <div className="stat">
            <span className="lbl">Chat ID</span>
            <span className={`tag ${status?.chatConfigured ? 'ok' : 'off'}`}>
              {status?.chatConfigured ? '✓ Configured' : '✗ Belum diset'}
            </span>
          </div>
          <div className="stat">
            <span className="lbl">Snapshot Automatik</span>
            <span className={`tag ${status?.autoSnapshot ? 'ok' : 'mute'}`}>
              {status?.autoSnapshot ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="stat">
            <span className="lbl">Masa Snapshot</span>
            <span className="val">{status?.snapshotTimeLabel || '—'}</span>
          </div>
          <div className="stat">
            <span className="lbl">Realtime</span>
            <span className={`tag ${status?.realtime ? 'ok' : 'mute'}`}>
              {status?.realtime ? 'ON' : 'OFF'}
            </span>
          </div>
          <div className="stat">
            <span className="lbl">Snapshot Terakhir</span>
            <span className="val">{status?.lastSnapshot?.masa || 'Tiada lagi'}</span>
          </div>
        </div>
      </section>

      {/* Tetapan */}
      <section className="card">
        <h2>Tetapan</h2>

        <label className="row">
          <input
            type="checkbox"
            checked={autoSnapshot}
            onChange={(e) => setAutoSnapshot(e.target.checked)}
          />
          <span>
            <strong>Aktifkan Snapshot Automatik</strong>
            <span className="hint">Hantar snapshot penuh setiap hari pada masa ditetapkan (langkau Sabtu/Ahad).</span>
          </span>
        </label>

        <div className="field">
          <span className="flbl">Jam Snapshot Harian</span>
          <select
            className="select"
            value={isCustom ? '__custom__' : snapshotTime}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== '__custom__') setSnapshotTime(v);
              else setSnapshotTime('07:00');
            }}
            disabled={!autoSnapshot}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p} pagi
              </option>
            ))}
            <option value="__custom__">Lain-lain (pilih masa)…</option>
          </select>
          {isCustom && (
            <input
              type="time"
              className="time"
              value={snapshotTime}
              step="300"
              onChange={(e) => setSnapshotTime(e.target.value)}
              disabled={!autoSnapshot}
            />
          )}
        </div>

        <label className="row">
          <input type="checkbox" checked={realtime} onChange={(e) => setRealtime(e.target.checked)} />
          <span>
            <strong>Aktifkan Realtime</strong>
            <span className="hint">
              Selepas jam snapshot, setiap tambah/kemaskini/batal rekod hari ini akan hantar snapshot baharu.
            </span>
          </span>
        </label>

        <p className="note">
          Nota: Default sistem ialah <strong>OFF</strong> kerana sekolah masih menggunakan Telegram GAS.
          Aktifkan hanya selepas ujian selesai.
        </p>

        {error && <div className="msg err" role="alert">{error}</div>}
        {info && <div className="msg ok" role="status">{info}</div>}

        <button className="btn" onClick={simpan} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan Tetapan'}
        </button>
      </section>

      <style jsx>{styles}</style>
    </main>
  );
}

const styles = `
  .wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 48px; background: #eef3f1; min-height: 100vh; }
  .top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .back { color: #0f766e; text-decoration: none; font-size: 14px; font-weight: 600; }
  h1 { font-size: 20px; color: #0f766e; margin: 0; }
  h2 { font-size: 15px; color: #0b5e57; margin: 0 0 14px; }
  .muted { color: #6b7c77; }
  .card { background: #fff; border: 1px solid #d8e6e1; border-radius: 14px; padding: 18px; margin-bottom: 16px; }

  .statusGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .stat { display: flex; flex-direction: column; gap: 4px; }
  .lbl { font-size: 12px; color: #6b7c77; }
  .val { font-size: 14px; color: #14302b; font-weight: 600; }
  .tag { display: inline-block; width: fit-content; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 999px; }
  .tag.ok { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
  .tag.off { color: #b42318; background: #fef3f2; border: 1px solid #fcd9d3; }
  .tag.mute { color: #6b7c77; background: #f1f5f4; border: 1px solid #dde7e4; }

  .row { display: flex; gap: 12px; align-items: flex-start; padding: 12px 0; border-top: 1px solid #eef3f1; }
  .row:first-of-type { border-top: none; }
  .row input[type="checkbox"] { width: 20px; height: 20px; margin-top: 2px; accent-color: #0f766e; flex: none; }
  .row strong { display: block; font-size: 14px; color: #14302b; }
  .hint { display: block; font-size: 12px; color: #6b7c77; margin-top: 2px; }

  .field { padding: 14px 0; border-top: 1px solid #eef3f1; }
  .flbl { display: block; font-size: 13px; font-weight: 600; color: #14302b; margin-bottom: 8px; }
  .select, .time {
    width: 100%; padding: 10px 12px; border: 1px solid #cfe0db; border-radius: 10px;
    font-size: 15px; color: #14302b; background: #fff;
  }
  .time { margin-top: 10px; }
  .select:focus, .time:focus { outline: none; border-color: #0f766e; }
  .select:disabled, .time:disabled { background: #f4f7f6; color: #9aa8a4; }

  .note { font-size: 12px; color: #6b7c77; background: #f7faf9; border: 1px dashed #cfe0db; border-radius: 10px; padding: 10px 12px; margin: 14px 0; }
  .msg { font-size: 13px; padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; }
  .msg.err { color: #b42318; background: #fef3f2; border: 1px solid #fcd9d3; }
  .msg.ok { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }

  .btn {
    width: 100%; padding: 12px; border: none; border-radius: 10px; background: #0f766e;
    color: #fff; font-size: 15px; font-weight: 700; cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: #0b5e57; }
  .btn:disabled { opacity: 0.6; cursor: progress; }

  @media (max-width: 520px) { .statusGrid { grid-template-columns: 1fr; } }
`;
