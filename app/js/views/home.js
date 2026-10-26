// Home (the active market), market picker, and the "More" menu.
import { html, today, dateBi, dayWord, money } from '../util.js';
import { sb, S, q, setMarket, signOut } from '../db.js';
import { go } from '../app.js';

const STATUS = { upcoming: 'Upcoming 即將', open: 'Open 營業中', closed: 'Closed 已結束' };
export const statusTag = s => html`<span class="tag st-${s}">${STATUS[s] || s}</span>`;

export function marketLine(m) {
  const dw = dayWord(m.date);
  return html`<b>${m.name}</b><div class="mu">${dw ? html`<b>${dw}</b> · ` : ''}${dateBi(m.date)}${m.location ? ' · 📍 ' + m.location : ''}</div>`;
}

export async function homeView() {
  const m = S.market;
  if (!m) return pickMarketView();
  let rows = [];
  try {
    rows = await q(sb.from('market_products').select('product_id,price,qty_brought,sold_out,sort').eq('market_id', m.id).order('sort'));
  } catch { /* offline: show without products */ }
  const byId = Object.fromEntries(S.products.map(p => [p.id, p]));
  return {
    title: 'Market 市集', tab: '#/',
    body: html`
      <a class="card market-head" href="#/pick">
        <div class="grow">${marketLine(m)}</div>
        <div class="col-end">${statusTag(m.status)}<span class="link">Change 切換</span></div>
      </a>
      <div class="card soon">
        <b>Pre-orders & sales 預訂與銷售</b>
        <p class="mu">Coming in the next update. 下一版加入。</p>
      </div>
      <h2>Products at this market 本場商品</h2>
      ${rows.length ? rows.map(r => {
        const p = byId[r.product_id] || {};
        return html`<div class="card row"><div class="grow"><b>${p.name_zh}</b><div class="mu">${p.name_en}</div></div>
          <div class="col-end"><b>${money(r.price)}</b><span class="mu">× ${r.qty_brought}</span></div></div>`;
      }) : html`<p class="mu c">No products set for this market yet. 這場市集尚未設定商品。
          ${S.isOwner ? html`<br><a href="#/market/${m.id}">Set up 設定 ›</a>` : ''}</p>`}`,
    actions: {},
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
        if (!confirm('Log out? 確定登出？')) return;
        await signOut(); location.hash = '#/'; location.reload();
      },
    },
  };
}
