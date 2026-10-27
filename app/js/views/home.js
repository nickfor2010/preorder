// Home (the active market), market picker, and the "More" menu.
import { html, str, today, dateBi, dayWord, money } from '../util.js';
import { S, setMarket, signOut, marketProducts, marketStock } from '../db.js';
import { ensureBasics } from '../db.js';
import { go } from '../app.js';
import { toMake, pendingCount, onOrdersChange } from '../orders.js';
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
  return make.length ? makeHtml(make) : html`<p class="mu c">No pre-orders to pick up here yet. 本場尚無待取訂單。</p>`;
};

export async function homeView() {
  await ensureBasics();
  const m = S.market;
  if (!m) return pickMarketView();
  const [rows, stock] = await Promise.all([marketProducts(m.id).catch(() => []), marketStock(m.id).catch(() => [])]);
  const st = Object.fromEntries(stock.map(x => [x.product_id, x]));
  const byId = Object.fromEntries(S.products.map(p => [p.id, p]));
  let off;
  return {
    title: 'Market 市集', tab: '#/',
    body: html`
      <a class="card market-head" href="#/pick">
        <div class="grow">${marketLine(m)}</div>
        <div class="col-end">${statusTag(m.status)}<span class="link">Change 切換</span></div>
      </a>
      <div id="sbar">${syncBar()}</div>
      <div class="grid2">
        <a class="btn pri" href="#/new">➕ New order<br>新訂單</a>
        <a class="btn pri alt" href="#/scan">📷 Pickup scan<br>取貨掃描</a>
      </div>
      <div id="mk">${makeBlock(m)}</div>
      <div class="card soon"><b>Walk-up sales 現場銷售</b><p class="mu">Coming in the next update. 下一版加入。</p></div>
      <h2>Stock 庫存 <span class="mu small">brought − pre-orders − sold = left 帶貨−預訂−售出＝剩</span></h2>
      ${rows.length ? rows.map(r => {
        const p = byId[r.product_id] || {}, s = st[r.product_id];
        return html`<div class="card row"><div class="grow"><b>${p.name_zh}</b><div class="mu">${p.name_en} · ${money(r.price)}</div></div>
          <div class="col-end">${s ? html`<b class="${s.remaining <= 0 ? 'bad-tx' : ''}">${s.remaining <= 0 ? 'Sold out 售完' : 'Left 剩 ' + s.remaining}</b>
            <span class="mu small">${s.brought} − ${s.preordered} − ${s.sold}</span>` : html`<span class="mu">× ${r.qty_brought}</span>`}</div></div>`;
      }) : html`<p class="mu c">No products set for this market yet. 這場市集尚未設定商品。
          ${S.isOwner ? html`<br><a class="link" href="#/market/${m.id}">Set up 設定 ›</a>` : ''}</p>`}`,
    after() {
      off = onOrdersChange(() => {
        const b = document.getElementById('sbar'), k = document.getElementById('mk');
        if (b) b.innerHTML = str(syncBar());
        if (k) k.innerHTML = str(makeBlock(m));
      });
    },
    cleanup: () => off && off(),
    actions: { ...syncActions },
  };
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
