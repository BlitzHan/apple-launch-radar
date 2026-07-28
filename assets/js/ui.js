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
