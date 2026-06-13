'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api.js';
import { clearToken } from '../../../lib/auth.js';

const USERNAME_RE = /^[a-z0-9_]+$/;
const validUsername = (u) => USERNAME_RE.test(u);

export default function TetapanPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [suUser, setSuUser] = useState('');
  const [suPass, setSuPass] = useState('');
  const [adUser, setAdUser] = useState('');
  const [adPass, setAdPass] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (!alive) return;
        if (me.role !== 'SUPER_ADMIN') {
          router.replace('/dashboard'); // Admin biasa tidak boleh akses
          return;
        }
        setAllowed(true);
        const acc = await api.accounts.get();
        if (!alive) return;
        setSuUser(acc.superAdmin?.username || '');
        setAdUser(acc.admin?.username || '');
      } catch (e) {
        if (e.status === 401) {
          clearToken();
          router.replace('/login');
        } else if (e.status === 403) {
          router.replace('/dashboard');
        } else {
          setError(e.message || 'Gagal memuatkan tetapan akaun.');
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

    const su = suUser.trim();
    const ad = adUser.trim();
    if (!su || !validUsername(su)) {
      setError('Username Super Admin tidak sah. Guna huruf kecil, nombor, atau underscore (_) sahaja.');
      return;
    }
    if (!ad || !validUsername(ad)) {
      setError('Username Admin tidak sah. Guna huruf kecil, nombor, atau underscore (_) sahaja.');
      return;
    }
    if (su === ad) {
      setError('Username Super Admin dan Admin tidak boleh sama.');
      return;
    }

    setSaving(true);
    try {
      await api.accounts.update({
        superAdmin: { username: su, password: suPass },
        admin: { username: ad, password: adPass },
      });
      setSuPass('');
      setAdPass('');
      setInfo('Akaun berjaya dikemas kini. Login lama tidak lagi sah; gunakan butiran baru pada log masuk akan datang.');
    } catch (e) {
      setError(e.message || 'Gagal menyimpan perubahan.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="screen">
        <p className="muted">Memuatkan…</p>
        <style jsx>{styles}</style>
      </main>
    );
  }
  if (!allowed) return null;

  return (
    <main className="screen">
      <div className="topline">
        <Link href="/dashboard" className="back">← Dashboard</Link>
      </div>

      <section className="card">
        <h1 className="h">Tetapan Akaun</h1>
        <p className="sub">
          Urus akaun umum sistem. Biarkan medan kata laluan <strong>kosong</strong> untuk kekalkan kata laluan sedia ada.
        </p>

        {error && <div className="alert" role="alert">{error}</div>}
        {info && <div className="ok" role="status">{info}</div>}

        {/* Super Admin */}
        <div className="acc">
          <div className="accHead">
            <span className="badge gold">Super Admin</span>
          </div>
          <label className="lbl" htmlFor="suUser">Username</label>
          <input
            id="suUser"
            className="inp"
            value={suUser}
            onChange={(e) => setSuUser(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="huruf kecil, nombor, _"
          />
          <label className="lbl" htmlFor="suPass">Kata laluan baharu</label>
          <input
            id="suPass"
            className="inp"
            type="password"
            value={suPass}
            onChange={(e) => setSuPass(e.target.value)}
            autoComplete="new-password"
            placeholder="Biarkan kosong untuk kekal"
          />
        </div>

        {/* Admin */}
        <div className="acc">
          <div className="accHead">
            <span className="badge green">Admin</span>
          </div>
          <label className="lbl" htmlFor="adUser">Username</label>
          <input
            id="adUser"
            className="inp"
            value={adUser}
            onChange={(e) => setAdUser(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="huruf kecil, nombor, _"
          />
          <label className="lbl" htmlFor="adPass">Kata laluan baharu</label>
          <input
            id="adPass"
            className="inp"
            type="password"
            value={adPass}
            onChange={(e) => setAdPass(e.target.value)}
            autoComplete="new-password"
            placeholder="Biarkan kosong untuk kekal"
          />
        </div>

        <p className="hint">
          Format username: huruf kecil sahaja, nombor &amp; underscore (_) dibenarkan. Contoh: ketuaadmin, admin_jadual, admin2026.
        </p>

        <button className="btn" onClick={simpan} disabled={saving}>
          {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
        </button>
      </section>

      <style jsx>{styles}</style>
    </main>
  );
}

const styles = `
  .screen {
    min-height: 100vh;
    background: #eef3f1;
    padding: 22px 16px 60px;
  }
  .muted { color: #5b716a; }
  .topline {
    max-width: 560px;
    margin: 0 auto 14px;
  }
  .back {
    font-size: 13.5px;
    font-weight: 600;
    color: #0f766e;
    text-decoration: none;
  }
  .back:hover { text-decoration: underline; }
  .card {
    max-width: 560px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid #dce5e2;
    border-radius: 16px;
    padding: 22px;
    box-shadow: 0 1px 2px rgba(15, 42, 35, 0.04), 0 18px 40px -24px rgba(15, 42, 35, 0.2);
  }
  .h {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 700;
    color: #0f2a23;
  }
  .sub {
    margin: 0 0 18px;
    font-size: 13.5px;
    color: #5b716a;
  }
  .acc {
    margin-top: 16px;
    padding: 16px;
    background: #fafcfb;
    border: 1px solid #e3ebe8;
    border-radius: 12px;
  }
  .accHead { margin-bottom: 12px; }
  .badge {
    display: inline-block;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 999px;
  }
  .badge.gold { color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; }
  .badge.green { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
  .lbl {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #2b3f39;
    margin: 12px 0 6px;
  }
  .inp {
    width: 100%;
    box-sizing: border-box;
    padding: 11px 12px;
    font-size: 14px;
    color: #0f2a23;
    background: #fff;
    border: 1px solid #cfdbd6;
    border-radius: 9px;
    outline: none;
  }
  .inp:focus {
    border-color: #0f766e;
    box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
  }
  .hint {
    margin: 14px 0 0;
    font-size: 12.5px;
    color: #6b8079;
  }
  .btn {
    width: 100%;
    margin-top: 18px;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 700;
    color: #fff;
    background: #0f766e;
    border: none;
    border-radius: 10px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: #0b5e57; }
  .btn:disabled { opacity: 0.6; cursor: progress; }
  .alert {
    margin: 0 0 14px;
    padding: 10px 12px;
    font-size: 13px;
    color: #b42318;
    background: #fef3f2;
    border: 1px solid #fcd2cd;
    border-radius: 9px;
  }
  .ok {
    margin: 0 0 14px;
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
    color: #0b5e57;
    background: #e6f4f0;
    border: 1px solid #c2e3da;
    border-radius: 9px;
  }
`;
