// One-time import of orders saved by the old app on this phone.
// (The old app is on the same website, so this phone can read what it saved.)
import { html, toast, store, addDays, isoDate } from '../util.js';
import { T } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q, loadBasics } from '../db.js';
import { go } from '../app.js';
import { createOrder } from '../orders.js';

const old = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const oldOrders = () => (Array.isArray(old('orders')) ? old('orders') : []).filter(o => o && o.id && Array.isArray(o.items));
export const oldOrdersCount = () => store.get('imported', false) ? 0 : oldOrders().length;
const DAYS = { t: 'Today', m: 'Tomorrow', n: 'Next market', s: 'In shop' };

export function importView() {
  const L = oldOrders(), P = old('products') || [], shop = old('shop') || {};
  const open = L.filter(o => !o.done).length;
  return {
    title: T('Import old orders', '匯入舊訂單'), back: '#/more', tab: '#/more',
    body: html`
      <div class="card c"><div class="big-num">${L.length}</div>
        <div class="mu">${T(`orders from the old app on this phone · ${open} not picked up`, `筆舊版訂單在這支手機 · ${open} 筆未取貨`)}</div></div>
      <p class="mu small" style="margin:0 2px">${T('They are copied, not moved, so the old app keeps working and old QR photos still open. Each order keeps its code and is added as an “In shop” pickup on its original date.',
        '只會複製，不會刪除舊資料；舊版和舊 QR 照片仍可使用。每筆訂單保留原編號，並以「到店取貨」和原日期加入。')}</p>
      ${S.isOwner && (P.length || shop.name) ? html`<label class="card check-row"><span class="grow">${T(`Also copy ${P.length} products and the shop details`, `一併複製 ${P.length} 項商品與店家資料`)}</span><input id="alsoP" type="checkbox" checked></label>` : ''}
      <button class="btn primary lg block" data-act="go">${T('Import orders', '匯入訂單')}</button>
      <button class="btn ghost block" data-act="csv">${icon('download')}${T('Save a backup file (CSV)', '下載備份檔（CSV）')}</button>
      ${store.get('imported', false) ? html`<p class="mu c small">${T(`Already imported on ${store.get('imported')}.`, `已於 ${store.get('imported')} 匯入。`)}</p>` : ''}`,
    actions: {
      async go() {
        if (store.get('imported', false) && !confirm(T('You already imported once. Import again? This can create duplicates.', '已經匯入過，確定再匯入一次？可能會重複。'))) return;
        if (S.isOwner && document.getElementById('alsoP')?.checked) await copyProducts(P, shop);
        const byName = new Map(S.products.flatMap(p => [[p.name_zh, p], [p.name_en, p]]).filter(([k]) => k));
        for (const o of [...L].reverse()) {
          const at = o.at ? new Date(o.at) : new Date();
          const date = o.date || (o.day === 't' ? isoDate(at) : o.day === 'm' ? addDays(isoDate(at), 1) : null);
          createOrder({
            code: String(o.id).toUpperCase(), market_id: null, imported: true,
            pickup_kind: 'shop', pickup_market_id: null, pickup_date: date,
            pickup_time: [o.day === 'n' ? T('Next market', '下次市集') : '', o.time || ''].filter(Boolean).join(' '),
            customer_name: o.name || '', phone: String(o.phone || ''), note: o.note || '',
            paid: !!o.paid, payment_type: null, paid_market_id: null,
            status: o.done ? 'picked_up' : 'waiting',
            picked_up_at: o.done && o.doneAt ? new Date(o.doneAt).toISOString() : null,
            created_at: at.toISOString(),
          }, o.items.filter(x => x.q > 0).map(x => {
            const p = byName.get(x.zh) || byName.get(x.en);
            return { product_id: p?.id || null, name_en: x.en || '', name_zh: x.zh || '', qty: x.q, unit_price: p?.default_price || 0 };
          }));
        }
        store.set('imported', new Date().toLocaleDateString('zh-TW'));
        toast(T(`Imported ${L.length} orders`, `已匯入 ${L.length} 筆訂單`)); go('#/orders');
      },
      csv() {
        const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
        const rows = [['code', 'name', 'phone', 'items', 'pickup', 'date', 'time', 'paid', 'picked_up', 'picked_up_at', 'note', 'ordered_at']]
          .concat(L.map(o => [o.id, o.name, o.phone, o.items.map(x => `${x.zh || x.en} x${x.q}`).join('; '), DAYS[o.day] || o.day, o.date, o.time,
            o.paid ? 'yes' : '', o.done ? 'yes' : '', o.doneAt ? new Date(o.doneAt).toLocaleString() : '', o.note, o.at ? new Date(o.at).toLocaleString() : '']));
        const blob = new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'old-orders.csv'; a.click();
      },
    },
  };
}

async function copyProducts(P, shop) {
  const have = new Set(S.products.flatMap(p => [p.name_zh, p.name_en]).filter(Boolean));
  const add = P.filter(p => (p.zh || p.en) && !have.has(p.zh) && !have.has(p.en))
    .map((p, i) => ({ name_zh: p.zh || '', name_en: p.en || '', default_price: 0, sort: S.products.length + i }));
  if (add.length) await q(sb.from('products').insert(add));
  if (shop.name && (!S.org?.name || S.org.name === 'My Shop 我的店'))
    await q(sb.from('orgs').update({ name: shop.name, address: shop.addr || '', hours: shop.hours || '', line_id: shop.line || '' }).eq('id', S.org.id));
  await loadBasics();
}
