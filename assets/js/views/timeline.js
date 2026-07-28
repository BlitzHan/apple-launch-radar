import { el, clear, fmtShort, fmtRange, fmtAway, accentStyle } from '../ui.js';
import { predictFamily, toDate, toISO, diffDays, addDays } from '../engine.js';
import { openFamily } from './drawer.js';

const LABEL_W = 190;
const ROW_H = 46;
const START = '2020-01-01';

export function renderTimeline(root, state) {
  clear(root);

  const families = state.ctx.families.filter((f) => state.matches(f) && (state.ctx.byFamily.get(f.id) || []).length);
  if (!families.length) {
    root.append(el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek ürün yok.'));
    return;
  }

  const preds = new Map();
  for (const f of families) {
    const p = predictFamily(f.id, state.ctx, { asOf: state.asOf });
    if (p && f.active) preds.set(f.id, p);
  }

  // Yatay ölçek: en geç tahmin + tampon
  const start = toDate(START);
  let end = addDays(state.asOf, 400);
  for (const p of preds.values()) if (p.high > end) end = p.high;
  end = addDays(end, 45);

  const totalDays = diffDays(end, start);
  const pxPerDay = state.zoom;
  const width = LABEL_W + totalDays * pxPerDay;
  const x = (d) => LABEL_W + diffDays(d instanceof Date ? d : toDate(d), start) * pxPerDay;

  root.append(
    el('div', { class: 'tl-toolbar' },
      el('div', { class: 'chipset' },
        el('button', { class: 'chip chip--sm', onClick: () => setZoom(state, state.zoom / 1.4) }, '−'),
        el('button', { class: 'chip chip--sm', onClick: () => setZoom(state, 0.42) }, 'Sığdır'),
        el('button', { class: 'chip chip--sm', onClick: () => setZoom(state, state.zoom * 1.4) }, '+')
      ),
      el('div', { class: 'tl-legend' },
        el('span', {}, el('i', {}), 'çıkmış sürüm'),
        el('span', {}, el('i', { class: 'is-pred' }), 'tahmin'),
        el('span', {}, el('i', { class: 'is-band' }), 'güven aralığı')
      )
    )
  );

  const inner = el('div', { class: 'tl__inner', style: { width: `${width}px` } });
  const scroller = el('div', { class: 'tl', id: 'tl-scroll' }, inner);

  /* --- eksen --- */
  const axis = el('div', { class: 'tl__axis' });
  const grid = el('div', { class: 'tl__grid' });
  const y0 = start.getUTCFullYear(), y1 = end.getUTCFullYear();
  for (let y = y0; y <= y1; y++) {
    const left = x(new Date(Date.UTC(y, 0, 1)));
    if (left < LABEL_W) continue;
    axis.append(el('div', { class: 'tl__year', style: { left: `${left}px` } }, String(y)));
    grid.append(el('div', { class: 'tl__gridline tl__gridline--year', style: { left: `${left}px` } }));
    for (const m of [3, 6, 9]) {
      const ql = x(new Date(Date.UTC(y, m, 1)));
      if (ql < LABEL_W || ql > width) continue;
      if (pxPerDay > 0.3) axis.append(el('div', { class: 'tl__q', style: { left: `${ql}px` } }, `Ç${m / 3 + 1}`));
      grid.append(el('div', { class: 'tl__gridline', style: { left: `${ql}px` } }));
    }
  }
  inner.append(axis);

  /* --- satırlar --- */
  const rows = el('div', { class: 'tl__rows' }, grid);
  for (const f of families) {
    const devices = state.ctx.byFamily.get(f.id) || [];
    const pred = preds.get(f.id);
    const row = el('div', { class: 'tl__row', style: accentStyle(state.categories, f.category) });

    row.append(el('div', { class: 'tl__label' },
      el('i', {}), el('span', { title: f.label }, f.short || f.label)));

    for (const d of devices) {
      const left = x(d.released);
      const pip = el('button', {
        class: `tl__pip${d.cadenceSkip ? ' tl__pip--skip' : ''}`,
        style: { left: `${left}px` },
        'aria-label': `${d.name}, ${fmtShort(d.released)}`,
        onClick: () => openFamily(f.id, state),
      }, pxPerDay > 0.33 ? shortChip(d.chip) : '');
      attachTip(pip, () => tipForDevice(d, devices));
      row.append(pip);
    }

    if (pred) {
      const bl = x(pred.low), bw = Math.max(6, x(pred.high) - bl);
      row.append(el('div', { class: 'tl__band', style: { left: `${bl}px`, width: `${bw}px` } }));
      const pl = x(pred.date);
      const label = pred.chip?.genKey ?? nextChipLabel(devices, state.ctx);
      const chip = el('button', {
        class: `tl__pred${pred.overdue ? ' tl__pred--overdue' : ''}`,
        style: { left: `${pl}px`, transform: 'translate(-50%, -50%)', padding: '0 7px' },
        'aria-label': `${f.label} tahmini: ${fmtShort(pred.date)}`,
        onClick: () => openFamily(f.id, state),
      }, pxPerDay > 0.33 ? label : '');
      attachTip(chip, () => tipForPrediction(f, pred));
      row.append(chip);
    }

    rows.append(row);
  }

  /* --- bugün çizgisi --- */
  rows.append(el('div', { class: 'tl__now', style: { left: `${x(state.asOf)}px` } }));
  inner.append(rows);
  root.append(scroller);

  // Açılışta bugünü görünür kıl.
  requestAnimationFrame(() => {
    scroller.scrollLeft = Math.max(0, x(state.asOf) - scroller.clientWidth * 0.62);
  });
}

function setZoom(state, z) {
  state.zoom = Math.min(2.2, Math.max(0.14, z));
  state.render();
}

/**
 * Çip yayılım modeli çalışmayan ailelerde (iPhone, Watch) tahmin kapsülünün etiketi:
 * son kullanılan çipin bir sonraki nesli.
 */
function nextChipLabel(devices, ctx) {
  const last = devices[devices.length - 1];
  const chip = last && ctx.chipById.get(last.chip);
  return chip ? `${chip.series}${chip.gen + 1}` : '—';
}

/** "M5 Pro" → "M5P", "A19 Pro" → "A19P" — dar kapsüle sığsın diye. */
function shortChip(chip) {
  return chip
    .replace(' Bionic', '')
    .replace(' Pro', 'P')
    .replace(' Max', 'X')
    .replace(' Ultra', 'U');
}

/* ------------------------------------------------------------- tooltip */

function attachTip(node, build) {
  const tip = document.getElementById('tip');
  const show = (e) => {
    tip.replaceChildren(...build());
    tip.hidden = false;
    place(e);
  };
  const place = (e) => {
    const r = tip.getBoundingClientRect();
    const px = (e.clientX ?? 0), py = (e.clientY ?? 0);
    tip.style.left = `${Math.min(window.innerWidth - r.width - 10, Math.max(8, px + 14))}px`;
    tip.style.top = `${py - r.height - 12 < 8 ? py + 18 : py - r.height - 12}px`;
  };
  node.addEventListener('mouseenter', show);
  node.addEventListener('mousemove', place);
  node.addEventListener('mouseleave', () => { tip.hidden = true; });
  node.addEventListener('focus', () => { tip.hidden = true; });
}

function tipForDevice(d, all) {
  const idx = all.indexOf(d);
  const prev = all.slice(0, idx).filter((p) => !p.cadenceSkip).pop();
  const gap = prev ? diffDays(toDate(d.released), toDate(prev.released)) : null;
  const lead = diffDays(toDate(d.released), toDate(d.announced));
  return [
    el('strong', {}, d.name),
    el('div', {}, `Satış: ${fmtShort(d.released)}`),
    el('div', {}, `Duyuru: ${fmtShort(d.announced)}${lead ? ` (${lead} gün önce)` : ' (aynı gün)'}`),
    el('div', {}, `Çip: ${d.chip}`),
    gap ? el('div', {}, `Önceki nesilden ${gap} gün sonra`) : null,
    d.cadenceSkip ? el('div', { class: 'faint' }, 'Kadans hesabına dahil değil') : null,
  ].filter(Boolean);
}

function tipForPrediction(family, pred) {
  return [
    el('strong', {}, `${family.label} — tahmin`),
    el('div', {}, fmtShort(pred.date)),
    el('div', {}, `Pencere: ${fmtRange(pred.low, pred.high)}`),
    el('div', {}, `Güven: ${pred.band.label} (%${pred.confidence})`),
    el('div', {}, pred.overdue ? `Pencere ${Math.abs(pred.daysAway)} gün önce kapandı` : fmtAway(pred.daysAway)),
    pred.chip ? el('div', {}, `${pred.chip.genKey}${pred.chip.projected ? ' (öngörülen)' : ''} · +${pred.chip.medianLag}g`) : null,
  ].filter(Boolean);
}
