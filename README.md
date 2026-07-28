# Apple Launch Radar

2020'den (M1 dönemi) bugüne Apple **iPhone · iPad · Mac · Watch** sürümlerini tek bir zaman
çizelgesinde gösteren ve geçmiş kadanstan bir sonraki lansmanın **ne zaman olacağını hesaplayan**
statik web sitesi.

Apple lansman tarihlerini mağazalara önceden bildirmiyor. Bu araç tahmini kulaktan dolma
söylentiye değil, ölçülebilir geçmişe dayandırır: her tahminin gerekçesi ve güven skoru açıktır,
ve modelin kendi doğruluğu sitede yayımlanır.

## Ekranlar

| Sekme | Ne işe yarar |
|---|---|
| **Radar** | Önümüzdeki 12 ayın beklenen lansmanları, tarihe göre sıralı. Birlikte çıkan modeller (iPhone 18 + Pro + Pro Max + Air) tek satırda. Gecikmiş yenilemeler en üstte. |
| **Zaman Çizelgesi** | 2020'den bugüne tüm sürümler + tahminler; lansman hattı başına bir şerit, güven aralığı bandıyla. |
| **Çip Yayılımı** | Satır = ürün, kolon = çip nesli. "M5 önce 14″ MacBook Pro'ya, 140 gün sonra MacBook Air'e geldi." |
| **Model Doğruluğu** | Geriye dönük sınama: model son sürümleri ne kadar isabetli tahmin ediyordu. |
| **Metodoloji** | Formüllerin ve sınırların açık anlatımı. |

## Tahmin nasıl çalışıyor

Beş katman, hepsi geçmiş tarihlerden türetiliyor:

1. **Ağırlıklı kadans** — nesiller arası gün farklarının, yakın nesillere ağırlık veren ortalaması.
2. **Eğilim düzeltmesi** — Apple'ın yenileme döngüleri uzuyor; aralıklara doğru uydurulup ileri projekte ediliyor.
3. **Mevsimsel oturtma** — Apple bir ürünü hep yılın aynı haftasında çıkarır; dairesel istatistikle hedef hafta bulunup tahmin oraya çekiliyor.
4. **Çip yayılımı** — bir çip nesli piyasaya çıktıktan kaç gün sonra bu ürüne indiğinin ağırlıklı medyanı. Nesil atlamaları hesaba katılıyor.
5. **Lansman gruplama** — geçmişte hep aynı gün çıkan aileler tek olay sayılıyor (iPhone 18 + Pro + Pro Max + Air); kural elle yazılmıyor, tarih çakışmalarından çıkarılıyor. Ayrışmış hatlar (MacBook Pro baz M vs Pro/Max) ayrı kalıyor.
6. **Birleştirme** — kadans ve çip yayılımı ters-varyansla harmanlanıyor; güven skoru veri derinliği, tutarlılık ve iki kanalın uyumundan hesaplanıyor.

Ayrıntı ve formüller: sitedeki **Metodoloji** sekmesi.

### Şu anki doğruluk

`node scripts/calibrate.mjs` çıktısından (17 aile, son sürüm gizlenip öncekilerden tahmin edilerek):

- Ortanca hata **46 gün** · ortalama hata 152 gün
- ±30 günde isabet **%41** · ±60 günde **%53**
- Gösterilen pencere gerçek tarihi **%76** oranında kapsıyor

iPhone ve Watch Series gibi takvimi oturmuş aileler **gün gün** tutuyor (hata 0). Ortalamayı
şişiren, Apple'ın bir yılı atladığı aileler (Watch Ultra 2024, iPad 2023–24) — model bunu
geçmişten bilemez ve o ailelerde güven skoru da zaten düşük çıkar.

## Veri

`data/` altında üç düz JSON dosyası, elle küratörlü. Otomatik toplama yok: doğruluk hızdan önemli.

- `devices.json` — her sürüm için duyuru tarihi, satış tarihi, çip, kaynak, veri kalitesi
- `chips.json` — çip nesilleri ve piyasaya ilk çıkış günleri
- `families.json` — ürün aileleri (tahmin motorunun kadans birimi) ve kategoriler

**Yeni ürün eklemek:** `data/devices.json`'a bir satır ekleyip kaydet. Build yok, tahminler
sayfa açıldığında yeniden hesaplanır.

```bash
node scripts/validate-data.mjs   # tarih sırası, çip referansları, kopya kayıt denetimi
node scripts/calibrate.mjs       # parametreleri backtest ile yeniden ara
```

## Yerel çalıştırma

Site tamamen statiktir ama JSON'ları `fetch` ile yüklediği için `file://` üzerinden açılmaz.

```bash
node server.js
```

Sonra <http://localhost:8731>.

## Yapı

```
index.html
assets/css/    base · components · timeline
assets/js/
  engine.js      tahmin motoru — saf fonksiyonlar, Node'dan da import edilebilir
  ui.js          Türkçe tarih biçimleme ve DOM yardımcıları
  main.js        durum, sekmeler, filtreler
  views/         radar · timeline · diffusion · accuracy · method · drawer
data/          devices · chips · families
scripts/       validate-data · calibrate
```

Bağımlılık yok, build adımı yok, çerçeve yok. GitHub Pages doğrudan `main` dalından yayınlar.

## Sınırlar

Model geçmiş kalıpları uzatır; Apple'ın stratejik kararlarını göremez. Bir ürünün yılı atlanması,
tek nesli olan yeni ürünler (MacBook Neo, iPhone Air), hat bölünmeleri ve tedarik gecikmeleri
modelin dışındadır. Bu yüzden her tahminin yanında bir güven skoru ve bir pencere var:
dar pencere + yüksek güven planlanabilir, geniş pencere + düşük güven "şu aralıkta olabilir"
demektir — takvime yazılmaz.

Bu proje bağımsız bir analiz aracıdır; Apple ile ilişkisi yoktur ve içindeki hiçbir tahmin
resmî bilgi değildir.
