import { el, clear, fmtShort, accentStyle } from '../ui.js';
import { predictFamily, predictNextChipGen, chipGenerations, toDate, toISO, addDays, diffDays } from '../engine.js';
import { openFamily } from './drawer.js';

/**
 * Excel Mantığı ile Çip & Model Matrisi.
 * Satır = Ürün Ailesi (iPhone, iPad, Mac, Watch).
 * Sütun = Çip Nesli (M1, M2, M3, M4 veya A16, A17, A18, A19...).
 * Hücre = O çipi aldığı tarih + çip çıkışından kaç gün sonra aldığı.
 * Gelecek Hücreleri = Tahmini çıkış tarihi + Tahmin mantığı bağlantısı.
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

  // Üst Bilgilendirme ve Filtre
  root.append(
    el('div', { class: 'section-head' },
      el('h2', {}, `${series}-Serisi İşlemci & Model Matrisi`),
      el('p', {}, 'İşlemcilerin duyuru tarihleri ile cihazların bu çipleri alma sürelerinin Excel matrisi. Kesikli hücreler bir sonraki tahmini temsil eder.')
    ),
    el('div', { class: 'excel-banner' },
      el('div', { class: 'excel-banner__item' },
        el('span', { class: 'excel-badge excel-badge--first' }, 'İlk Taşıyıcı'),
        el('span', {}, 'İşlemcinin ilk kez çıktığı cihaz (+0 gün)')
      ),
      el('div', { class: 'excel-banner__item' },
        el('span', { class: 'excel-badge excel-badge--received' }, 'Çıkış Tarihi'),
        el('span', {}, 'Cihazın o çiple satışa çıktığı tarih (+X gün gecikme)')
      ),
      el('div', { class: 'excel-banner__item' },
        el('span', { class: 'excel-badge excel-badge--pred' }, 'Tahmini Çıkış'),
        el('span', {}, 'Gelecek çipi alma öngörüsü (Çip Kadansı)')
      )
    ),
    el('div', { class: 'filters', style: { marginBottom: '20px' } },
      el('div', { class: 'chipset' },
        ['M', 'A'].map((s) => el('button', {
          class: `chip${s === series ? ' chip--active' : ''}`,
          'aria-pressed': String(s === series),
          onClick: () => { state.chipSeries = s; state.render(); },
        }, `${s}-Serisi İşlemciler (${s === 'M' ? 'Mac & iPad' : 'iPhone & Neo'})`))
      )
    )
  );

  if (!families.length) {
    root.append(el('div', { class: 'card empty' }, 'Bu filtrelerle gösterilecek ürün yok.'));
    return;
  }

  const cols = [
    ...gens.map((g) => ({ key: g.key, label: g.key, debut: toDate(g.debut), projected: false })),
    ...(next ? [{ key: next.key, label: `${next.key} (Gelecek)`, debut: next.date, projected: true }] : [])
  ];

  const table = el('table', { class: 'excel-table' });

  // Sütun Başlıkları (Çip Adı + Çıkış Tarihi)
  table.append(el('thead', {}, el('tr', {},
    el('th', { class: 'excel-th-head' }, 'Ürün / Model'),
    cols.map((c) => el('th', {
      class: `excel-th-col${c.projected ? ' excel-th-col--pred' : ''}`,
      title: c.projected ? 'Öngörülen Çip Çıkış Dönemi' : `İşlemci Duyuru Tarihi: ${toISO(c.debut)}`
    },
      el('div', { class: 'excel-chip-name' }, c.label),
      el('div', { class: 'excel-chip-date' }, c.projected ? `~${fmtShort(c.debut)}` : fmtShort(c.debut))
    ))
  )));

  // Satırlar (Ürün Aileleri)
  const tbody = el('tbody');
  for (const f of families) {
    const diff = diffusion.get(f.id);
    const byGen = new Map(diff.lags.map((l) => [l.genKey, l]));
    const pred = f.active ? predictFamily(f.id, state.ctx, { asOf: state.asOf }) : null;
    const devices = state.ctx.byFamily.get(f.id) || [];

    const tr = el('tr', { style: accentStyle(state.categories, f.category) });
    tr.append(el('th', { scope: 'row', class: 'excel-row-head' },
      el('button', {
        class: 'excel-row-btn',
        onClick: () => openFamily(f.id, state),
      },
        el('span', { class: 'excel-row-cat' }, state.categories.find((c) => c.id === f.category)?.label),
        el('span', { class: 'excel-row-name' }, f.label)
      )
    ));

    for (const c of cols) {
      const hit = byGen.get(c.key);
      if (hit) {
        const dev = devices.find((d) => d.id === hit.deviceId);
        const isFirst = hit.lag === 0;
        tr.append(el('td', {
          class: `excel-cell${isFirst ? ' excel-cell--first' : ' excel-cell--hit'}`,
          title: `${dev?.name ?? f.label}: ${fmtShort(hit.released)} (Çip çıkışından ${hit.lag} gün sonra)`
        },
          el('div', { class: 'excel-cell__main' }, fmtShort(hit.released)),
          el('div', { class: 'excel-cell__sub' }, isFirst ? ' İlk taşıyıcı' : `+${hit.lag} gün`)
        ));
        continue;
      }

      // Gelecek Tahmini Hücresi
      if (pred?.chip?.genKey === c.key) {
        tr.append(el('td', {
          class: 'excel-cell excel-cell--pred',
          title: `Tahmini Lansman: ${fmtShort(pred.date)} (Yayılım ortalaması +${Math.round(diff.median)} gün)`
        },
          el('div', { class: 'excel-cell__main' }, fmtShort(pred.date)),
          el('div', { class: 'excel-cell__sub' }, `Tahmin · %${pred.confidence}`)
        ));
      } else {
        const missed = addDays(c.debut, diff.median) <= state.asOf;
        tr.append(el('td', {
          class: 'excel-cell excel-cell--empty',
          title: missed ? 'Bu ürün bu nesli atladı' : 'Henüz bu nesle geçmedi',
        }, '—'));
      }
    }
    tbody.append(tr);
  }
  table.append(tbody);

  root.append(el('div', { class: 'matrix-wrap excel-wrap' }, table));

  root.append(el('p', { class: 'drawer__sub', style: { marginTop: '16px' } },
    '“İlk taşıyıcı” = Apple\'ın o çip neslini ilk kez vitrine çıkardığı cihaz. ' +
    'Gecikme süreleri (+X gün), işlemcinin ilk çıkış tarihinden itibaren hesaplanır.'
  ));
}
