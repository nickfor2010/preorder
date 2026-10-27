// Pre-orders: local copy on the phone + an "outbox" of changes waiting to be sent.
// Everything is saved on the phone first, so the app keeps working without signal.
import { sb, S, q } from './db.js';
import { store, uuid, dateBi, today } from './util.js';

export const O = {
  list: store.get('orders', []),        // last list from the server (with items)
  outbox: store.get('outbox', []),      // changes not yet sent: {op:'save'|'patch'|'del', ...}
  syncing: false,
  lastSync: store.get('lastSync', 0),
  listeners: new Set(),
};
const saveLocal = () => { store.set('orders', O.list); store.set('outbox', O.outbox); };
const notify = () => O.listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
export const onOrdersChange = f => { O.listeners.add(f); return () => O.listeners.delete(f); };

// ---- codes and secret tokens -------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';     // no 0/O, 1/I/L
export function newCode() {
  const used = new Set(allOrders().filter(o => o.status !== 'picked_up').map(o => o.code));
  let c;
  do { c = [...crypto.getRandomValues(new Uint8Array(4))].map(n => CODE_CHARS[n % CODE_CHARS.length]).join(''); } while (used.has(c));
  return c;
}
export function newToken() {          // 24 random letters/digits ≈ 142 bits: impossible to guess
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.getRandomValues(new Uint8Array(24))].map(n => A[n % 62]).join('');
}
export const customerLink = o => location.href.split('#')[0].replace(/[^/]*$/, '') + 'o.html#t=' + o.token;

// ---- the list everyone sees = server list + my changes not yet sent -----
export function allOrders() {
  const map = new Map(O.list.map(o => [o.id, { ...o }]));
  for (const c of O.outbox) {
    if (c.op === 'save') map.set(c.order.id, { ...(map.get(c.order.id) || {}), ...c.order, items: c.items, _pending: true });
    else if (c.op === 'patch' && map.has(c.id)) Object.assign(map.get(c.id), c.patch, { _pending: true });
    else if (c.op === 'del') map.delete(c.id);
  }
  return [...map.values()].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
export const getOrder = id => allOrders().find(o => o.id === id);
export const pendingCount = () => O.outbox.length;
export const errorCount = () => O.outbox.filter(c => c.err).length;

// ---- changes (always local first, then sync) ----------------------------
export function createOrder(fields, items) {
  const order = {
    id: uuid(), code: newCode(), token: newToken(), status: 'waiting',
    created_at: new Date().toISOString(), created_by: S.email, ...fields,
  };
  O.outbox.push({ op: 'save', order, items });
  saveLocal(); notify(); sync();
  return order;
}
export function patchOrder(id, patch) {
  patch = { ...patch, updated_at: new Date().toISOString() };
  // if the order itself hasn't been sent yet, just change it in the outbox
  const pend = O.outbox.find(c => c.op === 'save' && c.order.id === id && !c.sending);
  if (pend) Object.assign(pend.order, patch);
  else O.outbox.push({ op: 'patch', id, patch });
  saveLocal(); notify(); sync();
}
export function deleteOrder(id) {
  const had = O.outbox.some(c => c.op === 'save' && c.order.id === id);
  O.outbox = O.outbox.filter(c => !(c.order?.id === id || c.id === id));
  if (!had || O.list.some(o => o.id === id)) O.outbox.push({ op: 'del', id });
  saveLocal(); notify(); sync();
}
export function discardErrors() { O.outbox = O.outbox.filter(c => !c.err); saveLocal(); notify(); }

// ---- walk-up sales ---------------------------------------------------------
export function addSale(sale) {
  sale = { id: uuid(), qty: 1, created_at: new Date().toISOString(), created_by: S.email, ...sale };
  O.outbox.push({ op: 'sale', sale });
  saveLocal(); notify(); sync();
  return sale;
}
export function undoSale(sale) {
  const i = O.outbox.findIndex(c => c.op === 'sale' && c.sale.id === sale.id && !c.sending);
  if (i >= 0) O.outbox.splice(i, 1);                 // never sent: just forget it
  else O.outbox.push({ op: 'unsale', id: sale.id, market_id: sale.market_id, product_id: sale.product_id, qty: sale.qty });
  saveLocal(); notify(); sync();
}
// sales not yet on the server (+) and undos not yet on the server (−), per product, for one market
export function pendingSaleQty(marketId) {
  const out = {};
  for (const c of O.outbox) {
    if (c.op === 'sale' && c.sale.market_id === marketId) out[c.sale.product_id] = (out[c.sale.product_id] || 0) + c.sale.qty;
    if (c.op === 'unsale' && c.market_id === marketId && !c.err) out[c.product_id] = (out[c.product_id] || 0) - c.qty;
  }
  return out;
}
export const pendingSales = marketId => O.outbox.filter(c => c.op === 'sale' && c.sale.market_id === marketId).map(c => ({ ...c.sale, _pending: true }));
export const pendingUnsales = () => new Set(O.outbox.filter(c => c.op === 'unsale').map(c => c.id));

// ---- sending the outbox --------------------------------------------------
const isNetwork = e => /fetch|network|Failed|Load failed|timeout/i.test(e?.message || String(e));

export async function sync() {
  if (O.syncing || !S.me) return;
  O.syncing = true;
  O.outbox.forEach(c => { c.sending = false; });
  try {
    for (let i = 0; i < O.outbox.length; i++) {
      const c = O.outbox[i];
      try {
        c.sending = true;
        if (c.op === 'save') await sendSave(c);
        else if (c.op === 'patch') await q(sb.from('orders').update(c.patch).eq('id', c.id));
        else if (c.op === 'del') await q(sb.from('orders').delete().eq('id', c.id));
        else if (c.op === 'sale') await q(sb.from('sales').upsert(c.sale, { onConflict: 'id', ignoreDuplicates: true }));
        else if (c.op === 'unsale') {
          const gone = await q(sb.from('sales').delete().eq('id', c.id).select('id'));
          if (!gone.length) throw new Error('Too late to undo (over 10 minutes) — ask the owner. 超過10分鐘無法復原，請找老闆。');
        }
        O.outbox.splice(i--, 1);
        saveLocal();
      } catch (e) {
        c.sending = false;
        if (isNetwork(e)) break;                       // no signal: try again later, keep order
        c.err = e.message || String(e); saveLocal();   // real problem: keep it, show it, move on
      }
    }
    await refresh();
  } catch (e) {
    if (!isNetwork(e)) console.error(e);
  } finally {
    O.syncing = false; notify();
  }
}

async function sendSave(c) {
  for (let tries = 0; ; tries++) {
    const { error } = await sb.rpc('save_order', { p_order: c.order, p_items: c.items });
    if (!error) return;
    // two phones made the same short code while offline: pick a new one
    if (/orders_open_code/.test(error.message) && tries < 5) { c.order.code = newCode(); c.codeChanged = true; continue; }
    throw error;
  }
}

// latest orders from the server: everything not picked up + picked up in the last 14 days
export async function refresh() {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const rows = await q(sb.from('orders').select('*, items:order_items(*)')
    .or(`status.neq.picked_up,picked_up_at.gt.${since}`)
    .order('created_at', { ascending: false }).limit(1000));
  O.list = rows; O.lastSync = Date.now();
  store.set('lastSync', O.lastSync); saveLocal(); notify();
}

// live updates: when another phone changes an order, refresh (debounced)
let channel, timer;
export function startLive() {
  if (channel) return;
  channel = sb.channel('orders-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      clearTimeout(timer); timer = setTimeout(() => refresh().catch(() => { }), 700);
    })
    .subscribe();
  addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (O.outbox.length && navigator.onLine) sync(); }, 30000);
}

// ---- words for pickup -----------------------------------------------------
export function pickupText(o) {
  if (o.pickup_kind === 'market') {
    const m = S.markets.find(x => x.id === o.pickup_market_id);
    return (m ? `${m.name} · ${dateBi(m.date)}` : 'Market 市集') + (o.pickup_time ? ' · ' + o.pickup_time : '');
  }
  const d = o.pickup_date ? (o.pickup_date === today() ? 'Today 今天 · ' : '') + dateBi(o.pickup_date) : '';
  return ['In shop 到店', d, o.pickup_time].filter(Boolean).join(' · ');
}
// group key + sort key for the "to make" list
export function pickupGroup(o) {
  if (o.pickup_kind === 'market') {
    const m = S.markets.find(x => x.id === o.pickup_market_id);
    return { key: 'm' + o.pickup_market_id, sort: (m?.date || '9999') + 'a', label: m ? `${m.name} · ${dateBi(m.date)}` : 'Market 市集' };
  }
  return { key: 's' + (o.pickup_date || ''), sort: (o.pickup_date || '9999') + 'b', label: 'In shop 到店' + (o.pickup_date ? ' · ' + dateBi(o.pickup_date) : '') };
}
export const itemsText = o => (o.items || []).map(i => `${i.name_zh || i.name_en} ×${i.qty}`).join(', ');
export const orderTotal = o => (o.items || []).reduce((s, i) => s + i.qty * (i.unit_price || 0), 0);

// "To make" = items still to hand over, grouped by when/where they are picked up
export function toMake(filter = () => true) {
  const groups = new Map();
  for (const o of allOrders().filter(o => o.status !== 'picked_up' && filter(o))) {
    const g = pickupGroup(o);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, items: new Map(), orders: 0 });
    const G = groups.get(g.key); G.orders++;
    for (const i of o.items || []) {
      const k = i.name_zh || i.name_en;
      G.items.set(k, (G.items.get(k) || 0) + i.qty);
    }
  }
  return [...groups.values()].sort((a, b) => a.sort.localeCompare(b.sort));
}
