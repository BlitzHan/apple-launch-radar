import { el, clear } from '../ui.js';
import { DEFAULTS } from '../engine.js';

export function renderMethod(root, state) {
  clear(root);
  const o = state.ctx.opt;
  const d = state.ctx.devices.length;
  const f = state.ctx.families.length;

  const p = (...kids) => el('p', {}, ...kids);
  const h = (t) => el('h3', {}, t);
  const code = (t) => el('code', {}, t);
  const formula = (t) => el('div', { class: 'formula' }, t);

  root.append(el('div', { class: 'prose' },
    h('Ne yapıyor'),
    p('Apple lansman tarihlerini önceden duyurmuyor. Bu site, ', el('strong', {}, `${d} sürümün`),
      ` ${f} ürün ailesindeki geçmiş kadansından yola çıkarak bir sonraki yenilemenin ne zaman olacağını hesaplıyor. `,
      'Tahmin değil, ölçüm tabanlı bir projeksiyon: her sayı geçmiş tarihlerden türetiliyor ve her tahminin gerekçesi açık.'),
    p('Motor satışa çıkış tarihini (', code('released'), ') tahmin ediyor, duyuru tarihini değil. ',
      'Mağaza için stok günü olan budur; duyuru tarihi ayrıca gösteriliyor.'),

    h('1. Ağırlıklı kadans — ne sıklıkta yenileniyor?'),
    p('Bir ailenin sürüm tarihleri arasındaki gün farkları alınır. Yakın nesiller daha çok ağırlıklandırılır, ',
      'çünkü Apple\'ın son yıllardaki davranışı on yıl öncekinden daha bilgilendirici.'),
    formula(`wᵢ = λ^(yaş)                 λ = ${o.lambda}\nμ = Σ wᵢ·gᵢ / Σ wᵢ         (gᵢ = nesiller arası gün)\nσ = √( Σ wᵢ(gᵢ−μ)² / Σ wᵢ )`),

    h('2. Eğilim düzeltmesi — döngüler uzuyor'),
    p('Apple\'ın yenileme aralıkları birçok üründe zamanla uzuyor. Sadece ortalama almak modeli sistematik olarak ',
      'erken tahmin etmeye itiyordu. Aralıklara ağırlıklı bir doğru uydurulup bir sonraki aralık ileri projekte ediliyor ',
      've düz ortalama ile harmanlanıyor.'),
    formula(`eğim = ağırlıklı en küçük kareler(gᵢ)\nprojeksiyon = μ + eğim·(n − x̄)      [0,6μ , 2,2μ] aralığına kırpılır\nμ* = (1−t)·μ + t·projeksiyon        t = ${o.trend}`),
    p('Bu düzeltme geriye dönük sınamada sistematik sapmayı ', code('−99 gün'), '\'den ', code('−18 gün'), '\'e indirdi.'),

    h('3. Mevsimsel oturtma — yılın hangi haftasında?'),
    p('Apple bir ürünü neredeyse hep yılın aynı haftasında çıkarır: iPhone 38. hafta, MacBook Air mart başı. ',
      'Hafta numaraları dairesel olduğu için (52 ile 1 komşudur) düz ortalama yanlış sonuç verir; açı ortalaması kullanılır.'),
    formula(`θᵢ = 2π·haftaᵢ / 52,18\nC = Σwᵢcos θᵢ ,  S = Σwᵢsin θᵢ\nhedef hafta = 52,18·atan2(S, C) / 2π\nR = √(C²+S²)        ← kalıp gücü: 0 dağınık, 1 kusursuz`),
    p('Ham tahmin, hedef haftaya en yakın tarihe çekilir. Kaydırma R ile ölçeklenir (R ≥ ', code(String(o.snapFloor)),
      ' ise tam), en fazla ', code(`${o.maxSnapDays} gün`), ' kaydırılır ve ailenin baskın haftagününe yuvarlanır.'),

    h('4. Çip yayılımı — M5 önce hangi ürüne, sonra hangisine?'),
    p('Mac ve iPad\'de asıl soru cihaz değil çip. Her çip nesli için ', el('strong', {}, 'yayılım gecikmesi'),
      ' ölçülür: o nesil piyasaya çıktıktan kaç gün sonra bu ürüne indi?'),
    formula(`gecikme(ürün, nesil) = çıkış(ürün, nesil) − ilk satış(nesil)\n\nörnek — MacBook Air:\n  M1  +0 gün    (ilk taşıyıcı)\n  M2  +21 gün\n  M3  +122 gün\n  M4  +301 gün\n  M5  +140 gün\n  → ağırlıklı medyan ≈ 140 gün`),
    p('Yeni bir nesil için tahmin: ', code('çip ilk satış + medyan gecikme'), '. Çip henüz duyurulmamışsa (M6 gibi) ',
      'önce çip serisinin kendi kadansından çıkış tarihi öngörülür, sonra gecikme eklenir — iki katmanlı tahmin, ',
      'belirsizlikler toplanır ve güven düşürülür.'),
    p(el('strong', {}, 'Nesil atlama: '), 'bir ürün bir nesli hiç almayabilir (Mac mini M3\'ü atladı). ',
      'Bu yüzden model “en eski alınmamış nesil”i değil, gecikme eklendiğinde hâlâ gelecekte kalan en erken nesli hedefler. ',
      'Bu düzeltme Mac mini hatasını ', code('−203'), '\'ten ', code('+46 güne'), ' çekti.'),

    h('5. Birlikte çıkan modellerin gruplanması'),
    p('iPhone 17, 17 Pro ve 17 Pro Max aynı gün satışa çıkar; bunları ayrı ayrı listelemek ',
      'aynı olayı üç kez göstermek olur. Radar ve zaman çizelgesi bu yüzden ürün ailesi değil ',
      el('strong', {}, 'lansman olayı'), ' gösterir. Gruplama elle yazılmaz, veriden çıkarılır:'),
    el('ul', {},
      el('li', {}, 'Aileler aynı kategoride olacak.'),
      el('li', {}, 'Sürüm tarihlerinin en az %60\'ı çakışacak ve en az iki ortak tarih bulunacak.'),
      el('li', {}, el('strong', {}, 'En son sürümleri de birlikte çıkmış olacak. '),
        'Bu kısıt, artık ayrışmış hatları yanlışlıkla birleştirmeyi önler: MacBook Pro\'nun baz M ' +
        'modeli Ekim 2025\'te, Pro/Max modelleri Mart 2026\'da çıktı — eskiden birlikte çıksalar da ' +
        'artık ayrı iki olaydır.'),
      el('li', {}, 'Tek nesilli yeni bir ürün (iPhone Air) mevcut ve çok modelli bir olaya katılabilir, ' +
        'ama tek ortak tarihten yeni bir olay uyduramaz ve iki yerleşik grubu birbirine bağlayamaz.'),
    ),
    p('Bir grubun tarihi ve güveni ', el('strong', {}, 'en çok geçmişi olan üyeden'), ' alınır. ',
      'Üyeler aynı olayı tahmin ettiği için bağımsız kanıt sayılmaz — güvenler toplanmaz.'),
    p(el('strong', {}, 'İsimlendirme: '), 'iPhone ve Watch pazarlamada model numarasıyla anılır, ',
      'o yüzden tahmin ', code('iPhone 18'), ' / ', code('Apple Watch Series 12'), ' diye gösterilir. ',
      'Mac ve iPad\'de belirleyici olan çip nesli olduğu için oralarda ', code('MacBook Air (M6)'),
      ' biçimi kullanılır.'),

    h('6. Birleştirme ve güven'),
    p('Kadans tahmini ile çip yayılımı tahmini bağımsız iki kanaldır; ters-varyansla harmanlanır — ',
      'hangisi daha kesinse ona daha çok ağırlık verilir.'),
    formula(`T = (T_kadans/σ_k² + T_çip/σ_ç²) / (1/σ_k² + 1/σ_ç²)\nσ = √( 1 / (1/σ_k² + 1/σ_ç²) )`),
    p('Güven skoru dört şeye bakar: aralıkların ne kadar tutarlı olduğu, kaç nesil veri bulunduğu, ',
      'takvim kalıbının gücü (R) ve iki kanalın birbirini doğrulayıp doğrulamadığı.'),
    formula(`güven = 100 · √(1 − σ/0,5μ) · (1 − e^(−n/3)) · (0,6 + 0,4R)\n         × 0,8   iki katmanlı tahminse\n         × ceza  iki kanal ayrışıyorsa\n\nYüksek ≥ 70    Orta 45–70    Düşük < 45`),
    p('Gösterilen pencere ', code(`±${o.bandK}σ`), '. Bu çarpan varsayımla değil, geriye dönük sınamada ',
      'gerçek tarihlerin ~%75\'ini kapsayacak şekilde ölçülerek seçildi.'),

    h('Sınırlar — neyi bilemez'),
    el('ul', {},
      el('li', {}, el('strong', {}, 'Atlanan yıllar. '), 'Apple bir ürünü bir yıl atlarsa (Watch Ultra 2024\'te atladı) model bunu geçmişten öngöremez; o ailelerde hata bir yıla yaklaşır.'),
      el('li', {}, el('strong', {}, 'Yeni ürünler. '), 'Tek nesli olan aileler (MacBook Neo, iPhone Air, Mac Pro) kategori medyanına düşer; güven skoru bunu yansıtır.'),
      el('li', {}, el('strong', {}, 'Strateji değişiklikleri. '), 'iPhone hattının iki mevsime bölünmesi gibi kararlar geçmiş veride yoktur.'),
      el('li', {}, el('strong', {}, 'Tedarik aksaklıkları. '), 'Çip üretimi veya bileşen gecikmeleri modelin göremediği dış etkenlerdir.'),
    ),
    p('Bu yüzden her tahminin yanında güven skoru ve pencere var. Dar pencere + yüksek güven planlanabilir; ',
      'geniş pencere + düşük güven “şu aralıkta olabilir” demektir, takvime yazılmaz.'),

    h('Veri'),
    p('Veri elle küratörlü ve ', code('data/*.json'), ' altında düz JSON. Otomatik toplama yok — doğruluk hızdan önemli. ',
      'Her kayıtta duyuru tarihi, satış tarihi, çip ve kaynak var. ', code('node scripts/validate-data.mjs'),
      ' tarih sırası, çip referansları ve kopya kayıtları denetler; ', code('node scripts/calibrate.mjs'),
      ' parametreleri backtest ile yeniden arar.'),
    p('Yeni bir ürün çıktığında yapılacak tek şey ', code('data/devices.json'), '\'a bir satır eklemek. ',
      'Site build gerektirmiyor; dosya kaydedildiği an tahminler yeniden hesaplanır.')
  ));
}
