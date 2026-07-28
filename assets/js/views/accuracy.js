import { el, clear, stat, fmtShort } from '../ui.js';
import { backtest } from '../engine.js';

/**
 * Modelin kendi doğruluğu. Her aile için son sürüm gizlenir, öncekilerle tahmin
 * edilir, hata ölçülür. Tahmine dayanıp stok kararı verecek biri için bu sayfa
 * tahminlerin kendisi kadar önemli.
 */
export function renderAccuracy(root, state) {
  clear(root);
  const bt = backtest(
    { devices: state.ctx.devices, chips: state.ctx.chips, families: state.ctx.families },
    state.ctx.opt
  );

  root.append(
    el('div', { class: 'section-head' },
      el('h2', {}, 'Model doğruluğu'),
      el('p', {}, `${bt.n} ürün ailesinde geriye dönük sınama: son sürüm gizlenip öncekilerden tahmin edildi.`)
    ),
    el('div', { class: 'acc-grid' },
      stat('Ortanca hata', `${bt.medianError} gün`, 'ailelerin yarısı bundan iyi'),
      stat('Ortalama hata', `${Math.round(bt.mae)} gün`, 'birkaç düzensiz aile şişiriyor'),
      stat('±30 gün isabet', `%${Math.round(bt.hit30 * 100)}`, `±60 gün: %${Math.round(bt.hit60 * 100)}`),
      stat('Pencere kapsaması', `%${Math.round(bt.bandCoverage * 100)}`, 'gerçek tarih bantta kaldı'),
      stat('Sistematik sapma', `${bt.bias > 0 ? '+' : ''}${Math.round(bt.bias)} gün`, bt.bias < 0 ? 'model biraz erken tahmin ediyor' : 'model biraz geç tahmin ediyor')
    )
  );

  root.append(
    el('p', { class: 'drawer__sub' },
      'Nasıl okunmalı: iPhone ve Watch Series gibi takvimi oturmuş aileler gün gün tutuyor. ' +
      'Apple bir yılı atladığında (Watch Ultra 2024, iPad 2023–24) model bunu geçmişten bilemez — ' +
      'bu ailelerin hatası büyük ve güven skoru da zaten düşük çıkıyor.'
    )
  );

  const table = el('table', { class: 'plain' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Ürün ailesi'),
    el('th', {}, 'Gerçek çıkış'),
    el('th', {}, 'Modelin tahmini'),
    el('th', { style: { textAlign: 'right' } }, 'Hata'),
    el('th', { style: { textAlign: 'right' } }, 'Güven'),
    el('th', { style: { textAlign: 'right' } }, 'Bantta')
  )));

  const tbody = el('tbody');
  for (const r of bt.rows) {
    const cls = r.absError <= 30 ? 'err-good' : r.absError <= 90 ? 'err-ok' : 'err-bad';
    tbody.append(el('tr', {},
      el('td', {}, r.label),
      el('td', { class: 'n' }, fmtShort(r.actual)),
      el('td', { class: 'n' }, fmtShort(r.predicted)),
      el('td', { class: `n ${cls}` }, `${r.errorDays > 0 ? '+' : ''}${r.errorDays} g`),
      el('td', { class: 'n' }, `%${r.confidence}`),
      el('td', { class: 'n' }, r.inBand ? '✓' : '—')
    ));
  }
  table.append(tbody);
  root.append(el('div', { class: 'matrix-wrap', style: { marginTop: '16px' } }, table));

  root.append(el('p', { class: 'drawer__sub', style: { marginTop: '14px' } },
    'Negatif hata = model gerçekten erken tahmin etti. ' +
    'Parametreler (λ, eğilim ağırlığı, bant çarpanı) bu tabloyu en iyileyecek şekilde seçildi; ' +
    'ızgaranın tam en iyi noktası yerine ona denk gelen ama kenarda olmayan bir nokta kullanıldı ki ' +
    `${bt.n} örnekte aşırı uyum olmasın.`
  ));
}
