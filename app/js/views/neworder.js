// New pre-order: pick items, pickup, customer → QR.
import { html, $, $$, toast, today, addDays, dateBi, money, digits } from '../util.js';
import { S, marketProducts, marketStock } from '../db.js';
import { ensureBasics } from '../db.js';
import { go } from '../app.js';
import { createOrder, allOrders } from '../orders.js';

// the order being typed survives switching tabs
let D = freshDraft();
function freshDraft() { return { cart: {}, pick: 't', nextId: '', shopDate: '', time: '', name: '', phone: '', note: '', paid: false, pay: 'cash' }; }

const PAY = [['cash', 'Cash 現金'], ['linepay', 'LINE Pay'], ['transfer', 'Transfer 轉帳']];

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
  if (!p) return 'No upcoming market — add one, or choose In shop. 沒有下一場市集';
  if (p.pickup_kind === 'market') { const x = S.markets.find(y => y.id === p.pickup_market_id); return `→ ${x.name} · ${dateBi(x.date)}`; }
  return `→ In shop 到店 · ${dateBi(p.pickup_date)}`;
}

export async function newOrderView() {
  await ensureBasics();
  const m = S.market;
  if (!m) return go('#/pick');
  const [mp, stock] = await Promise.all([
    marketProducts(m.id).catch(() => []),
    marketStock(m.id).catch(() => []),
  ]);
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
    return html`<span class="tag ${n <= 0 ? 'bad' : n <= 3 ? 'warn' : ''}" data-left="${r.product_id}">${n <= 0 ? 'Sold out 售完' : 'Left 剩 ' + n}</span>`;
  };

  return {
    title: 'New order 新訂單', tab: '#/new',
    right: html`<a class="tag" href="#/pick">${m.name}</a>`,
    body: html`
      ${rows.length ? rows.map(r => html`<div class="card row item ${D.cart[r.product_id] > 0 ? 'picked' : ''}" data-pid="${r.product_id}">
          <div class="grow"><b>${r.p.name_zh}</b><div class="mu">${r.p.name_en} · ${money(r.price)}</div>${leftTag(r)}</div>
          <div class="qty"><button data-act="minus" aria-label="minus">−</button><b class="n">${D.cart[r.product_id] || 0}</b><button data-act="plus" aria-label="plus">＋</button></div>
        </div>`)
      : html`<p class="mu c">No products at this market yet. 這場市集尚未設定商品。${S.isOwner ? html`<br><a class="link" href="#/market/${m.id}">Set up 設定 ›</a>` : ''}</p>`}
      <div class="card total row"><span class="grow">Total 合計</span><b id="tot">${money(total(rows))}</b></div>

      <h2>Pickup 取貨</h2>
      <div class="chips" id="pk">${[['t', 'Today', '今天'], ['m', 'Tomorrow', '明天'], ['n', 'Next market', '下次市集'], ['s', 'In shop', '到店']].map(([k, en, zh]) =>
        html`<button class="chipb ${D.pick === k ? 'on' : ''}" data-act="pick" data-k="${k}">${en}<br>${zh}</button>`)}</div>
      <div id="pkn" class="${D.pick === 'n' && ups.length > 1 ? '' : 'hide'}"><select id="nextId" data-change="nextId">
        ${ups.map(x => html`<option value="${x.id}" ${x.id === (resolvePickup()?.pickup_market_id) ? 'selected' : ''}>${dateBi(x.date)} · ${x.name}</option>`)}</select></div>
      <div id="pks" class="${D.pick === 's' ? '' : 'hide'}"><input id="shopDate" type="date" min="${today()}" value="${D.shopDate || addDays(today(), 1)}" data-change="shopDate"></div>
      <p class="mu pkline" id="pkline">${pickupLine(resolvePickup())}</p>
      <input id="time" placeholder="Time 時間 (e.g. after 3pm 下午三點後)" value="${D.time}">

      <h2>Customer 客人</h2>
      <input id="phone" type="tel" inputmode="numeric" autocomplete="off" placeholder="Phone 電話 09xx xxx xxx" value="${D.phone}">
      <input id="name" placeholder="Name 姓名 (optional)" value="${D.name}" class="mt">
      <input id="note" placeholder="Note 備註 (customer sees it 客人看得到)" value="${D.note}" class="mt">
      <label class="card row big-check"><span class="grow">💰 Already paid 已付款</span><input id="paid" type="checkbox" ${D.paid ? 'checked' : ''} data-change="paid"></label>
      <div class="chips ${D.paid ? '' : 'hide'}" id="payrow">${PAY.map(([k, l]) =>
        html`<button class="chipb ${D.pay === k ? 'on' : ''}" data-act="pay" data-k="${k}">${l}</button>`)}</div>

      <button class="pri sticky" data-act="create">Create QR 產生 QR</button>
      <button class="ghost wide" data-act="clear">Clear 清除</button>`,
    after(root) {
      // keep typed text in the draft
      ['time', 'phone', 'name', 'note'].forEach(k => $('#' + k, root).addEventListener('input', e => D[k] = e.target.value));
    },
    actions: {
      plus: el => bump(el, +1, rows, left),
      minus: el => bump(el, -1, rows, left),
      pick(el) {
        D.pick = el.dataset.k;
        $$('#pk .chipb').forEach(b => b.classList.toggle('on', b === el));
        $('#pkn').classList.toggle('hide', !(D.pick === 'n' && ups.length > 1));
        $('#pks').classList.toggle('hide', D.pick !== 's');
        $('#pkline').textContent = pickupLine(resolvePickup());
      },
      nextId(el) { D.nextId = el.value; $('#pkline').textContent = pickupLine(resolvePickup()); },
      shopDate(el) { D.shopDate = el.value; $('#pkline').textContent = pickupLine(resolvePickup()); },
      paid(el) { D.paid = el.checked; $('#payrow').classList.toggle('hide', !D.paid); },
      pay(el) { D.pay = el.dataset.k; $$('#payrow .chipb').forEach(b => b.classList.toggle('on', b === el)); },
      clear() { D = freshDraft(); go('#/new'); },
      create() {
        const items = rows.filter(r => D.cart[r.product_id] > 0).map(r => ({
          product_id: r.product_id, name_en: r.p.name_en, name_zh: r.p.name_zh, qty: D.cart[r.product_id], unit_price: r.price,
        }));
        const phone = digits(D.phone);
        if (!items.length) return toast('Pick at least one item 請選商品', 'err');
        if (phone.length < 4) return toast('Phone number needed 請輸入電話', 'err');
        const p = resolvePickup();
        if (!p) return toast('Choose a pickup 請選取貨方式', 'err');
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
  if (d > 0 && left[pid] != null && n > left[pid]) toast(`Only ${Math.max(0, left[pid])} left 只剩 ${Math.max(0, left[pid])}`);
}
