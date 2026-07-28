# Metodoloji

Sitedeki **Metodoloji** sekmesinin metin karşılığı. Formüllerin uygulaması
[`assets/js/engine.js`](../assets/js/engine.js) içinde, hepsi saf fonksiyon.

## Ne tahmin ediliyor

Motor **satışa çıkış** tarihini (`released`) tahmin eder, duyuru tarihini değil. Mağaza için
stok günü olan budur. Duyuru tarihi veride ayrıca tutulur ve arayüzde gösterilir.

Kadans birimi **ürün ailesi**dir, tek tek modeller değil. Örneğin `macbook-pro-base`
(baz M çipli 14″) ile `macbook-pro-promax` (Pro/Max çipli 14/16″) ayrı ailelerdir; çünkü
Apple bunları M5 neslinden beri farklı takvimlerde çıkarıyor ve tek aile saymak kadansı bozar.

Mevcut nesle sonradan eklenen ekran boyutları (15″ MacBook Air, Haziran 2023) `cadenceSkip: true`
ile işaretlenir: zaman çizelgesinde görünür ama aralık hesabına girmez.

## 1. Ağırlıklı kadans

Sürüm tarihleri arasındaki gün farkları alınır, yakın nesiller daha çok ağırlıklandırılır:

```
wᵢ = λ^(yaş)                λ = 0,8
μ = Σ wᵢ·gᵢ / Σ wᵢ
σ = √( Σ wᵢ(gᵢ−μ)² / Σ wᵢ )
```

Bir ailede iki sürümden az varsa (MacBook Neo, iPhone Air, Mac Pro) kategorinin medyan
kadansına düşülür ve güven cezalandırılır.

## 2. Eğilim düzeltmesi

Apple'ın yenileme aralıkları birçok üründe uzuyor. Sadece ortalama almak modeli sistematik
olarak erken tahmin etmeye itiyordu. Aralıklara ağırlıklı en küçük karelerle doğru uydurulur:

```
eğim       = ağırlıklı_eğim(gᵢ)
projeksiyon = μ + eğim·(n − x̄)      →  [0,6μ , 2,2μ] aralığına kırpılır
μ*          = (1−t)·μ + t·projeksiyon     t = 0,75
```

Kırpma, üç dört gözlemden uydurulan bir doğrunun saçma değerlere gitmesini engeller.
Bu düzeltme geriye dönük sınamada sistematik sapmayı **−99 günden −18 güne** indirdi.

## 3. Mevsimsel oturtma

Apple bir ürünü neredeyse hep yılın aynı haftasında çıkarır. Hafta numaraları dairesel
olduğu için (52. hafta ile 1. hafta komşudur) düz ortalama yanlıştır; açı ortalaması kullanılır:

```
θᵢ = 2π·haftaᵢ / 52,18
C  = Σwᵢcos θᵢ ,  S = Σwᵢsin θᵢ
hedef hafta = 52,18·atan2(S, C) / 2π
R  = √(C² + S²)          ← kalıp gücü: 0 dağınık, 1 kusursuz
```

Ham tahmin hedef haftaya en yakın tarihe çekilir. Kaydırma `R/0,6` ile ölçeklenir, en fazla
100 gün olabilir, sonra ailenin baskın haftagününe yuvarlanır.

Örnek: iPhone ailesinde R ≈ 0,99 (38. hafta) — tam oturtma yapılır.
Mac Studio'da R düşüktür — oturtma neredeyse hiç uygulanmaz.

## 4. Çip yayılımı

Mac ve iPad'de asıl soru cihaz değil çip. Her çip **nesli** için (M5, M5 Pro, M5 Max aynı nesil;
nesil çıkışı = o nesildeki en erken kademenin satış günü) yayılım gecikmesi ölçülür:

```
gecikme(ürün, nesil) = çıkış(ürün, nesil) − nesil_ilk_satış
```

MacBook Air ölçümleri:

| Nesil | İlk satış | MacBook Air | Gecikme |
|---|---|---|---|
| M1 | 17 Kas 2020 | 17 Kas 2020 | +0 (ilk taşıyıcı) |
| M2 | 24 Haz 2022 | 15 Tem 2022 | +21 |
| M3 | 7 Kas 2023 | 8 Mar 2024 | +122 |
| M4 | 15 May 2024 | 12 Mar 2025 | +301 |
| M5 | 22 Eki 2025 | 11 Mar 2026 | +140 |

→ ağırlıklı medyan ≈ **140 gün**. M6 için tahmin: `M6 ilk satış + 140 gün`.

Çip henüz duyurulmamışsa (M6) önce çip serisinin kendi kadansından çıkış tarihi öngörülür,
sonra gecikme eklenir. İki katmanlı tahmindir: varyanslar toplanır, güven ×0,8 ile cezalandırılır.

### Nesil atlama

Bir ürün bir nesli hiç almayabilir — Mac mini M3'ü atladı. Bu yüzden model "en eski alınmamış
nesli" hedeflemez; **gecikme eklendiğinde hâlâ gelecekte kalan en erken nesli** hedefler.
Bu düzeltme Mac mini hatasını −203 günden +46 güne çekti.

## 5. Birleştirme ve güven

Kadans tahmini ile çip yayılımı tahmini bağımsız iki kanaldır, ters-varyansla harmanlanır:

```
T = (T_kadans/σ_k² + T_çip/σ_ç²) / (1/σ_k² + 1/σ_ç²)
σ = √( 1 / (1/σ_k² + 1/σ_ç²) )
```

Güven skoru:

```
güven = 100 · √(1 − σ/0,5μ) · (1 − e^(−n/3)) · (0,6 + 0,4R)
        × 0,8   iki katmanlı tahminse
        × ceza  iki kanal σ'dan fazla ayrışıyorsa

Yüksek ≥ 70    Orta 45–70    Düşük < 45
```

Gösterilen pencere `±2,5σ`. Bu çarpan normal dağılım varsayımıyla değil, geriye dönük sınamada
gerçek tarihlerin ~%75'ini kapsayacak en küçük değer olarak **ölçülerek** seçildi.

## Kalibrasyon

`scripts/calibrate.mjs` her aile için son sürümü gizler, öncekilerden tahmin eder, hatayı ölçer
ve parametre ızgarasını tarar. Sıralama ölçütü **ortanca hata**dır (birkaç düzensiz aile
ortalamayı domine ettiği için).

Seçilen parametreler bilerek ızgaranın en iyi noktası değil, ona denk gelen ama kenarda olmayan
bir noktadır — 17 örnekte argmin almak aşırı uyum olurdu.

```
λ = 0,8    çipλ = 0,5    snapFloor = 0,6    trend = 0,75    bandK = 2,5
```

## Sınırlar

- **Atlanan yıllar.** Apple bir ürünü bir yıl atlarsa (Watch Ultra 2024'te atladı) model bunu
  geçmişten öngöremez; hata bir yıla yaklaşır.
- **Yeni ürünler.** Tek nesli olan aileler kategori medyanına düşer; güven skoru bunu yansıtır.
- **Strateji değişiklikleri.** iPhone hattının iki mevsime bölünmesi gibi kararlar geçmiş veride yoktur.
- **Tedarik.** Çip üretimi veya bileşen gecikmeleri modelin göremediği dış etkenlerdir.

Her tahminin yanında güven skoru ve pencere bu yüzden var.
