/** Ortak biçimlendirme ve DOM yardımcıları. */

export const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const TR_MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const asDate = (d) => (d instanceof Date ? d : new Date(d + 'T00:00:00Z'));

export const fmtShort = (d) => {
  const x = asDate(d);
  return `${x.getUTCDate()} ${TR_MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};
export const fmtLong = (d) => {
  const x = asDate(d);
  return `${x.getUTCDate()} ${TR_MONTHS_LONG[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};
export const fmtMonth = (d) => {
  const x = asDate(d);
  return `${TR_MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
};

/** İki tarihi kısa bir aralık olarak yazar: "4 – 22 Eyl 2026" */
export function fmtRange(a, b) {
  const x = asDate(a), y = asDate(b);
  if (x.getUTCFullYear() === y.getUTCFullYear()) {
    if (x.getUTCMonth() === y.getUTCMonth()) {
      return `${x.getUTCDate()}–${y.getUTCDate()} ${TR_MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
    }
    return `${x.getUTCDate()} ${TR_MONTHS[x.getUTCMonth()]} – ${y.getUTCDate()} ${TR_MONTHS[y.getUTCMonth()]} ${x.getUTCFullYear()}`;
  }
  return `${fmtShort(x)} – ${fmtShort(y)}`;
}

/** "3 ay 12 gün sonra" / "47 gün önce" */
export function fmtAway(days) {
  const n = Math.abs(days);
  const suffix = days < 0 ? 'önce' : 'sonra';
  if (n < 45) return `${n} gün ${suffix}`;
  const months = Math.round(n / 30.44);
  if (months < 24) return `~${months} ay ${suffix}`;
  return `~${(n / 365.25).toFixed(1).replace('.', ',')} yıl ${suffix}`;
}

export const plural = (n, word) => `${n} ${word}`;

/* ------------------------------------------------------- isimlendirme */

/**
 * Bir sonraki sürümün beklenen adı.
 * iPhone ve Watch pazarlamada model numarasıyla anılır (iPhone 17 → iPhone 18),
 * Mac ve iPad ise çip nesliyle (MacBook Air (M6)). Bu ayrımı isimlendirme de izler.
 */
export function expectedName(family, devices, pred) {
  const last = devices[devices.length - 1];
  if (!last) return family.label;
  if (family.category === 'iphone' || family.category === 'watch') return bumpName(last.name);

  const gen = pred?.chip?.genKey;
  // Çip tahmini yoksa (tek nesilli ürün, ya da A-serisi gibi modellenmemiş hat)
  // aile adını olduğu gibi yazmak yanıltıcı: "iPad (standart)" sıradaki modelin adı değil.
  if (!gen) return `Yeni nesil ${family.label.replace(/\s*\((?:standart|baz[^)]*)\)/i, '').trim()}`;

  // Aile adındaki sondaki parantez ya kademe bilgisidir (Pro/Max — korunur) ya da
  // eskimiş çip bilgisidir (baz M — atılır), sonuna yeni çip nesli yazılır.
  const m = family.label.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  let base = family.label, tier = '';
  if (m) {
    base = m[1];
    if (/pro|max|ultra/i.test(m[2]) && !/baz/i.test(m[2])) tier = ` ${m[2]}`;
  }
  return `${base} (${gen}${tier})`;
}

/** "iPhone 17 Pro" → "iPhone 18 Pro" · "Apple Watch SE (3. nesil)" → "(4. nesil)" */
function bumpName(name) {
  const m = name.match(/\d+/);
  if (!m) return `${name} (2. nesil)`;
  return name.slice(0, m.index) + (Number(m[0]) + 1) + name.slice(m.index + m[0].length);
}

/**
 * Bir grup adın ortak gövdesi: kelime kelime, adların yarısından fazlasında
 * aynı olan en uzun ön ek. ["iPhone 18","iPhone 18 Pro","iPhone Air 2"] → "iPhone 18".
 */
export function commonStem(names) {
  if (names.length === 1) return names[0];
  const words = names.map((n) => n.split(' '));
  const stem = [];
  for (let i = 0; ; i++) {
    const counts = new Map();
    for (const w of words) if (i < w.length) counts.set(w[i], (counts.get(w[i]) || 0) + 1);
    if (!counts.size) break;
    const [word, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (count <= names.length / 2) break;
    stem.push(word);
  }
  return stem.join(' ') || names[0];
}

/** Zaman çizelgesi kapsülü için kısa etiket: "iPhone 17 Pro" → "17", "iPhone 17e" → "17e" */
export function modelToken(name) {
  return name.split(' ').find((w) => /^\d/.test(w)) || null;
}

/* ------------------------------------------------------------- DOM */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => { node.replaceChildren(); return node; };

export function badge(text, variant = 'quiet') {
  return el('span', { class: `badge badge--${variant}` }, text);
}

export function confidenceBadge(pred) {
  if (pred.overdue) return badge('Gecikmiş', 'overdue');
  return badge(`${pred.band.label} · %${pred.confidence}`, pred.band.id);
}

export function stat(label, value, sub) {
  return el('div', { class: 'card stat' },
    el('div', { class: 'stat__k' }, label),
    el('div', { class: 'stat__v' }, value),
    sub ? el('div', { class: 'stat__s' }, sub) : null
  );
}

/** Kategori renklerini CSS değişkeni olarak taşır. */
export function accentStyle(categories, categoryId) {
  const c = categories.find((x) => x.id === categoryId);
  return c ? `--accent:${c.color}` : '';
}
