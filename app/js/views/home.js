// Market tab (one-tap walk-up sales), market picker, and the "More" menu.
import { html, str, raw, $, $$, toast, store, today, dayWord, money } from '../util.js';
import { T, getLang, setLang, pname, fmtDate, fmtTime, PAY } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, q, S, setMarket, signOut, marketProducts, marketStock, ensureBasics } from '../db.js';
import { go, render } from '../app.js';
import { toMake, pendingCount, onOrdersChange, addSale, undoSale, pendingSaleQty, pendingSales, pendingUnsales, allOrders, O } from '../orders.js';
import { makeHtml, syncBar, syncActions } from './orderlist.js';
import { oldOrdersCount } from './import.js';

const STATUS = () => ({ upcoming: T('Upcoming', '即將舉行'), open: T('Open', '營業中'), closed: T('Closed', '已結束') });
export const statusTag = s => html`<span class="status ${s}">${STATUS()[s] || s}</span>`;

export function marketLine(m) {
  const dw = dayWord(m.date);
  return html`<div class="name">${m.name}</div>
    <div class="mu small">${dw ? html`<b>${dw}</b> · ` : ''}${fmtDate(m.date)}${m.location ? ' · ' + m.location : ''}</div>`;
}

const makeBlock = m => {
  const make = toMake(o => o.pickup_market_id === m.id);
  return make.length ? makeHtml(make) : '';
};

const mySales = new Map();     // sales tapped on this phone (so Undo works even right after syncing)
const PAYS = ['cash', 'linepay', 'transfer'];

// ---- Market tab: tap a product = one walk-up sale. Stock counts down by itself. ----
export async function homeView() {
  await ensureBasics();
  const m = S.market;
  if (!m) return pickMarketView();
  const byId = Object.fromEntries(S.products.map(p => [p.id, p]));
  const rows = (await marketProducts(m.id).catch(() => [])).filter(r => byId[r.product_id]);
  let stock = Object.fromEntries((await marketStock(m.id).catch(() => [])).map(x => [x.product_id, x]));
  let recent = [];
  let stockAt = new Date().toISOString();
  let pay = store.get('payType', 'cash');
  let off, undoTimer, stockTimer;

  // left = server count − my sales not sent yet − my pre-orders not sent yet
  const leftOf = pid => {
    const s = stock[pid];
    if (!s) return null;
    let n = s.remaining - (pendingSaleQty(m.id)[pid] || 0);
    const pend = new Set(pendingSales(m.id).map(x => x.id));
    for (const x of mySales.values()) if (x.market_id === m.id && x.product_id === pid && !pend.has(x.id) && x.created_at > stockAt) n -= x.qty;
    for (const o of allOrders()) if (o._pending && o.pickup_market_id === m.id) for (const i of o.items || []) if (i.product_id === pid) n -= i.qty;
    return n;
  };
  const isOut = r => r.sold_out || (leftOf(r.product_id) ?? 1) <= 0;

  const gridHtml = () => str(rows.length ? html`<div class="sellgrid">${rows.map(r => {
      const p = byId[r.product_id], n = leftOf(r.product_id), out = isOut(r);
      return html`<button class="sellbtn ${out ? 'out' : n != null && n <= 3 ? 'low' : ''}" data-act="sell" data-pid="${r.product_id}">
        <b>${pname(p)}</b>
        <span class="foot"><span class="price">${money(r.price)}</span>
        <span class="left">${out ? T('Sold out', '售完') : n == null ? '' : T(`${n} left`, `剩 ${n}`)}</span></span></button>`;
    })}</div>`
    : html`<div class="empty"><b>${T('No products here yet', '這場市集還沒有商品')}</b>
        ${T('Choose which products this market sells, with price and quantity.', '請設定本場販售的商品、價格與數量。')}
        ${S.isOwner ? html`<div style="margin-top:12px"><a class="btn primary" href="#/market/${m.id}">${T('Set up products', '設定商品')}</a></div>` : ''}</div>`);

  const recentHtml = () => {
    const gone = pendingUnsales(), pend = pendingSales(m.id);
    const L = [...pend, ...recent.filter(x => !gone.has(x.id) && !pend.some(p => p.id === x.id))]
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12);
    if (!L.length) return '';
    const canUndo = x => S.isOwner || (x.created_by === S.email && Date.now() - new Date(x.created_at) < 10 * 60e3);
    return str(html`<div class="h2">${T('Recent sales', '最近銷售')}${S.isOwner ? '' : html`<span class="aside">${T('yours only', '僅顯示你的')}</span>`}</div>
      <div class="list">${L.map(x => html`<div class="sale">
        <time>${fmtTime(x.created_at)}</time>
        <span class="grow"><b>${pname(byId[x.product_id])}</b> ×${x.qty} <span class="mu small">· ${PAY()[x.payment_type] || ''}</span>
          ${x._pending ? html` <span class="pill warn">${icon('clock')}${T('Not synced', '未同步')}</span>` : ''}</span>
        ${canUndo(x) ? html`<button class="btn sm ghost" data-act="undo" data-id="${x.id}">${T('Undo', '復原')}</button>` : ''}</div>`)}</div>`);
  };

  const draw = () => {
    const g = $('#grid'), r = $('#recent'), b = $('#sbar'), k = $('#mk');
    if (g) g.innerHTML = gridHtml();
    if (r) r.innerHTML = recentHtml();
    if (b) b.innerHTML = str(syncBar());
    if (k) k.innerHTML = str(makeBlock(m));
  };
  // after my changes reach the server, ask for fresh counts (debounced)
  const refreshStock = () => {
    clearTimeout(stockTimer);
    stockTimer = setTimeout(async () => {
      if (!navigator.onLine) return;
      if (O.syncing) return refreshStock();
      try {
        const at = new Date().toISOString();
        stock = Object.fromEntries((await marketStock(m.id)).map(x => [x.product_id, x]));
        stockAt = at;
        recent = await loadRecent(m.id);
      } catch { }
      draw();
    }, 600);
  };
  const showUndo = sale => {
    const u = $('#undobar');
    if (!u) return;
    u.innerHTML = str(html`${icon('check')}<span class="grow">${pname(byId[sale.product_id])} ×1 · ${money(sale.unit_price)} · ${PAY()[sale.payment_type]}</span>
      <button data-act="undo" data-id="${sale.id}">${icon('undo')}${T('Undo', '復原')}</button>`);
    u.classList.add('show');
    clearTimeout(undoTimer); undoTimer = setTimeout(() => u.classList.remove('show'), 7000);
  };

  return {
    title: T('Market', '市集'), tab: '#/',
    body: html`
      <a class="card market-head" href="#/pick">
        <div class="grow">${marketLine(m)}</div>
        <div class="col end">${statusTag(m.status)}<span class="accent-tx small">${T('Change', '切換')}</span></div>
      </a>
      ${S.isOwner ? html`<a class="list sumbtn" href="#/summary/${m.id}"><span><span class="lead">${icon('chart')}</span>
        <span class="grow">${T('Today’s summary', '本場結算')}</span>${icon('chevron', 'chev')}</span></a>` : ''}
      <div id="sbar">${syncBar()}</div>
      <div class="h2">${T('Walk-up sale', '現場銷售')}<span class="aside">${T('Tap a product to sell one', '點一下商品＝賣出 1 份')}</span></div>
      <div class="seg accent" id="payc">${PAYS.map(k => html`<button class="${pay === k ? 'on' : ''}" data-act="pay" data-k="${k}">${PAY()[k]}</button>`)}</div>
      <div id="grid">${raw(gridHtml())}</div>
      <div id="recent" class="stack"></div>
      <div class="h2">${T('Pre-orders', '預訂')}</div>
      <div class="grid2">
        <a class="btn" href="#/new">${icon('newOrder')}${T('New order', '新增訂單')}</a>
        <a class="btn" href="#/scan">${icon('scan')}${T('Scan pickup', '掃描取貨')}</a>
      </div>
      <div id="mk">${makeBlock(m)}</div>
      <div id="undobar" class="undobar" role="status"></div>`,
    async after() {
      off = onOrdersChange(() => { draw(); refreshStock(); });
      recent = await loadRecent(m.id).catch(() => []);
      draw();
    },
    cleanup: () => { off && off(); clearTimeout(undoTimer); clearTimeout(stockTimer); },
    actions: {
      ...syncActions,
      pay(el) { pay = el.dataset.k; store.set('payType', pay); $$('#payc button').forEach(b => b.classList.toggle('on', b === el)); },
      sell(el) {
        const r = rows.find(x => x.product_id === el.dataset.pid);
        if (isOut(r) && !confirm(T('This is marked sold out. Record a sale anyway?', '已標示售完，仍要記錄這筆銷售嗎？'))) return;
        const sale = addSale({ market_id: m.id, product_id: r.product_id, unit_price: r.price, payment_type: pay });
        mySales.set(sale.id, sale);
        navigator.vibrate?.(30);
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 280);
        showUndo(sale);
      },
      undo(el) {
        const id = el.dataset.id;
        const x = pendingSales(m.id).find(s => s.id === id) || recent.find(s => s.id === id) || mySales.get(id);
        if (!x) return;
        undoSale(x);
        mySales.delete(id);
        recent = recent.filter(s => s.id !== id);
        $('#undobar')?.classList.remove('show');
        toast(T('Sale removed', '已復原'));
      },
    },
  };
}

async function loadRecent(marketId) {
  return q(sb.from('sales').select('id,product_id,qty,unit_price,payment_type,created_by,created_at,market_id')
    .eq('market_id', marketId).order('created_at', { ascending: false }).limit(12));
}

// ---- choose the market you are working at ----
export function pickMarketView() {
  const t = today();
  const list = [...S.markets].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const current = list.filter(m => (m.date >= t && m.status !== 'closed') || m.status === 'open');
  const past = list.filter(m => !current.includes(m)).reverse().slice(0, 15);
  const item = m => html`<button data-act="pick" data-id="${m.id}">
      <div class="grow">${marketLine(m)}</div>${m.id === S.marketId ? html`<span class="pill accent">${icon('check')}${T('Current', '目前')}</span>` : statusTag(m.status)}</button>`;
  return {
    title: T('Choose market', '選擇市集'), tab: '#/',
    body: html`
      ${current.length ? html`<div class="list market-list">${current.map(item)}</div>`
        : html`<div class="empty"><b>${T('No upcoming markets', '沒有即將舉行的市集')}</b>${S.isOwner ? T('Create one to start selling.', '新增一場市集即可開始。') : T('Ask the owner to add one.', '請老闆新增市集。')}</div>`}
      ${S.isOwner ? html`<a class="btn block" href="#/market/new">${icon('plus')}${T('New market', '新增市集')}</a>` : ''}
      ${past.length ? html`<details class="card flat"><summary class="mu">${T('Past markets', '過去的市集')}</summary><div class="list market-list" style="margin-top:12px">${past.map(item)}</div></details>` : ''}`,
    actions: { pick(el) { setMarket(el.dataset.id); go('#/'); } },
  };
}

// ---- More ----
export function moreView() {
  const owner = S.isOwner;
  const link = (href, ic, label) => html`<a href="${href}"><span class="lead">${icon(ic)}</span><span class="grow">${label}</span>${icon('chevron', 'chev')}</a>`;
  const n = oldOrdersCount();
  return {
    title: T('More', '更多'), tab: '#/more',
    body: html`
      <div class="card row"><div class="lead" style="width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font:600 20px/1 var(--serif)">${(S.me.name || S.email)[0].toUpperCase()}</div>
        <div class="grow"><b>${S.me.name || S.email}</b><div class="mu small">${owner ? T('Owner', '老闆') : T('Staff', '員工')} · ${S.org?.name || ''}</div><div class="mu3 xs">${S.email}</div></div></div>
      <div class="list">
        ${link('#/pick', 'market', T('Choose market', '選擇市集'))}
        ${owner ? link('#/summary', 'chart', T('Summary', '結算')) : ''}
        ${n ? link('#/import', 'download', T(`Import ${n} orders from the old app`, `匯入舊版 ${n} 筆訂單`)) : ''}
      </div>
      ${owner ? html`<div class="h2">${T('Set up', '設定')}</div><div class="list">
        ${link('#/markets', 'calendar', T('Markets', '市集管理'))}
        ${link('#/products', 'cake', T('Products', '商品'))}
        ${link('#/team', 'users', T('Team', '團隊'))}
        ${link('#/shop', 'shop', T('Shop details', '店家資料'))}</div>` : ''}
      <div class="h2">${T('Language', '語言')}</div>
      <div class="seg"><button class="${getLang() === 'en' ? 'on' : ''}" data-act="lang" data-l="en">English</button>
        <button class="${getLang() === 'zh' ? 'on' : ''}" data-act="lang" data-l="zh">中文（台灣）</button></div>
      <button class="btn ghost block" data-act="out">${icon('logout')}${T('Log out', '登出')}</button>
      <p class="mu3 xs c">MarketRecipe 2.1</p>`,
    actions: {
      lang(el) { setLang(el.dataset.l); render(); },
      async out() {
        if (pendingCount() && !confirm(T(`${pendingCount()} changes haven’t synced yet. They stay on this phone and sync after you log in again.`, `還有 ${pendingCount()} 筆資料尚未同步，會保留在這支手機，下次登入後同步。`))) return;
        if (!confirm(T('Log out?', '確定要登出嗎？'))) return;
        await signOut(); location.hash = '#/'; location.reload();
      },
    },
  };
}
