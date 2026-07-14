'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api.js';
import { clearToken } from '../../../lib/auth.js';

const HARI_LIST = [
  { value: 'ISNIN', label: 'Isnin' },
  { value: 'SELASA', label: 'Selasa' },
  { value: 'RABU', label: 'Rabu' },
  { value: 'KHAMIS', label: 'Khamis' },
  { value: 'JUMAAT', label: 'Jumaat' },
];
const HARI_LABEL = Object.fromEntries(HARI_LIST.map((h) => [h.value, h.label]));

const JENIS_LIST = [
  { value: 'FULL_WEEK', label: 'Sekatan Sepanjang Minggu', desc: 'Tidak boleh relief — semua hari, semua waktu' },
  { value: 'SPECIFIC_DAYS', label: 'Sekatan Hari Tertentu', desc: 'Tidak boleh relief sepanjang hari yang dipilih' },
  { value: 'SPECIFIC_TIME', label: 'Sekatan Waktu Tertentu', desc: 'Tidak boleh relief pada waktu tertentu sahaja' },
];
const JENIS_LABEL = Object.fromEntries(JENIS_LIST.map((j) => [j.value, j.label]));

const EMPTY_FORM = { id: null, teacherId: '', restrictionType: 'SPECIFIC_TIME', hariList: [], masaDari: '', masaHingga: '', catatan: '' };

function formatHari(item) {
  if (item.restrictionType === 'FULL_WEEK' || !item.hariList || item.hariList.length === 0) return 'Semua hari';
  return item.hariList.map((h) => HARI_LABEL[h] || h).join(', ');
}
function formatWaktu(item) {
  if (item.restrictionType === 'SPECIFIC_TIME' && item.masaDari && item.masaHingga) {
    return `${item.masaDari.replace('.', ':')} – ${item.masaHingga.replace('.', ':')}`;
  }
  return 'Sepanjang hari';
}
function toTimeInput(v) {
  return v ? v.replace('.', ':') : '';
}

export default function SekatanReliefPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  const [items, setItems] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [listError, setListError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState(null);

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
        await muatSemula();
      } catch (e) {
        if (e.status === 401) {
          clearToken();
          router.replace('/login');
        } else if (e.status === 403) {
          router.replace('/dashboard');
        } else {
          setListError(e.message || 'Gagal memuatkan Sekatan Khas Relief.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function muatSemula() {
    const [list, opts] = await Promise.all([api.specialRestrictions.list(), api.specialRestrictions.options()]);
    setItems(list.items || []);
    setTeachers(opts.teachers || []);
  }

  function bukaTambah() {
    setForm(EMPTY_FORM);
    setTeacherQuery('');
    setFormError('');
    setShowForm(true);
  }

  function bukaEdit(item) {
    setForm({
      id: item.id,
      teacherId: item.teacherId || '',
      restrictionType: item.restrictionType,
      hariList: item.hariList || [],
      masaDari: item.masaDari || '',
      masaHingga: item.masaHingga || '',
      catatan: item.catatan || '',
    });
    setTeacherQuery(item.nama);
    setFormError('');
    setShowForm(true);
  }

  function toggleHari(h) {
    setForm((f) => ({ ...f, hariList: f.hariList.includes(h) ? f.hariList.filter((x) => x !== h) : [...f.hariList, h] }));
  }

  const teacherFiltered = useMemo(() => {
    const q = teacherQuery.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) => t.nama.toLowerCase().includes(q));
  }, [teachers, teacherQuery]);

  function pilihGuru(t) {
    setForm((f) => ({ ...f, teacherId: t.id }));
    setTeacherQuery(t.nama);
    setTeacherOpen(false);
  }

  async function simpan() {
    if (saving) return;
    setFormError('');

    if (!form.teacherId) return setFormError('Sila pilih guru daripada senarai (guru aktif sahaja).');
    if (form.restrictionType !== 'FULL_WEEK' && form.hariList.length === 0) {
      return setFormError('Sila pilih sekurang-kurangnya satu hari.');
    }
    if (form.restrictionType === 'SPECIFIC_TIME') {
      if (!form.masaDari || !form.masaHingga) return setFormError('Sila isi masa mula dan masa tamat.');
      if (form.masaHingga <= form.masaDari) return setFormError('Masa tamat mesti selepas masa mula.');
    }

    setSaving(true);
    try {
      const payload = {
        teacherId: Number(form.teacherId),
        restrictionType: form.restrictionType,
        hariList: form.restrictionType === 'FULL_WEEK' ? [] : form.hariList,
        masaDari: form.restrictionType === 'SPECIFIC_TIME' ? form.masaDari : undefined,
        masaHingga: form.restrictionType === 'SPECIFIC_TIME' ? form.masaHingga : undefined,
        catatan: form.catatan || undefined,
      };
      if (form.id) await api.specialRestrictions.update(form.id, payload);
      else await api.specialRestrictions.create(payload);
      await muatSemula();
      setShowForm(false);
    } catch (e) {
      setFormError(e.message || 'Gagal menyimpan sekatan.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAktif(item) {
    if (busyId) return;
    setBusyId(item.id);
    setListError('');
    try {
      if (item.isActive) await api.specialRestrictions.deactivate(item.id);
      else await api.specialRestrictions.activate(item.id);
      await muatSemula();
    } catch (e) {
      setListError(e.message || 'Gagal mengemaskini status sekatan.');
    } finally {
      setBusyId(null);
    }
  }

  async function padam(item) {
    if (busyId) return;
    if (!window.confirm(`Padam sekatan untuk ${item.nama}? Tindakan ini tidak boleh diundur.`)) return;
    setBusyId(item.id);
    setListError('');
    try {
      await api.specialRestrictions.remove(item.id);
      await muatSemula();
    } catch (e) {
      setListError(e.message || 'Gagal memadam sekatan.');
    } finally {
      setBusyId(null);
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
  if (!allowed) return null;

  return (
    <div className="wrap">
      <Link href="/dashboard" className="back">← Dashboard</Link>

      <div className="head">
        <h1 className="title">Sekatan Khas Relief</h1>
        <p className="lede">
          Urus guru yang tidak boleh menerima relief. Perubahan berkuat kuasa serta-merta pada Enjin Relief — tiada
          keperluan ubah kod apabila pengetua bertukar, guru baharu masuk, atau waktu sekatan berubah.
        </p>
      </div>

      {listError && <div className="msg err" role="alert">{listError}</div>}

      {!showForm && (
        <button className="btn addBtn" onClick={bukaTambah}>
          + Tambah Sekatan
        </button>
      )}

      {showForm && (
        <section className="card formCard">
          <div className="formTitle">{form.id ? 'Edit Sekatan' : 'Tambah Sekatan'}</div>

          <label className="field">
            <span className="flabel">Nama Guru</span>
            <div className="combo">
              <input
                className="finput"
                placeholder="Taip untuk cari guru aktif…"
                value={teacherQuery}
                onChange={(e) => {
                  setTeacherQuery(e.target.value);
                  setTeacherOpen(true);
                  setForm((f) => ({ ...f, teacherId: '' }));
                }}
                onFocus={() => setTeacherOpen(true)}
                onBlur={() => setTimeout(() => setTeacherOpen(false), 150)}
              />
              {teacherOpen && (
                <div className="comboList">
                  {teacherFiltered.length === 0 && <div className="comboEmpty">Tiada guru aktif sepadan</div>}
                  {teacherFiltered.map((t) => (
                    <button type="button" key={t.id} className="comboItem" onMouseDown={() => pilihGuru(t)}>
                      {t.nama}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="fhint">Hanya guru aktif (hasil sync Google Sheet) dipaparkan.</span>
          </label>

          <label className="field">
            <span className="flabel">Jenis Sekatan</span>
            <div className="typeGroup">
              {JENIS_LIST.map((j) => (
                <button
                  type="button"
                  key={j.value}
                  className={`typeBtn ${form.restrictionType === j.value ? 'active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, restrictionType: j.value }))}
                >
                  <span className="typeLabel">{j.label}</span>
                  <span className="typeDesc">{j.desc}</span>
                </button>
              ))}
            </div>
          </label>

          {form.restrictionType !== 'FULL_WEEK' && (
            <label className="field">
              <span className="flabel">Hari</span>
              <div className="hariGroup">
                {HARI_LIST.map((h) => (
                  <button
                    type="button"
                    key={h.value}
                    className={`hariBtn ${form.hariList.includes(h.value) ? 'active' : ''}`}
                    onClick={() => toggleHari(h.value)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </label>
          )}

          {form.restrictionType === 'SPECIFIC_TIME' && (
            <div className="timeRow">
              <label className="field">
                <span className="flabel">Masa Mula</span>
                <input
                  className="finput"
                  type="time"
                  value={toTimeInput(form.masaDari)}
                  onChange={(e) => setForm((f) => ({ ...f, masaDari: e.target.value }))}
                />
              </label>
              <label className="field">
                <span className="flabel">Masa Tamat</span>
                <input
                  className="finput"
                  type="time"
                  value={toTimeInput(form.masaHingga)}
                  onChange={(e) => setForm((f) => ({ ...f, masaHingga: e.target.value }))}
                />
              </label>
            </div>
          )}

          <label className="field">
            <span className="flabel">Catatan (pilihan)</span>
            <textarea
              className="finput"
              rows={2}
              value={form.catatan}
              onChange={(e) => setForm((f) => ({ ...f, catatan: e.target.value }))}
              placeholder="Cth: Waktu solat Jumaat"
            />
          </label>

          {formError && <div className="msg err" role="alert">{formError}</div>}

          <div className="formActions">
            <button className="btnGhost" onClick={() => setShowForm(false)} disabled={saving}>
              Batal
            </button>
            <button className="btn" onClick={simpan} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </section>
      )}

      <h2 className="secTitle">Senarai Sekatan ({items.length})</h2>

      {items.length === 0 && <p className="empty">Belum ada sekatan khas ditetapkan.</p>}

      <div className="list">
        {items.map((item) => (
          <div key={item.id} className={`card item ${!item.isActive ? 'inactive' : ''}`}>
            <div className="itemTop">
              <div className="itemName">
                {item.nama}
                {item.teacherActive === false && <span className="badge warn">Tidak Aktif</span>}
                {item.teacherActive === null && <span className="badge warn">Tiada Padanan</span>}
              </div>
              <span className={`badge ${item.isActive ? 'ok' : 'off'}`}>{item.isActive ? 'Aktif' : 'Nyahaktif'}</span>
            </div>
            <div className="itemMeta">
              <span className="pill">{JENIS_LABEL[item.restrictionType]}</span>
              <span className="metaText">{formatHari(item)}</span>
              <span className="metaText">{formatWaktu(item)}</span>
            </div>
            {item.catatan && <div className="itemNote">{item.catatan}</div>}
            <div className="itemActions">
              <button className="aBtn" onClick={() => bukaEdit(item)} disabled={busyId === item.id}>
                Edit
              </button>
              <button className="aBtn" onClick={() => toggleAktif(item)} disabled={busyId === item.id}>
                {item.isActive ? 'Nyahaktifkan' : 'Aktifkan'}
              </button>
              <button className="aBtn danger" onClick={() => padam(item)} disabled={busyId === item.id}>
                Padam
              </button>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .wrap { max-width: 720px; margin: 0 auto; padding: 20px 16px 56px; background: #eef3f1; min-height: 100vh; }
        .back { color: #0f766e; text-decoration: none; font-size: 14px; font-weight: 600; }
        .back:hover { text-decoration: underline; }

        .head { margin: 16px 0 18px; }
        .title { margin: 0; font-size: 22px; font-weight: 800; color: #0f2a23; letter-spacing: -0.02em; }
        .lede { margin: 8px 0 0; font-size: 13.5px; line-height: 1.5; color: #5b716a; }

        .card {
          background: #fff; border: 1px solid #d8e6e1; border-radius: 14px; padding: 18px;
          box-shadow: 0 1px 2px rgba(15,42,35,.04), 0 16px 36px -30px rgba(15,42,35,.3);
        }

        .btn {
          padding: 11px 16px; font-size: 14px; font-weight: 700; color: #fff; background: #0f766e;
          border: none; border-radius: 10px; cursor: pointer; transition: background .15s ease;
        }
        .btn:hover:not(:disabled) { background: #0b5e57; }
        .btn:disabled { opacity: .6; cursor: progress; }
        .addBtn { width: 100%; margin-bottom: 18px; }

        .btnGhost {
          padding: 11px 16px; font-size: 14px; font-weight: 600; color: #5b716a; background: #f1f5f4;
          border: 1px solid #d8e2de; border-radius: 10px; cursor: pointer;
        }
        .btnGhost:hover:not(:disabled) { background: #e7eeec; }

        .msg { margin-bottom: 14px; padding: 11px 13px; font-size: 13px; border-radius: 11px; }
        .msg.err { color: #b42318; background: #fef3f2; border: 1px solid #fcd2cd; }

        .formCard { margin-bottom: 20px; display: flex; flex-direction: column; gap: 16px; }
        .formTitle { font-size: 16px; font-weight: 700; color: #0f2a23; }

        .field { display: flex; flex-direction: column; gap: 6px; }
        .flabel { font-size: 12.5px; font-weight: 700; color: #5b716a; text-transform: uppercase; letter-spacing: .04em; }
        .fhint { font-size: 12px; color: #8a9a95; }
        .finput {
          padding: 10px 12px; font-size: 14.5px; color: #14302b; background: #fff;
          border: 1px solid #d8e2de; border-radius: 10px; outline: none; font-family: inherit;
        }
        .finput:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,.12); }
        textarea.finput { resize: vertical; }

        .combo { position: relative; }
        .comboList {
          position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; right: 0; max-height: 220px; overflow-y: auto;
          background: #fff; border: 1px solid #d8e2de; border-radius: 10px; box-shadow: 0 12px 28px -12px rgba(15,42,35,.35);
        }
        .comboItem { display: block; width: 100%; text-align: left; padding: 9px 12px; font-size: 14px; color: #14302b; background: none; border: none; cursor: pointer; }
        .comboItem:hover { background: #f1f7f5; }
        .comboEmpty { padding: 10px 12px; font-size: 13px; color: #8a9a95; }

        .typeGroup { display: flex; flex-direction: column; gap: 8px; }
        .typeBtn {
          text-align: left; padding: 11px 13px; border: 1px solid #d8e2de; border-radius: 10px; background: #fff;
          cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: border-color .15s ease, background .15s ease;
        }
        .typeBtn.active { border-color: #0f766e; background: #f1f7f5; }
        .typeLabel { font-size: 14px; font-weight: 700; color: #0f2a23; }
        .typeDesc { font-size: 12.5px; color: #5b716a; }

        .hariGroup { display: flex; flex-wrap: wrap; gap: 8px; }
        .hariBtn {
          padding: 8px 14px; font-size: 13.5px; font-weight: 600; color: #5b716a; background: #f1f5f4;
          border: 1px solid #d8e2de; border-radius: 999px; cursor: pointer; transition: all .15s ease;
        }
        .hariBtn.active { color: #fff; background: #0f766e; border-color: #0f766e; }

        .timeRow { display: flex; gap: 12px; }
        .timeRow .field { flex: 1; }

        .formActions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }

        .secTitle { margin: 6px 2px 12px; font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #7c8f89; }
        .empty { font-size: 14px; color: #8a9a95; padding: 20px 0; text-align: center; }

        .list { display: flex; flex-direction: column; gap: 12px; }
        .item { display: flex; flex-direction: column; gap: 10px; }
        .item.inactive { opacity: .68; }
        .itemTop { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .itemName { font-size: 15px; font-weight: 700; color: #0f2a23; display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }

        .badge { display: inline-flex; align-items: center; padding: 3px 9px; font-size: 11.5px; font-weight: 700; border-radius: 999px; white-space: nowrap; }
        .badge.ok { color: #0b5e57; background: #e6f4f0; border: 1px solid #c2e3da; }
        .badge.off { color: #6b7c77; background: #f1f5f4; border: 1px solid #dde7e4; }
        .badge.warn { color: #8a6d12; background: #faf3df; border: 1px solid #ecdcae; }

        .itemMeta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .pill { padding: 4px 10px; font-size: 12px; font-weight: 700; color: #0f766e; background: #e6f4f0; border-radius: 999px; }
        .metaText { font-size: 13px; color: #5b716a; }
        .itemNote { font-size: 13px; color: #5b716a; font-style: italic; padding-top: 2px; border-top: 1px dashed #e6efeb; }

        .itemActions { display: flex; gap: 8px; flex-wrap: wrap; }
        .aBtn {
          padding: 7px 12px; font-size: 12.5px; font-weight: 600; color: #0f766e; background: #f1f7f5;
          border: 1px solid #d8e6e1; border-radius: 8px; cursor: pointer;
        }
        .aBtn:hover:not(:disabled) { background: #e0efe9; }
        .aBtn:disabled { opacity: .6; cursor: progress; }
        .aBtn.danger { color: #b42318; background: #fef3f2; border-color: #fcd2cd; }
        .aBtn.danger:hover:not(:disabled) { background: #fde3e0; }

        @media (max-width: 480px) {
          .timeRow { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
