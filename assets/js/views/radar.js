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

const PAST_WINDOW = 7;
const FUTURE_WINDOW = 14;

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
      saleEnd: sales[0] === sales[sales.length - 1] ? null : saleEnd,
      lead: diffDays(sale, announce),
      lines: new Set(group.map((d) => d.family)).size,
      products: group
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
        .map((d) => ({
          name: d.name,
          category: d.category,
          chip: d.chip,
          released: d.released,
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
      }, future ? 'Gerekçe →' : 'Geçmiş →')
    )
  );

  const note = future
    ? (event.lastAnnounced.length === 1
        ? `Bu modeller en son ${fmtLong(event.lastAnnounced[0])} tarihinde, hepsi aynı etkinlikte tanıtılmıştı.`
        : `Bu modeller en son ${event.lastAnnounced.map((d) => fmtShort(d)).join(' ve ')} tarihlerinde tanıtılmıştı.`)
    : `Gerçekleşmiş lansman — bu tarihler tahmin değil, kayıt.`;

  return el('div', { class: `card hero${future ? '' : ' hero--past'}`,
      style: accentStyle(state.categories, future ? anchor.category : products[0].category) },
    el('div', { class: 'hero__topbar' },
      el('div', { class: 'hero__badge' },
        el('span', { class: 'hero__badge-dot' }),
        el('span', { class: 'hero__badge-text' }, future ? 'Tahmini Etkinlik' : 'Geçmiş Etkinlik')
      ),
      el('div', { class: 'hero__controls' },
        state.eventIndex !== null
          ? el('button', {
              class: 'hero__reset',
              onClick: () => { state.eventIndex = null; state.render(); },
            }, '↺ Varsayılana dön')
          : null,
        el('span', { class: 'hero__steps' },
          nav(-1, '‹', 'Önceki lansman'),
          el('span', { class: 'hero__count' }, `${index + 1} / ${events.length}`),
          nav(1, '›', 'Sonraki lansman')
        )
      )
    ),
    el('div', { class: 'hero__grid' },
      el('div', { class: 'hero__when' },
        el('div', { class: 'stat__k' }, future ? 'Tahmini tanıtım' : 'Tanıtım tarihi'),
        el('div', { class: 'hero__date' }, fmtLong(event.announce)),
        el('div', { class: 'hero__sale' },
          event.saleEnd
            ? `Satış: ${fmtRange(event.sale, event.saleEnd)} · kademeli`
            : `Satış: ${fmtLong(event.sale)}` + (event.lead ? ` · tanıtımdan ${event.lead} gün sonra` : ' · aynı gün')
        ),
        el('div', { class: 'hero__row' },
          future ? confidenceBadge(anchor) : badge('Gerçekleşti', 'quiet'),
          badge(fmtAway(away), 'quiet'),
          event.lines > 1 ? badge(`${event.lines} ürün hattı`, 'quiet') : null
        ),
        future
          ? el('div', { class: 'hero__window' }, `Satış penceresi: ${fmtRange(anchor.low, anchor.high)}`)
          : null
      ),
      el('div', { class: 'hero__products' },
        el('div', { class: 'stat__k' },
          future ? `Beklenen ${products.length} ürün` : `${products.length} ürün`),
        el('div', { class: 'hero__list' }, rows),
        el('p', { class: 'hero__note' }, note)
      )
    )
  );
}

/* --------------------------------------------------- ürün hattı kutuları */

/**
 * Ürün hatları. Apple mağazada ürünü kategoriyle değil hatla anar: müşteri
 * "iPad" değil "iPad Pro" ya da "MacBook Air" sorar. Bu yüzden iPad ve MacBook
 * Pro/Air olarak ikiye ayrıldı.
 *
 * `lead` = kutunun ismini ve tarihlerini veren aile (hattın amiral gemisi).
 * `with` = aynı etkinlikte çıkan kardeş aileler; yalnızca sayı olarak görünür.
 */
const LINEUPS = [
  { id: 'iphone', label: 'iPhone', icon: 'iphone', lead: 'iphone-base', with: ['iphone-pro', 'iphone-promax', 'iphone-air'] },
  { id: 'ipad-pro', label: 'iPad Pro', icon: 'ipad', lead: 'ipad-pro', with: [] },
  { id: 'ipad-air', label: 'iPad Air', icon: 'ipad', lead: 'ipad-air', with: [] },
  { id: 'watch', label: 'Apple Watch', icon: 'watch', lead: 'watch-series', with: ['watch-ultra', 'watch-se'] },
  { id: 'macbook-pro', label: 'MacBook Pro', icon: 'mac', lead: 'macbook-pro-base', with: ['macbook-pro-promax'] },
  { id: 'macbook-air', label: 'MacBook Air', icon: 'mac', lead: 'macbook-air', with: [] },
  { id: 'iphone-e', label: 'iPhone e', icon: 'iphone', lead: 'iphone-e', with: [] },
  { id: 'ipad', label: 'iPad', icon: 'ipad', lead: 'ipad-base', with: [] },
  { id: 'ipad-mini', label: 'iPad mini', icon: 'ipad', lead: 'ipad-mini', with: [] },
  { id: 'macbook-neo', label: 'MacBook Neo', icon: 'mac', lead: 'macbook-neo', with: [] },
  { id: 'mac-mini', label: 'Mac mini', icon: 'macmini', lead: 'mac-mini', with: [] },
  { id: 'imac', label: 'iMac', icon: 'imac', lead: 'imac', with: [] },
  { id: 'mac-studio', label: 'Mac Studio', icon: 'macmini', lead: 'mac-studio', with: [] },
];

/* Apple ürün siluetleri — currentColor ile kategori rengini alır. */
const ICONS = {
  iphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="2.5" width="10" height="19" rx="2.6"/><path d="M10.6 4.9h2.8" stroke-linecap="round"/></svg>',
  ipad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4.5" y="2.5" width="15" height="19" rx="2.2"/><path d="M10.8 19.2h2.4" stroke-linecap="round"/></svg>',
  watch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="6.5" width="10" height="11" rx="3"/><path d="M9.3 6.5 9.8 3h4.4l.5 3.5M9.3 17.5l.5 3.5h4.4l.5-3.5" stroke-linejoin="round"/><path d="M17 10.5v3" stroke-linecap="round"/></svg>',
  mac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4.5" width="16" height="11" rx="1.6"/><path d="M2 18.5h20" stroke-linecap="round"/></svg>',
  imac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3.5" width="18" height="13" rx="1.8"/><path d="M9.6 16.5v3.5h4.8v-3.5M8 20h8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  macmini: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="8" width="18" height="8" rx="2"/><circle cx="7" cy="12" r="0.9" fill="currentColor" stroke="none"/></svg>',
};

/**
 * Kutular dar olduğu için model adından ekran boyutu ayıklanır:
 * `iPad Pro (M5, 11" & 13")` → `iPad Pro (M5)` · `MacBook Air 13/15" (M5)` → `MacBook Air (M5)`.
 * Boyut bilgisi kutunun taşıdığı bilgi değil; tam ad hero panelinde ve detayda duruyor.
 */
function compactModel(name) {
  return name
    .replace(/\(([^)]*)\)/, (_, inner) => `(${inner.split(/[,/]/)[0].trim()})`)
    .replace(/\s*\d+(?:[/,]\d+)*\s*["″]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * "Tahmini Etkinlik" panelinin üstündeki hat kutuları: her hattın en son çıkan
 * modeli, kaç gün önce çıktığı ve sıradaki beklenen model + tarihi.
 * Kutuya tıklamak hero panelini o hattın lansman olayına götürür.
 */
function renderLineupTiles(state, events, index) {
  // Sıra tarihe göre: en yakın çıkacak ürün en başta. Penceresi kapanmış
  // (gecikmiş) ürünler tarihi geçmiş olduğu için doğal olarak en öne gelir —
  // mağaza için doğrusu da bu, "her an çıkabilir" demek.
  const rows = [];
  for (const line of LINEUPS) {
    const fam = state.ctx.familyById.get(line.lead);
    if (!fam || !fam.active || !state.matches(fam)) continue;
    const pred = predictFamily(fam.id, state.ctx, { asOf: state.asOf });
    if (pred) rows.push({ line, fam, pred });
  }
  rows.sort((a, b) => a.pred.date - b.pred.date);

  const tiles = [];

  for (const { line, fam, pred } of rows) {

    const devices = state.ctx.byFamily.get(fam.id) || [];
    const last = pred.lastRelease;
    const nextName = expectedName(fam, devices, pred);
    const siblings = line.with.filter((id) => {
      const f = state.ctx.familyById.get(id);
      return f && f.active && state.matches(f);
    }).length;

    // Kutunun hedefi: bu ailenin göründüğü ilk gelecek lansman olayı.
    const target = events.findIndex(
      (e) => e.kind === 'future' && e.products.some((p) => p.familyId === fam.id)
    );
    const selected = target !== -1 && target === index;

    tiles.push(el('button', {
      class: `lineup${selected ? ' is-selected' : ''}`,
      style: accentStyle(state.categories, fam.category),
      disabled: target === -1,
      'aria-pressed': String(selected),
      onClick: () => { state.eventIndex = target; state.render(); },
    },
      el('div', { class: 'lineup__head' },
        el('span', { class: 'lineup__icon', html: ICONS[line.icon] }),
        el('span', { class: 'lineup__name' }, line.label),
        siblings ? el('span', { class: 'lineup__count' }, `+${siblings}`) : null
      ),

      el('div', { class: 'lineup__block' },
        el('span', { class: 'lineup__label' }, 'Son çıkan'),
        el('span', { class: 'lineup__model' }, compactModel(last.name)),
        el('span', { class: 'lineup__meta' },
          `${fmtShort(last.released)} · ${pred.daysSinceLast} gün önce`)
      ),

      el('div', { class: 'lineup__block lineup__block--next' },
        el('span', { class: 'lineup__label' }, 'Sıradaki beklenen'),
        el('span', { class: 'lineup__model lineup__model--next' }, compactModel(nextName)),
        el('span', { class: 'lineup__meta lineup__meta--next' },
          pred.overdue
            ? `Pencere kapandı · ${fmtAway(pred.daysAway)}`
            : `${fmtShort(pred.date)} · ${fmtAway(pred.daysAway)}`)
      )
    ));
  }

  if (!tiles.length) return null;

  const track = el('div', { class: 'lineups__track' }, tiles);

  // Bir "sayfa" = görünen genişliğin %85'i; son kutu yarım kalmasın diye tam değil.
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const page = (dir) => () => track.scrollBy({
    left: dir * track.clientWidth * 0.85,
    behavior: smooth ? 'smooth' : 'auto',
  });
  const arrow = (dir, text, label) =>
    el('button', { class: 'lineups__arrow', 'aria-label': label, onClick: page(dir) }, text);

  return el('div', { class: 'lineups' },
    el('div', { class: 'lineups__head' },
      el('div', { class: 'section-head' },
        el('h2', {}, 'Ürün Hatları'),
        el('p', {}, 'En yakın çıkması beklenen hat en başta. Ayrıntı için bir hatta dokunun.')
      ),
      el('div', { class: 'lineups__arrows' }, arrow(-1, '‹', 'Geri kaydır'), arrow(1, '›', 'İleri kaydır'))
    ),
    el('div', { class: 'lineups__scroller' }, track)
  );
}

/**
 * Apple Store & Keynote Standartlarında Lüks Akordeon Lansman Geçmişi.
 */
function renderAccordionHistory(pastEvents, state) {
  if (!pastEvents.length) return null;

  const sortedPast = [...pastEvents].sort((a, b) => b.announce - a.announce);

  const list = el('div', { class: 'accordion-list' });

  sortedPast.forEach((evt) => {
    let isOpen = false; // Tüm lansman geçmişi ilk başta kapalı/küçük gelsin

    const row = el('div', { class: `accordion-item${isOpen ? ' is-open' : ''}` });

    const header = el('button', {
      class: 'accordion-header',
      'aria-expanded': String(isOpen),
      onClick: () => {
        isOpen = !isOpen;
        row.classList.toggle('is-open', isOpen);
        header.setAttribute('aria-expanded', String(isOpen));
      },
    },
      el('div', { class: 'accordion-left' },
        el('span', { class: 'accordion-apple-icon' }, ''),
        el('span', { class: 'accordion-date' }, fmtLong(evt.announce)),
        el('div', { class: 'accordion-badges' },
          evt.products.slice(0, 4).map((p) =>
            el('span', {
              class: 'accordion-tag',
              style: accentStyle(state.categories, p.category),
            },
              el('span', { class: 'accordion-tag-dot' }),
              p.name
            )
          ),
          evt.products.length > 4 ? el('span', { class: 'accordion-tag-more' }, `+${evt.products.length - 4} ürün daha`) : null
        )
      ),
      el('div', { class: 'accordion-right' },
        el('span', { class: 'accordion-count' }, `${evt.products.length} Ürün Tanıtıldı`),
        el('span', { class: 'accordion-chevron' }, '›')
      )
    );

    const body = el('div', { class: 'accordion-body' },
      el('div', { class: 'accordion-content' },
        el('div', { class: 'accordion-grid' },
          evt.products.map((p) =>
            el('div', {
              class: 'accordion-prod-card',
              style: accentStyle(state.categories, p.category),
              onClick: () => openFamily(p.familyId, state),
            },
              el('div', { class: 'accordion-prod-top' },
                el('span', { class: 'accordion-prod-name' }, p.name),
                el('span', { class: 'accordion-prod-chip' }, p.chip)
              ),
              el('div', { class: 'accordion-prod-bottom' },
                el('span', { class: 'accordion-prod-date' }, `Satış: ${fmtShort(p.released)}`),
                el('span', { class: 'accordion-prod-lead' }, evt.lead ? `${evt.lead}g sonra stokta` : 'Aynı gün')
              )
            )
          )
        )
      )
    );

    row.append(header, body);
    list.append(row);
  });

  return el('div', { class: 'history-section' },
    el('div', { class: 'section-head' },
      el('h2', {}, 'Gerçekleşen Lansman Geçmişi'),
      el('p', {}, 'Apple\'ın 2020\'den günümüze tüm gerçekleşmiş lansman kaydı. Detayları görmek için etkinlik üzerine dokunun.')
    ),
    list
  );
}

export function renderRadar(root, state) {
  clear(root);
  const launches = buildLaunches(state);
  const events = buildEvents(state, launches);

  const firstFuture = Math.max(0, events.findIndex((e) => e.kind === 'future'));
  const index = state.eventIndex === null
    ? firstFuture
    : Math.min(Math.max(state.eventIndex, 0), events.length - 1);

  // 1. Ürün hattı kutuları — hero'nun üstünde, hattı seçmenin de yolu
  const tiles = renderLineupTiles(state, events, index);
  if (tiles) root.append(tiles);

  // 2. Hero alanı (Tahmini / Geçmiş Etkinlik)
  if (events.length) root.append(renderHero(events, index, state));

  // 3. Apple Store standartlarında Lüks Gerçekleşen Lansman Geçmişi
  const pastEvents = events.filter((e) => e.kind === 'past');
  const historyView = renderAccordionHistory(pastEvents, state);
  if (historyView) root.append(historyView);
}
