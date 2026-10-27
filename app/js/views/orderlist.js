// Orders list, one order's page, and the full-screen QR.
import { html, str, $, $$, toast, money, choose, store, digits } from '../util.js';
import { T, pname, fmtDateTime, PAY, inLang } from '../i18n.js';
import { icon } from '../icons.js';
import { S } from '../db.js';
import { go } from '../app.js';
import {
  allOrders, getOrder, patchOrder, deleteOrder, onOrdersChange, customerLink, pickupText,
  itemsText, orderTotal, pendingCount, errorCount, discardErrors, sync, O,
} from '../orders.js';

const STATUS = () => ({ waiting: T('Waiting', '待取貨'), ready: T('Ready', '已備好'), picked_up: T('Picked up', '已取貨') });

// ---- QR as a crisp black-on-white SVG ------------------------------------
export function qrSvg(text) {
  const k = window.qrcode(0, 'M'); k.addData(text, 'Byte'); k.make();
  const n = k.getModuleCount(); let p = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (k.isDark(r, c)) p += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
}

// ---- shared bits ----------------------------------------------------------
export function syncBar() {
  const n = pendingCount(), e = errorCount();
  if (!n) return '';
  return html`<div class="syncbar ${e ? 'err' : ''}">${icon(e ? 'alert' : 'clock')}
    <span class="grow">${e ? html`${T(`${e} change could not be saved`, `${e} 筆資料無法儲存`)}<br><span class="xs">${O.outbox.find(c => c.err)?.err}</span>`
      : navigator.onLine ? T(`${n} waiting to sync`, `${n} 筆等待同步`) : T(`${n} saved on this phone · no signal`, `${n} 筆存在手機 · 沒有網路`)}</span>
    <button class="btn sm" data-act="syncNow">${T('Retry', '重試')}</button>
    ${e ? html`<button class="btn sm" data-act="discard">${T('Discard', '放棄')}</button>` : ''}</div>`;
}
export const syncActions = {
  async syncNow() { await sync(); toast(pendingCount() ? T('Still waiting for signal', '仍在等待網路') : T('All synced', '已全部同步')); },
  async discard() { if (confirm(T('Throw away the changes that could not be saved?', '確定放棄無法儲存的資料？'))) discardErrors(); },
};

export function makeHtml(groups) {
  if (!groups.length) return '';
  const total = groups.reduce((s, g) => s + g.orders, 0);
  return html`<details class="card make" open><summary>${T('To prepare', '待準備')} <span class="pill">${T(`${total} orders`, `${total} 筆`)}</span></summary>
    ${groups.map(g => html`<div class="mk"><div class="row"><b class="grow">${g.label}</b><span class="mu small">${g.sub}</span></div>
      <div class="chips">${[...g.items].map(([k, n]) => html`<span class="pill">${k} <b>×${n}</b></span>`)}</div></div>`)}
  </details>`;
}

const tags = o => html`<span class="pill ${o.status === 'ready' ? 'ok' : o.status === 'picked_up' ? 'line' : ''}">${STATUS()[o.status]}</span>
  <span class="pill ${o.paid ? 'ok' : 'line'}">${o.paid ? (PAY()[o.payment_type] || T('Paid', '已付款')) : T('Unpaid', '未付款')}</span>
  ${o._pending ? html`<span class="pill warn">${icon('clock')}${T('Not synced', '未同步')}</span>` : ''}`;

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
  return str(html`
    ${L.length ? L.map(o => html`<div class="card ord ${o.status}">
      <a href="#/order/${o.id}" class="stack" style="gap:6px">
        <div class="row wrap gap4"><span class="code grow">#${o.code}</span>${tags(o)}</div>
        <div><b>${o.customer_name || T('No name', '未留姓名')}</b> <span class="mu num">${o.phone}</span></div>
        <div>${itemsText(o)}</div>
        <div class="meta">${icon('pin')}<span class="grow">${pickupText(o)}</span></div>
        ${o.note ? html`<div class="meta">${icon('note')}<span class="grow">${o.note}</span></div>` : ''}
      </a>
      ${o.status !== 'picked_up' ? html`<div class="acts">
        <button class="btn ok grow" data-act="pickup" data-id="${o.id}">${icon('check')}${T('Picked up', '已取貨')}</button>
        ${o.status === 'waiting' ? html`<button class="btn" data-act="ready" data-id="${o.id}">${T('Ready', '備好了')}</button>` : ''}</div>`
        : html`<div class="meta">${icon('check')}${fmtDateTime(o.picked_up_at)}</div>`}
    </div>`) : html`<div class="empty"><b>${Q ? T('No matching orders', '找不到符合的訂單') : T('No orders here', '目前沒有訂單')}</b>
      ${Q ? T('Try the last 4 digits of the phone number.', '試試電話末四碼。') : T('New pre-orders will appear here.', '新的預訂會顯示在這裡。')}</div>`}`);
}

export function ordersView() {
  let off;
  return {
    title: T('Orders', '訂單'), tab: '#/orders',
    right: html`<a class="btn sm" href="#/scan">${icon('scan')}${T('Scan', '掃描')}</a>`,
    body: html`
      <div id="sbar">${syncBar()}</div>
      <label class="search">${icon('search')}<input id="q" type="search" inputmode="search" autocomplete="off" placeholder="${T('Phone, last 4 digits, name or code', '電話、末四碼、姓名或編號')}" value="${Q}"></label>
      <div class="seg" id="ff">${[['market', T('This market', '本場')], ['open', T('All open', '全部未取')], ['done', T('Picked up', '已取貨')]].map(([k, l]) =>
        html`<button class="${F === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`)}</div>
      <div id="olist" class="stack"></div>`,
    after(root) {
      const draw = () => { const el = $('#olist'); if (el) el.innerHTML = listHtml(); const sb = $('#sbar'); if (sb) sb.innerHTML = str(syncBar()); };
      draw();
      $('#q', root).addEventListener('input', e => { Q = e.target.value; draw(); });
      off = onOrdersChange(draw);
    },
    cleanup: () => off && off(),
    actions: {
      ...syncActions,
      filter(el) { F = el.dataset.k; store.set('ordFilter', F); $$('#ff button').forEach(b => b.classList.toggle('on', b === el)); $('#olist').innerHTML = listHtml(); },
      pickup: el => markPickedUp(getOrder(el.dataset.id)),
      ready: el => markReady(el.dataset.id),
    },
  };
}

// ---- "your order is ready" message ------------------------------------------
// Written in Chinese and English together (we don't know which the customer reads).
export function readyMessage(o) {
  const shop = S.org?.name || '';
  const zh = inLang('zh', () => `【${shop}】您好${o.customer_name ? ' ' + o.customer_name : ''}，您的訂單 #${o.code} 已準備好，可以取貨了！\n取貨：${pickupText(o)}`);
  const en = inLang('en', () => `Your order #${o.code} is ready for pickup. Pickup: ${pickupText(o)}`);
  const tel = S.org?.phone ? `\n店家電話 Shop phone：${S.org.phone}` : '';
  return `${zh}\n${en}${tel}\n${customerLink(o)}`;
}
export const smsHref = (phone, text) => `sms:${phone}${/iPhone|iPad|iPod|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
export const lineHref = text => `https://line.me/R/share?text=${encodeURIComponent(text)}`;

export async function tellCustomer(o, asked = true) {
  if (!o) return;
  const how = await choose(T(`Tell ${o.customer_name || 'the customer'} the order is ready?`, `通知${o.customer_name || '客人'}可以取貨？`), [
    { label: T('Send SMS', '傳簡訊') + ' · ' + o.phone, value: 'sms', cls: 'primary' },
    { label: T('Send on LINE', '用 LINE 傳送'), value: 'line' },
  ], asked ? T('Opens your messages app with the text ready. You only tap Send.', '會開啟訊息並自動填好內容，只要按「傳送」。') : '');
  if (!how) return;
  const text = readyMessage(o);
  location.href = how === 'sms' ? smsHref(o.phone, text) : lineHref(text);
}
async function markReady(id) {
  patchOrder(id, { status: 'ready' });
  await tellCustomer(getOrder(id));
}

// ---- actions shared by list and detail -----------------------------------
async function askPay(title, withNotPaid) {
  const opts = ['cash', 'linepay', 'transfer'].map(value => ({ label: PAY()[value], value, cls: value === 'cash' ? 'primary' : '' }));
  if (withNotPaid) opts.push({ label: T('Not paid yet', '尚未付款'), value: 'none', cls: 'ghost' });
  return choose(title, opts);
}
async function markPickedUp(o) {
  if (!o) return;
  const patch = { status: 'picked_up', picked_up_at: new Date().toISOString() };
  if (!o.paid) {
    const pay = await askPay(T(`#${o.code} · ${money(orderTotal(o))} — how did they pay?`, `#${o.code} · ${money(orderTotal(o))}，付款方式？`), true);
    if (pay === undefined) return;
    if (pay !== 'none') Object.assign(patch, { paid: true, payment_type: pay, paid_market_id: S.marketId });
  }
  patchOrder(o.id, patch);
  toast(T(`#${o.code} picked up`, `#${o.code} 已取貨`));
}

// ---- one order -----------------------------------------------------------
export function orderView(id) {
  const o = getOrder(id);
  if (!o) return { title: T('Order', '訂單'), back: '#/orders', tab: '#/orders', body: html`<div class="empty"><b>${T('Order not found', '找不到訂單')}</b>${T('It may have been deleted on another phone.', '可能已在其他手機刪除。')}</div>` };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const smsText = `${S.org?.name || ''} ${T('Order', '訂單')} #${o.code}\n${itemsText(o)}\n${pickupText(o)}\n${customerLink(o)}`;
  let off;
  return {
    title: '#' + o.code, back: '#/orders', tab: '#/orders',
    body: html`
      <div class="card">
        <div class="row wrap gap4">${tags(o)}</div>
        <div class="detail-items">${(o.items || []).map(i => html`<div><span class="serif">${pname(i)}</span><b class="num">×${i.qty}</b></div>`)}</div>
        <div class="divider"></div>
        <div class="total"><span class="mu">${T('Total', '合計')}</span><b>${money(orderTotal(o))}</b></div>
      </div>
      <div class="card stack">
        <div class="kv">${icon('users')}<span class="grow"><b>${o.customer_name || T('No name', '未留姓名')}</b><br><a class="accent-tx num" href="tel:${o.phone}">${o.phone}</a></span></div>
        <div class="kv">${icon('pin')}<span class="grow">${pickupText(o)}</span></div>
        ${o.note ? html`<div class="kv">${icon('note')}<span class="grow">${o.note}</span></div>` : ''}
        <div class="kv mu small">${icon('clock')}<span class="grow">${T('Ordered', '下單')} ${fmtDateTime(o.created_at)}${o.created_by ? ' · ' + o.created_by : ''}
          ${o.picked_up_at ? html`<br>${T('Picked up', '取貨')} ${fmtDateTime(o.picked_up_at)}` : ''}${o.imported ? ' · ' + T('imported', '匯入') : ''}</span></div>
      </div>
      ${o.status !== 'picked_up'
        ? html`<div class="actgrid"><button class="btn ok lg" data-act="pickup">${icon('check')}${T('Picked up', '已取貨')}</button>
               <button class="btn lg" data-act="ready">${o.status === 'ready' ? T('Not ready', '尚未備好') : T('Ready', '備好了')}</button></div>`
        : html`<button class="btn block" data-act="undo">${icon('undo')}${T('Undo pickup', '取消取貨')}</button>`}
      <div class="list">
        <button data-act="paid"><span class="lead">${icon('coin')}</span><span class="grow">${o.paid ? T('Mark as unpaid', '改為未付款') : T('Mark as paid', '標記已付款')}</span></button>
        ${o.status !== 'picked_up' ? html`<button data-act="tell"><span class="lead">${icon('message')}</span><span class="grow">${T('Tell the customer it’s ready', '通知客人可以取貨')}</span></button>` : ''}
        <a href="#/qr/${o.id}/x"><span class="lead">${icon('qr')}</span><span class="grow">${T('Show QR code', '顯示 QR code')}</span>${icon('chevron', 'chev')}</a>
        <a href="sms:${o.phone}${ios ? '&' : '?'}body=${encodeURIComponent(smsText)}"><span class="lead">${icon('message')}</span><span class="grow">${T('Send by SMS', '用簡訊傳送')}</span></a>
        <button data-act="share"><span class="lead">${icon('share')}</span><span class="grow">${T('Share link', '分享連結')}</span></button>
      </div>
      <button class="btn danger block" data-act="del">${icon('trash')}${T('Delete order', '刪除訂單')}</button>`,
    after() { off = onOrdersChange(() => { if (location.hash === '#/order/' + id) go(location.hash); }); },
    cleanup: () => off && off(),
    actions: {
      pickup: () => markPickedUp(getOrder(id)),
      ready: () => o.status === 'ready' ? patchOrder(id, { status: 'waiting' }) : markReady(id),
      tell: () => tellCustomer(getOrder(id), false),
      undo: () => patchOrder(id, { status: 'ready', picked_up_at: null }),
      async paid() {
        if (o.paid) { if (confirm(T('Mark this order as not paid?', '確定改為未付款？'))) patchOrder(id, { paid: false, payment_type: null, paid_market_id: null }); return; }
        const pay = await askPay(T('How did they pay?', '付款方式？'));
        if (pay) patchOrder(id, { paid: true, payment_type: pay, paid_market_id: S.marketId });
      },
      share: () => shareText(smsText),
      del() {
        if (!confirm(T(`Delete order #${o.code}?`, `確定刪除訂單 #${o.code}？`))) return;
        deleteOrder(id); toast(T('Order deleted', '訂單已刪除')); go('#/orders');
      },
    },
  };
}

async function shareText(text) {
  if (navigator.share) return navigator.share({ text }).catch(() => { });
  try { await navigator.clipboard.writeText(text); toast(T('Copied', '已複製')); } catch { toast(text); }
}

// ---- full-screen QR --------------------------------------------------------
const pendNote = o => o._pending
  ? html`<p class="note warn">${T('Not synced yet. The customer’s link starts working once this phone has signal.', '尚未同步，手機有網路後客人的連結才會生效。')}</p>`
  : html`<p class="note ok">${icon('check')} ${T('Saved — the customer’s link is live.', '已儲存，客人的連結已可使用。')}</p>`;

export function qrView(id, fromDetail) {
  const o = getOrder(id);
  if (!o) return go('#/orders');
  const url = customerLink(o);
  let off;
  return {
    title: T('Order', '訂單') + ' #' + o.code, tab: false, back: fromDetail ? '#/order/' + id : '#/new',
    body: html`<div class="qrpage">
      <p class="mu" style="margin:0">${T('Ask the customer to take a photo of this code', '請客人拍下這個 QR code')}</p>
      <div class="qrbox" id="qr"></div>
      <div class="code-xl">#${o.code}</div>
      <div class="detail-items" style="width:100%;max-width:340px">${(o.items || []).map(i => html`<div><span class="serif">${pname(i)}</span><b class="num">×${i.qty}</b></div>`)}</div>
      <div class="mu small">${pickupText(o)}<br>${o.customer_name} <span class="num">${o.phone}</span>${o.paid ? ' · ' + T('Paid', '已付款') : ''}</div>
      <div id="pend" style="width:100%">${pendNote(o)}</div>
      <button class="btn primary lg block" data-act="done">${T('Done', '完成')}</button>
      <button class="btn ghost block" data-act="share">${icon('share')}${T('Send link instead', '改傳連結')}</button>
    </div>`,
    after() {
      $('#qr').innerHTML = qrSvg(url);
      off = onOrdersChange(() => { const p = $('#pend'), x = getOrder(id); if (p && x) p.innerHTML = str(pendNote(x)); });
    },
    cleanup: () => off && off(),
    actions: {
      done: () => go(fromDetail ? '#/order/' + id : '#/new'),
      share: () => shareText(`${S.org?.name || ''} ${T('Order', '訂單')} #${o.code}\n${url}`),
    },
  };
}

export { markPickedUp };
