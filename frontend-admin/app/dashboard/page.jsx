'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../lib/api.js';
import { clearToken } from '../../lib/auth.js';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Sync Google Sheet (Super Admin)
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        clearToken();
        router.replace('/login');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await api.logout();
    } catch {
      /* abaikan — tetap log keluar di klien */
    }
    clearToken();
    router.replace('/login');
  }

  async function handleSync() {
    if (syncBusy) return;
    setSyncBusy(true);
    setSyncError('');
    setSyncResult(null);
    try {
      const r = await api.sync.run();
      setSyncResult(r);
    } catch (e) {
      if (e.status === 409) setSyncError(e.message || 'Sync sedang berjalan. Cuba lagi sebentar.');
      else setSyncError(e.message || 'Sync gagal. Sila cuba lagi.');
    } finally {
      setSyncBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="state">
        <p>Memuatkan…</p>
        <style jsx>{`
          .state {
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #eef3f1;
            color: #5b716a;
            font-size: 15px;
          }
        `}</style>
      </main>
    );
  }

  if (!user) return null;

  const roleKey = user.role;
  const roleLabel = ROLE_LABEL[roleKey] || roleKey;

  return (
    <div className="wrap">
      <header className="bar">
        <div className="brand">
          <picture className="logoWrap">
            <source srcSet="/logo-sekolah.webp" type="image/webp" />
            <img className="logo" src="/logo-sekolah.png" alt="Logo SABK Maahad Al-Khair Lil Banat" />
          </picture>
          <div className="bname">Jadual Guru Ganti</div>
        </div>
        <div className="right">
          <span className="who">{roleLabel}</span>
          <button className="logout" onClick={handleLogout} disabled={busy}>
            {busy ? 'Keluar…' : 'Log Keluar'}
          </button>
        </div>
      </header>

      <main className="main">
        <div className="card">
          <div className="status">
            <span className="dot" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M5 12.5l4.2 4.2L19 7" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Fasa 2 Authentication Berjaya
          </div>

          <h1 className="hello">Selamat datang, {roleLabel}.</h1>
          <p className="lede">Anda telah log masuk ke panel pentadbir.</p>

          <dl className="facts">
            <div className="row">
              <dt>Peranan</dt>
              <dd>
                <span className={`badge ${roleKey === 'SUPER_ADMIN' ? 'gold' : 'green'}`}>{roleLabel}</span>
              </dd>
            </div>
          </dl>

          <Link href="/dashboard/absence" className="modul">
            <div>
              <div className="modulTitle">Ketidakhadiran Guru</div>
              <div className="modulSub">Lihat, semak &amp; urus rekod ketidakhadiran</div>
            </div>
            <span className="modulArrow" aria-hidden="true">→</span>
          </Link>

          <Link href="/dashboard/relief" className="modul">
            <div>
              <div className="modulTitle">Jadual Relief</div>
              <div className="modulSub">Jana, semak &amp; sahkan cadangan guru ganti</div>
            </div>
            <span className="modulArrow" aria-hidden="true">→</span>
          </Link>

          {roleKey === 'SUPER_ADMIN' && (
            <Link href="/dashboard/tetapan" className="modul">
              <div>
                <div className="modulTitle">Tetapan Akaun</div>
                <div className="modulSub">Urus username &amp; kata laluan Super Admin &amp; Admin</div>
              </div>
              <span className="modulArrow" aria-hidden="true">→</span>
            </Link>
          )}

          {roleKey === 'SUPER_ADMIN' && (
            <section className="sync">
              <div className="syncTitle">Sync Google Sheet</div>
              <div className="syncSub">
                Kemas kini data guru, jadual guru dan jadual kelas daripada Google Sheet.
              </div>
              <button className="syncBtn" onClick={handleSync} disabled={syncBusy}>
                {syncBusy ? 'Menyegerak…' : 'Sync Sekarang'}
              </button>

              {syncError && <div className="syncMsg err" role="alert">{syncError}</div>}
              {syncResult && (
                <div className="syncMsg ok" role="status">
                  <b>Sync berjaya.</b>
                  <div className="syncStats">
                    <span>Guru: <b>{syncResult.guru ?? '-'}</b></span>
                    <span>Jadual Guru: <b>{syncResult.jadual ?? '-'}</b></span>
                    <span>Jadual Kelas: <b>{syncResult.jadualKelas ?? '-'}</b></span>
                    <span>Masa: <b>{syncResult.durationMs != null ? `${(syncResult.durationMs / 1000).toFixed(1)}s` : '-'}</b></span>
                  </div>
                </div>
              )}
            </section>
          )}

          <p className="note">Modul Telegram &amp; PDF akan tersedia pada fasa seterusnya.</p>
        </div>
      </main>

      <style jsx>{`
        .wrap {
          min-height: 100vh;
          background: #eef3f1;
        }
        .bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 20px;
          background: #ffffff;
          border-bottom: 1px solid #dce5e2;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .logoWrap {
          flex: none;
          display: inline-flex;
        }
        .logo {
          height: 32px;
          width: auto;
          object-fit: contain;
          display: block;
        }
        .bname {
          font-size: 15px;
          font-weight: 700;
          color: #0f2a23;
          letter-spacing: -0.01em;
        }
        .right {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .who {
          font-size: 13.5px;
          color: #2b3f39;
        }
        .logout {
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 600;
          color: #0f766e;
          background: #f1f5f4;
          border: 1px solid #d3ded9;
          border-radius: 9px;
          cursor: pointer;
        }
        .logout:hover:not(:disabled) {
          background: #e7eeec;
        }
        .logout:focus-visible {
          outline: 2px solid #0f766e;
          outline-offset: 1px;
        }
        .logout:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .main {
          display: grid;
          place-items: center;
          padding: 40px 20px;
        }
        .card {
          width: 100%;
          max-width: 520px;
          background: #ffffff;
          border: 1px solid #dce5e2;
          border-radius: 16px;
          padding: 30px 28px;
          box-shadow: 0 1px 2px rgba(15, 42, 35, 0.04), 0 18px 40px -26px rgba(15, 42, 35, 0.24);
        }
        .status {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 7px 13px 7px 9px;
          font-size: 13px;
          font-weight: 600;
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
          border-radius: 999px;
        }
        .dot {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #0f766e;
        }
        .hello {
          margin: 20px 0 4px;
          font-size: 22px;
          letter-spacing: -0.01em;
          color: #0f2a23;
          font-weight: 700;
        }
        .lede {
          margin: 0 0 22px;
          font-size: 14.5px;
          color: #5b716a;
        }
        .facts {
          margin: 0;
          border-top: 1px solid #eef2f0;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 13px 0;
          border-bottom: 1px solid #eef2f0;
        }
        .row dt {
          font-size: 13.5px;
          color: #6b8079;
        }
        .row dd {
          margin: 0;
          font-size: 14.5px;
          font-weight: 600;
          color: #0f2a23;
          text-align: right;
        }
        .cap {
          text-transform: capitalize;
        }
        .badge {
          display: inline-block;
          padding: 4px 11px;
          font-size: 12.5px;
          font-weight: 600;
          border-radius: 999px;
        }
        .badge.green {
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
        }
        .badge.gold {
          color: #8a6d12;
          background: #faf3df;
          border: 1px solid #ecdcae;
        }
        .note {
          margin: 22px 0 0;
          font-size: 13px;
          color: #80958e;
        }
        .modul {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-top: 22px;
          padding: 15px 16px;
          text-decoration: none;
          background: #f1f5f4;
          border: 1px solid #d8e2de;
          border-radius: 12px;
        }
        .modul:hover {
          background: #e9f1ee;
          border-color: #bcd5cd;
        }
        .modulTitle {
          font-size: 15px;
          font-weight: 700;
          color: #0f2a23;
        }
        .modulSub {
          font-size: 12.5px;
          color: #5b716a;
          margin-top: 2px;
        }
        .modulArrow {
          font-size: 18px;
          color: #0f766e;
        }
        .sync {
          margin-top: 22px;
          padding: 16px;
          background: #f1f5f4;
          border: 1px solid #d8e2de;
          border-radius: 12px;
        }
        .syncTitle {
          font-size: 15px;
          font-weight: 700;
          color: #0f2a23;
        }
        .syncSub {
          font-size: 12.5px;
          color: #5b716a;
          margin-top: 2px;
        }
        .syncBtn {
          margin-top: 12px;
          padding: 9px 16px;
          font-size: 14px;
          font-weight: 600;
          color: #ffffff;
          background: #0f766e;
          border: none;
          border-radius: 9px;
          cursor: pointer;
        }
        .syncBtn:hover:not(:disabled) {
          background: #0b5e57;
        }
        .syncBtn:focus-visible {
          outline: 2px solid #0f766e;
          outline-offset: 1px;
        }
        .syncBtn:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .syncMsg {
          margin-top: 12px;
          padding: 10px 12px;
          font-size: 13px;
          border-radius: 9px;
        }
        .syncMsg.ok {
          color: #0b5e57;
          background: #e6f4f0;
          border: 1px solid #c2e3da;
        }
        .syncMsg.err {
          color: #b42318;
          background: #fef3f2;
          border: 1px solid #fcd2cd;
        }
        .syncStats {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 6px;
          font-size: 12.5px;
          color: #2b3f39;
        }
      `}</style>
    </div>
  );
}
