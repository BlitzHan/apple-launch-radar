import { el, clear, badge, confidenceBadge, fmtLong, fmtRange, fmtShort, fmtAway, accentStyle } from '../ui.js';
import { predictFamily, toISO } from '../engine.js';

let lastFocus = null;

export function openFamily(familyId, state) {
  const scrim = document.getElementById('drawer-scrim');
  const drawer = document.getElementById('drawer');
  const pred = predictFamily(familyId, state.ctx, { asOf: state.asOf });
  const family = state.ctx.familyById.get(familyId);
  if (!family) return;

  const releases = (state.ctx.byFamily.get(familyId) || []).slice().reverse();
  clear(drawer);
  drawer.setAttribute('style', accentStyle(state.categories, family.category));

  drawer.append(
    el('div', { class: 'drawer__head' },
      el('h3', {}, family.label),
      el('button', { class: 'icon-btn', 'aria-label': 'Kapat', onClick: close }, '✕')
    ),
    el('p', { class: 'drawer__sub' },
      `${releases.length} sürüm · ${state.categories.find((c) => c.id === family.category)?.label}` +
      (family.active ? '' : ' · üretimi sonlanmış')
    )
  );

  if (family.note) {
    drawer.append(el('p', { class: 'drawer__sub', style: { marginTop: '-14px' } }, family.note));
  }

  /* --- tahmin kartı --- */
  if (pred) {
    drawer.append(
      el('div', { class: 'verdict' },
        el('div', { class: 'stat__k' }, pred.overdue ? 'Beklenen yenileme (geçti)' : 'Tahmini çıkış'),
        el('div', { class: 'verdict__date' }, fmtLong(pred.date)),
        el('div', { class: 'verdict__range' }, `Pencere: ${fmtRange(pred.low, pred.high)} · ${fmtAway(pred.daysAway)}`),
        el('div', { class: 'verdict__row' },
          confidenceBadge(pred),
          pred.chip ? badge(`${pred.chip.genKey}${pred.chip.projected ? ' (öngörülen)' : ''}`, 'quiet') : null,
          pred.fallback ? badge('Yetersiz geçmiş', 'low') : null
        )
      )
    );

    drawer.append(
      el('div', { class: 'dsec' },
        el('h4', {}, 'Tahmin neye dayanıyor'),
        el('ul', { class: 'reasons' }, pred.reasons.map((r) => el('li', {}, r)))
      )
    );

    /* --- nesil aralıkları --- */
    if (pred.cadence?.gaps?.length) {
      const gaps = pred.cadence.gaps;
      const max = Math.max(...gaps, pred.cadence.mu);
      const dates = releases.slice().reverse().filter((d) => !d.cadenceSkip);
      drawer.append(
        el('div', { class: 'dsec' },
          el('h4', {}, 'Nesiller arası süre'),
          el('div', { class: 'gapbars' },
            gaps.map((g, i) => el('div', { class: 'gapbar' },
              el('span', { class: 'gapbar__l' }, `${dates[i]?.released.slice(0, 7) ?? ''} →`),
              el('span', { class: 'gapbar__t' }, el('span', { class: 'gapbar__f', style: { width: `${(g / max) * 100}%` } })),
              el('span', { class: 'gapbar__v' }, `${g}g`)
            )),
            el('div', { class: 'gapbar' },
              el('span', { class: 'gapbar__l faint' }, 'beklenen'),
              el('span', { class: 'gapbar__t' },
                el('span', { class: 'gapbar__f', style: { width: `${(pred.cadence.mu / max) * 100}%`, opacity: .35 } })),
              el('span', { class: 'gapbar__v' }, `${Math.round(pred.cadence.mu)}g`)
            )
          )
        )
      );
    }

    /* --- çip yayılımı --- */
    if (pred.chip?.lags?.length) {
      drawer.append(
        el('div', { class: 'dsec' },
          el('h4', {}, 'Çip yayılım gecikmesi'),
          el('div', { class: 'histlist' },
            pred.chip.lags.map((l) => el('div', { class: 'histrow' },
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
              el('div', { class: 'histrow__d' }, `+${pred.chip.medianLag} gün`)
            )
          )
        )
      );

      if (pred.chip.gapDays > 45) {
        drawer.append(el('p', { class: 'drawer__sub' },
          `Kadans tahmini ${pred.chip.cadenceOnlyDate}, çip yayılımı tahmini ${pred.chip.chipOnlyDate} diyor. ` +
          `İkisi belirsizliklerine göre harmanlandı.`
        ));
      }
    }
  } else {
    drawer.append(el('p', { class: 'drawer__sub' }, 'Bu aile için tahmin üretilemedi.'));
  }

  /* --- geçmiş sürümler --- */
  drawer.append(
    el('div', { class: 'dsec' },
      el('h4', {}, 'Sürüm geçmişi'),
      el('div', { class: 'histlist' },
        releases.map((d) => el('div', { class: 'histrow' },
          el('div', { class: 'histrow__n' },
            el('div', {}, d.name, d.dataQuality === 'approx' ? el('span', { class: 'histrow__c', title: 'Tarih yaklaşık' }, ' ~') : null),
            el('div', { class: 'histrow__c' },
              `${d.chip} · duyuru ${fmtShort(d.announced)}` +
              (d.cadenceSkip ? ' · kadans dışı' : '')
            )
          ),
          el('div', { class: 'histrow__d' }, fmtShort(d.released))
        ))
      )
    )
  );

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
