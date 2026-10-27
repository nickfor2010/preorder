// New pre-order: pick items, pickup, customer → QR.
import { html, $, $$, toast, today, addDays, money, digits } from '../util.js';
import { T, pname, fmtDate, PAY } from '../i18n.js';
import { icon } from '../icons.js';
import { S, marketProducts, marketStock, ensureBasics } from '../db.js';
import { go } from '../app.js';
import { createOrder, allOrders } from '../orders.js';

// the order being typed survives switching tabs
let D = freshDraft();
function freshDraft() { return { cart: {}, pick: 't', nextId: '', shopDate: '', time: '', name: '', phone: '', note: '', paid: false, pay: 'cash' }; }

// where does each pickup button lead?
function upcoming() {
  const m = S.market, t = today();
  return S.markets.filter(x => x.status !== 'closed' && x.date >= t && x.id !== m?.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
function resolvePickup() {
  const m = S.market, t = today(), tm = addDays(t, 1);
  const mk = x => x ? { pickup_kind: 'market', pickup_market_id: x.id, pickup_date: x.date } : null;
  const shop = d => ({ pickup_kind: 'shop', pickup_market_id: null, pickup_date: d || null });
  switch (D.pick) {
    case 't': return m && m.date === t ? mk(m) : shop(t);
    case 'm': return mk(S.markets.find(x => x.date === tm && x.status !== 'closed' && x.name === m?.name)
                     || S.markets.find(x => x.date === tm && x.status !== 'closed')) || shop(tm);
    case 'n': return mk(S.markets.find(x => x.id === D.nextId) || upcoming().find(x => x.date > (m?.date || t)) || upcoming()[0]);
    case 's': return shop(D.shopDate || tm);
  }
}
function pickupLine(p) {
  if (!p) return T('No upcoming market yet. Add one, or choose In shop.', '還沒有下一場市集，請新增或選擇「到店」。');
  if (p.pickup_kind === 'market') { const x = S.markets.find(y => y.id === p.pickup_market_id); return `${x.name} · ${fmtDate(x.date)}`; }
  return `${T('In shop', '到店取貨')} · ${fmtDate(p.pickup_date)}`;
}

export async function newOrderView() {
  await ensureBasics();
  const m = S.market;
  if (!m) return go('#/pick');
  const [mp, stock] = await Promise.all([marketProducts(m.id).catch(() => []), marketStock(m.id).catch(() => [])]);
  const byP = Object.fromEntries(S.products.map(p => [p.id, p]));
  const left = Object.fromEntries(stock.map(s => [s.product_id, s.remaining]));
  // orders made on this phone but not sent yet also use stock
  for (const o of allOrders().filter(o => o._pending && o.pickup_market_id === m.id))
    for (const i of o.items || []) if (left[i.product_id] != null) left[i.product_id] -= i.qty;
  const rows = mp.map(r => ({ ...r, p: byP[r.product_id] })).filter(r => r.p);
  const ups = upcoming();

  const leftTag = r => {
    const n = left[r.product_id];
    if (n == null) return '';
    return html`<span class="pill ${n <= 0 ? 'bad' : n <= 3 ? 'warn' : ''}">${n <= 0 ? T('Sold out', '售完') : T(`${n} left`, `剩 ${n}`)}</span>`;
  };
  const PICKS = [['t', T('Today', '今天')], ['m', T('Tomorrow', '明天')], ['n', T('Next market', '下次市集')], ['s', T('In shop', '到店')]];

  return {
    title: T('New order', '新增訂單'), tab: '#/new',
    right: html`<a class="pill accent" href="#/pick">${m.name}</a>`,
    body: html`
      ${rows.length ? html`<div class="stack">${rows.map(r => html`<div class="card item ${D.cart[r.product_id] > 0 ? 'picked' : ''}" data-pid="${r.product_id}">
          <div class="grow col"><span class="name">${pname(r.p)}</span>
            <span class="row gap4 wrap"><span class="mu small num">${money(r.price)}</span>${leftTag(r)}</span></div>
          <div class="qty"><button data-act="minus" aria-label="${T('One less', '減一')}">−</button><span class="n">${D.cart[r.product_id] || 0}</span><button data-act="plus" aria-label="${T('One more', '加一')}">+</button></div>
        </div>`)}</div>
        <div class="total"><span class="mu">${T('Total', '合計')}</span><b id="tot">${money(total(rows))}</b></div>`
      : html`<div class="empty"><b>${T('No products at this market yet', '這場市集還沒有商品')}</b>
          ${S.isOwner ? html`<div style="margin-top:12px"><a class="btn primary" href="#/market/${m.id}">${T('Set up products', '設定商品')}</a></div>` : T('Ask the owner to set them up.', '請老闆設定。')}</div>`}

      <div class="h2">${T('Pickup', '取貨')}</div>
      <div class="seg" id="pk">${PICKS.map(([k, l]) => html`<button class="${D.pick === k ? 'on' : ''}" data-act="pick" data-k="${k}">${l}</button>`)}</div>
      <div id="pkn" class="${D.pick === 'n' && ups.length > 1 ? '' : 'hide'}"><select id="nextId" data-change="nextId" aria-label="${T('Which market', '哪一場市集')}">
        ${ups.map(x => html`<option value="${x.id}" ${x.id === (resolvePickup()?.pickup_market_id) ? 'selected' : ''}>${fmtDate(x.date)} · ${x.name}</option>`)}</select></div>
      <div id="pks" class="${D.pick === 's' ? '' : 'hide'}"><input id="shopDate" type="date" min="${today()}" value="${D.shopDate || addDays(today(), 1)}" data-change="shopDate" aria-label="${T('Pickup date', '取貨日期')}"></div>
      <p class="pkline">${icon('pin')}<span id="pkline">${pickupLine(resolvePickup())}</span></p>
      <input id="time" placeholder="${T('Time (optional), e.g. after 3 pm', '時間（選填），例如下午三點後')}" value="${D.time}">

      <div class="h2">${T('Customer', '客人')}</div>
      <input id="phone" type="tel" inputmode="numeric" autocomplete="off" placeholder="${T('Phone number', '電話號碼')}" value="${D.phone}">
      <input id="name" placeholder="${T('Name (optional)', '姓名（選填）')}" value="${D.name}">
      <input id="note" placeholder="${T('Note — the customer can see this', '備註（客人看得到）')}" value="${D.note}">
      <label class="card check-row"><span class="grow"><b>${T('Already paid', '已付款')}</b></span><input id="paid" type="checkbox" ${D.paid ? 'checked' : ''} data-change="paid"></label>
      <div class="seg ${D.paid ? '' : 'hide'}" id="payrow">${['cash', 'linepay', 'transfer'].map(k =>
        html`<button class="${D.pay === k ? 'on' : ''}" data-act="pay" data-k="${k}">${PAY()[k]}</button>`)}</div>

      <button class="btn primary lg block sticky-cta" data-act="create">${icon('qr')}${T('Create QR code', '產生 QR code')}</button>
      <button class="btn ghost block" data-act="clear">${T('Clear form', '清除')}</button>`,
    after(root) {
      ['time', 'phone', 'name', 'note'].forEach(k => $('#' + k, root).addEventListener('input', e => D[k] = e.target.value));
    },
    actions: {
      plus: el => bump(el, +1, rows, left),
      minus: el => bump(el, -1, rows, left),
      pick(el) {
        D.pick = el.dataset.k;
        $$('#pk button').forEach(b => b.classList.toggle('on', b === el));
        $('#pkn').classList.toggle('hide', !(D.pick === 'n' && ups.length > 1));
        $('#pks').classList.toggle('hide', D.pick !== 's');
        $('#pkline').textContent = pickupLine(resolvePickup());
      },
      nextId(el) { D.nextId = el.value; $('#pkline').textContent = pickupLine(resolvePickup()); },
      shopDate(el) { D.shopDate = el.value; $('#pkline').textContent = pickupLine(resolvePickup()); },
      paid(el) { D.paid = el.checked; $('#payrow').classList.toggle('hide', !D.paid); },
      pay(el) { D.pay = el.dataset.k; $$('#payrow button').forEach(b => b.classList.toggle('on', b === el)); },
      clear() { D = freshDraft(); go('#/new'); },
      create() {
        const items = rows.filter(r => D.cart[r.product_id] > 0).map(r => ({
          product_id: r.product_id, name_en: r.p.name_en, name_zh: r.p.name_zh, qty: D.cart[r.product_id], unit_price: r.price,
        }));
        const phone = digits(D.phone);
        if (!items.length) return toast(T('Add at least one item.', '請至少選一項商品。'), 'err');
        if (phone.length < 4) return toast(T('Enter the customer’s phone number.', '請輸入客人電話。'), 'err');
        const p = resolvePickup();
        if (!p) return toast(T('Choose when they pick up.', '請選擇取貨方式。'), 'err');
        const o = createOrder({
          market_id: m.id, ...p, pickup_time: D.time.trim(),
          customer_name: D.name.trim(), phone, note: D.note.trim(),
          paid: D.paid, payment_type: D.paid ? D.pay : null, paid_market_id: D.paid ? m.id : null,
        }, items);
        D = freshDraft();
        go('#/qr/' + o.id);
      },
    },
  };
}

function total(rows) { return rows.reduce((s, r) => s + (D.cart[r.product_id] || 0) * r.price, 0); }

function bump(el, d, rows, left) {
  const card = el.closest('.item'), pid = card.dataset.pid;
  const n = Math.max(0, (D.cart[pid] || 0) + d);
  D.cart[pid] = n;
  $('.n', card).textContent = n;
  card.classList.toggle('picked', n > 0);
  $('#tot').textContent = money(total(rows));
  if (d > 0 && left[pid] != null && n > left[pid]) toast(T(`Only ${Math.max(0, left[pid])} left`, `只剩 ${Math.max(0, left[pid])} 份`));
}
