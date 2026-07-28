import { el, clear, stat, badge, confidenceBadge, fmtLong, fmtRange, fmtAway, fmtShort, accentStyle, expectedName, commonStem } from '../ui.js';
import { predictFamily, diffDays, toDate, toISO } from '../engine.js';
import { openLaunch, openFamily } from './drawer.js';

/**
 * Radar, ürün ailesi değil LANSMAN OLAYI listeler. Aynı gün çıkan aileler
 * (iPhone 18 + 18 Pro + 18 Pro Max + Air) tek kartta toplanır.
 */
export function buildLaunches(state) {
  const out = [];
  for (const group of state.groups) {
    const members = group.members.filter((f) => f.active);
    if (!members.length || !members.some((f) => state.matches(f))) continue;

    const preds = members
      .map((f) => predictFamily(f.id, state.ctx, { asOf: state.asOf }))
      .filter(Boolean);
    if (!preds.length) continue;

    // Çapa = en çok kanıtı olan üye. Aynı olayı tahmin ettikleri için güven
    // toplanmaz; en iyi geçmişe sahip üyenin güveni kullanılır.
    const anchor = preds.slice().sort(
      (a, b) => b.confidence - a.confidence || b.cadence.n - a.cadence.n
    )[0];

    const names = preds.map((p) =>
      expectedName(p.family, state.ctx.byFamily.get(p.familyId) || [], p)
    );

    out.push({
      id: group.id,
      anchor,
      preds,
      names,
      title: commonStem(names),
      category: anchor.category,
      familyIds: preds.map((p) => p.familyId),
    });
  }
  return out.sort((a, b) => a.anchor.date - b.anchor.date);
}

// Geçmiş olaylar kayıttır, dar tutulur: Apple'ın çok günlü duyuru dalgaları en fazla
// 3-4 gün sürüyor (Mart 2026: 2, 3 ve 4 Mart). 14 gün, iPhone 16e'yi (19 Şub 2025)
// ayrı bir duyuru olan Mart dalgasıyla birleştiriyordu.
const PAST_WINDOW = 7;
// Gelecek olaylar tahmindir; belirsizlik payı daha geniş bir pencereyi haklı çıkarır.
const FUTURE_WINDOW = 14;

/** Yakın tarihli öğeleri tek etkinlikte toplar (Apple bir keynote'ta çok hat tanıtır). */
function cluster(items, dateOf, windowDays) {
  const sorted = [...items].sort((a, b) => dateOf(a) - dateOf(b));
  const out = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && diffDays(dateOf(it), dateOf(last[0])) <= windowDays) last.push(it);
    else out.push([it]);
  }
  return out;
}

/**
 * Gezilebilir lansman olayları: geçmiştekiler gerçek duyuru tarihlerinden,
 * gelecektekiler tahminlerden. Tek bir kronolojik dizi halinde döner.
 */
export function buildEvents(state, launches) {
  const events = [];

  // --- geçmiş: gerçek duyuru tarihlerine göre kümelenmiş ---
  const seen = state.ctx.devices.filter((d) => {
    const fam = state.ctx.familyById.get(d.family);
    return fam && state.matches(fam) && d.announced <= toISO(state.asOf);
  });
  for (const group of cluster(seen, (d) => toDate(d.announced), PAST_WINDOW)) {
    const announce = toDate(group[0].announced);
    const sales = group.map((d) => d.released).sort();
    const sale = toDate(sales[0]);
    const saleEnd = toDate(sales[sales.length - 1]);
    events.push({
      kind: 'past',
      announce,
      sale,
      // Bir dalgadaki ürünler farklı günlerde satışa çıkabiliyor (Eyl 2020'de
      // iPad Air 4, aynı etkinlikteki diğerlerinden 35 gün sonra); aralık gösterilir.
      saleEnd: sales[0] === sales[sales.length - 1] ? null : saleEnd,
      lead: diffDays(sale, announce),
      lines: new Set(group.map((d) => d.family)).size,
      products: group
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
        .map((d) => ({
          name: d.name,
          category: d.category,
          sub: `${d.chip} · satış ${fmtShort(d.released)}`,
          familyId: d.family,
        })),
    });
  }

  // --- gelecek: tahminlerden kümelenmiş ---
  for (const group of cluster(launches.filter((l) => !l.anchor.overdue), (l) => l.anchor.date, FUTURE_WINDOW)) {
    const anchor = group
      .map((l) => l.anchor)
      .sort((a, b) => b.confidence - a.confidence || b.cadence.n - a.cadence.n)[0];
    const products = group.flatMap((l) =>
      l.preds.map((p, i) => ({
        name: l.names[i],
        category: p.category,
        sub: `son: ${p.lastRelease.name} · ${fmtShort(p.lastRelease.announced)} tanıtıldı`,
        familyId: p.familyId,
        launch: l,
        lastAnnounced: p.lastRelease.announced,
      }))
    );
    events.push({
      kind: 'future',
      announce: anchor.announce,
      sale: anchor.date,
      lead: anchor.announceLead,
      lines: group.length,
      anchor,
      products,
      lastAnnounced: [...new Set(products.map((p) => p.lastAnnounced))].sort(),
    });
  }

  return events;
}

function renderHero(events, index, state) {
  const event = events[index];
  const { kind, products, anchor } = event;
  const future = kind === 'future';
  const away = diffDays(event.announce, state.asOf);

  const nav = (delta, text, label) => el('button', {
    class: 'hero__nav',
    disabled: !events[index + delta],
    'aria-label': label,
    onClick: () => { state.eventIndex = index + delta; state.render(); },
  }, text);

  const rows = products.map((prod) =>
    el('div', { class: 'hero__prod', style: accentStyle(state.categories, prod.category) },
      el('span', { class: 'hero__prod-dot' }),
      el('span', { class: 'hero__prod-main' },
        el('span', { class: 'hero__prod-name' }, prod.name),
        el('span', { class: 'hero__prod-last' }, prod.sub)
      ),
      el('button', {
        class: 'hero__prod-link',
        onClick: () => (prod.launch ? openLaunch(prod.launch, state) : openFamily(prod.familyId, state)),
      }, future ? 'gerekçe →' : 'geçmiş →')
    )
  );

  // "Bu modeller en son ne zaman tanıtıldı?" — çoğu zaman hepsi aynı gün.
  const note = future
    ? (event.lastAnnounced.length === 1
        ? `Bu modeller en son ${fmtLong(event.lastAnnounced[0])} tarihinde, hepsi aynı etkinlikte tanıtılmıştı.`
        : `Bu modeller en son ${event.lastAnnounced.map((d) => fmtShort(d)).join(' ve ')} tarihlerinde tanıtılmıştı.`)
    : `Gerçekleşmiş lansman — bu tarihler tahmin değil, kayıt.`;

  return el('div', { class: `card hero${future ? '' : ' hero--past'}`,
      style: accentStyle(state.categories, future ? anchor.category : products[0].category) },
    el('div', { class: 'hero__grid' },
      el('div', { class: 'hero__when' },
        el('div', { class: 'hero__eyebrow' },
          el('span', { class: 'stat__k' }, future ? 'Tahmini tanıtım' : 'Gerçekleşen tanıtım'),
          el('span', { class: 'hero__steps' },
            nav(-1, '‹', 'Önceki lansman'),
            el('span', { class: 'hero__count' }, `${index + 1} / ${events.length}`),
            nav(1, '›', 'Sonraki lansman')
          )
        ),
        el('div', { class: 'hero__date' }, fmtLong(event.announce)),
        el('div', { class: 'hero__sale' },
          event.saleEnd
            ? `Satış: ${fmtRange(event.sale, event.saleEnd)} · kademeli`
            : `Satış: ${fmtLong(event.sale)}` + (event.lead ? ` · tanıtımdan ${event.lead} gün sonra` : ' · aynı gün')
        ),
        el('div', { class: 'hero__row' },
          future ? confidenceBadge(anchor) : badge('Gerçekleşti', 'quiet'),
          badge(fmtAway(away), future ? 'quiet' : 'quiet'),
          event.lines > 1 ? badge(`${event.lines} ürün hattı`, 'quiet') : null
        ),
        future
          ? el('div', { class: 'hero__window' }, `Satış penceresi: ${fmtRange(anchor.low, anchor.high)}`)
          : null,
        state.eventIndex !== null
          ? el('button', {
              class: 'hero__reset',
              onClick: () => { state.eventIndex = null; state.render(); },
            }, '↺ sıradaki lansmana dön')
          : null
      ),
      el('div', { class: 'hero__products' },
        el('div', { class: 'stat__k' },
          future ? `Tanıtılması beklenen ${products.length} model` : `Tanıtılan ${products.length} model`),
        el('div', { class: 'hero__list' }, rows),
        el('p', { class: 'hero__note' }, note)
      )
    )
  );
}

export function renderRadar(root, state) {
  clear(root);
  const launches = buildLaunches(state);
  const events = buildEvents(state, launches);
  // Varsayılan konum: ilk gelecek olay. eventIndex ayarlıysa sınırlar içine kırpılır.
  const firstFuture = Math.max(0, events.findIndex((e) => e.kind === 'future'));
  const index = state.eventIndex === null
    ? firstFuture
    : Math.min(Math.max(state.eventIndex, 0), events.length - 1);

  const overdue = launches.filter((l) => l.anchor.overdue).sort((a, b) => a.anchor.daysAway - b.anchor.daysAway);
  const upcoming = launches.filter((l) => !l.anchor.overdue);
  const within12 = upcoming.filter((l) => l.anchor.daysAway <= 400);
  const models12 = within12.reduce((n, l) => n + l.preds.length, 0);

  if (events.length) root.append(renderHero(events, index, state));

  root.append(
    el('div', { class: 'radar-lede' },
      stat('Gecikmiş', String(overdue.length), 'model penceresi kapandı'),
      stat('12 ay içinde', String(within12.length), `lansman · ${models12} model`),
      stat('En yakın', within12[0] ? fmtShort(within12[0].anchor.date) : '—', within12[0]?.title ?? ''),
      stat('Yüksek güven', String(launches.filter((l) => l.anchor.band.id === 'high' && !l.anchor.overdue).length), '%70 üzeri')
    )
  );

  if (overdue.length) {
    root.append(
      el('div', { class: 'section-head' },
        el('h2', {}, 'Gecikmiş yenilemeler'),
        el('p', {}, 'Beklenen pencere kapandı — bu ürünler her an duyurulabilir.')
      ),
      el('div', { class: 'radar-list', style: { marginBottom: '28px' } }, overdue.map((l) => card(l, state)))
    );
  }

  root.append(
    el('div', { class: 'section-head' },
      el('h2', {}, 'Önümüzdeki lansmanlar'),
      el('p', {}, 'Birlikte çıkması beklenen modeller tek satırda. Karta dokunarak gerekçeyi görün.')
    ),
    upcoming.length
      ? el('div', { class: 'radar-list' }, upcoming.map((l) => card(l, state)))
      : el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek tahmin yok.')
  );
}

function card(launch, state) {
  const { anchor, preds, names } = launch;
  const soon = !anchor.overdue && anchor.daysAway <= 120;
  const multi = preds.length > 1;

  const meta = [];
  if (multi) meta.push(names.join(' · '));
  const last = anchor.lastRelease;
  meta.push(`Son: ${last.name} (${fmtShort(last.released)}) · ${anchor.daysSinceLast} gündür yenilenmedi`);
  if (anchor.chip) {
    meta.push(anchor.chip.projected
      ? `${anchor.chip.genKey} bekleniyor · +${anchor.chip.medianLag}g yayılım`
      : `${anchor.chip.genKey} çıktı, henüz gelmedi`);
  }

  return el('button', {
    class: `card rcard${soon ? ' rcard--soon' : ''}`,
    style: accentStyle(state.categories, launch.category),
    onClick: () => openLaunch(launch, state),
  },
    el('span', { class: 'rcard__rail' }),
    el('span', { class: 'rcard__body' },
      el('span', { class: 'rcard__title' },
        el('span', { class: 'rcard__cat' }, state.categories.find((c) => c.id === launch.category)?.label),
        el('span', { class: 'rcard__name' }, launch.title),
        multi ? el('span', { class: 'badge badge--quiet' }, `${preds.length} model`) : null,
        confidenceBadge(anchor)
      ),
      el('span', { class: 'rcard__meta' }, meta.join(' — '))
    ),
    el('span', { class: 'rcard__side' },
      el('span', { class: 'rcard__when' }, fmtLong(anchor.date)),
      el('span', { class: 'rcard__away' }, fmtAway(anchor.daysAway)),
      el('span', { class: 'rcard__away' }, fmtRange(anchor.low, anchor.high))
    )
  );
}
