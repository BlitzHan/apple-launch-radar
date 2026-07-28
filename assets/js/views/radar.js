import { el, clear, stat, confidenceBadge, fmtLong, fmtRange, fmtAway, fmtShort, accentStyle, expectedName, commonStem } from '../ui.js';
import { predictFamily } from '../engine.js';
import { openLaunch } from './drawer.js';

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

export function renderRadar(root, state) {
  clear(root);
  const launches = buildLaunches(state);

  const overdue = launches.filter((l) => l.anchor.overdue).sort((a, b) => a.anchor.daysAway - b.anchor.daysAway);
  const upcoming = launches.filter((l) => !l.anchor.overdue);
  const within12 = upcoming.filter((l) => l.anchor.daysAway <= 400);
  const models12 = within12.reduce((n, l) => n + l.preds.length, 0);

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
