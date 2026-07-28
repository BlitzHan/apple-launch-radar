#!/usr/bin/env node
// Veri bütünlük kontrolü. Bağımlılık yok: `node scripts/validate-data.mjs`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const { devices } = load('devices.json');
const { chips } = load('chips.json');
const { families, categories } = load('families.json');

const chipIds = new Set(chips.map((c) => c.id));
const familyIds = new Set(families.map((f) => f.id));
const categoryIds = new Set(categories.map((c) => c.id));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (s) => ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

// --- families ---
for (const f of families) {
  if (!categoryIds.has(f.category)) err(`families: "${f.id}" bilinmeyen kategori "${f.category}"`);
}

// --- chips ---
const seenChips = new Set();
for (const c of chips) {
  if (seenChips.has(c.id)) err(`chips: yinelenen id "${c.id}"`);
  seenChips.add(c.id);
  if (!isValidDate(c.debut)) err(`chips: "${c.id}" geçersiz debut "${c.debut}"`);
  if (c.debutFamily && !familyIds.has(c.debutFamily)) {
    err(`chips: "${c.id}" bilinmeyen debutFamily "${c.debutFamily}"`);
  }
}

// --- devices ---
const seenDevices = new Set();
for (const d of devices) {
  const at = `devices: "${d.id}"`;
  if (seenDevices.has(d.id)) err(`${at} yinelenen id`);
  seenDevices.add(d.id);

  for (const field of ['family', 'category', 'name', 'chip', 'announced', 'released']) {
    if (!d[field]) err(`${at} zorunlu alan eksik: ${field}`);
  }
  if (!familyIds.has(d.family)) err(`${at} bilinmeyen aile "${d.family}"`);
  if (!categoryIds.has(d.category)) err(`${at} bilinmeyen kategori "${d.category}"`);
  if (!chipIds.has(d.chip)) err(`${at} bilinmeyen çip "${d.chip}"`);

  if (!isValidDate(d.announced)) err(`${at} geçersiz announced "${d.announced}"`);
  if (!isValidDate(d.released)) err(`${at} geçersiz released "${d.released}"`);
  if (isValidDate(d.announced) && isValidDate(d.released) && d.released < d.announced) {
    err(`${at} released (${d.released}) < announced (${d.announced})`);
  }
  if (d.released < '2020-01-01') err(`${at} kapsam dışı tarih (${d.released}) — proje 2020'den başlıyor`);

  const fam = families.find((f) => f.id === d.family);
  if (fam && fam.category !== d.category) {
    err(`${at} kategori (${d.category}) ile ailenin kategorisi (${fam.category}) uyuşmuyor`);
  }
  if (!['keynote', 'press-release', 'wwdc'].includes(d.channel)) {
    err(`${at} geçersiz channel "${d.channel}"`);
  }
  if (!['verified', 'approx'].includes(d.dataQuality)) {
    err(`${at} geçersiz dataQuality "${d.dataQuality}"`);
  }

  // Cihaz, çipinin debut'undan önce satışa çıkamaz (aynı gün olabilir).
  const chip = chips.find((c) => c.id === d.chip);
  if (chip && d.released < chip.debut) {
    err(`${at} ${d.released} tarihinde çıkmış ama çipi "${d.chip}" ${chip.debut} tarihinde debut etmiş`);
  }
}

// --- çip debut tutarlılığı: debut, o çipi taşıyan en erken cihazla eşleşmeli ---
for (const c of chips) {
  const carriers = devices.filter((d) => d.chip === c.id);
  if (!carriers.length) continue;
  const earliest = carriers.reduce((a, b) => (a.released <= b.released ? a : b));
  if (earliest.released !== c.debut) {
    warn(`chips: "${c.id}" debut=${c.debut} ama veri setindeki en erken taşıyıcı ${earliest.id} (${earliest.released}) — çip 2020 öncesi çıkmışsa normal`);
  }
}

// --- aile bazlı kronoloji ve kadans özeti ---
const byFamily = new Map();
for (const d of devices) {
  if (!byFamily.has(d.family)) byFamily.set(d.family, []);
  byFamily.get(d.family).push(d);
}
for (const [famId, list] of byFamily) {
  list.sort((a, b) => a.released.localeCompare(b.released));
  const cadence = list.filter((d) => !d.cadenceSkip);
  if (cadence.length < 2) {
    warn(`aile "${famId}": kadans için yetersiz veri (${cadence.length} nesil) — tahmin geri düşüşe (fallback) girecek`);
  }
}
for (const f of families) {
  if (!byFamily.has(f.id)) warn(`aile "${f.id}" tanımlı ama hiç cihazı yok`);
}

// --- rapor ---
console.log(`\nCihaz: ${devices.length}  ·  Çip: ${chips.length}  ·  Aile: ${families.length}\n`);
for (const w of warnings) console.log(`  UYARI  ${w}`);
if (warnings.length) console.log('');
for (const e of errors) console.log(`  HATA   ${e}`);

if (errors.length) {
  console.log(`\n✗ ${errors.length} hata bulundu.\n`);
  process.exit(1);
}
console.log(`✓ Veri tutarlı${warnings.length ? ` (${warnings.length} uyarı)` : ''}.\n`);
