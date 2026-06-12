# Sistem Auto Jana Jadual Guru Ganti

Migrasi dari Google Apps Script → stack Docker (Next.js + Node/Express + PostgreSQL + Prisma).
**SABK Maahad Al-Khair Lil Banat** · Home server `srv-zai-93`.

- Borang guru: `borangketidakhadiranguru.byzaifuan.com`
- Panel admin: `adminjadual.byzaifuan.com`

> **Status: Fasa 9 — Telegram Automatik.** Snapshot **pagi automatik 5:30 (KL)** via penjadual dalam-proses (dedup harian), **realtime "KETIDAKHADIRAN BAHARU"** selepas borang dihantar, dan **"PEMBATALAN KETIDAKHADIRAN"** apabila status ditukar ke DIBATALKAN. Pencetus ikut GAS (hari ini + ≥5:30 pagi). Snapshot manual Fasa 8 kekal. PDF relief & Cloudflare Tunnel pada fasa seterusnya.

---

## 1. Keperluan di server

- Docker Engine + Docker Compose plugin (`docker compose version`)
- Port bebas: `4000` (backend), `3001` (borang), `3002` (admin), `5432` dalaman

## 2. Setup pertama

```bash
# 1) Salin projek ke server (contoh)
scp -r relief-system zai@srv-zai-93:/home/zai/

# 2) Sediakan .env
cd /home/zai/relief-system
cp .env.example .env
nano .env          # WAJIB tukar: POSTGRES_PASSWORD, JWT_SECRET, DATABASE_URL (padan password), SEED_DEFAULT_PASSWORD

# 3) Bina & jalankan
docker compose up -d --build

# 4) Semak log backend (migrasi + seed berjalan automatik)
docker compose logs -f backend
```

Bila backend siap, ia automatik menjalankan `prisma migrate deploy` (cipta 18 jadual) dan `seed` (kategori, peranan, 5 akaun admin, sekatan khas, tetapan).

## 3. Pengesahan

```bash
curl http://localhost:4000/health
# → {"status":"ok","db":true,...}

curl http://localhost:4000/api/v1/status
# → {"seed":{"kategori":5,"peranan":2,"pengguna":5,"sekatan":9,"tetapan":8},...}

# Uji login (Fasa 2) — gantikan password dengan SEED_DEFAULT_PASSWORD anda:
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"zai","password":"ubah1234"}'
# → {"token":"...","user":{"nama":"Ustaz Zai","role":"SUPER_ADMIN",...}}
```

- Borang guru `:3001` — halaman placeholder (UI penuh Fasa 7).
- Panel admin `:3002` — buka di pelayar: akan **redirect ke `/login`**. Log masuk dengan akaun di bawah → dashboard memaparkan "Fasa 2 Authentication Berjaya".

## 4. Akaun admin awal

Semua akaun ini dicipta automatik oleh seed. **Kata laluan awal semua akaun = nilai `SEED_DEFAULT_PASSWORD`** dalam `.env` (default `ubah1234`). Gunakan untuk uji login di panel admin. (Fungsi tukar kata laluan oleh pengguna ditambah pada fasa kemudian.)

| Nama | Username | Peranan | Hari bertugas* |
|---|---|---|---|
| Ustaz Zai | `zai` | SUPER_ADMIN | Jumaat |
| Cikgu Din | `din` | ADMIN_RELIEF | Isnin |
| Ustazah Najwa | `najwa` | ADMIN_RELIEF | Selasa |
| Teacher Mariam | `mariam` | ADMIN_RELIEF | Rabu |
| Teacher Ainul | `ainul` | ADMIN_RELIEF | Khamis |

*Hari bertugas = **lembut**: hanya default/paparan. Mana-mana admin boleh jana relief bila-bila hari. Super Admin boleh ubah jadual bertugas.

> Selepas seed pertama berjaya, set `SEED_ON_START=false` dalam `.env` dan `docker compose up -d` semula, supaya seed tidak berjalan lagi setiap restart (walaupun ia idempotent/selamat).

### Endpoint authentication & peranan (Fasa 2)

| Endpoint | Kaedah | Akses |
|---|---|---|
| `/api/auth/login` | POST | awam |
| `/api/auth/logout` | POST | perlu token |
| `/api/auth/me` | GET | perlu token |
| `/api/auth/admin-check` | GET | SUPER_ADMIN sahaja (contoh uji `authorize`) |

- **SUPER_ADMIN** (Ustaz Zai): akses penuh — urus admin, tetapan sistem, sync Google Sheet, hantar snapshot ketidakhadiran.
- **ADMIN_RELIEF** (Din, Najwa, Mariam, Ainul): semak ketidakhadiran, jana & kemaskini relief, lihat laporan. **Tidak boleh** urus akaun admin lain, ubah tetapan sistem, atau hantar snapshot.

Token JWT (tempoh 8 jam, secret dari `JWT_SECRET`) dihantar sebagai header `Authorization: Bearer <token>`. Setiap LOGIN & LOGOUT direkod dalam jadual `audit_logs`.

> **Nota ujian:** frontend admin memanggil backend pada `NEXT_PUBLIC_API_URL` yang **dibaked pada masa build**. Default ujian = `http://localhost:4000`. Untuk prod, tetapkan ke domain panel lalu bina semula: `docker compose up -d --build frontend-admin`.

### Google Sheet Sync (Fasa 3)

Engine menyegerakkan Google Sheet (master data) → PostgreSQL. **SUPER_ADMIN sahaja** boleh jalankan.

**Setup service account (sekali sahaja):**
1. Google Cloud Console: cipta projek → enable **Google Sheets API** → cipta **Service Account** → jana kunci JSON.
2. Isi `.env`: `GOOGLE_SERVICE_ACCOUNT_EMAIL` (client_email), `GOOGLE_PRIVATE_KEY` (private_key — satu baris dengan `\n`), `GOOGLE_SHEET_ID` (id dari URL sheet).
3. **Kongsi** Google Sheet (akses Viewer) dengan emel service account tersebut.
4. Sahkan nama tab dalam `.env` jika berbeza (default: `KATEGORI GURU`, `JADUAL GURU`, `JADUAL KELAS`, `pengecualian_relief`).

**Endpoint:**

| Endpoint | Kaedah | Akses | Fungsi |
|---|---|---|---|
| `/api/sync/run` | POST | SUPER_ADMIN | jalankan sync penuh |
| `/api/sync/status` | GET | mana-mana admin login | status sync terakhir |

**Jalankan (guna token SUPER_ADMIN dari `/api/auth/login`):**

```bash
TOKEN=...   # token akaun zai
curl -X POST http://localhost:4000/api/sync/run -H "Authorization: Bearer $TOKEN"
# → {"success":true,"guru":48,"jadual":3524,"jadualKelas":982,"pengecualian":17,"durationMs":...}

curl http://localhost:4000/api/sync/status -H "Authorization: Bearer $TOKEN"
# → {"lastSyncAt":"...","lastSyncStatus":"SUCCESS","durationMs":...,"counts":{...}}
```

**Pemetaan tab → jadual:**
- `KATEGORI GURU` → `teachers` (upsert; guru tiada dalam sheet → `isActive=false`)
- `JADUAL GURU` → `teacher_schedule` (padam semua → masuk semula)
- `JADUAL KELAS` → `class_schedule` (padam semua → masuk semula)
- `pengecualian_relief` → `relief_exclusions` (import; set `SYNC_PENGECUALIAN=false` bila diurus via panel kelak)

Selepas sync, sahkan dengan `GET /api/v1/status` — medan `data` patut tunjuk kiraan guru/jadual/jadualKelas/pengecualian. Sebarang baris tidak sah (cth tarikh/MOD pengecualian salah) dilangkau dan dilaporkan dalam medan `dilangkau`/`isu` respons sync (tidak menggagalkan keseluruhan sync).

### Borang Ketidakhadiran Guru (Fasa 4)

Borang awam (tiada login) di `frontend-borang` — guru isi & hantar; rekod disimpan ke `absence_records`.

| Endpoint | Kaedah | Akses | Fungsi |
|---|---|---|---|
| `/api/absence/public/options` | GET | awam | senarai guru aktif + sebab + jenis |
| `/api/absence` | POST | awam | hantar borang → `{ success, reference }` |
| `/api/absence/:id` | GET | login admin | papar satu rekod (kegunaan admin nanti) |

- **Medan:** nama guru (dropdown guru aktif), tarikh, sebab (`MC/CRK/CTR/PROGRAM_SEKOLAH/PROGRAM_LUAR/LAIN_LAIN`), jenis (`SEPANJANG_HARI`/`SEPARUH_HARI`), masa mula (jika separuh hari), catatan, lampiran (placeholder).
- **Catatan:** wajib untuk PROGRAM_SEKOLAH / PROGRAM_LUAR / LAIN_LAIN; pilihan untuk MC / CRK / CTR.
- **Reference:** `ABS-YYYYMMDD-NNN` (YYYYMMDD = tarikh ketidakhadiran; NNN = turutan harian).

**Uji (tiada login):**

```bash
curl http://localhost:4000/api/absence/public/options
# → { "teachers":[...], "sebab":[...], "jenis":[...] }

curl -X POST http://localhost:4000/api/absence \
  -H "Content-Type: application/json" \
  -d '{"guruNama":"<nama guru aktif>","tarikh":"2026-06-10","sebab":"MC","jenis":"SEPANJANG_HARI"}'
# → { "success":true, "reference":"ABS-20260610-001" }
```

Borang web: buka `http://<ip>:3001` (atau domain borang). Setiap penghantaran direkod dalam `audit_logs` (`ABSENCE_CREATE`).

### Dashboard Admin Ketidakhadiran (Fasa 5)

Admin (login) di `frontend-admin` → `/dashboard` → kad **Ketidakhadiran Guru** → `/dashboard/absence`. Papar kad ringkasan + jadual + penapis + tindakan.

| Endpoint | Kaedah | Akses |
|---|---|---|
| `/api/admin/absence` | GET | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/admin/absence/summary` | GET | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/admin/absence/:id` | GET | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/admin/absence/:id/status` | PATCH | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/admin/absence/:id` | DELETE | **SUPER_ADMIN sahaja** (soft delete) |

- **Status:** AKTIF / DIBATALKAN / SELESAI (default papar AKTIF).
- **Penapis:** tarikh (satu tarikh), status, sebab, guru, carian teks (nama/reference).
- **Padam** = soft delete (`deletedAt`) — rekod disembunyi dari senarai, tidak dihapus kekal. **Batal** = status DIBATALKAN (kekal tampak).
- **Kad ringkasan:** Hari Ini, Minggu Ini (kedua AKTIF), Rekod Aktif, Rekod Dibatalkan.
- Audit: `ABSENCE_STATUS_UPDATE`, `ABSENCE_CANCEL`, `ABSENCE_DELETE` (simpan userId, reference, status lama → baharu).

### Relief Engine (Fasa 6)

Jana jadual guru ganti untuk satu tarikh. Logik diport **100%** dari `reliefEngine.gs` + `helpers.gs` (bukan ringkasan).

| Endpoint | Kaedah | Akses |
|---|---|---|
| `/api/relief/generate` | POST | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/relief/:tarikh` | GET | SUPER_ADMIN + ADMIN_RELIEF |

**Jana:**
```bash
curl -X POST https://adminjadual.byzaifuan.com/api/relief/generate \
  -H "Authorization: Bearer <TOKEN_ADMIN>" -H "Content-Type: application/json" \
  -d '{"tarikh":"2026-06-15"}'
```
Respons: `{ tarikh, hari, batchId, status, ringkasan:{slot,terisi,kosong,tier2}, generated:[...] }`.

**Lihat semula:** `GET /api/relief/2026-06-15` → batch + senarai assignment (disusun ikut masa).

- **Aliran:** PASS 1 (had **1 relief/guru/hari**) → PASS 2 (jika ≥ `threshold_pass2` slot **dan** ada slot kosong, benarkan **Tier 2** = relief kedua untuk guru ringan `slotMengajar ≤ 2`).
- **Keutamaan calon:** `slotMengajar` menaik → kemudian `gantiDapat` menaik (ikut GAS asal).
- **Tapisan calon (turutan):** absen (peka masa) → pengecualian relief (`SEPANJANG_HARI`/`SLOT`) → kategori exempt (`PENTADBIR`) → nama exempt → sekatan khas (`LELAKI`/nama, hari, tetingkap masa) → mesti _free_ pada waktu → mesti ada **jurang rehat** (tiada slot bersambung terus) → tiada relief bertindih → had relief.
- **Slot tiada calon:** `guruGanti = null`, `auditNote = "Tiada calon sesuai"`.
- **Kunci:** batch berstatus `DIHANTAR`/`SELESAI` → jana semula ditolak (**HTTP 409**).
- **Kekal DISAHKAN:** baris `DISAHKAN` dikekalkan; hanya baris `CADANGAN` diganti setiap kali jana.
- **Adaptasi borang Fasa 4:** borang simpan `kelas="-"` + `perluGanti=true`, jadi setiap rekod AKTIF+perluGanti dilayan sebagai **"SEMUA"** → ganti semua slot mengajar guru itu pada hari berkenaan (laluan SEMUA enjin asal). `SEPARUH_HARI` menapis slot bermula `masaMula`.
- **Kuirk masa 12-jam:** jam **1–6 = petang** (1.00 → 780 minit). Dilindungi ujian golden `npm test`.
- Audit: `RELIEF_GENERATE` (simpan tarikh, ringkasan, bilangan dibuang/dicipta).

### Dashboard & Semakan Cadangan Relief (Fasa 7)

Admin → `/dashboard` → kad **Jadual Relief** → `/dashboard/relief`. Pilih tarikh → **Jana Relief** (atau **Jana Semula**) → semak jadual → **Sahkan**/**Batal** setiap baris cadangan.

| Endpoint | Kaedah | Transisi | Audit | Akses |
|---|---|---|---|---|
| `/api/relief/generate` | POST | (jana — Fasa 6) | `RELIEF_GENERATE` | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/relief/:tarikh` | GET | (lihat — Fasa 6) | — | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/relief/assignment/:id/confirm` | PATCH | `CADANGAN → DISAHKAN` | `RELIEF_CONFIRM` | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/relief/assignment/:id/cancel` | PATCH | `CADANGAN → BATAL` | `RELIEF_CANCEL` | SUPER_ADMIN + ADMIN_RELIEF |

- **Ringkasan:** Tarikh · Jumlah Slot · Terisi · Kosong · Relief Kedua (2×) · Status Batch.
- **Warna status baris:** `CADANGAN` kuning · `DISAHKAN` hijau · `BATAL` merah.
- **Tindakan:** hanya baris `CADANGAN` ada butang Sahkan/Batal. `DISAHKAN`/`BATAL` terkunci (tiada butang).
- **Confirm/cancel** sah hanya dari `CADANGAN` (jika tidak → **409**); ditolak juga jika batch `DIHANTAR`/`SELESAI` (**409**). Batch **kekal `DIJANA`** (tiada auto-transisi).
- **Jana Semula** ada amaran pengesahan: baris `CADANGAN` dijana semula; `DISAHKAN`/`BATAL` kekal (logik Fasa 6).
- Baris tanpa calon (`guruGanti=null`) dipapar **"Tiada calon sesuai"** — admin masih boleh Sahkan/Batal.
- **TIADA penghantaran Telegram** dalam fasa ini.

### Telegram Snapshot Ketidakhadiran (Fasa 8)

Pratonton & hantar snapshot ketidakhadiran guru ke group Telegram sedia ada. Format dikekalkan seperti sistem GAS lama (4 kumpulan, susunan & label sama, plain text).

| Endpoint | Kaedah | Fungsi | Akses |
|---|---|---|---|
| `/api/telegram/snapshot/preview` | GET | Bina teks snapshot (tiada hantar) | SUPER_ADMIN + ADMIN_RELIEF |
| `/api/telegram/snapshot/send` | POST | Hantar ke Telegram + log | **SUPER_ADMIN sahaja** |

```bash
# Pratonton (tarikh pilihan; default hari ini)
curl "http://localhost:4000/api/telegram/snapshot/preview?tarikh=2026-06-10" -H "Authorization: Bearer <TOKEN>"

# Hantar (Super Admin)
curl -X POST http://localhost:4000/api/telegram/snapshot/send \
  -H "Authorization: Bearer <TOKEN_SUPER>" -H "Content-Type: application/json" \
  -d '{"tarikh":"2026-06-10"}'
```

- **Sumber:** `absence_records` `AKTIF` + `deletedAt=null` pada tarikh; dedup nama; susun ikut `createdAt`.
- **Kumpulan & label:** MC/CRK/CTR → **MC / CRK / CTR** (papar jenis sahaja, tanpa detail); `PROGRAM_SEKOLAH` → **PROGRAM DI SEKOLAH**; `PROGRAM_LUAR` → **PROGRAM DI LUAR SEKOLAH**; `LAIN_LAIN` → **LAIN-LAIN** (ketiga-tiga papar `sebabDetail`).
- **Seksyen kosong disembunyikan.** Jika semua kosong → status `TIADA`, **tidak hantar** (preview tetap papar "Tiada rekod ketidakhadiran.").
- **Format:** tarikh `D/M/YYYY`, masa `h:mm AM/PM` (zon `Asia/Kuala_Lumpur`), plain text (`parse_mode` kosong).
- **Log:** `telegram_logs` (jenis `MANUAL`, `messageText`, `telegramMessageId`, `status`) + `audit_logs` (`TELEGRAM_SNAPSHOT_SEND { tarikh, jumlahGuru }`).
- **UI:** `/dashboard/absence` → butang **Pratonton Snapshot Telegram** (semua admin) & **Hantar Snapshot Telegram** (Super Admin sahaja) → modal pratonton + sahkan hantar.
- **Konfigurasi:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` dalam `.env` (bot & group lama GAS). **Bukan** dalam kod. Jika belum diset → `send` pulang 503.

### Telegram Automatik — Cron + Realtime + Pembatalan (Fasa 9)

Tiga penghantaran automatik (di atas snapshot manual Fasa 8):

| Jenis | Bila | Format | telegram_logs |
|---|---|---|---|
| **Snapshot pagi** | 5:30 pagi (KL), Isnin–Jumaat, jika ada rekod | Snapshot **penuh** (`KETIDAKHADIRAN GURU` … `5:30 AM`) | `SNAPSHOT` |
| **Realtime** | Selepas borang dihantar (`POST /api/absence`) | **Satu rekod** `KETIDAKHADIRAN BAHARU` | `REALTIME` |
| **Pembatalan** | Status ditukar → `DIBATALKAN` | **Satu rekod** `PEMBATALAN KETIDAKHADIRAN` | `PEMBATALAN` |

- **Syarat cetus realtime & pembatalan (ikut GAS):** hanya jika **tarikh rekod = hari ini (KL)** **dan** **masa semasa ≥ 5:30 pagi**. (Sebelum 5:30, snapshot pagi yang meliputinya.)
- **Snapshot pagi** guna `buildSnapshot(isAutoSnapshot)` Fasa 8 — format tidak berubah.
- **Mesej satu-rekod:** papar Nama, Tarikh (`D/M/YYYY`), Kategori, Masa (`h:mm AM/PM`). MC/CRK/CTR tanpa detail; `PROGRAM_SEKOLAH`/`PROGRAM_LUAR`/`LAIN_LAIN` sertakan `sebabDetail` jika ada.
- **Penjadual:** dalam-proses (tiada dependency), `setTimeout` ke 5:30 KL, re-arm harian, langkau hujung minggu. Dikawal env `ENABLE_SCHEDULER` (default `true`).
- **Anti-duplikat (pagi):** semak `telegram_logs { jenis:SNAPSHOT, tarikh: hari ini, status:OK }` sebelum hantar → jamin **sekali sehari** (selamat-restart). Snapshot **manual tidak** tersekat.
- **Endpoint sandaran/ujian:** `POST /api/telegram/cron/snapshot` (header `x-cron-secret: <CRON_SECRET>`, **bukan** JWT). Body/param `force=true` untuk langkau dedup + hujung minggu (ujian). Untuk host crontab luaran sebagai sandaran:
  ```bash
  # contoh crontab host (5:30 pagi setiap hari)
  30 5 * * * curl -s -X POST http://localhost:4000/api/telegram/cron/snapshot -H "x-cron-secret: $CRON_SECRET"
  ```
- **Audit:** `TELEGRAM_SNAPSHOT_AUTO` / `TELEGRAM_REALTIME_SEND` / `TELEGRAM_PEMBATALAN_SEND`.
- **Migrasi:** tambah nilai `PEMBATALAN` ke enum `TelegramJenis` (additive). Soft-delete ("Padam") **tidak** mencetus Telegram.
- **Selamat:** kegagalan Telegram **tidak** menggagalkan borang/tindakan (dibungkus `try/catch`, hanya log).

## 5. Mengedit kod (WinSCP)

Folder `backend/` di-bind-mount ke dalam container. Untuk perubahan kod backend:

```bash
# selepas edit fail dalam backend/src atau backend/prisma
docker compose restart backend
```

- **Tukar dependency** (`package.json`) atau **skema Prisma**: bina semula →
  `docker compose up -d --build backend`
  (jika tambah dependency dan node_modules tidak kemas kini: `docker compose down` → buang volume `relief-system_backend_node_modules` → `up --build`).
- **Frontend** dibina sebagai imej (bukan bind-mount); selepas edit: `docker compose up -d --build frontend-admin` (atau `frontend-borang`).

## 6. Migrasi Prisma (perubahan skema akan datang)

```bash
# Selepas ubah schema.prisma, jana migrasi baharu (di server, ada internet):
docker compose exec backend npx prisma migrate dev --name nama_perubahan
# Di "production" guna:
docker compose exec backend npx prisma migrate deploy
```

> Migrasi awal `20260609000000_init` sudah disertakan. Jika Prisma melaporkan drift pada masa hadapan, anda boleh baseline semula dengan `prisma migrate resolve` — tetapi dalam keadaan biasa `migrate deploy` mencukupi.

## 7. Backup database

```bash
# Backup manual (folder ./backups di-mount ke container postgres)
docker compose exec postgres pg_dump -U relief relief_db > backups/relief_$(date +%F).sql

# Restore
cat backups/relief_2026-06-09.sql | docker compose exec -T postgres psql -U relief -d relief_db
```

(Backup berjadual + arkib suku tahunan tanpa purge: Fasa 8.)

## 8. Struktur projek

```
relief-system/
├── docker-compose.yml          # postgres + backend + 2 frontend
├── .env.example                # template konfigurasi
├── backups/                    # tempat dump SQL
├── backend/                    # Node/Express + Prisma
│   ├── prisma/                 # schema (18 jadual) + seed + migrasi
│   └── src/
│       ├── server.js           # health, status, mount auth/sync/absence/relief/telegram + scheduler
│       ├── scheduler.js        # penjadual dalam-proses 5:30 KL (F9)
│       ├── lib/                # prisma, jwt, audit, absence*, timeUtil, reliefConfig, telegram
│       ├── middleware/         # authenticate, authorize
│       ├── services/           # sync* (F3) + candidate/relief/assignment (F6) + snapshot (F8) + telegramNotify (F9)
│       ├── controllers/        # auth, sync, absence, adminAbsence, relief, reliefAssignment, telegram, telegramCron
│       ├── routes/             # auth, sync, absence, adminAbsence, relief, reliefAssignment, telegram, telegramCron
│       └── __tests__/          # timeUtil + relief-rules (node:test, F6)
├── frontend-borang/            # Next.js 14 — borang ketidakhadiran (Fasa 4)
│   ├── lib/                    # api (awam)
│   └── app/page.jsx            # borang
└── frontend-admin/             # Next.js 14 — login + dashboard
    ├── middleware.js           # guard /dashboard → /login
    ├── lib/                    # api (+relief), auth (cookie token)
    └── app/
        ├── login/              # halaman log masuk
        └── dashboard/          # dashboard + /absence (F5) + /relief (F7)
```

## 9. Peta jalan fasa

| Fasa | Skop | Status |
|---|---|---|
| **1** | Scaffold, Docker, skema DB, migrasi, seed | ✅ Siap |
| **2** | Authentication & role management (login, JWT, middleware, audit) | ✅ Siap |
| **3** | Sync Engine: Google Sheet → PostgreSQL (4 tab) | ✅ Siap |
| **4** | Borang ketidakhadiran (frontend-borang + API) | ✅ Siap |
| **5** | Dashboard admin ketidakhadiran (lihat & urus rekod) | ✅ Siap |
| **6** | Relief Engine: utiliti masa 12-jam + enjin two-pass + ujian regresi | ✅ Siap |
| **7** | Jana & urus relief dalam dashboard admin (sahkan/batal) | ✅ Siap |
| **8** | Telegram snapshot ketidakhadiran guru (pratonton/hantar) | ✅ Siap |
| **9** | Telegram automatik: cron pagi 5:30 + realtime + pembatalan | ✅ Siap |
| 10 | PDF relief + backup berjadual + Cloudflare Tunnel + parallel run vs GAS + serah | ⬜ |

---

### Nota reka bentuk (Fasa 1)

- **Logik relief belum diport** — ini hanya asas. Enjin (23 peraturan, two-pass, kuirk masa 12-jam) diport pada Fasa 3–4 dengan ujian regresi.
- `NAMA_EXEMPT` & parameter enjin (`relief_had_default`, `threshold_pass2`, dll.) disimpan dalam jadual `system_settings` (boleh diubah), bukan hardcode.
- `SEKATAN_KHAS` (9 peraturan) disimpan dalam jadual `special_restrictions` (boleh diubah).
- Firebase dibuang sepenuhnya.
- Status relief dua peringkat: batch (`DRAF→DIJANA→DIHANTAR→SELESAI`) + baris (`CADANGAN/DISAHKAN/BATAL`).

### Nota Fasa 2 (Authentication)

- **Tiada perubahan skema database** — guna jadual `roles`, `users`, `audit_logs`, `admin_assignments` sedia ada.
- Kata laluan disimpan sebagai **bcrypt hash** sahaja (tiada plaintext). JWT secret dari `.env`.
- Token disimpan dalam cookie `token` di pelayar (dibaca middleware untuk guard, dihantar sebagai Bearer ke API). Pengukuhan ke httpOnly cookie dirancang Fasa 10 bila `/api` jadi same-origin melalui Cloudflare Tunnel.
- Logout bersifat stateless (token tamat sendiri dalam 8 jam). Pembatalan segera (denylist) boleh ditambah jika perlu.
- Relief Engine dan Telegram **belum disentuh**.

### Nota Fasa 3 (Sync Engine)

- **Tiada perubahan schema** — guna jadual `teachers`, `teacher_schedule`, `class_schedule`, `relief_exclusions`, dan `sync_logs` sedia ada (semua dari Fasa 1).
- **Tiada dependency baharu** — auth Service Account guna `jsonwebtoken` (sedia ada) + `fetch` terbina Node 20. `package.json` tidak diubah.
- Google Sheet dianggap **master data**: `teacher_schedule` & `class_schedule` = padam-semua-lalu-masuk-semula; `teachers` = upsert + nyahaktif yang tiada.
- Sync bersifat **all-or-nothing** (satu transaction). Ralat struktur (header hilang / tab kosong untuk jadual) membatalkan keseluruhan sync tanpa menulis data separa.
- Setiap sync direkod dalam `sync_logs` (+ `audit_logs` dengan `action: SYNC_RUN`/`SYNC_FAIL` dan id pengguna).
- **Belum dibina:** Relief Engine, Telegram, cron job, UI sync (butang sync di panel datang di fasa UI).

### Nota Fasa 4 (Borang Ketidakhadiran)

- **Schema:** 3 lajur additive pada `absence_records` — `jenis`, `masaMula`, `reference` (unique). Migrasi `20260610000000_absence_form_fields` (ALTER sahaja; tiada lajur lama diubah/dipadam).
- **Tiada dependency baharu** (Zod sedia ada sejak Fasa 1).
- Borang **tiada login**; `hari` diterbitkan dari tarikh; `perluGanti`/`kelas`/`subjek` (kad kelas) ditangguh ke fasa relief.
- Sebab disimpan sebagai nilai konsisten (`MC`…`LAIN_LAIN`) untuk kegunaan Telegram kelak. Catatan wajib bagi PROGRAM_SEKOLAH / PROGRAM_LUAR / LAIN_LAIN.
- **Belum dibina:** Relief Engine, dashboard admin, Telegram, PDF, upload lampiran sebenar.

### Nota Fasa 5 (Dashboard Ketidakhadiran)

- **Schema:** enum `StatusBorang` → `AKTIF`/`DIBATALKAN`/`SELESAI` (rename `BATAL`→`DIBATALKAN`, tambah `SELESAI`); tambah lajur `deletedAt` (soft delete). Migrasi `20260610010000_absence_status_softdelete`. **Perlu PostgreSQL 16** (kami guna `postgres:16-alpine`) untuk `ALTER TYPE`.
- **Tiada dependency baharu.** API admin dalam namespace `/api/admin/absence` (berasingan dari borang awam Fasa 4 yang kekal).
- **Akses:** lihat/kemaskini status/batal = SUPER_ADMIN + ADMIN_RELIEF; **padam (soft delete) = SUPER_ADMIN sahaja**.
- **Belum dibina:** Relief Engine, jana relief, Telegram, PDF, cron.

### Nota Fasa 6 (Relief Engine)

- **Tiada perubahan schema** — guna `relief_batches`, `relief_assignments`, `relief_exclusions`, `special_restrictions`, `system_settings`, `audit_logs` sedia ada (semua dari Fasa 1).
- **Tiada dependency baharu** — ujian guna `node:test` terbina (Node 22). Skrip baharu: `npm test`.
- **Fidelity 100%** kepada GAS asal: `cariBestCalon`, `adaSekatanKhas`, `isFreepadaWaktu`, `semakRehat`, `masaKeMinit`, `parseMasa` diport tepat. Turutan keutamaan `slotMengajar` ↑ → `gantiDapat` ↑ dikekalkan.
- **Parameter dari DB** (bukan hardcode): `relief_had_default` (1), `threshold_pass2` (10), `tier2_max_slot_mengajar` (2), `nama_exempt`, kategori exempt (`teacher_categories.isReliefExempt`), `special_restrictions`.
- **Kekal DISAHKAN, ganti CADANGAN:** jana semula mengekalkan baris `DISAHKAN` (diseed ke kiraan beban guru), membuang & menjana semula baris `CADANGAN` sahaja, dalam satu transaksi. Batch `DIHANTAR`/`SELESAI` dikunci (409).
- **Adaptasi borang Fasa 4:** rekod AKTIF+`perluGanti` dilayan sebagai **"SEMUA"** (semua slot mengajar guru hari itu) kerana borang menyimpan `kelas="-"`. `SEPARUH_HARI` menapis slot dari `masaMula`.
- **Struktur disediakan, belum aktif:** `pengecualianKelas`/`fokusKelas` (Tetapan Khas) dan Suka Sama Suka — hook ada, tidak diimplement (keputusan #6/#7).
- **Ujian:** golden masa (`timeUtil.test.js`) + unit peraturan (`relief-rules.test.js`), 20 ujian, tulen tanpa DB. Jalankan `cd backend && npm test`.
- **Belum dibina:** UI jana/sah relief dalam dashboard (Fasa 7), Telegram + PDF "JADUAL WAKTU GANTI" + cron (Fasa 8).

### Nota Fasa 7 (Dashboard Relief)

- **Tiada perubahan schema** — guna `ReliefAssignment.status`/`updatedBy`/`auditNote` & `ReliefBatch.status` sedia ada.
- **Tiada dependency baharu** — backend 2 endpoint PATCH; frontend satu halaman `app/dashboard/relief/page.jsx`.
- **Enjin Fasa 6 TIDAK diubah** — `candidate/relief/assignment.service.js` + `timeUtil.js` kekal; `POST /api/relief/generate` & `GET /api/relief/:tarikh` diguna semula apa adanya.
- **Routing:** `/api/relief/assignment` didaftar **sebelum** `/api/relief` dalam `server.js` supaya PATCH tidak ditangkap oleh `GET /:tarikh`.
- **State machine baris:** `CADANGAN → DISAHKAN` (confirm) / `CADANGAN → BATAL` (cancel). Transisi lain ditolak 409. Batch terkunci (`DIHANTAR`/`SELESAI`) → 409. Batch kekal `DIJANA`.
- **Hak akses sama** untuk SUPER_ADMIN & ADMIN_RELIEF (jana, jana semula, sahkan, batal).
- **Belum dibina:** penghantaran Telegram, PDF relief, cron, transisi batch ke `DIHANTAR`/`SELESAI` (Fasa 8).

### Nota Fasa 8 (Telegram Snapshot)

- **Tiada perubahan schema** — `telegram_logs` + enum `TelegramJenis` sudah wujud sejak migrasi init Fasa 1.
- **Tiada dependency baharu** — guna `fetch` terbina Node 22 untuk Telegram Bot API.
- **Format dikekalkan** dari `telegram.gs` GAS: 4 kumpulan, susunan & label sama, dedup nama, susun ikut masa hantar, seksyen kosong disembunyi, tarikh `D/M/YYYY`, masa `h:mm AM/PM`, plain text.
- **Lebih bersih dari GAS:** sebab+detail sudah berasingan (`sebabKategori`/`sebabDetail`) sejak Fasa 4 — tiada lagi emoji-stripping/dash-splitting.
- **Akses:** preview = SUPER_ADMIN + ADMIN_RELIEF; **hantar = SUPER_ADMIN sahaja** (tugas Super Admin).
- **Selamat:** semua kosong → tidak hantar; token belum diset → 503; setiap cubaan hantar direkod ke `telegram_logs`.
- **Env:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` ditambah ke `docker-compose` `backend.environment` (dibaca dari `.env`). Bot & group lama GAS — tidak hardcode.
- **Disediakan untuk Fasa 9 (tidak aktif):** parameter `isAutoSnapshot` (header "KETIDAKHADIRAN GURU" + "5:30 AM") & `pembatalan` (header amaran) untuk cron auto-snapshot.
- **Belum dibina:** cron 5:30 pagi, auto-update realtime selepas submit/batal, PDF relief.

### Nota Fasa 9 (Telegram Automatik)

- **Satu migrasi additive:** `ALTER TYPE "TelegramJenis" ADD VALUE 'PEMBATALAN'` (PG16). Perlu `prisma migrate deploy` + `prisma generate`.
- **Tiada dependency baharu** — penjadual guna `setTimeout` + `Intl` (zon `Asia/Kuala_Lumpur`).
- **Hibrid (keputusan):** pagi = snapshot penuh (guna `buildSnapshot` F8 tanpa ubah); realtime + pembatalan = mesej satu-rekod format baharu.
- **Pencetus ikut GAS:** realtime/pembatalan hanya untuk rekod **hari ini** & selepas **5:30 pagi** (port `shouldTriggerRealtimeUpdate`).
- **F8 tidak disentuh:** `telegram.controller.js` + `telegram.routes.js` (snapshot manual) kekal. Cron guna fail berasingan (`telegramCron.*`).
- **Hook minimal:** `absence.controller` (selepas create) + `adminAbsence.controller` (status→DIBATALKAN) sahaja — `try/catch`, tidak blok.
- **Anti-duplikat pagi** via `telegram_logs` (jenis SNAPSHOT + tarikh + status OK). Manual tidak tersekat.
- **Env baharu:** `ENABLE_SCHEDULER` (default true), `CRON_SECRET` (endpoint sandaran).
- **Belum dibina:** PDF "JADUAL WAKTU GANTI", backup berjadual, Cloudflare Tunnel, serahan (Fasa 10).
