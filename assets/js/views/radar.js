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

/**
 * İlk giren kullanıcının "Tahmin nereden geliyor?" sorusunu tek bakışta anlamasını sağlayan
 * 3 adımlı Apple tarzı özet akış göstergesi.
 */
function renderOnboardingBanner() {
  return el('div', { class: 'how-it-works' },
    el('div', { class: 'how-it-works__title' }, 'Tahmin Mantığı Nasıl Çalışır?'),
    el('div', { class: 'how-it-works__steps' },
      el('div', { class: 'how-it-works__step' },
        el('span', { class: 'how-it-works__num' }, '1'),
        el('div', { class: 'how-it-works__text' },
          el('strong', {}, 'Geçmiş Kadans & Çipler'),
          el('span', {}, 'Apple\'ın 2020\'den beri lansman aralıkları ve çip yayılım süreleri ölçülür.')
        )
      ),
      el('span', { class: 'how-it-works__arrow' }, '→'),
      el('div', { class: 'how-it-works__step' },
        el('span', { class: 'how-it-works__num' }, '2'),
        el('div', { class: 'how-it-works__text' },
          el('strong', {}, 'İstatistiksel Ölçüm'),
          el('span', {}, 'Ağırlıklı kadans ve mevsimsel oturtma ile bir sonraki lansman penceresi hesaplanır.')
        )
      ),
      el('span', { class: 'how-it-works__arrow' }, '→'),
      el('div', { class: 'how-it-works__step' },
        el('span', { class: 'how-it-works__num' }, '3'),
        el('div', { class: 'how-it-works__text' },
          el('strong', {}, 'Gelecek Etkinlik'),
          el('span', {}, 'Önümüzdeki lansmanda birlikte tanıtılması beklenen modeller öngörülür.')
        )
      )
    )
  );
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
      // Bu kategoriye ait gelecek ilk lansmanın event index'ini bul
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
 * Akordeon Lansman Geçmişi — Gerçekleşen lansmanlar en sondan geriye doğru listelenir.
 * İlk başta kapalıdır; tıklandığında açılır ve çıkan ürünlerin detaylarını gösterir.
 */
function renderAccordionHistory(pastEvents, state) {
  if (!pastEvents.length) return null;

  // En yeni gerçekleşen lansmandan geriye sırala
  const sortedPast = [...pastEvents].sort((a, b) => b.announce - a.announce);

  const list = el('div', { class: 'accordion-list' });

  sortedPast.forEach((evt, idx) => {
    let isOpen = idx === 0; // En son lansman varsayılan olarak açık gelsin

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
        el('span', { class: 'accordion-date' }, fmtLong(evt.announce)),
        el('div', { class: 'accordion-badges' },
          evt.products.slice(0, 4).map((p) =>
            el('span', {
              class: 'badge badge--quiet',
              style: accentStyle(state.categories, p.category),
            }, p.name)
          ),
          evt.products.length > 4 ? el('span', { class: 'badge badge--quiet' }, `+${evt.products.length - 4}`) : null
        )
      ),
      el('div', { class: 'accordion-right' },
        el('span', { class: 'accordion-count' }, `${evt.products.length} ürün`),
        el('span', { class: 'accordion-chevron' }, '›')
      )
    );

    const body = el('div', { class: 'accordion-body' },
      el('div', { class: 'accordion-content' },
        el('div', { class: 'accordion-grid' },
          evt.products.map((p) =>
            el('div', { class: 'accordion-prod', style: accentStyle(state.categories, p.category) },
              el('div', { class: 'accordion-prod-name' }, p.name),
              el('div', { class: 'accordion-prod-detail' },
                el('span', {}, p.chip ? `${p.chip} çipi` : 'Standart çip'),
                el('span', {}, `Satış: ${fmtShort(p.released)}`)
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
      el('p', {}, 'Apple\'ın geçmiş lansmanları (en yeni lansmandan geriye doğru). Tıklayarak detayları görün.')
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

  const overdue = launches.filter((l) => l.anchor.overdue).sort((a, b) => a.anchor.daysAway - b.anchor.daysAway);
  const upcoming = launches.filter((l) => !l.anchor.overdue);
  const within12 = upcoming.filter((l) => l.anchor.daysAway <= 400);
  const models12 = within12.reduce((n, l) => n + l.preds.length, 0);

  // 1. "Tahmin Mantığı Nasıl Çalışır?" 3 adımlı göstergesi
  root.append(renderOnboardingBanner());

  // 2. Hero alanı (Kategori seçicili)
  if (events.length) root.append(renderHero(events, index, state));

  // 3. Stat özet kartları
  root.append(
    el('div', { class: 'radar-lede' },
      stat('Gecikmiş', String(overdue.length), 'model penceresi kapandı'),
      stat('12 ay içinde', String(within12.length), `lansman · ${models12} model`),
      stat('En yakın', within12[0] ? fmtShort(within12[0].anchor.date) : '—', within12[0]?.title ?? ''),
      stat('Yüksek güven', String(launches.filter((l) => l.anchor.band.id === 'high' && !l.anchor.overdue).length), '%70 üzeri')
    )
  );

  // 4. Gecikmiş yenilemeler
  if (overdue.length) {
    root.append(
      el('div', { class: 'section-head' },
        el('h2', {}, 'Gecikmiş yenilemeler'),
        el('p', {}, 'Beklenen pencere kapandı — bu ürünler her an duyurulabilir.')
      ),
      el('div', { class: 'radar-list', style: { marginBottom: '36px' } }, overdue.map((l) => card(l, state)))
    );
  }

  // 5. Önümüzdeki tahmini lansmanlar
  root.append(
    el('div', { class: 'section-head' },
      el('h2', {}, 'Önümüzdeki Lansmanlar & Modeller'),
      el('p', {}, 'Birlikte çıkması beklenen modeller tek kartta. Gerekçesini görmek için karta dokunun.')
    ),
    upcoming.length
      ? el('div', { class: 'radar-list', style: { marginBottom: '40px' } }, upcoming.map((l) => card(l, state)))
      : el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek tahmin yok.')
  );

  // 6. Akordeon Lansman Geçmişi (Gerçekleşmiş lansmanlar)
  const pastEvents = events.filter((e) => e.kind === 'past');
  const historyView = renderAccordionHistory(pastEvents, state);
  if (historyView) root.append(historyView);
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
