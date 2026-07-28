import { el, clear, stat, confidenceBadge, fmtLong, fmtRange, fmtAway, fmtShort, accentStyle } from '../ui.js';
import { predictAll } from '../engine.js';
import { openFamily } from './drawer.js';

export function renderRadar(root, state) {
  clear(root);
  const preds = predictAll(state.ctx, { asOf: state.asOf, includeInactive: false })
    .filter((p) => state.matches(p.family));

  // Gecikmişler en üstte — mağaza için "her an çıkabilir" anlamına geliyor.
  const overdue = preds.filter((p) => p.overdue).sort((a, b) => a.daysAway - b.daysAway);
  const upcoming = preds.filter((p) => !p.overdue);
  const within12 = upcoming.filter((p) => p.daysAway <= 400);

  root.append(
    el('div', { class: 'radar-lede' },
      stat('Gecikmiş', String(overdue.length), 'model penceresi kapandı'),
      stat('12 ay içinde', String(within12.length), 'beklenen yenileme'),
      stat('En yakın', within12[0] ? fmtShort(within12[0].date) : '—', within12[0]?.family.label ?? ''),
      stat('Yüksek güven', String(preds.filter((p) => p.band.id === 'high' && !p.overdue).length), '%70 üzeri')
    )
  );

  if (overdue.length) {
    root.append(
      el('div', { class: 'section-head' },
        el('h2', {}, 'Gecikmiş yenilemeler'),
        el('p', {}, 'Beklenen pencere kapandı — bu ürünler her an duyurulabilir.')
      ),
      el('div', { class: 'radar-list', style: { marginBottom: '28px' } }, overdue.map((p) => card(p, state)))
    );
  }

  root.append(
    el('div', { class: 'section-head' },
      el('h2', {}, 'Önümüzdeki lansmanlar'),
      el('p', {}, 'Tahmini satışa çıkış tarihine göre sıralı. Karta dokunarak gerekçeyi görün.')
    )
  );

  root.append(
    upcoming.length
      ? el('div', { class: 'radar-list' }, upcoming.map((p) => card(p, state)))
      : el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek tahmin yok.')
  );
}

function card(pred, state) {
  const soon = !pred.overdue && pred.daysAway <= 120;
  const bits = [];
  bits.push(`Son sürüm: ${pred.lastRelease.name} (${fmtShort(pred.lastRelease.released)})`);
  bits.push(`${pred.daysSinceLast} gündür yenilenmedi`);
  if (pred.chip) {
    bits.push(pred.chip.projected
      ? `${pred.chip.genKey} bekleniyor · +${pred.chip.medianLag}g yayılım`
      : `${pred.chip.genKey} çıktı, henüz gelmedi`);
  }

  return el('button', {
    class: `card rcard${soon ? ' rcard--soon' : ''}`,
    style: accentStyle(state.categories, pred.category),
    onClick: () => openFamily(pred.familyId, state),
  },
    el('span', { class: 'rcard__rail' }),
    el('span', { class: 'rcard__body' },
      el('span', { class: 'rcard__title' },
        el('span', { class: 'rcard__cat' }, state.categories.find((c) => c.id === pred.category)?.label),
        el('span', { class: 'rcard__name' }, pred.family.label),
        confidenceBadge(pred)
      ),
      el('span', { class: 'rcard__meta' }, bits.join(' · '))
    ),
    el('span', { class: 'rcard__side' },
      el('span', { class: 'rcard__when' }, fmtLong(pred.date)),
      el('span', { class: 'rcard__away' }, fmtAway(pred.daysAway)),
      el('span', { class: 'rcard__away' }, fmtRange(pred.low, pred.high))
    )
  );
}
