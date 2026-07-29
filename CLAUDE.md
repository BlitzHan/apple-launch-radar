# CLAUDE.md — Apple Launch Radar

Bu dosya, projeye sonradan katılan bir AI asistanının işe koyulmadan önce okuması içindir.
Amaç: kullanıcının her seferinde bağlamı yeniden anlatmak zorunda kalmaması.

---

## 1. Proje nedir, kim için

Kullanıcı **Apple Troy mağazasında** çalışıyor. Apple, mağazalara lansman tarihlerini
önceden bildirmiyor; ekip tahminle stok ve vitrin planlıyor.

Bu site, 2020 (M1 dönemi) sonrası tüm **iPhone / iPad / Mac / Watch** sürümlerinin
geçmişinden yola çıkarak **bir sonraki lansmanın ne zaman olacağını** hesaplıyor.

- **Canlı:** https://blitzhan.github.io/apple-launch-radar/
- **Repo:** `BlitzHan/apple-launch-radar` (public, GitHub Pages, `main` / kök dizin)
- **Yayın:** `main`'e push → Pages otomatik derler. Build adımı yok.

### Değişmez kurallar

| Kural | Neden |
|---|---|
| **Arayüz tamamen Türkçe** | Ürün adları orijinal kalır (iPhone 18, MacBook Air). Kod içi yorumlar da Türkçe. |
| **Build adımı yok** | Saf ES modülleri + `fetch`. Vite/React/Tailwind yok, `package.json` yok. Kullanıcı JSON'u elle düzenleyebilmeli. |
| **Bağımlılık yok** | Ne runtime ne de script tarafında. `node scripts/*.mjs` çıplak Node ile çalışır. |
| **Veri doğruluğu her şeyden önemli** | Mağaza bu tahminlere göre karar veriyor. Tarih uydurma. Emin değilsen `dataQuality: "approx"` işaretle veya web'den doğrula. |
| **Tahmin şeffaf olmalı** | Her tahmin, düz Türkçe gerekçesini üretir (`pred.reasons`). Kara kutu sayı gösterme. |

---

## 2. Dosya yapısı

```
index.html                  tek sayfa; #view-radar / #view-timeline / #view-diffusion
assets/js/
  engine.js       (657)     TÜM tahmin matematiği. Saf fonksiyon, DOM yok, Node'dan import edilebilir.
  main.js         (172)     state, sekme yönlendirme, filtreler, FAMILY_DISPLAY_ORDER
  ui.js           (146)     el() DOM yardımcısı, TR tarih formatları, isimlendirme kuralları
  views/
    radar.js      (~440)    ana ekran: ürün hattı kutuları + hero paneli + akordeon geçmiş
    timeline.js   (239)     yatay Gantt; şerit = lansman hattı
    diffusion.js  (109)     çip yayılım matrisi (ürün × M nesli)
    drawer.js     (212)     sağdan açılan detay paneli
assets/css/       base / components / timeline — Apple tarzı tasarım sistemi, koyu varsayılan
data/             devices.json · chips.json · families.json  ← elle küratörlü
scripts/
  validate-data.mjs         şema + tarih tutarlılığı. DEĞİŞİKLİKTEN SONRA MUTLAKA ÇALIŞTIR.
  calibrate.mjs             backtest ızgara araması; DEFAULTS'u seçmek için
docs/METODOLOJI.md          formüllerin metin karşılığı
server.js                   yerel önizleme (node server.js) — Pages'te gerekmez
```

### Ölü kod — dikkat

`assets/js/views/accuracy.js` ve `views/method.js` **hiçbir yerden import edilmiyor.**
"Model Doğruluğu" ve "Metodoloji" sekmeleri arayüzden kaldırılmış ama dosyalar duruyor.
Bunlara dokunmadan önce kullanıcıya sor: geri mi gelecek, silinecek mi?

---

## 3. Veri modeli

Üç JSON, elle küratörlü. **Kaynak-i doğruluk buradadır**; motor bunlardan türetilir.

### `devices.json` — her satır bir sürüm (~82 kayıt)

```json
{
  "id": "macbook-pro-m5-base",
  "family": "macbook-pro-base",     // kadans birimi (families.json'a referans)
  "category": "mac",
  "name": "MacBook Pro 14\" (M5)",  // arayüzde görünen tam ad
  "chip": "M5",                     // chips.json'a referans
  "announced": "2025-10-15",        // duyuru günü
  "released": "2025-10-22",         // satışa çıkış günü ← motor bunu kullanır
  "channel": "press-release",       // keynote | press-release | wwdc
  "dataQuality": "verified",        // verified | approx
  "source": "https://apple.com/newsroom/..."
}
```

Opsiyonel alanlar:
- **`cadenceSkip: true`** — timeline'da görünür ama **kadans hesabına girmez.**
  Yeni nesil değil, mevcut nesle eklenen varyant içindir (MacBook Air 15" M2, Haz 2023).
  Bunu yanlış kullanmak kadansı bozar.
- `sizes`, `note`

### `families.json` — tahmin birimi

Aile = "aynı ürün hattının nesilleri". Kritik nokta: **hat ayrışırsa aile de ayrışır.**
`macbook-pro-base` (14", baz M çip) ile `macbook-pro-promax` ayrı ailelerdir; çünkü
M5 baz Eki 2025'te, M5 Pro/Max Mar 2026'da çıktı. Tek aile sayılsalardı kadans bozulurdu.

`active: false` olan ailelere gelecek tahmini üretilmez (iPhone mini, Plus, MBP 13").

### `chips.json`

`debut` = o çipin **ilk satışa çıktığı gün** (duyuru değil). Yayılım modelinin çapası budur.
M4'ün bir Mac'te değil **iPad Pro**'da çıktığına dikkat (2024-05-15).

---

## 4. Tahmin motoru (`engine.js`)

Katmanlı ve her katman saf fonksiyon — ayrı test edilebilir.

| # | Katman | Fonksiyon | Ne yapar |
|---|---|---|---|
| 1 | Ağırlıklı kadans | `cadence()` | Nesil aralıklarının `λ^yaş` ağırlıklı ortalaması |
| 2 | Eğilim düzeltmesi | `weightedSlope()` | Apple döngüleri uzatıyor; aralıklara doğru uydurup ileri projekte eder |
| 3 | Mevsimsel oturtma | `seasonality()` / `snapToSeason()` | Dairesel istatistik — iPhone hep 38. hafta. Hafta no'su dairesel (52↔1), düz ortalama yanlış |
| 4 | Çip yayılımı | `chipDiffusion()` | "M nesli çıktıktan kaç gün sonra bu ürüne indi" — ağırlıklı medyan |
| 5 | Tanıtım tarihi | `announceLead()` | duyuru→satış gecikmesinin ağırlıklı medyanı, satıştan geri sayılır |
| — | Birleştirme | `predictFamily()` | Kadans + çip tahminini ters-varyansla harmanlar, güven üretir |
| — | Gruplama | `coLaunchGroups()` | Birlikte çıkan aileleri tek lansman olayı yapar |
| — | Öz-sınama | `backtest()` | Son sürümü gizleyip tahmin eder, hatayı ölçer |

### Parametreler (`DEFAULTS`) nereden geldi

`node scripts/calibrate.mjs` 480 kombinasyon deniyor. Ama **ızgaranın argmin'i alınmadı** —
17 aile üzerinde argmin aşırı uyum (overfit) olurdu. Argmin'e denk gelen ama ızgara
kenarında olmayan bir nokta seçildi.

Güncel performans: **ortanca hata 46 gün**, MAE 152 gün, ±30 günde %41, bant kapsaması %76.
`bandK` varsayımla değil, kapsama ~%75 olacak şekilde ampirik seçildi.

MAE'nin yüksek olması normal: Apple'ın bir yılı atladığı aileler (Watch Ultra 2024'ü atladı,
iPad 868 gün bekledi) hatayı domine ediyor. Ortanca hata daha dürüst bir gösterge.

### Parametre değiştirirsen

`calibrate.mjs`'i tekrar çalıştır ve sonucu commit mesajına yaz. Metrik kötüleşiyorsa geri al.

---

## 5. Kritik tasarım kararları (bunları bozma)

Bunlar deneme yanılmayla bulundu; "sadeleştirme" adına geri alınırsa hata geri gelir.

**Lansman gruplama kuralı** (`coLaunchGroups`) — elle liste tutulmaz, veriden çıkarılır:
- Aynı kategori + tarihlerin ≥%60'ı çakışıyor + **en az 2 ortak tarih**
- **En son sürümleri de birlikte çıkmış olmalı** → ayrışmış hatları korur (MBP baz vs Pro/Max)
- Tek nesilli yeni ürünler (iPhone Air) **ayrı geçişte** ve yalnızca **zaten çok modelli**
  bir gruba katılır. Yoksa MacBook Neo tek veri noktasıyla iki grubu köprülüyordu.

**Güvenler toplanmaz.** Bir grubun tarihi/güveni *en çok geçmişi olan üyeden* alınır.
4 model aynı olayı tahmin ediyor — bu 4 kat kanıt değil.

**Çip hedefi seçimi:** "en eski alınmamış nesil" değil, *gecikme eklendiğinde hâlâ gelecekte
kalan en erken nesil*. Ürünler nesil atlayabiliyor (Mac mini M3'ü hiç almadı).
Bu düzeltme Mac mini hatasını −203 günden +46 güne çekti.

**Ortalama değil medyan** — çip gecikmesi ve tanıtım gecikmesinde. Tekil olaylar sapıyor
(Watch Series 7 duyurudan 31 gün sonra satışa çıktı; tipik değer 7–10 gün).

**Etkinlik kümeleme pencereleri farklı:**
- Geçmiş **7 gün** — bunlar kayıt, dar olmalı. 14 gün, iPhone 16e'yi (19 Şub 2025) ayrı bir
  duyuru olan Mart dalgasıyla birleştiriyordu.
- Gelecek **14 gün** — bunlar tahmin, belirsizlik payı geniş pencereyi haklı çıkarır.

**İsimlendirme** (`ui.js/expectedName`): iPhone ve Watch **model numarasıyla** anılır
(`iPhone 18`, `Apple Watch Series 12`); Mac ve iPad **çip nesliyle** (`MacBook Air (M6)`).
Mac/iPad adlarındaki sayı ekran boyutudur — `modelToken()`'ı oralarda kullanma, `14"` çıkar.

**Ürün hattı kutuları** (`radar.js/LINEUPS`): radar ekranının üstündeki 6 kutu — iPhone ·
iPad Pro · iPad Air · Apple Watch · MacBook Pro · MacBook Air. Kategoriye göre değil **hatta**
göre bölünür, çünkü mağazada müşteri "iPad" değil "iPad Pro" sorar. Her hattın `lead` ailesi
kutunun adını ve tarihlerini verir; `with` listesindeki kardeş aileler yalnızca `+2` rozeti
olarak görünür. Kutuya tıklamak hero panelini o hattın ilk gelecek lansman olayına götürür.

**Gecikmiş ürünler gizlenmez.** Tahmin penceresi geçmişse `overdue: true` ile işaretlenir.
"Bu ürün yenilenmeyi geçti" bilgisi mağaza için tahmin kadar değerli.

---

## 6. Çalışma akışı

```bash
node scripts/validate-data.mjs     # veri değişikliğinden SONRA — sıfır hata bekle
node scripts/calibrate.mjs         # motor parametresi değiştirdiysen
node server.js                     # yerel önizleme (veya .claude/launch.json → "radar", port 8731)
```

Tarayıcıda doğrula: konsol hatasız, 3 sekme de render oluyor, mobil (375px) ve masaüstü
(1280px), açık/koyu tema. `file://` ile açılmaz — `fetch` CORS'a takılır, sunucu şart.

Yayın: `git push origin main` → Pages derler (~1–2 dk).
Durum: `gh api repos/BlitzHan/apple-launch-radar/pages --jq .status`

`validate-data.mjs`'in 6 uyarısı normaldir (2020 öncesi çipler + tek nesilli 3 aile).

---

## 7. Sık yapılacak işler

**Yeni cihaz eklemek** → `devices.json`'a satır. Çip yoksa `chips.json`'a da ekle.
Yeni hat ise `families.json`'a aile. Sonra `validate-data.mjs`. Gerçek tarihi bilmiyorsan
web'den doğrula; uydurma.

**Yeni kategori (AirPods, Vision Pro…)** → şema destekliyor: `families.json/categories`'e
renk+sıra, aileler, sonra cihazlar. `main.js/FAMILY_DISPLAY_ORDER`'a da ekle.

**Bugünün tarihi** `state.asOf`'tan gelir (`new Date()`). Test için sabitlemek istersen
`predictFamily(..., { asOf })` her yerde parametre kabul eder.

---

## 8. Kullanıcıyla çalışma notları

- Türkçe konuşur, Türkçe yanıt bekler.
- Ürün/tasarım geri bildirimi verir ("şu akıl karıştırıyor", "şunu ekleyebilir miyiz")
  — çözümü kendisi tarif etmez, **sen tasarla**.
- Doğruluk ve dürüstlük önemsiyor: modelin zayıf olduğu yeri gizlemek yerine
  (`Düşük · %14`, `tek nesil, kendi kadansı yok`) açıkça göstermek doğru yaklaşım.
- Hız bekler. Uzun keşif yerine çalışan sonuç + kısa özet.
- Değişiklikten sonra canlıya push etmeyi bekliyor; ayrıca söylemesi gerekmiyor.
