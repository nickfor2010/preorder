// Backup & export: a printable list of orders still to collect (keep it in the shop in case a
// customer's phone is dead), plus spreadsheets (CSV) of orders and sales for accounting.
import { html, $, $$, toast, money, today, addDays, store } from '../util.js';
import { T, pname, fmtDate, fmtDateTime, PAY } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q, ensureBasics } from '../db.js';
import { allOrders, pickupText, pickupGroup, orderTotal, sync } from '../orders.js';
import { render } from '../app.js';

export function exportView() {
  const from = store.get('expFrom', addDays(today(), -30)), to = store.get('expTo', today());
  return {
    title: T('Print & export', '列印與匯出'), back: '#/more', tab: '#/more',
    body: html`
      <a class="list" href="#/print"><span><span class="lead">${icon('note')}</span>
        <span class="grow col"><b>${T('Order list for the shop', '店內備用訂單清單')}</b>
        <span class="mu xs">${T('Print it or save it as a PDF, so you can hand over orders even if the customer’s phone is dead.', '列印或存成 PDF，客人手機沒電也能交貨。')}</span></span>${icon('chevron', 'chev')}</span></a>

      <div class="h2">${T('Spreadsheets (CSV, opens in Excel)', '試算表（CSV，可用 Excel 開啟）')}</div>
      <div class="card stack">
        <div class="grid2">
          <label class="field"><span>${T('From', '從')}</span><input id="from" type="date" value="${from}"></label>
          <label class="field"><span>${T('To', '到')}</span><input id="to" type="date" value="${to}"></label>
        </div>
        <button class="btn block" data-act="ordersCsv">${icon('download')}${T('Download orders', '下載訂單')}</button>
        ${S.isOwner ? html`<button class="btn block" data-act="salesCsv">${icon('download')}${T('Download walk-up sales', '下載現場銷售')}</button>` : ''}
        <p class="mu xs" style="margin:0">${T('Dates are when the order was placed or the sale was made.', '日期為下單或銷售的日期。')}</p>
      </div>`,
    actions: {
      async ordersCsv() {
        const [a, b] = range();
        const rows = await q(sb.from('orders').select('*, items:order_items(*)')
          .gte('created_at', a).lt('created_at', b).order('created_at').limit(5000));
        await ensureBasics();
        const mk = id => S.markets.find(m => m.id === id)?.name || '';
        download(`orders_${$('#from').value}_${$('#to').value}.csv`, [
          [T('Code', '編號'), T('Ordered', '下單時間'), T('Customer', '客人'), T('Phone', '電話'), T('Items', '商品'), T('Total', '合計'),
            T('Paid', '已付款'), T('Payment', '付款方式'), T('Status', '狀態'), T('Pickup', '取貨'), T('Picked up at', '取貨時間'), T('Taken at market', '接單市集'), T('Note', '備註')],
          ...rows.map(o => [o.code, local(o.created_at), o.customer_name, o.phone, (o.items || []).map(i => `${pname(i)} x${i.qty}`).join('; '),
            orderTotal(o), o.paid ? T('yes', '是') : T('no', '否'), PAY()[o.payment_type] || '', status(o.status), pickupText(o), local(o.picked_up_at), mk(o.market_id), o.note]),
        ]);
      },
      async salesCsv() {
        const [a, b] = range();
        const rows = await q(sb.from('sales').select('*').gte('created_at', a).lt('created_at', b).order('created_at').limit(20000));
        await ensureBasics();
        const prod = Object.fromEntries(S.products.map(p => [p.id, p]));
        const mk = Object.fromEntries(S.markets.map(m => [m.id, m.name]));
        download(`sales_${$('#from').value}_${$('#to').value}.csv`, [
          [T('Time', '時間'), T('Market', '市集'), T('Product', '商品'), T('Qty', '數量'), T('Price', '單價'), T('Total', '金額'), T('Payment', '付款方式'), T('Staff', '員工')],
          ...rows.map(x => [local(x.created_at), mk[x.market_id] || '', pname(prod[x.product_id]), x.qty, x.unit_price, x.qty * x.unit_price, PAY()[x.payment_type] || x.payment_type, x.created_by]),
        ]);
      },
    },
  };
}

const status = s => ({ waiting: T('Waiting', '待取貨'), ready: T('Ready', '已備好'), picked_up: T('Picked up', '已取貨') }[s] || s);
const local = t => t ? new Date(t).toLocaleString('sv-SE', { hour12: false }).slice(0, 16) : '';   // 2026-10-27 14:05
function range() {
  const f = $('#from').value, t = $('#to').value;
  if (!f || !t || f > t) throw new Error(T('Choose a valid date range.', '請選擇正確的日期範圍。'));
  store.set('expFrom', f); store.set('expTo', t);
  return [new Date(f + 'T00:00').toISOString(), new Date(addDays(t, 1) + 'T00:00').toISOString()];
}
function download(name, rows) {
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // ﻿ makes Excel read Chinese characters correctly
  const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast(T(`Saved ${name}`, `已下載 ${name}`));
}

// ---- printable list ---------------------------------------------------------
export async function printView() {
  await ensureBasics();
  await Promise.race([sync().catch(() => { }), new Promise(r => setTimeout(r, 3000))]);
  const scope = store.get('printScope', 'shop');
  let L = allOrders().filter(o => o.status !== 'picked_up');
  if (scope === 'shop') L = L.filter(o => o.pickup_kind === 'shop');
  else if (scope === 'market') L = L.filter(o => o.pickup_market_id === S.marketId);
  const groups = new Map();
  for (const o of L) {
    const g = pickupGroup(o);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, list: [] });
    groups.get(g.key).list.push(o);
  }
  const G = [...groups.values()].sort((a, b) => a.sort.localeCompare(b.sort));
  G.forEach(g => g.list.sort((a, b) => a.code.localeCompare(b.code)));
  const org = S.org || {};
  const tot = L.reduce((s, o) => s + (o.paid ? 0 : orderTotal(o)), 0);

  return {
    title: T('Order list', '訂單清單'), back: '#/export', tab: false,
    body: html`
      <div class="noprint stack">
        <div class="seg" id="ps">${[['shop', T('Shop pickups', '到店取貨')], ['market', T('This market', '本場')], ['all', T('All open', '全部未取')]].map(([k, l]) =>
          html`<button class="${scope === k ? 'on' : ''}" data-act="scope" data-k="${k}">${l}</button>`)}</div>
        <button class="btn primary lg block" data-act="print">${icon('download')}${T('Print or save as PDF', '列印或存成 PDF')}</button>
        <p class="mu xs" style="margin:0">${T('On iPhone: tap the button, then the Share icon at the top › Save to Files. On a computer choose “Save as PDF” as the printer.',
          'iPhone：按下按鈕後，點上方的分享圖示 › 儲存到「檔案」。電腦：印表機選「另存為 PDF」。')}</p>
      </div>

      <article class="sheetpaper">
        <header class="ph">
          ${org.logo ? html`<img src="${org.logo}" alt="">` : ''}
          <div class="grow"><h2>${org.name || ''}</h2>
            <div class="mu small">${{ shop: T('Orders to collect in the shop', '到店待取訂單'), market: T('Orders to collect at', '市集待取訂單') + ' ' + (S.market?.name || ''), all: T('All orders not yet collected', '所有未取訂單') }[scope]}</div></div>
          <div class="mu xs" style="text-align:right">${T('Printed', '列印時間')}<br>${fmtDateTime(new Date().toISOString())}<br>${T(`${L.length} orders`, `共 ${L.length} 筆`)}</div>
        </header>
        ${G.length ? G.map(g => html`<section>
          <h3>${g.label}${g.sub ? ' · ' + g.sub : ''} <span class="mu xs">(${g.list.length})</span></h3>
          <table class="ptbl"><thead><tr><th class="ck"></th><th>${T('Code', '編號')}</th><th>${T('Customer', '客人')}</th><th>${T('Items', '商品')}</th><th class="r">${T('To pay', '應收')}</th></tr></thead><tbody>
          ${g.list.map(o => html`<tr>
            <td class="ck"><span class="box"></span></td>
            <td><b class="pcode">#${o.code}</b></td>
            <td><b>${o.customer_name || '—'}</b><br><span class="num">${o.phone}</span></td>
            <td>${(o.items || []).map(i => html`${pname(i)} ×${i.qty}<br>`)}${o.pickup_time ? html`<span class="mu xs">${o.pickup_time}</span>` : ''}${o.note ? html`<div class="mu xs">${T('Note', '備註')}：${o.note}</div>` : ''}</td>
            <td class="r num">${o.paid ? html`<span class="mu">${T('Paid', '已付')}</span>` : money(orderTotal(o))}</td>
          </tr>`)}</tbody></table></section>`)
        : html`<p class="mu c">${T('No orders waiting. Nothing to print.', '目前沒有待取訂單。')}</p>`}
        ${G.length ? html`<footer class="pf"><span>${T('Still to collect (unpaid)', '尚未收款')}</span><b class="num">${money(tot)}</b></footer>` : ''}
        <p class="mu xs c">${T('Check the box and write the time when the customer collects.', '客人取貨時請打勾並寫上時間。')}</p>
      </article>`,
    actions: {
      scope(el) { store.set('printScope', el.dataset.k); render(); },
      print() { window.print(); },
    },
  };
}
