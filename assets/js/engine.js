/**
 * Tahmin motoru — saf fonksiyonlar, DOM bağımlılığı yok.
 * Node'dan da import edilebilir (backtest/kalibrasyon için).
 *
 * Katmanlar:
 *   1. Ağırlıklı kadans      — aile ne sıklıkta yenileniyor?
 *   2. Mevsimsel oturtma     — yılın hangi haftasında yenileniyor? (dairesel istatistik)
 *   3. Çip yayılımı          — bir çip nesli çıktıktan kaç gün sonra bu ürüne iniyor?
 *   4. Birleştirme + güven   — ters-varyans harmanlama, güven skoru, aralık
 */

export const DAY = 86400000;
export const WEEKS_PER_YEAR = 52.1775;

/** Varsayılan parametreler — scripts/calibrate.mjs bunları backtest ile arar. */
/**
 * Varsayılan parametreler. `node scripts/calibrate.mjs` ile backtest üzerinden seçildi.
 * Bilerek ızgaranın en iyi noktası değil, ona denk gelen ama kenarda olmayan bir nokta
 * kullanıldı — 17 aile üzerinde argmin almak aşırı uyum (overfit) demek olurdu.
 */
export const DEFAULTS = {
  lambda: 0.8,       // kadans zaman ağırlığı (küçük = son nesillere daha çok güven)
  chipLambda: 0.5,   // çip yayılım gecikmesi ağırlığı
  snapFloor: 0.6,    // bu R değerinin üstünde tam mevsimsel oturtma yapılır
  maxSnapDays: 100,  // mevsimsel oturtmanın kaydırabileceği azami gün
  minSigma: 18,      // hiçbir tahmin bundan daha kesin gösterilmez (gün)
  trend: 0.75,       // kadans eğilimi ağırlığı: Apple döngüleri uzatıyor (0 = eğilimi yok say)
  bandK: 2.5,        // aralık genişliği = bandK × sigma; backtest'te ~%75 kapsama verir
};

/* ------------------------------------------------------------------ tarih */

export const toDate = (iso) => new Date(iso + 'T00:00:00Z');
export const toISO = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + Math.round(n) * DAY);
export const diffDays = (a, b) => Math.round((a.getTime() - b.getTime()) / DAY);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** ISO 8601 hafta numarası (1–53). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7);
}

/** Verilen yıl/ISO hafta/haftagünü için tarih. dow: 0=Paz … 6=Cmt */
export function dateOfIsoWeek(year, week, dow) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = addDays(jan4, 1 - (jan4.getUTCDay() || 7));
  const monday = addDays(week1Monday, (week - 1) * 7);
  return addDays(monday, (dow === 0 ? 7 : dow) - 1);
}

/* ------------------------------------------------------- ağırlıklı istatistik */

/** En yeni gözlem sonda; ağırlık lambda^(yaş). */
export function decayWeights(n, lambda) {
  return Array.from({ length: n }, (_, i) => Math.pow(lambda, n - 1 - i));
}

export function weightedMean(xs, ws) {
  const W = ws.reduce((a, b) => a + b, 0);
  return W === 0 ? 0 : xs.reduce((s, x, i) => s + x * ws[i], 0) / W;
}

export function weightedStd(xs, ws, mean) {
  const W = ws.reduce((a, b) => a + b, 0);
  if (W === 0 || xs.length < 2) return 0;
  const v = xs.reduce((s, x, i) => s + ws[i] * (x - mean) ** 2, 0) / W;
  return Math.sqrt(v);
}

/**
 * Ağırlıklı en küçük kareler eğimi (ys, sıralı gözlemler).
 * Apple'ın yenileme döngüsü zamanla uzuyor; bu eğilimi yakalar.
 */
export function weightedSlope(ys, ws) {
  if (ys.length < 3) return 0;
  const W = ws.reduce((a, b) => a + b, 0);
  const mx = ys.reduce((s, _, i) => s + ws[i] * i, 0) / W;
  const my = weightedMean(ys, ws);
  let num = 0, den = 0;
  ys.forEach((y, i) => {
    num += ws[i] * (i - mx) * (y - my);
    den += ws[i] * (i - mx) ** 2;
  });
  return den === 0 ? 0 : num / den;
}

/** Ağırlıklı medyan — aykırı değerlere kadanstan daha dayanıklı, çip gecikmeleri için. */
export function weightedMedian(xs, ws) {
  if (!xs.length) return 0;
  const pairs = xs.map((x, i) => [x, ws[i]]).sort((a, b) => a[0] - b[0]);
  const half = pairs.reduce((s, p) => s + p[1], 0) / 2;
  let acc = 0;
  for (const [x, w] of pairs) {
    acc += w;
    if (acc >= half) return x;
  }
  return pairs[pairs.length - 1][0];
}

/* --------------------------------------------------- Katman 1: kadans */

/**
 * @param {string[]} isoDates kronolojik sıralı satış tarihleri
 * @returns {{gaps:number[], mu:number, sigma:number, n:number, last:string}|null}
 */
export function cadence(isoDates, lambda = DEFAULTS.lambda, trend = DEFAULTS.trend) {
  if (isoDates.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < isoDates.length; i++) {
    gaps.push(diffDays(toDate(isoDates[i]), toDate(isoDates[i - 1])));
  }
  const ws = decayWeights(gaps.length, lambda);
  const flat = weightedMean(gaps, ws);

  // Eğilim terimi: bir sonraki aralığı doğrusal uzatma ile öngör, makul sınırda tut.
  const slope = weightedSlope(gaps, ws);
  const W = ws.reduce((a, b) => a + b, 0);
  const mx = gaps.reduce((s, _, i) => s + ws[i] * i, 0) / W;
  const projected = clamp(flat + slope * (gaps.length - mx), flat * 0.6, flat * 2.2);
  const mu = (1 - trend) * flat + trend * projected;

  // Tek aralık varsa yayılım ölçülemez; %30'luk bir belirsizlik varsayılır.
  const spread = gaps.length >= 2 ? weightedStd(gaps, ws, flat) : flat * 0.3;
  // Eğilim düzeltmesi büyükse belirsizlik de artmalı.
  const sigma = Math.sqrt(spread ** 2 + (0.5 * (mu - flat)) ** 2);
  return { gaps, mu, flat, slope, sigma, n: isoDates.length, last: isoDates[isoDates.length - 1] };
}

/* ----------------------------------------------- Katman 2: mevsimsellik */

/**
 * Hafta numaraları dairesel (52 ile 1 komşu) olduğu için açı ortalaması alınır.
 * @returns {{week:number, R:number, dow:number}} R = kalıp gücü (0 dağınık, 1 kusursuz)
 */
export function seasonality(isoDates, lambda = DEFAULTS.lambda) {
  const ws = decayWeights(isoDates.length, lambda);
  const W = ws.reduce((a, b) => a + b, 0);
  let C = 0, S = 0;
  const dowWeight = new Map();
  isoDates.forEach((iso, i) => {
    const d = toDate(iso);
    const theta = (2 * Math.PI * isoWeek(d)) / WEEKS_PER_YEAR;
    C += ws[i] * Math.cos(theta);
    S += ws[i] * Math.sin(theta);
    const g = d.getUTCDay();
    dowWeight.set(g, (dowWeight.get(g) || 0) + ws[i]);
  });
  C /= W; S /= W;
  let week = (WEEKS_PER_YEAR * Math.atan2(S, C)) / (2 * Math.PI);
  if (week <= 0.5) week += WEEKS_PER_YEAR;
  const dow = [...dowWeight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { week: Math.round(week), R: Math.hypot(C, S), dow };
}

/**
 * Ham tahmini ailenin tipik takvim penceresine çeker.
 * Kaydırma R ile ölçeklenir ve maxSnapDays ile sınırlanır.
 */
export function snapToSeason(target, season, opt = DEFAULTS) {
  if (!season || season.R <= 0.05) return { date: target, shift: 0 };
  const y = target.getUTCFullYear();
  let best = null;
  for (const yy of [y - 1, y, y + 1]) {
    const cand = dateOfIsoWeek(yy, season.week, season.dow);
    if (!best || Math.abs(diffDays(cand, target)) < Math.abs(diffDays(best, target))) best = cand;
  }
  const rawShift = diffDays(best, target);
  const strength = clamp(season.R / opt.snapFloor, 0, 1);
  const shift = clamp(rawShift * strength, -opt.maxSnapDays, opt.maxSnapDays);
  return { date: addDays(target, shift), shift: Math.round(shift) };
}

/* -------------------------------------------- Katman 3: çip yayılımı */

/**
 * Bir çip neslinin piyasaya ilk çıkış günü (o nesildeki en erken kademe).
 * @returns {Map<string, {key:string, series:string, gen:number, debut:string, family:string}>}
 */
export function chipGenerations(chips) {
  const byGen = new Map();
  for (const c of chips) {
    const key = `${c.series}${c.gen}`;
    const cur = byGen.get(key);
    if (!cur || c.debut < cur.debut) {
      byGen.set(key, { key, series: c.series, gen: c.gen, debut: c.debut, family: c.debutFamily });
    }
  }
  return byGen;
}

/**
 * Aile başına "çip nesli piyasaya çıktıktan kaç gün sonra bu ürüne indi" ölçümleri.
 * @returns {Map<string, {lags:Array, median:number, sigma:number, n:number}>}
 */
export function chipDiffusion(devices, chips, { series = 'M', chipLambda = DEFAULTS.chipLambda } = {}) {
  const gens = chipGenerations(chips);
  const chipById = new Map(chips.map((c) => [c.id, c]));
  const perFamily = new Map();

  for (const d of devices) {
    const chip = chipById.get(d.chip);
    if (!chip || chip.series !== series) continue;
    const gen = gens.get(`${chip.series}${chip.gen}`);
    if (!gen) continue;
    const lag = diffDays(toDate(d.released), toDate(gen.debut));
    if (lag < 0) continue;
    if (!perFamily.has(d.family)) perFamily.set(d.family, new Map());
    const m = perFamily.get(d.family);
    // Bir ailede aynı nesilden birden çok kayıt varsa en erkeni geçerli.
    if (!m.has(gen.key) || lag < m.get(gen.key).lag) {
      m.set(gen.key, { genKey: gen.key, gen: gen.gen, chip: chip.id, deviceId: d.id, released: d.released, genDebut: gen.debut, lag });
    }
  }

  const out = new Map();
  for (const [famId, m] of perFamily) {
    const lags = [...m.values()].sort((a, b) => a.gen - b.gen);
    const ws = decayWeights(lags.length, chipLambda);
    const values = lags.map((l) => l.lag);
    const median = weightedMedian(values, ws);
    const sigma = lags.length >= 2 ? weightedStd(values, ws, weightedMean(values, ws)) : Math.max(45, median * 0.4);
    out.set(famId, { lags, median, sigma, n: lags.length });
  }
  return out;
}

/** Bir sonraki çip neslinin piyasaya çıkış tahmini (kadans + zayıf mevsimsellik). */
export function predictNextChipGen(chips, { series = 'M', lambda = DEFAULTS.lambda, trend = DEFAULTS.trend } = {}) {
  const gens = [...chipGenerations(chips).values()]
    .filter((g) => g.series === series)
    .sort((a, b) => a.gen - b.gen);
  if (gens.length < 2) return null;
  const dates = gens.map((g) => g.debut);
  const cad = cadence(dates, lambda, trend);
  const season = seasonality(dates, lambda);
  const raw = addDays(toDate(cad.last), cad.mu);
  const { date, shift } = snapToSeason(raw, season);
  const latest = gens[gens.length - 1];
  return {
    series,
    gen: latest.gen + 1,
    key: `${series}${latest.gen + 1}`,
    label: `${series}${latest.gen + 1}`,
    date,
    sigma: Math.max(cad.sigma, DEFAULTS.minSigma),
    cadence: cad,
    season,
    snapShift: shift,
    prevGen: latest,
    predicted: true,
  };
}

/* -------------------------------------- Katman 4: güven ve birleştirme */

export function confidenceScore({ mu, sigma, n, R, layers = 1, approxRatio = 0, disagreement = 0 }) {
  const stability = Math.sqrt(clamp(1 - sigma / Math.max(1, 0.5 * mu), 0, 1));
  const depth = 1 - Math.exp(-n / 3);
  const seasonal = 0.6 + 0.4 * clamp(R, 0, 1);
  let c = 100 * stability * depth * seasonal;
  if (layers > 1) c *= 0.8;
  if (approxRatio > 0.3) c *= 0.9;
  if (disagreement > 1) c *= clamp(1 - (disagreement - 1) * 0.25, 0.5, 1);
  return Math.round(clamp(c, 3, 96));
}

export function confidenceBand(score) {
  if (score >= 70) return { id: 'high', label: 'Yüksek' };
  if (score >= 45) return { id: 'mid', label: 'Orta' };
  return { id: 'low', label: 'Düşük' };
}

/** İki bağımsız tahmini ters-varyansla harmanlar. */
function blend(a, b) {
  const wa = 1 / (a.sigma ** 2);
  const wb = 1 / (b.sigma ** 2);
  const t = (a.date.getTime() * wa + b.date.getTime() * wb) / (wa + wb);
  return { date: new Date(Math.round(t)), sigma: Math.sqrt(1 / (wa + wb)) };
}

/* ------------------------------------------------------ ana API */

/**
 * Veriyi tahmin için hazırlar. Bir kez çağrılıp tekrar tekrar kullanılır.
 */
export function buildContext({ devices, chips, families }, opt = DEFAULTS) {
  const byFamily = new Map();
  for (const d of devices) {
    if (!byFamily.has(d.family)) byFamily.set(d.family, []);
    byFamily.get(d.family).push(d);
  }
  for (const list of byFamily.values()) list.sort((a, b) => a.released.localeCompare(b.released));

  return {
    opt,
    devices,
    chips,
    families,
    familyById: new Map(families.map((f) => [f.id, f])),
    chipById: new Map(chips.map((c) => [c.id, c])),
    byFamily,
    genMap: chipGenerations(chips),
    diffusionM: chipDiffusion(devices, chips, { series: 'M', chipLambda: opt.chipLambda }),
    diffusionA: chipDiffusion(devices, chips, { series: 'A', chipLambda: opt.chipLambda }),
  };
}

/**
 * Bir ailenin bir sonraki sürümünü tahmin eder.
 * @returns {object|null} date/low/high/confidence/reason ve tüm ara hesaplar
 */
export function predictFamily(familyId, ctx, { asOf = new Date() } = {}) {
  const opt = ctx.opt;
  const family = ctx.familyById.get(familyId);
  const all = (ctx.byFamily.get(familyId) || []).filter((d) => d.released <= toISO(asOf));
  if (!family || !all.length) return null;

  const forCadence = all.filter((d) => !d.cadenceSkip);
  const dates = forCadence.map((d) => d.released);
  const last = all[all.length - 1];
  const approxRatio = all.filter((d) => d.dataQuality === 'approx').length / all.length;
  const reasons = [];

  // --- Katman 1: kadans (yetersizse kategori medyanına düş) ---
  let cad = cadence(dates, opt.lambda, opt.trend);
  let fallback = false;
  if (!cad) {
    const peers = ctx.families
      .filter((f) => f.category === family.category && f.id !== familyId)
      .map((f) => cadence((ctx.byFamily.get(f.id) || []).filter((d) => !d.cadenceSkip && d.released <= toISO(asOf)).map((d) => d.released), opt.lambda, opt.trend))
      .filter(Boolean)
      .map((c) => c.mu)
      .sort((a, b) => a - b);
    if (!peers.length) return null;
    const mu = peers[Math.floor(peers.length / 2)];
    cad = { gaps: [], mu, sigma: mu * 0.45, n: 1, last: dates[dates.length - 1] || last.released };
    fallback = true;
    reasons.push(`Bu ailede tek nesil var; ${family.category.toUpperCase()} kategorisinin medyan kadansı (${Math.round(mu)} gün) kullanıldı.`);
  } else {
    reasons.push(
      `Son ${cad.gaps.length} nesil aralığı: ${cad.gaps.join(', ')} gün. Yakın nesillere ağırlık verilmiş ortalama ${Math.round(cad.flat)} gün (±${Math.round(cad.sigma)}).`
    );
    if (Math.abs(cad.mu - cad.flat) >= 7) {
      reasons.push(
        `Döngü ${cad.slope > 0 ? 'uzuyor' : 'kısalıyor'} (nesil başına ${cad.slope > 0 ? '+' : ''}${Math.round(cad.slope)} gün); eğilim düzeltmesiyle beklenen aralık ${Math.round(cad.mu)} güne çekildi.`
      );
    }
  }

  // --- Katman 2: mevsimsel oturtma ---
  const season = dates.length >= 2 ? seasonality(dates, opt.lambda) : null;
  const cadenceRaw = addDays(toDate(cad.last), cad.mu);
  const snapped = season ? snapToSeason(cadenceRaw, season, opt) : { date: cadenceRaw, shift: 0 };
  if (season && Math.abs(snapped.shift) >= 3) {
    reasons.push(
      `Aile tipik olarak yılın ${season.week}. haftasında çıkıyor (kalıp gücü R=${season.R.toFixed(2)}); ham tahmin ${snapped.shift > 0 ? '+' : ''}${snapped.shift} gün kaydırılarak o pencereye oturtuldu.`
    );
  } else if (season && season.R < 0.3) {
    reasons.push(`Takvim kalıbı zayıf (R=${season.R.toFixed(2)}) — mevsimsel oturtma uygulanmadı.`);
  }

  let estimate = { date: snapped.date, sigma: Math.max(cad.sigma, opt.minSigma) };
  let layers = fallback ? 2 : 1;
  let disagreement = 0;
  let chipInfo = null;

  // --- Katman 3: çip yayılımı (Mac ve iPad'de) ---
  const lastChip = ctx.chipById.get(last.chip);
  const diffusionMap = lastChip?.series === 'A' ? ctx.diffusionA : ctx.diffusionM;
  const diff = family.chipAware ? diffusionMap.get(familyId) : null;

  if (diff && lastChip && lastChip.series === 'M') {
    const gensSorted = [...ctx.genMap.values()].filter((g) => g.series === 'M').sort((a, b) => a.gen - b.gen);
    const usedGen = lastChip.gen;
    const newer = gensSorted.filter((g) => g.gen > usedGen && g.debut <= toISO(asOf));

    // Aday nesiller: piyasadaki henüz alınmamışlar + henüz duyurulmamış bir sonraki nesil.
    // Bir ürün nesil atlayabilir (Mac mini M3'ü hiç almadı), bu yüzden "en eski alınmamış"
    // değil, "yayılım gecikmesi eklendiğinde hâlâ gelecekte kalan en erken" nesil seçilir.
    const projectedNext = predictNextChipGen(ctx.chips, { series: 'M', lambda: opt.lambda, trend: opt.trend });
    const candidates = newer.map((g) => ({
      key: g.key,
      debut: toDate(g.debut),
      sigma: 0,
      projected: false,
    }));
    if (projectedNext) {
      candidates.push({ key: projectedNext.key, debut: projectedNext.date, sigma: projectedNext.sigma, projected: true });
    }

    const scored = candidates
      .map((c) => ({ ...c, when: addDays(c.debut, diff.median) }))
      .sort((a, b) => a.when - b.when);
    const targetGen = scored.find((c) => c.when > asOf) || scored[scored.length - 1];

    if (targetGen) {
      const { debut: genDebut, sigma: genSigma, projected: isProjected } = targetGen;
      const skipped = scored.filter((c) => c.when <= asOf).map((c) => c.key);
      if (skipped.length) {
        reasons.push(`${skipped.join(', ')} nesli için yayılım penceresi kapandı — bu ürün o nesli atlamış görünüyor.`);
      }
      reasons.push(
        isProjected
          ? `${targetGen.key} nesli henüz duyurulmadı; çip kadansından ${toISO(genDebut)} civarı öngörüldü.`
          : `${targetGen.key} nesli ${toISO(genDebut)} tarihinde piyasaya çıktı ama bu ürüne henüz gelmedi.`
      );
      if (isProjected) layers = Math.max(layers, 2);

      const lagDate = addDays(genDebut, diff.median);
      const lagSigma = Math.sqrt(diff.sigma ** 2 + genSigma ** 2);
      const chipEstimate = snapToSeason(lagDate, season, opt);
      const chipPred = { date: chipEstimate.date, sigma: Math.max(lagSigma, opt.minSigma) };

      reasons.push(
        `Yayılım geçmişi: bu ürün son ${diff.n} nesilde çip çıkışından medyan ${Math.round(diff.median)} gün sonra güncellendi (${diff.lags.map((l) => `${l.genKey}: +${l.lag}g`).join(', ')}).`
      );

      const gapDays = Math.abs(diffDays(chipPred.date, estimate.date));
      disagreement = gapDays / Math.max(1, Math.max(estimate.sigma, chipPred.sigma));
      const merged = blend(estimate, chipPred);
      chipInfo = {
        genKey: targetGen.key,
        projected: isProjected,
        genDebut: toISO(genDebut),
        medianLag: Math.round(diff.median),
        lags: diff.lags,
        chipOnlyDate: toISO(chipPred.date),
        cadenceOnlyDate: toISO(estimate.date),
        gapDays,
      };
      reasons.push(
        gapDays <= 45
          ? `Kadans ve çip yayılımı birbirini doğruluyor (${gapDays} gün fark) — tahmin güçlendi.`
          : `Kadans ve çip yayılımı ${gapDays} gün ayrışıyor; iki tahmin belirsizliklerine göre harmanlandı ve güven düşürüldü.`
      );
      estimate = merged;
      layers = Math.max(layers, 2);
    }
  }

  // --- Katman 4: güven ve aralık ---
  const score = confidenceScore({
    mu: cad.mu,
    sigma: cad.sigma,
    n: cad.n,
    R: season ? season.R : 0,
    layers,
    approxRatio,
    disagreement,
  });
  const halfWidth = Math.max(10, Math.round((opt.bandK ?? DEFAULTS.bandK) * estimate.sigma));
  const daysAway = diffDays(estimate.date, asOf);
  // Tahmin penceresi geçmişte kaldıysa gizlemek yerine "gecikmiş" olarak işaretle —
  // mağaza için "bu ürün yenilenmeyi geçti" bilgisi tahminin kendisi kadar değerli.
  if (daysAway < 0) {
    reasons.push(
      `Model penceresi ${Math.abs(daysAway)} gün önce kapandı; bu ürün beklenen yenileme tarihini geçmiş durumda.`
    );
  }

  return {
    familyId,
    family,
    category: family.category,
    date: estimate.date,
    iso: toISO(estimate.date),
    low: addDays(estimate.date, -halfWidth),
    high: addDays(estimate.date, halfWidth),
    sigma: estimate.sigma,
    halfWidth,
    confidence: score,
    band: confidenceBand(score),
    daysAway,
    overdue: daysAway < 0,
    lastRelease: last,
    daysSinceLast: diffDays(asOf, toDate(last.released)),
    cadence: cad,
    season,
    chip: chipInfo,
    fallback,
    reasons,
  };
}

/** Aktif tüm aileler için tahmin; tarihe göre sıralı. */
export function predictAll(ctx, { asOf = new Date(), includeInactive = false } = {}) {
  return ctx.families
    .filter((f) => includeInactive || f.active)
    .map((f) => predictFamily(f.id, ctx, { asOf }))
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}

/* ------------------------------------------------------------- backtest */

/**
 * Her aile için son sürümü gizleyip öncekilerle tahmin eder, hatayı ölçer.
 * Modelin kendi doğruluğunu dürüstçe raporlamasını sağlar.
 */
export function backtest(data, opt = DEFAULTS, { minGenerations = 3 } = {}) {
  const rows = [];
  for (const family of data.families) {
    const list = (data.devices.filter((d) => d.family === family.id) || [])
      .slice()
      .sort((a, b) => a.released.localeCompare(b.released));
    const cadenceList = list.filter((d) => !d.cadenceSkip);
    if (cadenceList.length < minGenerations) continue;

    const actual = cadenceList[cadenceList.length - 1];
    const cutoff = addDays(toDate(actual.released), -1);
    const trimmed = {
      families: data.families,
      chips: data.chips.filter((c) => c.debut <= toISO(cutoff)),
      devices: data.devices.filter((d) => d.released <= toISO(cutoff)),
    };
    const ctx = buildContext(trimmed, opt);
    const pred = predictFamily(family.id, ctx, { asOf: cutoff });
    if (!pred) continue;

    const errorDays = diffDays(pred.date, toDate(actual.released));
    rows.push({
      familyId: family.id,
      label: family.label,
      category: family.category,
      actual: actual.released,
      actualName: actual.name,
      predicted: pred.iso,
      errorDays,
      absError: Math.abs(errorDays),
      within30: Math.abs(errorDays) <= 30,
      within60: Math.abs(errorDays) <= 60,
      inBand: toDate(actual.released) >= pred.low && toDate(actual.released) <= pred.high,
      confidence: pred.confidence,
    });
  }

  const n = rows.length;
  const mae = n ? rows.reduce((s, r) => s + r.absError, 0) / n : 0;
  const median = n ? [...rows].sort((a, b) => a.absError - b.absError)[Math.floor(n / 2)].absError : 0;
  const bias = n ? rows.reduce((s, r) => s + r.errorDays, 0) / n : 0;
  return {
    rows: rows.sort((a, b) => a.absError - b.absError),
    n,
    mae,
    medianError: median,
    bias,
    hit30: n ? rows.filter((r) => r.within30).length / n : 0,
    hit60: n ? rows.filter((r) => r.within60).length / n : 0,
    bandCoverage: n ? rows.filter((r) => r.inBand).length / n : 0,
  };
}
