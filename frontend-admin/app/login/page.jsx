'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api.js';
import { setToken } from '../../lib/auth.js';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const { token } = await api.login(username.trim(), password);
      setToken(token);
      router.replace('/dashboard');
    } catch (err) {
      setError(err.message || 'Log masuk gagal. Cuba lagi.');
      setLoading(false);
    }
  }

  return (
    <main className="screen">
      <div className="grid-bg" aria-hidden="true" />

      <section className="card" role="region" aria-label="Log masuk pentadbir">
        <div className="brand">
          <picture className="logoWrap">
            <source srcSet="/logo-sekolah.webp" type="image/webp" />
            <img className="logo" src="/logo-sekolah.png" alt="Logo SABK Maahad Al-Khair Lil Banat" />
          </picture>
          <div className="eyebrow">Panel Pentadbir</div>
          <h1 className="title">Jadual Guru Ganti</h1>
          <p className="sub">SABK Maahad Al-Khair Lil Banat</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="username" className="lbl">Nama pengguna</label>
          <input
            id="username"
            name="username"
            type="text"
            className="inp"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="cth: zai"
          />

          <label htmlFor="password" className="lbl">Kata laluan</label>
          <div className="pw">
            <input
              id="password"
              name="password"
              type={show ? 'text' : 'password'}
              className="inp"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              className="toggle"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Sembunyi kata laluan' : 'Tunjuk kata laluan'}
            >
              {show ? 'Sembunyi' : 'Tunjuk'}
            </button>
          </div>

          {error && (
            <div className="err" role="alert" aria-live="assertive">
              {error}
            </div>
          )}

          <button type="submit" className="submit" disabled={loading}>
            {loading ? 'Memproses…' : 'Log Masuk'}
          </button>
        </form>
      </section>

      <style jsx>{`
        .screen {
          position: relative;
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #eef3f1;
          overflow: hidden;
        }
        .grid-bg {
          position: absolute;
          inset: -10%;
          background-image: linear-gradient(#e0e9e6 1px, transparent 1px),
            linear-gradient(90deg, #e0e9e6 1px, transparent 1px);
          background-size: 46px 46px;
          -webkit-mask-image: radial-gradient(circle at 50% 38%, #000 0%, transparent 72%);
          mask-image: radial-gradient(circle at 50% 38%, #000 0%, transparent 72%);
          pointer-events: none;
        }
        .card {
          position: relative;
          width: 100%;
          max-width: 384px;
          background: #ffffff;
          border: 1px solid #dce5e2;
          border-radius: 16px;
          padding: 34px 30px 30px;
          box-shadow: 0 1px 2px rgba(15, 42, 35, 0.04), 0 18px 40px -24px rgba(15, 42, 35, 0.28);
        }
        .brand {
          margin-bottom: 26px;
        }
        .logoWrap {
          display: inline-flex;
          margin-bottom: 16px;
        }
        .logo {
          height: 80px;
          width: auto;
          object-fit: contain;
          display: block;
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: #0f766e;
          font-weight: 600;
        }
        .title {
          margin: 5px 0 2px;
          font-size: 23px;
          line-height: 1.15;
          letter-spacing: -0.01em;
          color: #0f2a23;
          font-weight: 700;
        }
        .sub {
          margin: 0;
          font-size: 13px;
          color: #5b716a;
        }
        .lbl {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #2b3f39;
          margin: 16px 0 7px;
        }
        .inp {
          width: 100%;
          box-sizing: border-box;
          padding: 11px 13px;
          font-size: 15px;
          color: #0f2a23;
          background: #f7faf9;
          border: 1px solid #d3ded9;
          border-radius: 10px;
          outline: none;
        }
        .inp::placeholder {
          color: #9bafa8;
        }
        .inp:focus-visible {
          border-color: #0f766e;
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.16);
        }
        .pw {
          position: relative;
        }
        .pw .inp {
          padding-right: 78px;
        }
        .toggle {
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          border: none;
          background: transparent;
          color: #0f766e;
          font-size: 12.5px;
          font-weight: 600;
          padding: 6px 8px;
          border-radius: 7px;
          cursor: pointer;
        }
        .toggle:focus-visible {
          outline: 2px solid #0f766e;
          outline-offset: 1px;
        }
        .err {
          margin-top: 14px;
          padding: 10px 12px;
          font-size: 13px;
          color: #b42318;
          background: #fef3f2;
          border: 1px solid #fcd2cd;
          border-radius: 9px;
        }
        .submit {
          width: 100%;
          margin-top: 22px;
          padding: 12px 16px;
          font-size: 15px;
          font-weight: 600;
          color: #ffffff;
          background: #0f766e;
          border: none;
          border-radius: 10px;
          cursor: pointer;
        }
        .submit:hover:not(:disabled) {
          background: #0b5e57;
        }
        .submit:focus-visible {
          outline: 2px solid #0b5e57;
          outline-offset: 2px;
        }
        .submit:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        @media (prefers-reduced-motion: no-preference) {
          .inp,
          .submit {
            transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
          }
        }
      `}</style>
    </main>
  );
}
