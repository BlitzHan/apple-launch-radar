import { el, clear, badge, confidenceBadge, fmtLong, fmtRange, fmtShort, fmtAway, accentStyle, expectedName, commonStem } from '../ui.js';
import { predictFamily, diffDays } from '../engine.js';

let lastFocus = null;

/** Bir aileye tıklandığında o ailenin ait olduğu lansman olayını açar. */
export function openFamily(familyId, state) {
  const group = state.groups.find((g) => g.members.some((m) => m.id === familyId));
  const members = group ? group.members : [state.ctx.familyById.get(familyId)].filter(Boolean);
  const preds = members
    .map((f) => predictFamily(f.id, state.ctx, { asOf: state.asOf }))
    .filter(Boolean);
  const anchor =
    preds.slice().sort((a, b) => b.confidence - a.confidence || b.cadence.n - a.cadence.n)[0] || null;
  const names = preds.map((p) => expectedName(p.family, state.ctx.byFamily.get(p.familyId) || [], p));

  openLaunch({
    id: group?.id ?? familyId,
    anchor,
    preds,
    names,
    title: names.length ? commonStem(names) : members[0]?.label,
    category: members[0]?.category,
    familyIds: members.map((f) => f.id),
    allMembers: members,
  }, state);
}

export function openLaunch(launch, state) {
  const scrim = document.getElementById('drawer-scrim');
  const drawer = document.getElementById('drawer');
  const { anchor, preds } = launch;
  const members = launch.allMembers ?? preds.map((p) => p.family);
  const multi = members.length > 1;

  clear(drawer);
  drawer.setAttribute('style', accentStyle(state.categories, launch.category));

  const devicesOf = (id) => state.ctx.byFamily.get(id) || [];
  const allDevices = members.flatMap((f) => devicesOf(f.id));

  drawer.append(
    el('div', { class: 'drawer__head' },
      el('h3', {}, launch.title),
      el('button', { class: 'icon-btn', 'aria-label': 'Kapat', onClick: close }, '✕')
    ),
    el('p', { class: 'drawer__sub' },
      `${state.categories.find((c) => c.id === launch.category)?.label} · ` +
      (multi ? `${members.length} model, birlikte çıkması bekleniyor` : `${allDevices.length} sürüm`)
    )
  );

  if (!anchor) {
    drawer.append(el('p', { class: 'drawer__sub' }, 'Bu ürün için tahmin üretilemedi.'));
    show(scrim, drawer);
    return;
  }

  /* --- tahmin --- */
  drawer.append(
    el('div', { class: 'verdict' },
      el('div', { class: 'stat__k' }, anchor.overdue ? 'Beklenen yenileme (geçti)' : 'Tahmini çıkış'),
      el('div', { class: 'verdict__date' }, fmtLong(anchor.date)),
      el('div', { class: 'verdict__range' }, `Pencere: ${fmtRange(anchor.low, anchor.high)} · ${fmtAway(anchor.daysAway)}`),
      el('div', { class: 'verdict__row' },
        confidenceBadge(anchor),
        anchor.chip ? badge(`${anchor.chip.genKey}${anchor.chip.projected ? ' (öngörülen)' : ''}`, 'quiet') : null,
        anchor.fallback ? badge('Yetersiz geçmiş', 'low') : null
      )
    )
  );

  /* --- bu lansmanda beklenen modeller --- */
  if (multi) {
    drawer.append(
      el('div', { class: 'dsec' },
        el('h4', {}, 'Bu lansmanda beklenen modeller'),
        el('div', { class: 'histlist' },
          preds.map((p, i) => {
            const gap = Math.abs(diffDays(p.date, anchor.date));
            const solo = (state.ctx.byFamily.get(p.familyId) || []).length === 1;
            return el('div', { class: 'histrow' },
              el('div', { class: 'histrow__n' },
                el('div', {}, launch.names[i]),
                el('div', { class: 'histrow__c' },
                  p.family.label + (solo ? ' · tek nesil, kendi kadansı yok' : ` · ${p.cadence.n} nesil`)
                )
              ),
              el('div', { class: 'histrow__d' },
                p.familyId === anchor.familyId
                  ? badge('çapa', 'high')
                  : gap <= 14 ? 'aynı pencere' : `kendi tahmini ${fmtShort(p.date)}`
              )
            );
          })
        )
      )
    );
    drawer.append(el('p', { class: 'drawer__sub' },
      `Bu modeller geçmişte hep aynı gün satışa çıktı, bu yüzden tek lansman sayıldı. ` +
      `Tarih ve güven, en çok geçmişi olan üyeden (${anchor.family.label}) alınıyor — ` +
      `aynı olayı tahmin ettikleri için güvenler toplanmaz.`
    ));
  }

  drawer.append(
    el('div', { class: 'dsec' },
      el('h4', {}, 'Tahmin neye dayanıyor'),
      el('ul', { class: 'reasons' }, anchor.reasons.map((r) => el('li', {}, r)))
    )
  );

  /* --- nesil aralıkları --- */
  if (anchor.cadence?.gaps?.length) {
    const gaps = anchor.cadence.gaps;
    const max = Math.max(...gaps, anchor.cadence.mu);
    const dates = devicesOf(anchor.familyId).filter((d) => !d.cadenceSkip);
    drawer.append(
      el('div', { class: 'dsec' },
        el('h4', {}, `Nesiller arası süre — ${anchor.family.label}`),
        el('div', { class: 'gapbars' },
          gaps.map((g, i) => el('div', { class: 'gapbar' },
            el('span', { class: 'gapbar__l' }, `${dates[i]?.released.slice(0, 7) ?? ''} →`),
            el('span', { class: 'gapbar__t' }, el('span', { class: 'gapbar__f', style: { width: `${(g / max) * 100}%` } })),
            el('span', { class: 'gapbar__v' }, `${g}g`)
          )),
          el('div', { class: 'gapbar' },
            el('span', { class: 'gapbar__l faint' }, 'beklenen'),
            el('span', { class: 'gapbar__t' },
              el('span', { class: 'gapbar__f', style: { width: `${(anchor.cadence.mu / max) * 100}%`, opacity: .35 } })),
            el('span', { class: 'gapbar__v' }, `${Math.round(anchor.cadence.mu)}g`)
          )
        )
      )
    );
  }

  /* --- çip yayılımı --- */
  if (anchor.chip?.lags?.length) {
    drawer.append(
      el('div', { class: 'dsec' },
        el('h4', {}, 'Çip yayılım gecikmesi'),
        el('div', { class: 'histlist' },
          anchor.chip.lags.map((l) => el('div', { class: 'histrow' },
            el('div', { class: 'histrow__n' },
              el('div', {}, `${l.genKey} nesli`),
              el('div', { class: 'histrow__c' }, `${l.chip} · çip çıkışı ${l.genDebut}`)
            ),
            el('div', { class: 'histrow__d' }, l.lag === 0 ? 'ilk taşıyıcı' : `+${l.lag} gün`)
          )),
          el('div', { class: 'histrow' },
            el('div', { class: 'histrow__n' },
              el('div', { class: 'muted' }, 'Ağırlıklı medyan gecikme'),
              el('div', { class: 'histrow__c' }, 'yeni nesiller için kullanılan değer')
            ),
            el('div', { class: 'histrow__d' }, `+${anchor.chip.medianLag} gün`)
          )
        )
      )
    );
  }

  /* --- geçmiş: tarihe göre toplanmış --- */
  const byDate = new Map();
  for (const d of allDevices) {
    if (!byDate.has(d.released)) byDate.set(d.released, []);
    byDate.get(d.released).push(d);
  }
  drawer.append(
    el('div', { class: 'dsec' },
      el('h4', {}, 'Sürüm geçmişi'),
      el('div', { class: 'histlist' },
        [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, list]) =>
          el('div', { class: 'histrow' },
            el('div', { class: 'histrow__n' },
              el('div', {}, list.map((d) => d.name).join(', ')),
              el('div', { class: 'histrow__c' },
                [...new Set(list.map((d) => d.chip))].join(' / ') +
                ` · duyuru ${fmtShort(list[0].announced)}` +
                (list.every((d) => d.cadenceSkip) ? ' · kadans dışı' : '')
              )
            ),
            el('div', { class: 'histrow__d' }, fmtShort(date))
          )
        )
      )
    )
  );

  show(scrim, drawer);
}

function show(scrim, drawer) {
  lastFocus = document.activeElement;
  scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  drawer.querySelector('button')?.focus();
}

export function close() {
  const scrim = document.getElementById('drawer-scrim');
  if (scrim.hidden) return;
  scrim.hidden = true;
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

export function initDrawer() {
  const scrim = document.getElementById('drawer-scrim');
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
