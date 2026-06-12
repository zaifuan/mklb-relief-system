// ════════════════════════════════════════════════════════════
//  Ujian GOLDEN — utiliti masa (kuirk 12-jam sekolah Malaysia).
//  Jalankan: npm test   (node --test)
//  Nilai ini mesti KEKAL identik dengan sistem GAS asal.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  masaKeMinit,
  parseMasa,
  parseKelas,
  formatMasaDisplay,
  masaBertindih,
} from '../lib/timeUtil.js';

test('masaKeMinit — pagi/tengahari kekal', () => {
  assert.equal(masaKeMinit('7.40'), 460);
  assert.equal(masaKeMinit('8.10'), 490);
  assert.equal(masaKeMinit('9.10'), 550);
  assert.equal(masaKeMinit('12.00'), 720);
  assert.equal(masaKeMinit('12.30'), 750);
  assert.equal(masaKeMinit('7.00'), 420);
  assert.equal(masaKeMinit('12'), 720);
});

test('masaKeMinit — jam 1-6 dianggap PETANG (+12)', () => {
  assert.equal(masaKeMinit('1.00'), 780); // 1 petang
  assert.equal(masaKeMinit('1.30'), 810);
  assert.equal(masaKeMinit('2.00'), 840);
  assert.equal(masaKeMinit('6.00'), 1080);
  assert.equal(masaKeMinit('6.59'), 1139);
});

test('masaKeMinit — input tidak sah → null (bukan 0)', () => {
  assert.equal(masaKeMinit(''), null);
  assert.equal(masaKeMinit(null), null);
  assert.equal(masaKeMinit('abc'), null);
  assert.equal(masaKeMinit('9.1.0'), null);
});

test('parseMasa — julat biasa', () => {
  assert.deepEqual(parseMasa('9.10-10.10'), [550, 610]);
  assert.deepEqual(parseMasa('7.40-8.10'), [460, 490]);
  assert.deepEqual(parseMasa('1.00-2.00'), [780, 840]);
});

test('parseMasa — merentas pagi→petang & en/em dash', () => {
  assert.deepEqual(parseMasa('12.30-1.00'), [750, 780]);
  assert.deepEqual(parseMasa('12.30–1.00'), [750, 780]); // en dash
  assert.deepEqual(parseMasa('12.30—1.00'), [750, 780]); // em dash
});

test('parseMasa — tidak sah → [null, null]', () => {
  assert.deepEqual(parseMasa('bad'), [null, null]);
  assert.deepEqual(parseMasa(''), [null, null]);
  assert.deepEqual(parseMasa('9.10'), [null, null]); // tiada dash
});

test('parseKelas — SEMUA / kosong → []', () => {
  assert.deepEqual(parseKelas('SEMUA'), []);
  assert.deepEqual(parseKelas(''), []);
  assert.deepEqual(parseKelas(null), []);
});

test('parseKelas — senarai kelas + masa', () => {
  assert.deepEqual(parseKelas('4A (9.10-10.10)'), [{ kelas: '4A', masa: '9.10-10.10' }]);
  assert.deepEqual(parseKelas('4A (9.10-10.10), 4B (11.00-12.00)'), [
    { kelas: '4A', masa: '9.10-10.10' },
    { kelas: '4B', masa: '11.00-12.00' },
  ]);
});

test('formatMasaDisplay — AM/PM betul', () => {
  assert.equal(formatMasaDisplay('9.40'), '9:40 AM');
  assert.equal(formatMasaDisplay('7.00'), '7:00 AM');
  assert.equal(formatMasaDisplay('12.30'), '12:30 PM');
  assert.equal(formatMasaDisplay('1.00'), '1:00 PM');
  assert.equal(formatMasaDisplay('6.30'), '6:30 PM');
});

test('masaBertindih — pertindihan & sempadan', () => {
  assert.equal(masaBertindih(460, 490, 470, 500), true); // bertindih
  assert.equal(masaBertindih(460, 490, 490, 520), false); // bersentuh, bukan tindih
  assert.equal(masaBertindih(490, 520, 460, 490), false);
  assert.equal(masaBertindih(null, 490, 470, 500), false); // null-safe
});
