// Orders list, one order's page, and the full-screen QR.
import { html, str, $, toast, money, choose, store, digits, dateBi } from '../util.js';
import { S } from '../db.js';
import { go } from '../app.js';
import {
  allOrders, getOrder, patchOrder, deleteOrder, onOrdersChange, customerLink, pickupText,
  itemsText, orderTotal, toMake, pendingCount, errorCount, discardErrors, sync, O,
} from '../orders.js';

const PAY = { cash: 'Cash 現金', linepay: 'LINE Pay', transfer: 'Transfer 轉帳' };
const STATUS = { waiting: 'Waiting 待取', ready: 'Ready 已備好', picked_up: 'Picked up 已取' };
const fmtTime = t => t ? new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

// ---- QR as a crisp black-on-white SVG ------------------------------------
export function qrSvg(text) {
  const k = window.qrcode(0, 'M'); k.addData(text, 'Byte'); k.make();
  const n = k.getModuleCount(); let p = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (k.isDark(r, c)) p += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-3 -3 ${n + 6} ${n + 6}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
}

// ---- small shared bits ---------------------------------------------------
export function syncBar() {
  const n = pendingCount(), e = errorCount();
  if (!n) return '';
  return html`<div class="card syncbar ${e ? 'err' : ''}">
    ${e ? html`⚠ ${e} not saved 未儲存: <span class="small">${O.outbox.find(c => c.err)?.err}</span>`
        : html`⏳ ${n} not synced yet 尚未同步 ${navigator.onLine ? '' : '· offline 離線'}`}
    <div class="row gap"><button class="sm" data-act="syncNow">Retry 重試</button>
    ${e ? html`<button class="sm danger" data-act="discard">Discard 放棄</button>` : ''}</div></div>`;
}
export const syncActions = {
  async syncNow() { await sync(); toast(pendingCount() ? 'Still waiting for signal 等待網路' : 'Synced 已同步'); },
  async discard() { if (confirm('Throw away the changes that could not be saved? 確定放棄？')) discardErrors(); },
};

export function makeHtml(groups) {
  if (!groups.length) return '';
  return html`<details class="card make" open><summary><b>To make 要準備</b></summary>
    ${groups.map(g => html`<div class="mk"><b>${g.label}</b> <span class="mu">(${g.orders})</span><div>${[...g.items].map(([k, n]) => html`<span class="tag">${k} ×${n}</span> `)}</div></div>`)}
  </details>`;
}

const tags = o => html`<span class="tag st-${o.status}">${STATUS[o.status]}</span>
  <span class="tag ${o.paid ? 'paid' : 'unpaid'}">${o.paid ? '💰 ' + (PAY[o.payment_type] || 'Paid 已付') : 'Unpaid 未付'}</span>
  ${o._pending ? html`<span class="tag warn">⏳ Not synced 未同步</span>` : ''}`;

// ---- list ----------------------------------------------------------------
let F = store.get('ordFilter', 'market'), Q = '';

function filtered() {
  const m = S.marketId;
  let L = allOrders();
  if (F === 'market') L = L.filter(o => o.status !== 'picked_up' && (o.pickup_market_id === m || o.market_id === m));
  else if (F === 'open') L = L.filter(o => o.status !== 'picked_up');
  else L = L.filter(o => o.status === 'picked_up').sort((a, b) => (b.picked_up_at || '').localeCompare(a.picked_up_at || ''));
  const q = Q.trim(), d = digits(q);
  if (q) L = allOrders().filter(o => (d.length >= 3 && o.phone.includes(d)) || o.code === q.toUpperCase()
    || (!d && (o.customer_name || '').toLowerCase().includes(q.toLowerCase())));
  return L;
}

function listHtml() {
  const L = filtered();
  return str(html`${!Q && F !== 'done' ? makeHtml(toMake(o => F !== 'market' || o.pickup_market_id === S.marketId || o.market_id === S.marketId)) : ''}
    ${L.length ? L.map(o => html`<div class="card ord ${o.status}">
      <a href="#/order/${o.id}" class="block">
        <div class="row"><b class="code">#${o.code}</b><span class="grow"></span>${tags(o)}</div>
        <div><b>${o.customer_name}</b> ${o.phone}</div>
        <div>${itemsText(o)}</div>
        <div class="mu">${pickupText(o)}${o.note ? ' · 📝 ' + o.note : ''}</div>
      </a>
      ${o.status !== 'picked_up' ? html`<div class="row gap mt">
        <button class="ok grow" data-act="pickup" data-id="${o.id}">✔ Picked up 已取貨</button>
        ${o.status === 'waiting' ? html`<button data-act="ready" data-id="${o.id}">Ready 備好</button>` : ''}</div>` : html`<div class="mu small">✔ ${fmtTime(o.picked_up_at)}</div>`}
    </div>`) : html`<p class="mu c">${Q ? 'Nothing found 找不到' : 'No orders 沒有訂單'}</p>`}`);
}

export function ordersView() {
  let off;
  return {
    title: 'Orders 訂單', tab: '#/orders',
    right: html`<a class="btn sm" href="#/scan">📷 Scan 掃描</a>`,
    body: html`
      <div id="sbar">${syncBar()}</div>
      <input id="q" type="search" inputmode="search" autocomplete="off" placeholder="🔍 Phone, last 4, name, code 電話／末四碼／姓名" value="${Q}">
      <div class="chips mt" id="ff">${[['market', 'This market', '本場'], ['open', 'All open', '全部未取'], ['done', 'Picked up', '已取貨']].map(([k, en, zh]) =>
        html`<button class="chipb ${F === k ? 'on' : ''}" data-act="filter" data-k="${k}">${en}<br>${zh}</button>`)}</div>
      <div id="olist"></div>`,
    after(root) {
      const draw = () => { const el = $('#olist'); if (el) el.innerHTML = listHtml(); const sb = $('#sbar'); if (sb) sb.innerHTML = str(syncBar()); };
      draw();
      $('#q', root).addEventListener('input', e => { Q = e.target.value; draw(); });
      off = onOrdersChange(draw);
    },
    cleanup: () => off && off(),
    actions: {
      ...syncActions,
      filter(el) { F = el.dataset.k; store.set('ordFilter', F); document.querySelectorAll('#ff .chipb').forEach(b => b.classList.toggle('on', b === el)); $('#olist').innerHTML = listHtml(); },
      pickup: el => markPickedUp(getOrder(el.dataset.id)),
      ready: el => patchOrder(el.dataset.id, { status: 'ready' }),
    },
  };
}

// ---- actions shared by list and detail -----------------------------------
async function askPay(title, withNotPaid) {
  const opts = Object.entries(PAY).map(([value, label]) => ({ label, value, cls: value === 'cash' ? 'pri' : '' }));
  if (withNotPaid) opts.push({ label: 'Not paid yet 尚未付款', value: 'none', cls: 'ghost' });
  return choose(title, opts);
}
async function markPickedUp(o) {
  if (!o) return;
  const patch = { status: 'picked_up', picked_up_at: new Date().toISOString() };
  if (!o.paid) {
    const pay = await askPay(`#${o.code} · ${money(orderTotal(o))} — paid how? 付款方式？`, true);
    if (pay === undefined) return;
    if (pay !== 'none') Object.assign(patch, { paid: true, payment_type: pay, paid_market_id: S.marketId });
  }
  patchOrder(o.id, patch);
  toast(`#${o.code} picked up 已取貨 ✔`);
}

// ---- one order -----------------------------------------------------------
export function orderView(id) {
  const o = getOrder(id);
  if (!o) return { title: 'Order 訂單', back: '#/orders', tab: '#/orders', body: html`<p class="mu c">Order not found 找不到訂單</p>` };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const smsText = `${S.org?.name || ''} 訂單 Order #${o.code}\n${itemsText(o)}\n${pickupText(o)}\n${customerLink(o)}`;
  let off;
  return {
    title: '#' + o.code, back: '#/orders', tab: '#/orders',
    body: html`
      <div class="card">${tags(o)}
        <p class="big-items">${(o.items || []).map(i => html`<span>${i.name_zh || i.name_en} <b>×${i.qty}</b></span><br>`)}</p>
        <div class="row"><span class="grow mu">Total 合計</span><b>${money(orderTotal(o))}</b></div></div>
      <div class="card">
        <div><b>${o.customer_name || '—'}</b> · <a class="link" href="tel:${o.phone}">${o.phone}</a></div>
        <div>📍 ${pickupText(o)}</div>
        ${o.note ? html`<div>📝 ${o.note}</div>` : ''}
        <div class="mu small">Ordered 下單 ${fmtTime(o.created_at)} · ${o.created_by || ''}${o.picked_up_at ? html`<br>Picked up 取貨 ${fmtTime(o.picked_up_at)}` : ''}${o.imported ? ' · imported 匯入' : ''}</div>
      </div>
      <div class="grid2">
        ${o.status !== 'picked_up'
          ? html`<button class="ok" data-act="pickup">✔ Picked up 已取貨</button>
                 <button data-act="ready">${o.status === 'ready' ? 'Not ready 未備好' : 'Ready 備好'}</button>`
          : html`<button data-act="undo">↩ Undo pickup 取消取貨</button><span></span>`}
        <button data-act="paid">${o.paid ? 'Mark unpaid 改未付' : '💰 Paid 已付款'}</button>
        <a class="btn" href="#/qr/${o.id}/x">QR</a>
        <a class="btn" href="sms:${o.phone}${ios ? '&' : '?'}body=${encodeURIComponent(smsText)}">💬 SMS</a>
        <button data-act="share">📤 Share 分享</button>
      </div>
      <button class="ghost wide danger" data-act="del">🗑 Delete order 刪除訂單</button>`,
    after() { off = onOrdersChange(() => { if (location.hash === '#/order/' + id) go(location.hash); }); },
    cleanup: () => off && off(),
    actions: {
      ...syncActions,
      pickup: () => markPickedUp(getOrder(id)),
      ready: () => patchOrder(id, { status: o.status === 'ready' ? 'waiting' : 'ready' }),
      undo: () => patchOrder(id, { status: 'ready', picked_up_at: null }),
      async paid() {
        if (o.paid) { if (confirm('Mark as NOT paid? 改為未付款？')) patchOrder(id, { paid: false, payment_type: null, paid_market_id: null }); return; }
        const pay = await askPay('Paid how? 付款方式？');
        if (pay) patchOrder(id, { paid: true, payment_type: pay, paid_market_id: S.marketId });
      },
      async share() {
        if (navigator.share) await navigator.share({ text: smsText }).catch(() => { });
        else { await navigator.clipboard?.writeText(smsText); toast('Copied 已複製'); }
      },
      del() {
        if (!confirm(`Delete order #${o.code}? 確定刪除？`)) return;
        deleteOrder(id); toast('Deleted 已刪除'); go('#/orders');
      },
    },
  };
}

const pendTag = o => o._pending
  ? html`<p class="note warn">⏳ Not synced yet — the customer's link starts working once it syncs. 尚未同步，同步後客人連結才會生效。</p>`
  : html`<p class="note okc">✓ Saved 已儲存</p>`;

// ---- full-screen QR --------------------------------------------------------
export function qrView(id, fromDetail) {
  const o = getOrder(id);
  if (!o) return go('#/orders');
  const url = customerLink(o);
  let off;
  return {
    title: '#' + o.code, tab: false,
    body: html`<div class="c qrpage">
      <div class="mu">Ask the customer to take a photo 請客人拍照</div>
      <div class="qrbox" id="qr"></div>
      <div class="big">#${o.code}</div>
      <div class="big-items">${(o.items || []).map(i => html`${i.name_zh || i.name_en} ×${i.qty}<br>`)}</div>
      <div class="mu">${pickupText(o)}<br>${o.customer_name} ${o.phone}${o.paid ? ' · 💰 Paid 已付款' : ''}</div>
      <div id="pend">${pendTag(o)}</div>
      <button class="pri" data-act="done">Done 完成</button>
      <button class="ghost wide" data-act="share">📤 Send link 傳送連結</button>
    </div>`,
    after() {
      $('#qr').innerHTML = qrSvg(url);
      off = onOrdersChange(() => { const p = $('#pend'), x = getOrder(id); if (p && x) p.innerHTML = str(pendTag(x)); });
    },
    cleanup: () => off && off(),
    actions: {
      done: () => go(fromDetail ? '#/order/' + id : '#/new'),
      async share() {
        const text = `${S.org?.name || ''} 訂單 Order #${o.code}\n${url}`;
        if (navigator.share) await navigator.share({ text }).catch(() => { });
        else { await navigator.clipboard?.writeText(text); toast('Copied 已複製'); }
      },
    },
  };
}

export { markPickedUp, dateBi };
