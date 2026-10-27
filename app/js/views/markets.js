// Owner: list of markets, and create / edit one market with its products, prices and quantities.
import { html, $, $$, toast, today, uuid, formData } from '../util.js';
import { T, pname, fmtDate } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q, loadBasics, setMarket } from '../db.js';
import { go } from '../app.js';
import { marketLine, statusTag } from './home.js';

export function marketsView() {
  const list = [...S.markets].sort((a, b) => b.date.localeCompare(a.date));
  return {
    title: T('Markets', '市集管理'), back: '#/more', tab: '#/more',
    body: html`
      <a class="btn primary block" href="#/market/new">${icon('plus')}${T('New market', '新增市集')}</a>
      ${list.length ? html`<div class="list market-list">${list.map(m => html`<a href="#/market/${m.id}"><div class="grow">${marketLine(m)}</div>${statusTag(m.status)}${icon('chevron', 'chev')}</a>`)}</div>`
        : html`<div class="empty"><b>${T('No markets yet', '還沒有市集')}</b>${T('Add the first market you will sell at.', '新增第一場市集。')}</div>`}`,
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
      <label class="check-row"><input type="checkbox" class="sell" ${r ? 'checked' : ''} data-change="toggle">
        <span class="grow serif" style="font-size:17px;font-weight:600">${pname(p)}</span></label>
      <div class="nums">
        <label class="field"><span>${T('Price (NT$)', '價格（NT$）')}</span><input type="number" inputmode="numeric" min="0" class="price" value="${r ? r.price : p.default_price}"></label>
        <label class="field"><span>${T('Bringing', '帶貨量')}</span><input type="number" inputmode="numeric" min="0" class="qty" value="${r ? r.qty_brought : ''}" placeholder="0"></label>
      </div>
      <label class="check-row so-l small"><input type="checkbox" class="so" ${r?.sold_out ? 'checked' : ''}><span class="mu">${T('Sold out now — stop selling it', '現在售完，停止販售')}</span></label></div>`;
  };

  return {
    title: isNew ? T('New market', '新增市集') : T('Edit market', '編輯市集'), back: '#/markets', tab: '#/more',
    body: html`
      <div class="card stack" id="mf">
        <label class="field"><span>${T('Name', '名稱')}</span><input name="name" value="${m.name}" placeholder="${T('e.g. Blueprint Saturday market', '例如：藍晒圖週六市集')}"></label>
        <label class="field"><span>${T('Date', '日期')}</span><input name="date" type="date" value="${m.date}"></label>
        <label class="field"><span>${T('Location', '地點')}</span><input name="location" value="${m.location}"></label>
        <div class="field"><span>${T('Status', '狀態')}</span>
          <div class="seg">${['upcoming', 'open', 'closed'].map(s => html`
            <label><input type="radio" name="status" value="${s}" ${m.status === s ? 'checked' : ''}>${{ upcoming: T('Upcoming', '即將舉行'), open: T('Open', '營業中'), closed: T('Closed', '已結束') }[s]}</label>`)}</div></div>
      </div>

      ${others.length ? html`<div class="card stack">
        <span class="mu small">${T('Start from a previous market', '從之前的市集複製')}</span>
        <div class="row"><select id="copyFrom" class="grow" aria-label="${T('Copy products from', '複製商品自')}"><option value="">${T('Choose a market…', '選擇市集…')}</option>
          ${others.map(o => html`<option value="${o.id}">${fmtDate(o.date)} · ${o.name}</option>`)}</select>
        <button class="btn" data-act="copy">${T('Copy', '複製')}</button></div></div>` : ''}

      <div class="h2">${T('Products', '商品')}<span class="aside">${T('Tick what you sell here', '勾選本場販售的商品')}</span></div>
      ${prods.length ? html`<div class="stack">${prods.map(prodRow)}</div>` : html`<div class="empty"><b>${T('No products yet', '還沒有商品')}</b><a class="accent-tx" href="#/products">${T('Add products first', '請先新增商品')}</a></div>`}

      <button class="btn primary lg block sticky-cta" data-act="save">${T('Save market', '儲存市集')}</button>
      ${isNew ? '' : html`<button class="btn danger block" data-act="del">${icon('trash')}${T('Delete market', '刪除市集')}</button>`}`,
    actions: {
      toggle(el) { el.closest('.prod').classList.toggle('off', !el.checked); },

      async copy() {
        const from = $('#copyFrom').value;
        if (!from) return toast(T('Choose a market first.', '請先選擇市集。'));
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
        toast(T(`Copied ${src.length} products`, `已複製 ${src.length} 項商品`));
      },

      async save() {
        const f = formData($('#mf'));
        if (!f.name) return toast(T('Give the market a name.', '請輸入市集名稱。'), 'err');
        if (!f.date) return toast(T('Choose a date.', '請選擇日期。'), 'err');
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
            sold_out: $('.so', card).checked,
          });
          else if (inMarket[pid]) drop.push(pid);
        });
        if (keep.length) await q(sb.from('market_products').upsert(keep));
        if (drop.length) await q(sb.from('market_products').delete().eq('market_id', m.id).in('product_id', drop));

        await loadBasics();
        if (isNew && !S.market) setMarket(m.id);
        toast(T('Market saved', '市集已儲存')); go('#/markets');
      },

      async del() {
        const [{ count: o }, { count: s }] = await Promise.all([
          sb.from('orders').select('id', { count: 'exact', head: true }).or(`market_id.eq.${m.id},pickup_market_id.eq.${m.id}`),
          sb.from('sales').select('id', { count: 'exact', head: true }).eq('market_id', m.id),
        ]);
        if (o || s) return toast(T(`This market has ${o || 0} orders and ${s || 0} sales, so it can’t be deleted. Set it to Closed instead.`, `這場市集已有 ${o || 0} 筆訂單、${s || 0} 筆銷售，無法刪除，請改為「已結束」。`), 'err');
        if (!confirm(T(`Delete “${m.name}”?`, `確定刪除「${m.name}」？`))) return;
        await q(sb.from('markets').delete().eq('id', m.id));
        if (S.marketId === m.id) setMarket(null);
        await loadBasics(); toast(T('Market deleted', '市集已刪除')); go('#/markets');
      },
    },
  };
}
