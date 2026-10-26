// Owner: list of markets, and create / edit one market with its products, prices and quantities.
import { html, $, $$, toast, today, uuid, dateBi, formData } from '../util.js';
import { sb, S, q, loadBasics, setMarket } from '../db.js';
import { go } from '../app.js';
import { marketLine, statusTag } from './home.js';

export function marketsView() {
  const list = [...S.markets].sort((a, b) => b.date.localeCompare(a.date));
  return {
    title: 'Markets 市集管理', back: '#/more', tab: '#/more',
    body: html`
      <a class="btn pri wide" href="#/market/new">＋ New market 新增市集</a>
      ${list.map(m => html`<a class="card row" href="#/market/${m.id}"><div class="grow">${marketLine(m)}</div>${statusTag(m.status)}</a>`)}
      ${list.length ? '' : html`<p class="mu c">No markets yet. 還沒有市集。</p>`}`,
  };
}

export async function marketEditView(id) {
  const isNew = id === 'new';
  const m = isNew ? { id: uuid(), name: '', date: today(), location: '', status: 'upcoming' }
    : await q(sb.from('markets').select('*').eq('id', id).single());
  const mp = isNew ? [] : await q(sb.from('market_products').select('*').eq('market_id', id));
  const inMarket = Object.fromEntries(mp.map(r => [r.product_id, r]));
  // active products, plus any inactive ones this market already uses
  const prods = S.products.filter(p => p.active || inMarket[p.id]);
  const others = [...S.markets].filter(x => x.id !== m.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  const prodRow = p => {
    const r = inMarket[p.id];
    return html`<div class="card prod ${r ? '' : 'off'}" data-pid="${p.id}">
      <label class="row"><input type="checkbox" class="sell" ${r ? 'checked' : ''} data-change="toggle">
        <span class="grow"><b>${p.name_zh}</b> <span class="mu">${p.name_en}</span></span></label>
      <div class="row gap nums">
        <label>Price 價格<input type="number" inputmode="numeric" min="0" class="price" value="${r ? r.price : p.default_price}"></label>
        <label>Bring 帶貨量<input type="number" inputmode="numeric" min="0" class="qty" value="${r ? r.qty_brought : ''}" placeholder="0"></label>
      </div></div>`;
  };

  return {
    title: isNew ? 'New market 新增市集' : 'Edit market 編輯市集', back: '#/markets', tab: '#/more',
    body: html`
      <div class="card form" id="mf">
        <label class="lbl">Name 名稱<input name="name" value="${m.name}" placeholder="e.g. 藍晒圖 Saturday market"></label>
        <label class="lbl">Date 日期<input name="date" type="date" value="${m.date}"></label>
        <label class="lbl">Location 地點<input name="location" value="${m.location}" placeholder="📍"></label>
        <div class="lbl">Status 狀態</div>
        <div class="chips">${['upcoming', 'open', 'closed'].map(s => html`
          <label class="chip"><input type="radio" name="status" value="${s}" ${m.status === s ? 'checked' : ''}><span>${statusTag(s)}</span></label>`)}</div>
      </div>

      ${others.length ? html`<div class="card row gap">
        <select id="copyFrom" class="grow"><option value="">Copy products from… 複製商品自…</option>
          ${others.map(o => html`<option value="${o.id}">${dateBi(o.date)} · ${o.name}</option>`)}</select>
        <button data-act="copy">Copy 複製</button></div>` : ''}

      <h2>Products 商品 <span class="mu small">(tick what you sell here 勾選本場販售)</span></h2>
      ${prods.length ? prods.map(prodRow) : html`<p class="mu c">Add products first. 請先新增商品。 <a href="#/products">Products 商品 ›</a></p>`}

      <button class="pri sticky" data-act="save">Save 儲存</button>
      ${isNew ? '' : html`<button class="ghost wide danger" data-act="del">Delete market 刪除市集</button>`}`,
    actions: {
      toggle(el) { el.closest('.prod').classList.toggle('off', !el.checked); },

      async copy() {
        const from = $('#copyFrom').value;
        if (!from) return toast('Choose a market 請選擇市集');
        const src = await q(sb.from('market_products').select('*').eq('market_id', from));
        const byP = Object.fromEntries(src.map(r => [r.product_id, r]));
        $$('.prod').forEach(card => {
          const r = byP[card.dataset.pid];
          $('.sell', card).checked = !!r; card.classList.toggle('off', !r);
          if (r) { $('.price', card).value = r.price; $('.qty', card).value = r.qty_brought; }
        });
        const o = S.markets.find(x => x.id === from);
        const f = $('#mf');
        if (o && !$('[name=name]', f).value) $('[name=name]', f).value = o.name;
        if (o && !$('[name=location]', f).value) $('[name=location]', f).value = o.location;
        toast(`Copied ${src.length} products 已複製`);
      },

      async save() {
        const f = formData($('#mf'));
        if (!f.name) return toast('Name needed 請輸入名稱', 'err');
        if (!f.date) return toast('Date needed 請選日期', 'err');
        const status = ($('#mf [name=status]:checked') || {}).value || 'upcoming';
        await q(sb.from('markets').upsert({ id: m.id, name: f.name, date: f.date, location: f.location, status }));

        const order = Object.fromEntries(S.products.map((p, i) => [p.id, i]));
        const keep = [], drop = [];
        $$('.prod').forEach(card => {
          const pid = card.dataset.pid;
          if ($('.sell', card).checked) keep.push({
            market_id: m.id, product_id: pid, sort: order[pid] ?? 0,
            price: Math.max(0, Number($('.price', card).value) || 0),
            qty_brought: Math.max(0, Number($('.qty', card).value) || 0),
          });
          else if (inMarket[pid]) drop.push(pid);
        });
        if (keep.length) await q(sb.from('market_products').upsert(keep));
        if (drop.length) await q(sb.from('market_products').delete().eq('market_id', m.id).in('product_id', drop));

        await loadBasics();
        if (isNew && !S.market) setMarket(m.id);
        toast('Saved 已儲存'); go('#/markets');
      },

      async del() {
        const [{ count: o }, { count: s }] = await Promise.all([
          sb.from('orders').select('id', { count: 'exact', head: true }).or(`market_id.eq.${m.id},pickup_market_id.eq.${m.id}`),
          sb.from('sales').select('id', { count: 'exact', head: true }).eq('market_id', m.id),
        ]);
        if (o || s) return toast(`Has ${o || 0} orders / ${s || 0} sales — set it to Closed instead. 已有訂單或銷售，請改為「已結束」。`, 'err');
        if (!confirm(`Delete "${m.name}"? 確定刪除？`)) return;
        await q(sb.from('markets').delete().eq('id', m.id));
        if (S.marketId === m.id) setMarket(null);
        await loadBasics(); toast('Deleted 已刪除'); go('#/markets');
      },
    },
  };
}
