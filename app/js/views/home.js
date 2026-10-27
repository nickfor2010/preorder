// Home (the active market), market picker, and the "More" menu.
import { html, str, raw, $, toast, store, today, dateBi, dayWord, money } from '../util.js';
import { sb, q, S, setMarket, signOut, marketProducts, marketStock } from '../db.js';
import { ensureBasics } from '../db.js';
import { go } from '../app.js';
import { toMake, pendingCount, onOrdersChange, addSale, undoSale, pendingSaleQty, pendingSales, pendingUnsales, allOrders, O } from '../orders.js';
import { makeHtml, syncBar, syncActions } from './orderlist.js';
import { oldOrdersCount } from './import.js';

const STATUS = { upcoming: 'Upcoming 即將', open: 'Open 營業中', closed: 'Closed 已結束' };
export const statusTag = s => html`<span class="tag st-${s}">${STATUS[s] || s}</span>`;

export function marketLine(m) {
  const dw = dayWord(m.date);
  return html`<b>${m.name}</b><div class="mu">${dw ? html`<b>${dw}</b> · ` : ''}${dateBi(m.date)}${m.location ? ' · 📍 ' + m.location : ''}</div>`;
}

const makeBlock = m => {
  const make = toMake(o => o.pickup_market_id === m.id);
  return make.length ? makeHtml(make) : html`<p class="mu c">No pre-orders to pick up here. 本場無待取訂單。</p>`;
};

const mySales = new Map();     // sales tapped on this phone (so Undo works even right after syncing)
const PAY = [['cash', 'Cash 現金'], ['linepay', 'LINE Pay'], ['transfer', 'Transfer 轉帳']];
const hhmm = t => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

// Market tab: tap a product = one walk-up sale. Stock counts down by itself.
export async function homeView() {
  await ensureBasics();
  const m = S.market;
  if (!m) return pickMarketView();
  const byId = Object.fromEntries(S.products.map(p => [p.id, p]));
  let rows = (await marketProducts(m.id).catch(() => [])).filter(r => byId[r.product_id]);
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
    // my sales that already reached the server after the counts were fetched
    const pend = new Set(pendingSales(m.id).map(x => x.id));
    for (const x of mySales.values()) if (x.market_id === m.id && x.product_id === pid && !pend.has(x.id) && x.created_at > stockAt) n -= x.qty;
    for (const o of allOrders()) if (o._pending && o.pickup_market_id === m.id) for (const i of o.items || []) if (i.product_id === pid) n -= i.qty;
    return n;
  };
  const isOut = r => r.sold_out || (leftOf(r.product_id) ?? 1) <= 0;

  const gridHtml = () => str(rows.length ? html`<div class="sellgrid">${rows.map(r => {
      const p = byId[r.product_id], n = leftOf(r.product_id);
      return html`<button class="sellbtn ${isOut(r) ? 'out' : ''}" data-act="sell" data-pid="${r.product_id}">
        <b>${p.name_zh}</b><span class="mu small">${p.name_en}</span>
        <span class="row"><span class="price">${money(r.price)}</span>
        <span class="left">${isOut(r) ? 'Sold out 售完' : n == null ? '' : 'Left 剩 ' + n}</span></span></button>`;
    })}</div>`
    : html`<p class="mu c">No products set for this market yet. 這場市集尚未設定商品。
        ${S.isOwner ? html`<br><a class="link" href="#/market/${m.id}">Set up 設定 ›</a>` : ''}</p>`);

  const recentHtml = () => {
    const gone = pendingUnsales();
    const L = [...pendingSales(m.id), ...recent.filter(x => !gone.has(x.id) && !pendingSales(m.id).some(p => p.id === x.id))]
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12);
    if (!L.length) return '';
    const canUndo = x => S.isOwner || (x.created_by === S.email && Date.now() - new Date(x.created_at) < 10 * 60e3);
    return str(html`<h2>Recent sales 最近銷售 ${S.isOwner ? '' : html`<span class="mu small">(mine 我的)</span>`}</h2>
      ${L.map(x => { const p = byId[x.product_id] || {}; return html`<div class="card row sale">
        <span class="mu small">${hhmm(x.created_at)}</span><span class="grow"><b>${p.name_zh || p.name_en}</b> ×${x.qty}
        <span class="mu small">· ${PAY.find(([k]) => k === x.payment_type)?.[1] || ''}</span>${x._pending ? html` <span class="tag warn">⏳</span>` : ''}</span>
        ${canUndo(x) ? html`<button class="sm" data-act="undo" data-id="${x.id}">Undo 復原</button>` : ''}</div>`; })}`);
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
      if (O.syncing) return refreshStock();            // wait until sending is finished
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
    const p = byId[sale.product_id] || {}, u = $('#undobar');
    if (!u) return;
    u.innerHTML = str(html`<span class="grow">✔ ${p.name_zh || p.name_en} ×1 · ${PAY.find(([k]) => k === sale.payment_type)[1]} · ${money(sale.unit_price)}</span>
      <button data-act="undo" data-id="${sale.id}">Undo 復原</button>`);
    u.classList.add('show');
    clearTimeout(undoTimer); undoTimer = setTimeout(() => u.classList.remove('show'), 7000);
  };

  return {
    title: 'Market 市集', tab: '#/',
    body: html`
      <a class="card market-head" href="#/pick">
        <div class="grow">${marketLine(m)}</div>
        <div class="col-end">${statusTag(m.status)}<span class="link">Change 切換</span></div>
      </a>
      <div id="sbar">${syncBar()}</div>
      <h2>Walk-up sale 現場銷售 <span class="mu small">tap = sell 1 點一下＝賣出 1</span></h2>
      <div class="chips" id="payc">${PAY.map(([k, l]) => html`<button class="chipb ${pay === k ? 'on' : ''}" data-act="pay" data-k="${k}">${l}</button>`)}</div>
      <div id="grid">${raw(gridHtml())}</div>
      <div id="recent"></div>
      <h2>Pre-orders 預訂</h2>
      <div class="grid2">
        <a class="btn" href="#/new">➕ New order<br>新訂單</a>
        <a class="btn" href="#/scan">📷 Pickup scan<br>取貨掃描</a>
      </div>
      <div id="mk">${makeBlock(m)}</div>
      <div id="undobar" class="undobar"></div>`,
    async after() {
      off = onOrdersChange(() => { draw(); refreshStock(); });
      recent = await loadRecent(m.id).catch(() => []);
      draw();
    },
    cleanup: () => { off && off(); clearTimeout(undoTimer); clearTimeout(stockTimer); },
    actions: {
      ...syncActions,
      pay(el) { pay = el.dataset.k; store.set('payType', pay); document.querySelectorAll('#payc .chipb').forEach(b => b.classList.toggle('on', b === el)); },
      sell(el) {
        const r = rows.find(x => x.product_id === el.dataset.pid);
        if (isOut(r) && !confirm('Marked sold out. Record a sale anyway? 已售完，仍要記錄？')) return;
        const sale = addSale({ market_id: m.id, product_id: r.product_id, unit_price: r.price, payment_type: pay });
        mySales.set(sale.id, sale);
        navigator.vibrate?.(30);
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 300);
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
        toast('Undone 已復原');
      },
    },
  };
}

async function loadRecent(marketId) {
  return q(sb.from('sales').select('id,product_id,qty,unit_price,payment_type,created_by,created_at,market_id')
    .eq('market_id', marketId).order('created_at', { ascending: false }).limit(12));
}

export function pickMarketView() {
  const t = today();
  const list = [...S.markets].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const current = list.filter(m => m.date >= t && m.status !== 'closed' || m.status === 'open');
  const past = list.filter(m => !current.includes(m)).reverse().slice(0, 15);
  const item = m => html`<button class="card pick ${m.id === S.marketId ? 'sel' : ''}" data-act="pick" data-id="${m.id}">
      <div class="grow">${marketLine(m)}</div>${statusTag(m.status)}</button>`;
  return {
    title: 'Choose market 選擇市集', tab: '#/',
    body: html`
      ${current.length ? current.map(item) : html`<p class="mu c">No upcoming markets. 沒有即將舉行的市集。</p>`}
      ${S.isOwner ? html`<a class="btn wide" href="#/market/new">＋ New market 新增市集</a>` : ''}
      ${past.length ? html`<details><summary>Past markets 過去的市集</summary>${past.map(item)}</details>` : ''}`,
    actions: {
      pick(el) { setMarket(el.dataset.id); go('#/'); },
    },
  };
}

export function moreView() {
  const owner = S.isOwner;
  const link = (href, icon, en, zh) => html`<a class="card row menu" href="${href}"><span>${icon}</span><span class="grow">${en} ${zh}</span><span class="mu">›</span></a>`;
  return {
    title: 'More 更多', tab: '#/more',
    body: html`
      <div class="card"><b>${S.me.name || S.email}</b><div class="mu">${S.email} · ${owner ? 'Owner 老闆' : 'Staff 員工'}</div>
        <div class="mu">${S.org?.name || ''}</div></div>
      ${link('#/pick', '🛒', 'Choose market', '選擇市集')}
      ${oldOrdersCount() ? link('#/import', '📥', `Import ${oldOrdersCount()} old orders`, '匯入舊訂單') : ''}
      ${owner ? [
        link('#/markets', '📅', 'Markets', '市集管理'),
        link('#/products', '🍰', 'Products', '商品'),
        link('#/team', '👥', 'Team', '團隊'),
        link('#/shop', '🏠', 'Shop info', '店家資料'),
      ] : ''}
      <button class="ghost wide" data-act="out">Log out 登出</button>
      <p class="mu small c">MarketRecipe · v2.0-beta</p>`,
    actions: {
      async out() {
        if (pendingCount() && !confirm(`${pendingCount()} changes are not synced yet. They stay on this phone and sync after the next login. 還有未同步資料，下次登入後會同步。`)) return;
        if (!confirm('Log out? 確定登出？')) return;
        await signOut(); location.hash = '#/'; location.reload();
      },
    },
  };
}
