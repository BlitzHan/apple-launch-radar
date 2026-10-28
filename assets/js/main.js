import { buildContext, coLaunchGroups, DEFAULTS } from './engine.js';
import { el, clear, fmtLong } from './ui.js';
import { renderRadar } from './views/radar.js';
import { renderTimeline } from './views/timeline.js';
import { renderDiffusion } from './views/diffusion.js';
import { initDrawer, close as closeDrawer } from './views/drawer.js';

const VIEWS = {
  radar: renderRadar,
  timeline: renderTimeline,
  diffusion: renderDiffusion,
};
const FILTERED_VIEWS = new Set(['radar', 'timeline', 'diffusion']);

/**
 * Kullanıcının belirlediği ürün ailesi gösterim sırası.
 * iPhone > iPad Pro > iPad Air > iPad > iPad mini > Watch > MacBook Pro > MacBook Air > MacBook Neo > iMac > Mac mini > Mac Studio
 */
const FAMILY_DISPLAY_ORDER = new Map([
  // iPhone ailesi
  ['iphone-base', 1],
  ['iphone-pro', 2],
  ['iphone-promax', 3],
  ['iphone-air', 4],
  ['iphone-plus', 5],
  ['iphone-mini', 6],
  ['iphone-e', 7],
  ['iphone-duo', 8],
  // iPad ailesi — Pro önce
  ['ipad-pro', 10],
  ['ipad-air', 11],
  ['ipad-base', 12],
  ['ipad-mini', 13],
  // Watch ailesi
  ['watch-ultra', 20],
  ['watch-series', 21],
  ['watch-se', 22],
  // Mac ailesi — MacBook Pro önce
  ['macbook-pro-base', 30],
  ['macbook-pro-promax', 31],
  ['macbook-pro-13', 32],
  ['macbook-air', 33],
  ['macbook-neo', 34],
  ['imac', 35],
  ['mac-mini', 36],
  ['mac-studio', 37],
  ['mac-pro', 38],
]);

/** Kategori gösterim sırası: iPhone > iPad > Watch > Mac */
const CATEGORY_ORDER = new Map([
  ['iphone', 1],
  ['ipad', 2],
  ['watch', 3],
  ['mac', 4],
]);

const state = {
  view: 'radar',
  categories: [],
  activeCategories: new Set(),
  query: '',
  chipSeries: 'M',
  zoom: 0.42,
  asOf: new Date(),
  ctx: null,
  groups: [],
  // Hero panelinde gezilen lansman olayı. null = "sıradaki lansman"a dön.
  // Filtre değişince sıfırlanır, çünkü olay listesinin uzunluğu değişir.
  eventIndex: null,
  render,
  matches(family) {
    if (this.activeCategories.size && !this.activeCategories.has(family.category)) return false;
    if (!this.query) return true;
    const q = this.query.toLocaleLowerCase('tr');
    if (family.label.toLocaleLowerCase('tr').includes(q)) return true;
    return (this.ctx.byFamily.get(family.id) || []).some(
      (d) => d.name.toLocaleLowerCase('tr').includes(q) || d.chip.toLocaleLowerCase('tr').includes(q)
    );
  },
};

/* --------------------------------------------------------------- boot */

async function boot() {
  const load = async (f) => {
    const res = await fetch(`data/${f}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/${f} yüklenemedi (${res.status})`);
    return res.json();
  };

  let data;
  try {
    const [devices, chips, families] = await Promise.all([
      load('devices.json'), load('chips.json'), load('families.json'),
    ]);
    data = { devices: devices.devices, chips: chips.chips, families: families.families };
    state.categories = families.categories;
  } catch (err) {
    document.getElementById('view-radar').append(
      el('div', { class: 'card empty' },
        'Veri yüklenemedi. Bu sayfa dosya sisteminden değil bir sunucudan açılmalı ',
        el('code', {}, 'python3 -m http.server'), '. ',
        el('div', { class: 'faint', style: { marginTop: '8px' } }, String(err.message))
      )
    );
    return;
  }

  state.ctx = buildContext(data, DEFAULTS);

  // Kullanıcının belirlediği özel sıralama ile ürün gruplarını sırala
  state.groups = coLaunchGroups(state.ctx).sort((a, b) => {
    const catA = CATEGORY_ORDER.get(a.members[0].category) ?? 99;
    const catB = CATEGORY_ORDER.get(b.members[0].category) ?? 99;
    if (catA !== catB) return catA - catB;
    const famA = FAMILY_DISPLAY_ORDER.get(a.members[0].id) ?? 99;
    const famB = FAMILY_DISPLAY_ORDER.get(b.members[0].id) ?? 99;
    return famA - famB;
  });

  document.getElementById('today').textContent = fmtLong(state.asOf);
  initTheme();
  initTabs();
  initDrawer();
  buildFilters();
  render();
}

/* ------------------------------------------------------------- chrome */

function initTheme() {
  const saved = localStorage.getItem('alr-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('alr-theme', next);
  });
}

function initTabs() {
  const tabs = document.getElementById('tabs');
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) go(btn.dataset.view);
  });
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VIEWS[v]) { state.view = v; syncTabs(); render(); }
  });
  const initial = location.hash.slice(1);
  if (VIEWS[initial]) state.view = initial;
  syncTabs();
}

function go(view) {
  if (!VIEWS[view]) return;
  state.view = view;
  closeDrawer();
  location.hash = view;
  syncTabs();
  render();
}

function syncTabs() {
  for (const t of document.querySelectorAll('.tab')) {
    t.setAttribute('aria-selected', String(t.dataset.view === state.view));
  }
}

function buildFilters() {
  const bar = document.getElementById('filters');
  clear(bar);

  bar.append(el('div', { class: 'chipset' },
    state.categories.map((c) => el('button', {
      class: 'chip',
      style: `--accent:${c.color}`,
      'aria-pressed': 'false',
      dataset: { cat: c.id },
      onClick: (e) => {
        const on = state.activeCategories.has(c.id);
        on ? state.activeCategories.delete(c.id) : state.activeCategories.add(c.id);
        e.currentTarget.setAttribute('aria-pressed', String(!on));
        state.eventIndex = null;
        render();
      },
    }, el('span', { class: 'chip__dot' }), c.label))
  ));

  const search = el('input', {
    class: 'search', type: 'search', placeholder: 'Ara…',
    'aria-label': 'Ürün veya çip ara',
  });
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.query = search.value.trim(); state.eventIndex = null; render(); }, 140);
  });
  bar.append(search);
}

/* --------------------------------------------------------------- render */

function render() {
  document.getElementById('filters').hidden = !FILTERED_VIEWS.has(state.view);
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`).hidden = key !== state.view;
  }
  VIEWS[state.view](document.getElementById(`view-${state.view}`), state);
}

boot();
