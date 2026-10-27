// Owner only: money and units for one market, or for every market on the same day.
import { html, money, store } from '../util.js';
import { T, fmtDate, PAY, getLang } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q, marketStock, ensureBasics } from '../db.js';
import { go } from '../app.js';
import { allOrders, orderTotal, sync } from '../orders.js';

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
  const cash = sum.by_payment?.cash || 0;
  const units = sum.units || [];
  const u = { walk: units.reduce((s, x) => s + x.walkup, 0), pre: units.reduce((s, x) => s + x.preorder, 0) };
  const ord = allOrders().filter(o => ids.includes(o.pickup_market_id));
  const waiting = ord.filter(o => o.status !== 'picked_up');
  const unpaidDone = ord.filter(o => o.status === 'picked_up' && !o.paid);
  const others = [...S.markets].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  const pct = v => total ? Math.round(v * 100 / total) : 0;
  const ordLink = o => html`<a class="row small" href="#/order/${o.id}"><span class="grow">#${o.code} · ${o.customer_name || ''} <span class="num mu">${o.phone}</span></span><b class="num">${money(orderTotal(o))}</b>${icon('chevron', 'chev')}</a>`;
  const pname = x => (getLang() === 'en' ? x.en || x.zh : x.zh || x.en);

  return {
    title: T('Summary', '結算'), back: '#/', tab: '#/',
    body: html`
      <select data-change="pickm" aria-label="${T('Market', '市集')}">${others.map(x => html`<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${fmtDate(x.date)} · ${x.name}</option>`)}</select>
      ${sameDay.length > 1 ? html`<div class="seg">
        <button class="${whole ? '' : 'on'}" data-act="scope" data-w="0">${T('This market', '本場')}</button>
        <button class="${whole ? 'on' : ''}" data-act="scope" data-w="1">${T(`Whole day · ${sameDay.length} markets`, `整天 · ${sameDay.length} 場`)}</button></div>` : ''}

      <div class="card c" style="padding:22px 16px">
        <div class="mu small">${whole ? sameDay.map(x => x.name).join(' + ') : m.name} · ${fmtDate(m.date)}</div>
        <div class="big-num big" style="margin:8px 0 6px">${money(total)}</div>
        <div class="mu small">${T(`${u.walk + u.pre} items sold`, `共售出 ${u.walk + u.pre} 件`)}</div>
      </div>

      <div class="grid2">
        <div class="card stat"><div class="lbl">${T('Walk-up', '現場銷售')}</div><b>${money(sum.walkup_total)}</b><div class="mu xs">${T(`${u.walk} items`, `${u.walk} 件`)}</div></div>
        <div class="card stat"><div class="lbl">${T('Pre-orders', '預訂')}</div><b>${money(sum.preorder_total)}</b><div class="mu xs">${T(`${u.pre} items picked up`, `${u.pre} 件已取貨`)}</div></div>
      </div>

      <div class="h2">${T('By payment', '付款方式')}</div>
      <div class="card">${pays.length ? html`${pays.map(([k, v]) => html`<div class="payrow"><span>${PAY()[k] || k}</span><b class="num">${money(v)}</b><span class="mu small num" style="text-align:right">${pct(v)}%</span>
          <div class="bar" style="grid-column:1/-1;margin-top:0"><i style="width:${pct(v)}%"></i></div></div>`)}
        <div class="payrow"><span class="mu">${T('Cash / digital', '現金／電子支付')}</span><b class="num">${money(cash)} / ${money(total - cash)}</b><span></span></div>`
        : html`<span class="mu">${T('No payments recorded yet.', '尚無付款紀錄。')}</span>`}</div>

      <div class="h2">${T('Per product', '各商品')}</div>
      <div class="card tbl-wrap"><table class="tbl"><tr><th></th><th>${T('Walk-up', '現場')}</th><th>${T('Pre-order', '預訂')}</th><th>${T('Total', '合計')}</th>${whole ? '' : html`<th>${T('Left', '剩')}</th>`}</tr>
        ${units.map(x => html`<tr><td class="serif">${pname(x)}</td><td>${x.walkup}</td><td>${x.preorder}</td><td><b>${x.walkup + x.preorder}</b></td>
          ${whole ? '' : html`<td>${st[x.product_id] ? st[x.product_id].remaining : ''}</td>`}</tr>`)}
        ${!units.length ? html`<tr><td colspan="5" class="mu">${T('Nothing sold yet.', '尚無銷售。')}</td></tr>` : ''}</table></div>

      <div class="h2">${T('Pre-orders here', '本場預訂')}</div>
      <div class="card stack">
        <div class="row"><span class="grow">${T('Picked up', '已取貨')}</span><b class="num">${ord.length - waiting.length}</b></div>
        <div class="row"><span class="grow">${T('Still waiting', '尚未取貨')}</span><b class="num ${waiting.length ? 'bad-tx' : ''}">${waiting.length}</b></div>
        ${waiting.map(ordLink)}
        ${unpaidDone.length ? html`<div class="divider"></div><div class="row"><span class="grow">${T('Picked up but unpaid', '已取貨未付款')}</span><b class="num bad-tx">${unpaidDone.length}</b></div>
          ${unpaidDone.map(ordLink)}` : ''}
      </div>
      <p class="mu xs" style="margin:0 2px">${T('Pre-order money counts at the market where it was paid. Pre-order items count where they were picked up.', '預訂金額計入收款的市集，預訂件數計入取貨的市集。')}</p>
      ${m.status !== 'closed' ? html`<button class="btn ghost block" data-act="close">${T('Close this market', '結束這場市集')}</button>` : ''}`,
    actions: {
      pickm(el) { go('#/summary/' + el.value); },
      scope(el) { store.set('sumWhole', el.dataset.w === '1'); go('#/summary/' + m.id); },
      async close() {
        if (!confirm(T(`Mark “${m.name}” as closed?`, `確定結束「${m.name}」？`))) return;
        await q(sb.from('markets').update({ status: 'closed' }).eq('id', m.id));
        m.status = 'closed'; go('#/summary/' + m.id);
      },
    },
  };
}
