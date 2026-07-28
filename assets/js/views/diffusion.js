import { el, clear, fmtShort, accentStyle } from '../ui.js';
import { predictFamily, predictNextChipGen, chipGenerations, toDate, toISO, addDays, diffDays } from '../engine.js';
import { openFamily } from './drawer.js';

/**
 * Satır = ürün ailesi, kolon = çip nesli.
 * Hücre = o nesli aldığı tarih + çip çıkışından kaç gün sonra aldığı.
 * Boş hücreler yayılım medyanı ile tahmin edilir (kesikli).
 */
export function renderDiffusion(root, state) {
  clear(root);

  const series = state.chipSeries || 'M';
  const gens = [...chipGenerations(state.ctx.chips).values()]
    .filter((g) => g.series === series && g.debut >= '2020-01-01')
    .sort((a, b) => a.gen - b.gen);
  const next = predictNextChipGen(state.ctx.chips, { series, lambda: state.ctx.opt.lambda, trend: state.ctx.opt.trend });

  const diffusion = series === 'M' ? state.ctx.diffusionM : state.ctx.diffusionA;
  const families = state.ctx.families
    .filter((f) => f.chipAware && diffusion.has(f.id) && state.matches(f));

  root.append(
    el('div', { class: 'section-head' },
      el('h2', {}, `${series}-serisi çip yayılımı`),
      el('p', {}, 'Bir çip nesli piyasaya çıktıktan kaç gün sonra hangi ürüne indi. Kesikli hücreler tahmindir.')
    ),
    el('div', { class: 'filters' },
      el('div', { class: 'chipset' },
        ['M', 'A'].map((s) => el('button', {
          class: 'chip', 'aria-pressed': String(s === series),
          onClick: () => { state.chipSeries = s; state.render(); },
        }, `${s}-serisi`))
      )
    )
  );

  if (!families.length) {
    root.append(el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek ürün yok.'));
    return;
  }

  const cols = [...gens.map((g) => ({ key: g.key, label: g.key, debut: toDate(g.debut), projected: false })),
    ...(next ? [{ key: next.key, label: `${next.key} ↗`, debut: next.date, projected: true }] : [])];

  const table = el('table', { class: 'matrix' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Ürün'),
    cols.map((c) => el('th', { title: c.projected ? 'Çip nesli henüz duyurulmadı — öngörülen çıkış' : `Çip çıkışı: ${toISO(c.debut)}` },
      el('div', {}, c.label),
      el('div', { class: 'cell__l' }, c.projected ? `~${fmtShort(c.debut)}` : fmtShort(c.debut))
    ))
  )));

  const tbody = el('tbody');
  for (const f of families) {
    const diff = diffusion.get(f.id);
    const byGen = new Map(diff.lags.map((l) => [l.genKey, l]));
    const pred = f.active ? predictFamily(f.id, state.ctx, { asOf: state.asOf }) : null;
    const devices = state.ctx.byFamily.get(f.id) || [];

    const tr = el('tr', { style: accentStyle(state.categories, f.category) });
    tr.append(el('th', { scope: 'row' },
      el('button', {
        class: 'chip chip--sm', style: { border: 0, background: 'none', padding: 0 },
        onClick: () => openFamily(f.id, state),
      }, f.label)
    ));

    for (const c of cols) {
      const hit = byGen.get(c.key);
      if (hit) {
        const dev = devices.find((d) => d.id === hit.deviceId);
        tr.append(el('td', { class: `cell-td${hit.lag === 0 ? ' cell--first' : ''}`, title: dev?.name },
          el('span', { class: 'cell' },
            el('span', { class: 'cell__d' }, fmtShort(hit.released)),
            el('span', { class: 'cell__l' }, hit.lag === 0 ? 'ilk taşıyıcı' : `+${hit.lag} gün`)
          )
        ));
        continue;
      }

      // Bu ürün bu nesli almamış. Yalnızca modelin hedeflediği nesil için tahmin gösterilir;
      // daha ileriki nesiller için tahmin üstüne tahmin kurmak yanıltıcı olurdu.
      if (pred?.chip?.genKey === c.key) {
        tr.append(el('td', { class: 'cell--pred', title: `Yayılım medyanı +${Math.round(diff.median)} gün` },
          el('span', { class: 'cell' },
            el('span', { class: 'cell__d' }, fmtShort(pred.date)),
            el('span', { class: 'cell__l' }, `tahmin · %${pred.confidence}`)
          )
        ));
      } else {
        const missed = addDays(c.debut, diff.median) <= state.asOf;
        tr.append(el('td', {
          class: 'cell--none',
          title: missed ? 'Bu ürün bu nesli atladı' : 'Henüz sırası gelmedi',
        }, '—'));
      }
    }
    tbody.append(tr);
  }
  table.append(tbody);
  root.append(el('div', { class: 'matrix-wrap' }, table));

  root.append(el('p', { class: 'drawer__sub', style: { marginTop: '14px' } },
    '“İlk taşıyıcı” = o çip nesli ilk kez bu üründe satışa çıktı. ' +
    'Gecikme, çip neslinin ilk satış gününden ölçülür; ürünün kendi duyuru tarihinden değil.'
  ));
}
