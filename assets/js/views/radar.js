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

  // Kategori Butonları Seçicisi (Hero üstünde)
  const categorySelector = el('div', { class: 'hero__cat-selector' },
    el('span', { class: 'hero__cat-label' }, 'Gelecek Lansmanı Seç:'),
    [
      { id: 'all', label: 'Tüm Ürünler' },
      { id: 'iphone', label: 'iPhone' },
      { id: 'ipad', label: 'iPad' },
      { id: 'watch', label: 'Watch' },
      { id: 'mac', label: 'Mac' },
    ].map((cat) => {
      let targetIndex = null;
      if (cat.id === 'all') {
        targetIndex = events.findIndex((e) => e.kind === 'future');
      } else {
        targetIndex = events.findIndex(
          (e) => e.kind === 'future' && e.products.some((p) => p.category === cat.id)
        );
      }
      const isSelected = targetIndex === index;

      return el('button', {
        class: `hero__cat-btn${isSelected ? ' is-selected' : ''}`,
        disabled: targetIndex === -1,
        onClick: () => {
          if (targetIndex !== -1) {
            state.eventIndex = targetIndex;
            state.render();
          }
        },
      }, cat.label);
    })
  );

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
      categorySelector,
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

/**
 * Kategori Bazlı Ürün Döngüleri & Gelecek Tahmin Modülü.
 * Sitenin temel amacını yanıtlar:
 * "Hangi cihaz ne zaman çıktı, kaç ayda bir yenileniyor ve bir sonraki ne zaman gelecek?"
 */
function renderCategoryExplorer(state) {
  const currentCat = state.activeCategoryTab || 'iphone';

  const catTabs = el('div', { class: 'cat-explorer__tabs' },
    state.categories.map((c) => el('button', {
      class: `cat-explorer__tab${c.id === currentCat ? ' is-active' : ''}`,
      style: c.id === currentCat ? `--accent:${c.color}` : '',
      onClick: () => {
        state.activeCategoryTab = c.id;
        state.render();
      },
    },
      el('span', { class: 'cat-explorer__dot', style: { background: c.color } }),
      c.label
    ))
  );

  const families = state.ctx.families.filter(
    (f) => f.active && f.category === currentCat && state.matches(f)
  );

  const grid = el('div', { class: 'cat-explorer__grid' });

  for (const f of families) {
    const pred = predictFamily(f.id, state.ctx, { asOf: state.asOf });
    if (!pred) continue;

    const devices = state.ctx.byFamily.get(f.id) || [];
    const nextName = expectedName(f, devices, pred);
    const last = pred.lastRelease;

    const avgDays = Math.round(pred.cadence.mean);
    const avgMonths = Math.round(avgDays / 30.4);

    const card = el('div', {
      class: 'cat-card',
      style: accentStyle(state.categories, f.category),
      onClick: () => openFamily(f.id, state),
    },
      el('div', { class: 'cat-card__header' },
        el('div', { class: 'cat-card__title-group' },
          el('span', { class: 'cat-card__badge-cat' }, state.categories.find((c) => c.id === f.category)?.label),
          el('h3', { class: 'cat-card__name' }, f.label)
        ),
        confidenceBadge(pred)
      ),

      el('div', { class: 'cat-card__metrics' },
        // En Son Çıkan Model & Tarih
        el('div', { class: 'cat-card__metric' },
          el('span', { class: 'cat-card__label' }, 'En Son Ne Zaman Çıktı?'),
          el('div', { class: 'cat-card__val' }, last.name),
          el('span', { class: 'cat-card__sub' }, `${fmtLong(toDate(last.released))} (${pred.daysSinceLast} gün önce)`)
        ),

        // Yenilenme Döngüsü
        el('div', { class: 'cat-card__metric' },
          el('span', { class: 'cat-card__label' }, 'Ortalama Yenilenme Aralığı'),
          el('div', { class: 'cat-card__val' }, `~${avgMonths} Ayda Bir`),
          el('span', { class: 'cat-card__sub' }, `Geçmiş döngü: ${avgDays} gün (${pred.cadence.n} nesil verisi)`)
        ),

        // Bir Sonraki Çıkış Tahmini
        el('div', { class: 'cat-card__metric cat-card__metric--next' },
          el('span', { class: 'cat-card__label' }, 'Sıradaki Model & Tahmini Çıkış'),
          el('div', { class: 'cat-card__val cat-card__val--highlight' }, nextName),
          el('span', { class: 'cat-card__sub cat-card__sub--highlight' },
            pred.overdue
              ? `⚠️ Pencere Kapandı (${fmtAway(pred.daysAway)})`
              : `🚀 Tahmini Lansman: ${fmtLong(pred.date)} (${fmtAway(pred.daysAway)})`
          )
        )
      ),

      el('div', { class: 'cat-card__footer' },
        el('span', { class: 'cat-card__range' }, `Tahmini Satış Penceresi: ${fmtRange(pred.low, pred.high)}`),
        el('button', { class: 'cat-card__link' }, 'Gerekçe & Detaylar →')
      )
    );

    grid.append(card);
  }

  return el('div', { class: 'cat-explorer' },
    el('div', { class: 'section-head' },
      el('h2', {}, 'Ürün Döngüleri & Gelecek Tahminleri'),
      el('p', {}, 'Hangi cihaz en son ne zaman çıktı, ortalama kaç ayda bir yenileniyor ve bir sonraki modeli ne zaman gelecek?')
    ),
    catTabs,
    grid
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

  // 1. Hero alanı (Tahmini Etkinlik & Kategori Seçicili)
  if (events.length) root.append(renderHero(events, index, state));

  // 2. Kategori Bazlı Ürün Döngüleri & Tahmin Modülü (iPhone / iPad / Mac / Watch)
  root.append(renderCategoryExplorer(state));

  // 3. Apple Store standartlarında Lüks Gerçekleşen Lansman Geçmişi
  const pastEvents = events.filter((e) => e.kind === 'past');
  const historyView = renderAccordionHistory(pastEvents, state);
  if (historyView) root.append(historyView);
}
