// App start, screen switching and the shared page frame (top bar + bottom tabs).
import { html, str, $, toast, errMsg } from './util.js';
import { sb, S, loadMe, loadBasics } from './db.js';
import { loginView, notInvitedView } from './views/login.js';
import { homeView, pickMarketView, moreView } from './views/home.js';
import { marketsView, marketEditView } from './views/markets.js';
import { productsView, productEditView } from './views/products.js';
import { teamView } from './views/team.js';
import { shopView } from './views/shop.js';

// ---- screens -------------------------------------------------------------
// Each view returns { title, body, actions, back?, tab? }.
const routes = [
  [/^#\/?$/, homeView],
  [/^#\/pick$/, pickMarketView],
  [/^#\/more$/, moreView],
  [/^#\/markets$/, marketsView, 'owner'],
  [/^#\/market\/(.+)$/, marketEditView, 'owner'],
  [/^#\/products$/, productsView, 'owner'],
  [/^#\/product\/(.+)$/, productEditView, 'owner'],
  [/^#\/team$/, teamView, 'owner'],
  [/^#\/shop$/, shopView],
];

let actions = {};
let renderId = 0;

export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

export async function render() {
  const id = ++renderId;
  let view;
  try {
    if (!S.email) view = loginView();
    else if (!S.me) view = notInvitedView();
    else {
      const h = location.hash || '#/';
      const hit = routes.find(([re]) => re.test(h)) || routes[0];
      if (hit[2] === 'owner' && !S.isOwner) return go('#/');
      view = await hit[1](...(h.match(hit[0]) || []).slice(1));
    }
  } catch (e) {
    view = { title: 'Error 錯誤', body: html`<div class="card">${errMsg(e)}</div><button class="pri" data-act="reload">Try again 重試</button>`, actions: { reload: () => location.reload() } };
  }
  if (id !== renderId) return;          // a newer screen was requested meanwhile
  mount(view);
}

function mount(v) {
  actions = v.actions || {};
  const tabs = [['#/', '🛒', 'Market', '市集'], ['#/more', '☰', 'More', '更多']];
  const nav = S.me && v.tab !== false ? html`<nav class="tabs">${tabs.map(([h, i, en, zh]) =>
    html`<a href="${h}" class="${v.tab === h ? 'on' : ''}"><span>${i}</span>${en} ${zh}</a>`)}</nav>` : '';
  const top = html`<header class="top">
      ${v.back ? html`<a class="back" href="${v.back}" aria-label="Back">‹</a>` : ''}
      <h1>${v.title || ''}</h1>${v.right || ''}
    </header>`;
  $('#app').innerHTML = str(html`${top}<main>${v.body}</main>${nav}`);
  window.scrollTo(0, 0);
  v.after && v.after($('#app'));
}

// One listener for every button: <button data-act="save" data-id="…">
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  ev.preventDefault();
  if (el.dataset.busy) return;
  el.dataset.busy = 1; el.classList.add('busy');
  try { await actions[el.dataset.act](el, ev); }
  catch (e) { console.error(e); toast(errMsg(e), 'err'); }
  finally { delete el.dataset.busy; el.classList.remove('busy'); }
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]');
  if (el && actions[el.dataset.change]) actions[el.dataset.change](el, ev);
});

// ---- start ---------------------------------------------------------------
async function start() {
  try { await loadMe(); } catch (e) { toast(errMsg(e), 'err'); }
  render();
  // refresh lists in the background; redraw only list screens (never a form being typed in)
  if (S.me) loadBasics().then(() => { if (/^(#\/?|#\/pick|#\/more)?$/.test(location.hash)) render(); })
    .catch(e => toast(errMsg(e), 'err'));
}
sb.auth.onAuthStateChange((event, session) => {
  const email = session?.user?.email?.toLowerCase() || '';
  if ((event === 'SIGNED_IN' || event === 'SIGNED_OUT') && email !== S.email) start();
});
addEventListener('hashchange', render);
addEventListener('online', () => document.body.classList.remove('offline'));
addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');
start();
