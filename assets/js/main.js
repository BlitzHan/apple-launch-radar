import { buildContext, coLaunchGroups, DEFAULTS } from './engine.js';
import { el, clear, fmtLong } from './ui.js';
import { renderRadar } from './views/radar.js';
import { renderTimeline } from './views/timeline.js';
import { renderDiffusion } from './views/diffusion.js';
import { renderAccuracy } from './views/accuracy.js';
import { renderMethod } from './views/method.js';
import { initDrawer, close as closeDrawer } from './views/drawer.js';

const VIEWS = {
  radar: renderRadar,
  timeline: renderTimeline,
  diffusion: renderDiffusion,
  accuracy: renderAccuracy,
  method: renderMethod,
};
const FILTERED_VIEWS = new Set(['radar', 'timeline', 'diffusion']);

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
  // Birlikte çıkan aileler (iPhone 18 + Pro + Pro Max + Air) tek lansman sayılır.
  const catOrder = new Map(state.categories.map((c) => [c.id, c.order]));
  state.groups = coLaunchGroups(state.ctx).sort(
    (a, b) =>
      catOrder.get(a.members[0].category) - catOrder.get(b.members[0].category) ||
      a.members[0].order - b.members[0].order
  );

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
        render();
      },
    }, el('span', { class: 'chip__dot' }), c.label))
  ));

  const search = el('input', {
    class: 'search', type: 'search', placeholder: 'Ürün veya çip ara…',
    'aria-label': 'Ürün veya çip ara',
  });
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.query = search.value.trim(); render(); }, 140);
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
