import { el, clear, fmtShort, fmtRange, fmtAway, accentStyle, expectedName, commonStem, modelToken } from '../ui.js';
import { predictFamily, toDate, diffDays, addDays } from '../engine.js';
import { openFamily } from './drawer.js';

const LABEL_W = 190;
const ROW_H = 46;
const START = '2020-01-01';

export function renderTimeline(root, state) {
  clear(root);

  // Her şerit bir LANSMAN HATTI: birlikte çıkan aileler tek şeritte toplanır,
  // aynı gün çıkan modeller tek kapsül olur.
  const lanes = [];
  for (const group of state.groups) {
    const members = group.members.filter((f) => state.matches(f));
    if (!members.length) continue;
    const devices = members.flatMap((f) => state.ctx.byFamily.get(f.id) || []);
    if (!devices.length) continue;

    const preds = members
      .filter((f) => f.active)
      .map((f) => predictFamily(f.id, state.ctx, { asOf: state.asOf }))
      .filter(Boolean);
    const anchor = preds.slice().sort((a, b) => b.confidence - a.confidence || b.cadence.n - a.cadence.n)[0] || null;

    // Aynı tarihte çıkan modelleri tek kapsülde birleştir.
    const byDate = new Map();
    for (const d of devices) {
      if (!byDate.has(d.released)) byDate.set(d.released, []);
      byDate.get(d.released).push(d);
    }

    lanes.push({
      id: group.id,
      category: members[0].category,
      // Grup adı tam etiketlerden türetilir: kısaltmalarda ortak gövde kalmaz
      // (["Series","Ultra","SE"] → hiçbir şey; ["Apple Watch Series", …] → "Apple Watch").
      label: members.length > 1
        ? commonStem(members.map((f) => f.label))
        : (members[0].short || members[0].label),
      fullLabel: members.map((f) => f.label).join(' + '),
      anchorFamilyId: (anchor ?? preds[0])?.familyId ?? members[0].id,
      events: [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, list]) => ({ date, list })),
      pred: anchor,
      predName: anchor ? expectedName(anchor.family, state.ctx.byFamily.get(anchor.familyId) || [], anchor) : null,
      order: members[0].order,
    });
  }

  if (!lanes.length) {
    root.append(el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek ürün yok.'));
    return;
  }

  // Yatay ölçek: en geç tahmin + tampon
  const start = toDate(START);
  let end = addDays(state.asOf, 400);
  for (const l of lanes) if (l.pred && l.pred.high > end) end = l.pred.high;
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
  for (const lane of lanes) {
    const row = el('div', { class: 'tl__row', style: accentStyle(state.categories, lane.category) });
    const open = () => openFamily(lane.anchorFamilyId, state);

    row.append(el('div', { class: 'tl__label' },
      el('i', {}), el('span', { title: lane.fullLabel }, lane.label)));

    for (const ev of lane.events) {
      const skip = ev.list.every((d) => d.cadenceSkip);
      const pip = el('button', {
        class: `tl__pip${skip ? ' tl__pip--skip' : ''}`,
        style: { left: `${x(ev.date)}px` },
        'aria-label': `${ev.list.map((d) => d.name).join(', ')}, ${fmtShort(ev.date)}`,
        onClick: open,
      }, pxPerDay > 0.33 ? eventLabel(ev, lane.category) : '');
      attachTip(pip, () => tipForEvent(ev, lane));
      row.append(pip);
    }

    if (lane.pred) {
      const p = lane.pred;
      const bl = x(p.low), bw = Math.max(6, x(p.high) - bl);
      row.append(el('div', { class: 'tl__band', style: { left: `${bl}px`, width: `${bw}px` } }));
      // Model numarası yalnızca iPhone/Watch'ta anlamlı; Mac ve iPad adlarındaki sayı
      // ekran boyutudur ("MacBook Pro 14\"") — oralarda çip nesli gösterilir.
      const byModel = lane.category === 'iphone' || lane.category === 'watch';
      const label =
        (byModel ? modelToken(lane.predName ?? '') : null) ??
        p.chip?.genKey ??
        nextChipLabel(state.ctx.byFamily.get(p.familyId) || [], state.ctx);
      const chip = el('button', {
        class: `tl__pred${p.overdue ? ' tl__pred--overdue' : ''}`,
        style: { left: `${x(p.date)}px`, transform: 'translate(-50%, -50%)', padding: '0 7px' },
        'aria-label': `${lane.predName} tahmini: ${fmtShort(p.date)}`,
        onClick: open,
      }, pxPerDay > 0.33 ? label : '');
      attachTip(chip, () => tipForPrediction(lane));
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

/** Kapsül etiketi: iPhone'da model numarası (17), diğerlerinde çip kısaltması. */
function eventLabel(ev, category) {
  if (category === 'iphone') {
    const token = modelToken(commonStem(ev.list.map((d) => d.name)));
    if (token) return token;
  }
  return shortChip(ev.list[0].chip);
}

function tipForEvent(ev, lane) {
  const idx = lane.events.indexOf(ev);
  const prev = lane.events.slice(0, idx).filter((e) => !e.list.every((d) => d.cadenceSkip)).pop();
  const gap = prev ? diffDays(toDate(ev.date), toDate(prev.date)) : null;
  const lead = diffDays(toDate(ev.date), toDate(ev.list[0].announced));
  const chips = [...new Set(ev.list.map((d) => d.chip))];
  return [
    el('strong', {}, ev.list.map((d) => d.name).join(', ')),
    el('div', {}, `Satış: ${fmtShort(ev.date)}`),
    el('div', {}, `Duyuru: ${fmtShort(ev.list[0].announced)}${lead ? ` (${lead} gün önce)` : ' (aynı gün)'}`),
    el('div', {}, `Çip: ${chips.join(' / ')}`),
    gap ? el('div', {}, `Önceki nesilden ${gap} gün sonra`) : null,
    ev.list.every((d) => d.cadenceSkip) ? el('div', { class: 'faint' }, 'Kadans hesabına dahil değil') : null,
  ].filter(Boolean);
}

function tipForPrediction(lane) {
  const p = lane.pred;
  return [
    el('strong', {}, `${lane.predName} — tahmin`),
    el('div', {}, fmtShort(p.date)),
    el('div', {}, `Pencere: ${fmtRange(p.low, p.high)}`),
    el('div', {}, `Güven: ${p.band.label} (%${p.confidence})`),
    el('div', {}, p.overdue ? `Pencere ${Math.abs(p.daysAway)} gün önce kapandı` : fmtAway(p.daysAway)),
    p.chip ? el('div', {}, `${p.chip.genKey}${p.chip.projected ? ' (öngörülen)' : ''} · +${p.chip.medianLag}g`) : null,
  ].filter(Boolean);
}
