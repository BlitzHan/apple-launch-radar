#!/usr/bin/env node
// Backtest ile parametre araması: `node scripts/calibrate.mjs`
// Her aile için son sürüm gizlenir, öncekilerle tahmin edilir, hata ölçülür.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { backtest, DEFAULTS } from '../assets/js/engine.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const data = {
  devices: load('devices.json').devices,
  chips: load('chips.json').chips,
  families: load('families.json').families,
};

const grid = [];
for (const lambda of [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9, 1.0]) {
  for (const chipLambda of [0.5, 0.65, 0.8, 1.0]) {
    for (const snapFloor of [0.4, 0.55, 0.7]) {
      for (const trend of [0, 0.25, 0.5, 0.75, 1.0]) {
        grid.push({ ...DEFAULTS, lambda, chipLambda, snapFloor, trend });
      }
    }
  }
}

const results = grid
  .map((opt) => ({ opt, r: backtest(data, opt) }))
  .filter(({ r }) => r.n > 0)
  // Öncelik ortanca hata (aykırı aileler MAE'yi domine ediyor); eşitlikte ±30 gün isabeti, sonra MAE.
  .sort((a, b) => a.r.medianError - b.r.medianError || b.r.hit30 - a.r.hit30 || a.r.mae - b.r.mae);

const best = results[0];

// bandK'yı ampirik seç: bantın gerçekten ~%75 kapsaması için gereken en küçük çarpan.
let bandK = DEFAULTS.bandK;
for (const k of [1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0]) {
  bandK = k;
  if (backtest(data, { ...best.opt, bandK: k }).bandCoverage >= 0.75) break;
}
best.opt.bandK = bandK;
best.r = backtest(data, best.opt);

const current = backtest(data, DEFAULTS);

const pct = (x) => `%${(x * 100).toFixed(0)}`;
const line = (tag, o, r) =>
  `${tag.padEnd(10)} λ=${o.lambda} çipλ=${o.chipLambda} snap=${o.snapFloor} trend=${o.trend} k=${o.bandK}  →  ortanca ${r.medianError}g  MAE ${r.mae.toFixed(0)}g  ±30g ${pct(r.hit30)}  ±60g ${pct(r.hit60)}  bant ${pct(r.bandCoverage)}  sapma ${r.bias > 0 ? '+' : ''}${r.bias.toFixed(0)}g`;

console.log(`\n${best.r.n} aile üzerinde ${grid.length} parametre kombinasyonu denendi.\n`);
console.log(line('MEVCUT', DEFAULTS, current));
console.log(line('EN İYİ', best.opt, best.r));
console.log('\nEn iyi 5:');
for (const { opt, r } of results.slice(0, 5)) console.log('  ' + line('', opt, r).trim());

console.log(`\nAile bazlı hata (en iyi parametrelerle):\n`);
console.log('  ' + 'Aile'.padEnd(30) + 'Gerçek'.padEnd(13) + 'Tahmin'.padEnd(13) + 'Hata'.padEnd(9) + 'Güven');
for (const r of best.r.rows) {
  const e = `${r.errorDays > 0 ? '+' : ''}${r.errorDays}g`;
  console.log(
    '  ' + r.label.padEnd(30) + r.actual.padEnd(13) + r.predicted.padEnd(13) + e.padEnd(9) + `%${r.confidence}` + (r.inBand ? '  ✓bant' : '')
  );
}
console.log('');
