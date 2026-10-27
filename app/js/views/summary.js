// Owner only: money and units for one market, or for every market on the same day.
import { html, money, dateBi, store } from '../util.js';
import { sb, S, q, marketStock, ensureBasics } from '../db.js';
import { go } from '../app.js';
import { allOrders, orderTotal, sync } from '../orders.js';

const PAY = { cash: 'Cash 現金', linepay: 'LINE Pay', transfer: 'Transfer 轉帳', unknown: 'Not recorded 未記錄' };

export async function summaryView(id) {
  await ensureBasics();
  const m = S.markets.find(x => x.id === (id || S.marketId));
  if (!m) return go('#/pick');
  const sameDay = S.markets.filter(x => x.date === m.date);
  const whole = store.get('sumWhole', false) && sameDay.length > 1;
  const ids = whole ? sameDay.map(x => x.id) : [m.id];
  // send anything waiting first, so totals are complete (but don't wait long on bad wifi)
  await Promise.race([sync().catch(() => { }), new Promise(r => setTimeout(r, 4000))]);
  const [sum, stock] = await Promise.all([
    q(sb.rpc('market_summary', { p_markets: ids })),
    whole ? Promise.resolve([]) : marketStock(m.id).catch(() => []),
  ]);
  const st = Object.fromEntries(stock.map(x => [x.product_id, x]));
  const total = (sum.walkup_total || 0) + (sum.preorder_total || 0);
  const pays = Object.entries(sum.by_payment || {}).sort((a, b) => b[1] - a[1]);
  const units = sum.units || [];
  const u = { walk: units.reduce((s, x) => s + x.walkup, 0), pre: units.reduce((s, x) => s + x.preorder, 0) };
  const ord = allOrders().filter(o => ids.includes(o.pickup_market_id));
  const waiting = ord.filter(o => o.status !== 'picked_up');
  const unpaidDone = ord.filter(o => o.status === 'picked_up' && !o.paid);
  const others = [...S.markets].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  return {
    title: 'Summary 結算', back: '#/', tab: '#/',
    body: html`
      <select data-change="pickm" class="mt">${others.map(x => html`<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${dateBi(x.date)} · ${x.name}</option>`)}</select>
      ${sameDay.length > 1 ? html`<div class="chips mt">
        <button class="chipb ${whole ? '' : 'on'}" data-act="scope" data-w="0">This market<br>本場</button>
        <button class="chipb ${whole ? 'on' : ''}" data-act="scope" data-w="1">Whole day (${sameDay.length} markets)<br>整天合計</button></div>` : ''}
      ${whole ? html`<p class="mu small">${sameDay.map(x => x.name).join(' + ')}</p>` : ''}

      <div class="card c"><div class="mu">Revenue 營收</div><div class="big">${money(total)}</div>
        <div class="mu">${u.walk + u.pre} items 件 · ${dateBi(m.date)}</div></div>

      <div class="grid2">
        <div class="card stat"><div class="mu">Walk-up 現場</div><b>${money(sum.walkup_total)}</b><div class="mu small">${u.walk} items 件</div></div>
        <div class="card stat"><div class="mu">Pre-orders 預訂</div><b>${money(sum.preorder_total)}</b><div class="mu small">${u.pre} items picked up 件已取</div></div>
      </div>

      <h2>By payment 付款方式</h2>
      <div class="card">${pays.length ? pays.map(([k, v]) => html`<div class="row"><span class="grow">${PAY[k] || k}</span><b>${money(v)}</b>
        <span class="mu small pct">${total ? Math.round(v * 100 / total) : 0}%</span></div>`) : html`<span class="mu">No money recorded yet 尚無紀錄</span>`}
        ${pays.length ? html`<div class="row sumline"><span class="grow">Cash vs digital 現金／電子</span>
          <b>${money(sum.by_payment?.cash || 0)} / ${money(total - (sum.by_payment?.cash || 0))}</b></div>` : ''}</div>

      <h2>Per product 各商品</h2>
      <div class="card"><table class="tbl"><tr><th></th><th>Walk-up<br>現場</th><th>Pre-order<br>預訂</th><th>Total<br>合計</th>${whole ? '' : html`<th>Left<br>剩</th>`}</tr>
        ${units.map(x => html`<tr><td>${x.zh || x.en}</td><td>${x.walkup}</td><td>${x.preorder}</td><td><b>${x.walkup + x.preorder}</b></td>
          ${whole ? '' : html`<td>${st[x.product_id] ? st[x.product_id].remaining : ''}</td>`}</tr>`)}
        ${!units.length ? html`<tr><td colspan="5" class="mu">Nothing sold yet 尚無銷售</td></tr>` : ''}</table></div>

      <h2>Pre-orders here 本場預訂</h2>
      <div class="card">
        <div class="row"><span class="grow">Picked up 已取</span><b>${ord.length - waiting.length}</b></div>
        <div class="row"><span class="grow">Still waiting 未取</span><b class="${waiting.length ? 'bad-tx' : ''}">${waiting.length}</b></div>
        ${waiting.map(o => html`<a class="mu small block" href="#/order/${o.id}">#${o.code} ${o.customer_name} ${o.phone} · ${money(orderTotal(o))} ›</a>`)}
        ${unpaidDone.length ? html`<div class="row mt"><span class="grow">Picked up but unpaid 已取未付</span><b class="bad-tx">${unpaidDone.length}</b></div>
          ${unpaidDone.map(o => html`<a class="mu small block" href="#/order/${o.id}">#${o.code} ${o.customer_name} ${o.phone} · ${money(orderTotal(o))} ›</a>`)}` : ''}
      </div>
      <p class="mu small">Pre-order money counts at the market where it was paid; pre-order items count where they were picked up.
        預訂金額算在收款的市集，預訂件數算在取貨的市集。</p>
      ${m.status !== 'closed' ? html`<button class="ghost wide" data-act="close">Close this market 結束本場市集</button>` : ''}`,
    actions: {
      pickm(el) { go('#/summary/' + el.value); },
      scope(el) { store.set('sumWhole', el.dataset.w === '1'); go(location.hash === '#/summary/' + m.id ? location.hash : '#/summary/' + m.id); },
      async close() {
        if (!confirm(`Mark "${m.name}" as closed? 確定結束？`)) return;
        await q(sb.from('markets').update({ status: 'closed' }).eq('id', m.id));
        m.status = 'closed'; go('#/summary/' + m.id);
      },
    },
  };
}
