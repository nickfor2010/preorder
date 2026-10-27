// App start, screen switching and the shared page frame (top bar + bottom tabs).
import { html, str, raw, $, toast, errMsg } from './util.js';
import { T } from './i18n.js';
import { icon } from './icons.js';
import { sb, S, loadMe, loadBasics } from './db.js';
import { loginView, notInvitedView } from './views/login.js';
import { homeView, pickMarketView, moreView } from './views/home.js';
import { marketsView, marketEditView } from './views/markets.js';
import { productsView, productEditView } from './views/products.js';
import { teamView } from './views/team.js';
import { shopView } from './views/shop.js';
import { newOrderView } from './views/neworder.js';
import { ordersView, orderView, qrView } from './views/orderlist.js';
import { scanView } from './views/scan.js';
import { importView } from './views/import.js';
import { summaryView } from './views/summary.js';
import { exportView, printView } from './views/export.js';
import { sync, startLive, pendingCount, onOrdersChange } from './orders.js';

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
  [/^#\/new$/, newOrderView],
  [/^#\/orders$/, ordersView],
  [/^#\/order\/([^/]+)$/, orderView],
  [/^#\/qr\/([^/]+)(\/x)?$/, qrView],
  [/^#\/scan$/, scanView],
  [/^#\/import$/, importView],
  [/^#\/summary(?:\/([^/]+))?$/, summaryView, 'owner'],
  [/^#\/export$/, exportView],
  [/^#\/print$/, printView],
];

let actions = {};
let cleanup = null;
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
    view = { title: T('Something went wrong', '發生錯誤'), body: html`<div class="card">${errMsg(e)}</div><button class="btn primary block" data-act="reload">${T('Try again', '重試')}</button>`, actions: { reload: () => location.reload() } };
  }
  if (id !== renderId) return;          // a newer screen was requested meanwhile
  mount(view);
}

function mount(v) {
  if (!v) return;                       // the view redirected somewhere else
  try { cleanup && cleanup(); } catch { }
  cleanup = v.cleanup || null;
  actions = v.actions || {};
  const tabs = [['#/new', 'newOrder', T('New', '新增')], ['#/orders', 'orders', T('Orders', '訂單')], ['#/', 'market', T('Market', '市集')], ['#/more', 'more', T('More', '更多')]];
  const n = pendingCount();
  const nav = S.me && v.tab !== false ? html`<nav class="tabs"><div class="in">${tabs.map(([h, ic, label]) =>
    html`<a href="${h}" class="${v.tab === h ? 'on' : ''}" ${v.tab === h ? raw('aria-current="page"') : ''}>${icon(ic)}${label}${h === '#/orders' && n ? html`<i class="dot">${n}</i>` : ''}</a>`)}</div></nav>` : '';
  const top = !v.title && !v.back ? '' : html`<header class="top"><div class="in">
      ${v.back ? html`<a class="back" href="${v.back}" aria-label="${T('Back', '返回')}">${icon('back')}</a>` : ''}
      <h1>${v.title || ''}</h1>
      <span class="pill warn offline-pill">${T('Offline', '離線')}</span>${v.right || ''}
    </div></header>`;
  $('#app').innerHTML = str(html`${top}<main>${v.body}</main>${nav}`);
  document.title = (v.title ? v.title + ' · ' : '') + 'MarketRecipe';
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
  if (!S.me) return;
  // refresh lists in the background; redraw only list screens (never a form being typed in)
  loadBasics().then(() => { if (/^(#\/?|#\/pick|#\/more)?$/.test(location.hash)) render(); })
    .catch(e => { if (navigator.onLine) toast(errMsg(e), 'err'); });
  startLive();
  sync();
}
sb.auth.onAuthStateChange((event, session) => {
  const email = session?.user?.email?.toLowerCase() || '';
  if ((event === 'SIGNED_IN' || event === 'SIGNED_OUT') && email !== S.email) start();

// offline support: keep a copy of the app on the phone
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
});
addEventListener('hashchange', render);
// keep the "not synced" number on the Orders tab up to date
onOrdersChange(() => {
  const a = document.querySelector('.tabs a[href="#/orders"]');
  if (!a) return;
  let d = a.querySelector('.dot'); const n = pendingCount();
  if (!n) return d && d.remove();
  if (!d) { d = document.createElement('i'); d.className = 'dot'; a.appendChild(d); }
  d.textContent = n;
});
addEventListener('online', () => document.body.classList.remove('offline'));
addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');
start();

// offline support: keep a copy of the app on the phone
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
