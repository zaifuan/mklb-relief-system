// ════════════════════════════════════════════════════════════
//  relief-backend — server.js
//  Fasa 9: + Telegram automatik (snapshot pagi cron + realtime + pembatalan).
//  PDF relief belum.
// ════════════════════════════════════════════════════════════

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import prisma from './lib/prisma.js';
import authRoutes from './routes/auth.routes.js';
import syncRoutes from './routes/sync.routes.js';
import absenceRoutes from './routes/absence.routes.js';
import adminAbsenceRoutes from './routes/adminAbsence.routes.js';
import accountRoutes from './routes/accounts.routes.js';
import specialSettingRoutes from './routes/specialSetting.routes.js';
import specialRestrictionRoutes from './routes/specialRestriction.routes.js';
import reliefRoutes from './routes/relief.routes.js';
import reliefAssignmentRoutes from './routes/reliefAssignment.routes.js';
import telegramRoutes from './routes/telegram.routes.js';
import telegramCronRoutes from './routes/telegramCron.routes.js';
import { startScheduler } from './scheduler.js';

const app = express();
app.set('trust proxy', 1); // ip tepat di belakang proxy/Cloudflare
app.use(express.json());

// ── CORS ──
// Origin prod dari .env + localhost untuk ujian tempatan.
const allowedOrigins = [
  process.env.FRONTEND_BORANG_ORIGIN,
  process.env.FRONTEND_ADMIN_ORIGIN,
  'http://localhost:3001',
  'http://localhost:3002',
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ── Auth (Fasa 2) ──
app.use('/api/auth', authRoutes);

// ── Sync (Fasa 3) ──
app.use('/api/sync', syncRoutes);

// ── Borang Ketidakhadiran (Fasa 4) ──
app.use('/api/absence', absenceRoutes);

// ── Dashboard Admin Ketidakhadiran (Fasa 5) ──
app.use('/api/admin/absence', adminAbsenceRoutes);
app.use('/api/admin/accounts', accountRoutes);
app.use('/api/special-settings', specialSettingRoutes);
app.use('/api/special-restrictions', specialRestrictionRoutes);

// ── Relief Engine (Fasa 6) + Semakan cadangan (Fasa 7) ──
// Daftar /assignment DAHULU supaya PATCH tidak ditangkap oleh GET /:tarikh.
app.use('/api/relief/assignment', reliefAssignmentRoutes);
app.use('/api/relief', reliefRoutes);

// ── Telegram snapshot ketidakhadiran (Fasa 8) + cron auto (Fasa 9) ──
// Daftar /cron DAHULU (CRON_SECRET, bukan JWT) sebelum laluan JWT /api/telegram.
app.use('/api/telegram/cron', telegramCronRoutes);
app.use('/api/telegram', telegramRoutes);

// ── Health check ──
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: true, time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: false, mesej: 'DB tidak dapat dihubungi' });
  }
});

// ── Status (bukti skema + seed + data sync) ──
app.get('/api/v1/status', async (req, res) => {
  try {
    const [kategori, peranan, pengguna, sekatan, tetapan, guru, jadual, jadualKelas, pengecualian, batch, assignment] =
      await Promise.all([
        prisma.teacherCategory.count(),
        prisma.role.count(),
        prisma.user.count(),
        prisma.specialRestriction.count(),
        prisma.systemSetting.count(),
        prisma.teacher.count(),
        prisma.teacherSchedule.count(),
        prisma.classSchedule.count(),
        prisma.reliefExclusion.count(),
        prisma.reliefBatch.count(),
        prisma.reliefAssignment.count(),
      ]);
    res.json({
      status: 'ok',
      fasa: 'Fasa 9 — telegram automatik',
      seed: { kategori, peranan, pengguna, sekatan, tetapan },
      data: { guru, jadual, jadualKelas, pengecualian },
      relief: { batch, assignment },
    });
  } catch (err) {
    res.status(500).json({ status: 'error', mesej: err.message });
  }
});

app.get('/', (req, res) =>
  res.json({
    servis: 'relief-backend',
    fasa: 9,
    lihat: [
      '/health',
      '/api/v1/status',
      '/api/auth/login',
      '/api/sync/run',
      '/api/absence/public/options',
      '/api/admin/absence',
      '/api/special-restrictions',
      '/api/relief/generate',
      '/api/relief/:tarikh',
      '/api/relief/:tarikh/confirm-all',
      '/api/relief/assignment/:id/confirm',
      '/api/relief/assignment/:id/cancel',
      '/api/relief/assignment/:id/teacher',
      '/api/telegram/snapshot/preview',
      '/api/telegram/snapshot/send',
      '/api/telegram/cron/snapshot',
    ],
  })
);

const PORT = process.env.BACKEND_PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 relief-backend berjalan di port ${PORT}`);
  startScheduler(); // Fasa 9 — snapshot pagi 5:30 KL (kawal: ENABLE_SCHEDULER)
});
