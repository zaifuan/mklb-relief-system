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

// ── Ikon ringkas (stroke ikut currentColor) ──
const Icon = {
  people: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" />
      <circle cx="9" cy="7" r="3" />
      <path d="M22 19v-1a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13A4 4 0 0 1 16 11.5" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9.5h18M8 3v3M16 3v3" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 3 11 14" />
      <path d="M22 3l-7 18-4-8-8-4 19-6z" />
    </svg>
  ),
  sheet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M4 9.5h16M4 15h16M10 3v18" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M12 5l7 7-7 7" />
    </svg>
  ),
  crown: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 7l4 4 5-6 5 6 4-4-1.6 11H4.6L3 7zm1.8 13h14.4v1.4H4.8V20z" />
    </svg>
  ),
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
          .state { min-height: 100vh; display: grid; place-items: center; background: #eef3f1; color: #5b716a; font-size: 15px; }
        `}</style>
      </main>
    );
  }

  if (!user) return null;

  const roleKey = user.role;
  const roleLabel = ROLE_LABEL[roleKey] || roleKey;
  const isSuper = roleKey === 'SUPER_ADMIN';

  const modules = [
    { href: '/dashboard/absence', icon: Icon.people, title: 'Ketidakhadiran Guru', sub: 'Lihat, semak & urus rekod ketidakhadiran', show: true },
    { href: '/dashboard/relief', icon: Icon.calendar, title: 'Jadual Relief', sub: 'Jana, semak & sahkan cadangan guru ganti', show: true },
    { href: '/dashboard/tetapan', icon: Icon.account, title: 'Tetapan Akaun', sub: 'Urus username & kata laluan Super Admin & Admin', show: isSuper },
    { href: '/dashboard/tetapan-telegram', icon: Icon.send, title: 'Tetapan Telegram', sub: 'Snapshot automatik, masa & realtime notifikasi', show: isSuper },
  ].filter((m) => m.show);

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
        {/* Hero / sambutan */}
        <section className="hero">
          <h1 className="hello">
            Selamat Datang, {roleLabel} <span className="wave" aria-hidden="true">👋</span>
          </h1>
          <p className="lede">Urus ketidakhadiran guru, jadual relief dan tetapan sistem.</p>
          <span className={`roleChip ${isSuper ? 'gold' : 'green'}`}>
            {isSuper && <span className="roleIcon">{Icon.crown}</span>}
            {roleLabel}
          </span>
        </section>

        {/* Modul utama */}
        <h2 className="secTitle">Modul Utama</h2>
        <div className="mods">
          {modules.map((m) => (
            <Link key={m.href} href={m.href} className="mod">
              <span className="mIcon">{m.icon}</span>
              <span className="mText">
                <span className="mTitle">{m.title}</span>
                <span className="mSub">{m.sub}</span>
              </span>
              <span className="mArrow" aria-hidden="true">{Icon.arrow}</span>
            </Link>
          ))}
        </div>

        {/* Sync Google Sheet — Super Admin sahaja */}
        {isSuper && (
          <section className="syncCard">
            <div className="syncTop">
              <span className="sIcon">{Icon.sheet}</span>
              <div className="sText">
                <div className="sTitle">Sync Google Sheet</div>
                <div className="sSub">Kemas kini data guru, jadual guru dan jadual kelas daripada Google Sheet.</div>
              </div>
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
      </main>

      <style jsx>{`
        .wrap { min-height: 100vh; background: #eef3f1; }

        .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 20px; background: #fff; border-bottom: 1px solid #e1ebe7; }
        .brand { display: flex; align-items: center; gap: 10px; }
        .logoWrap { flex: none; display: inline-flex; }
        .logo { height: 32px; width: auto; display: block; }
        .bname { font-size: 15px; font-weight: 700; color: #0f2a23; }
        .right { display: flex; align-items: center; gap: 12px; }
        .who { font-size: 13px; color: #5b716a; }
        .logout { padding: 8px 14px; font-size: 13px; font-weight: 600; color: #0f766e; background: #f1f5f4; border: 1px solid #d8e2de; border-radius: 9px; cursor: pointer; }
        .logout:hover:not(:disabled) { background: #e7eeec; }
        .logout:disabled { opacity: .6; cursor: progress; }

        .main { max-width: 760px; margin: 0 auto; padding: 26px 16px 56px; display: flex; flex-direction: column; gap: 18px; }

        /* Hero */
        .hero { background: #fff; border: 1px solid #e6efeb; border-radius: 20px; padding: 26px 24px; box-shadow: 0 1px 2px rgba(15,42,35,.04), 0 18px 40px -28px rgba(15,42,35,.28); }
        .hello { margin: 0; font-size: 25px; line-height: 1.2; font-weight: 800; color: #0f2a23; letter-spacing: -0.02em; }
        .wave { font-weight: 400; }
        .lede { margin: 8px 0 0; font-size: 14.5px; color: #5b716a; }
        .roleChip { display: inline-flex; align-items: center; gap: 7px; margin-top: 16px; padding: 6px 12px; font-size: 13px; font-weight: 700; border-radius: 999px; }
        .roleChip.gold { color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; }
        .roleChip.green { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
        .roleIcon { display: inline-flex; width: 15px; height: 15px; }
        .roleIcon :global(svg) { width: 100%; height: 100%; }

        .secTitle { margin: 6px 2px -4px; font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #7c8f89; }

        /* Modul */
        .mods { display: flex; flex-direction: column; gap: 12px; }
        .mod { display: flex; align-items: center; gap: 14px; padding: 16px 18px; background: #fff; border: 1px solid #e6efeb; border-radius: 16px; text-decoration: none; box-shadow: 0 1px 2px rgba(15,42,35,.04), 0 16px 36px -30px rgba(15,42,35,.3); transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
        .mod:hover { transform: translateY(-2px); border-color: #bfe0d6; box-shadow: 0 2px 4px rgba(15,42,35,.06), 0 22px 44px -26px rgba(15,118,110,.4); }
        .mIcon { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 13px; color: #0f766e; background: #e6f4f0; }
        .mIcon :global(svg) { width: 24px; height: 24px; }
        .mText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .mTitle { font-size: 16px; font-weight: 700; color: #0f2a23; }
        .mSub { font-size: 13px; color: #5b716a; }
        .mArrow { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 999px; color: #0f766e; background: #f1f7f5; transition: background .15s ease, transform .15s ease; }
        .mArrow :global(svg) { width: 18px; height: 18px; }
        .mod:hover .mArrow { background: #d9efe8; transform: translateX(2px); }

        /* Sync */
        .syncCard { background: #fff; border: 1px solid #e6efeb; border-radius: 18px; padding: 20px; box-shadow: 0 1px 2px rgba(15,42,35,.04), 0 16px 36px -30px rgba(15,42,35,.3); }
        .syncTop { display: flex; align-items: flex-start; gap: 14px; }
        .sIcon { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 13px; color: #128a4c; background: #e7f6ec; }
        .sIcon :global(svg) { width: 24px; height: 24px; }
        .sText { flex: 1; min-width: 0; }
        .sTitle { font-size: 16px; font-weight: 700; color: #0f2a23; }
        .sSub { margin-top: 3px; font-size: 13px; color: #5b716a; }
        .syncBtn { width: 100%; margin-top: 16px; padding: 12px; font-size: 14.5px; font-weight: 700; color: #fff; background: #0f766e; border: none; border-radius: 11px; cursor: pointer; transition: background .15s ease; }
        .syncBtn:hover:not(:disabled) { background: #0b5e57; }
        .syncBtn:disabled { opacity: .6; cursor: progress; }
        .syncMsg { margin-top: 12px; padding: 11px 13px; font-size: 13px; border-radius: 11px; }
        .syncMsg.err { color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; }
        .syncMsg.ok { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
        .syncStats { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; }
        .syncStats b { color: #0f2a23; }

        @media (max-width: 560px) {
          .hello { font-size: 22px; }
          .mod { padding: 14px 15px; gap: 12px; }
          .mIcon { width: 44px; height: 44px; }
          .bname { display: none; }
        }
      `}</style>
    </div>
  );
}
