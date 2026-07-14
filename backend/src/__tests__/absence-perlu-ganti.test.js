// ════════════════════════════════════════════════════════════
//  Ujian UNIT — resolveWantSwaps() (lib/absenceRules.js).
//  Tulen, tiada pangkalan data. Ini ialah SATU-SATUNYA gerbang yang
//  membenarkan/menolak Suka Sama Suka berdasarkan perluGanti — jika ujian
//  ini lulus, backend TERJAMIN tidak mencipta ClassSwap bila perluGanti=false,
//  tidak kira apa dihantar frontend.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWantSwaps } from '../lib/absenceRules.js';

test('resolveWantSwaps — perluGanti=true, individu, ada pertukaran → true (flow lama kekal)', () => {
  assert.equal(resolveWantSwaps({ pertukaranLength: 2, jumlahGuru: 1, perluGanti: true }), true);
});

test('resolveWantSwaps — perluGanti=false → SENTIASA false walau pertukaran dihantar & individu (paksaan payload)', () => {
  assert.equal(resolveWantSwaps({ pertukaranLength: 3, jumlahGuru: 1, perluGanti: false }), false);
  assert.equal(resolveWantSwaps({ pertukaranLength: 99, jumlahGuru: 1, perluGanti: false }), false);
});

test('resolveWantSwaps — perluGanti=true tapi kumpulan (jumlahGuru>1) → false (had sedia ada dikekalkan)', () => {
  assert.equal(resolveWantSwaps({ pertukaranLength: 2, jumlahGuru: 2, perluGanti: true }), false);
  assert.equal(resolveWantSwaps({ pertukaranLength: 5, jumlahGuru: 5, perluGanti: true }), false);
});

test('resolveWantSwaps — perluGanti=true, individu, TIADA pertukaran → false', () => {
  assert.equal(resolveWantSwaps({ pertukaranLength: 0, jumlahGuru: 1, perluGanti: true }), false);
});

test('resolveWantSwaps — perluGanti=false DAN kumpulan serentak → false (kedua-dua sekatan berlaku)', () => {
  assert.equal(resolveWantSwaps({ pertukaranLength: 5, jumlahGuru: 3, perluGanti: false }), false);
});

test('resolveWantSwaps — perluGanti bukan strictly true (undefined/1/"true") → false (elak type coercion tak sengaja)', () => {
  assert.equal(resolveWantSwaps({ pertukaranLength: 2, jumlahGuru: 1, perluGanti: undefined }), false);
  assert.equal(resolveWantSwaps({ pertukaranLength: 2, jumlahGuru: 1, perluGanti: 1 }), false);
  assert.equal(resolveWantSwaps({ pertukaranLength: 2, jumlahGuru: 1, perluGanti: 'true' }), false);
});
