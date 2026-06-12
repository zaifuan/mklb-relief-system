// ════════════════════════════════════════════════════════════
//  syncAudit — pengurusan rekod jadual sync_logs (Fasa 1)
// ════════════════════════════════════════════════════════════

import prisma from './prisma.js';

export function startSync() {
  return prisma.syncLog.create({ data: { status: 'RUNNING' } });
}

export function finishSyncOk(id, stats) {
  return prisma.syncLog.update({
    where: { id },
    data: { status: 'OK', finishedAt: new Date(), recordsSynced: stats },
  });
}

export function finishSyncFail(id, errorMsg) {
  return prisma.syncLog.update({
    where: { id },
    data: { status: 'FAIL', finishedAt: new Date(), error: String(errorMsg).slice(0, 1000) },
  });
}

export function findRunningSync() {
  return prisma.syncLog.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' } });
}

export function latestSync() {
  return prisma.syncLog.findFirst({ orderBy: { startedAt: 'desc' } });
}
