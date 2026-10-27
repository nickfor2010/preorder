// One-time import of orders saved by the old app on this phone.
// (The old app is on the same website, so this phone can read what it saved.)
import { html, toast, store, addDays, isoDate } from '../util.js';
import { sb, S, q, loadBasics } from '../db.js';
import { go } from '../app.js';
import { createOrder } from '../orders.js';

const old = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const oldOrders = () => (Array.isArray(old('orders')) ? old('orders') : []).filter(o => o && o.id && Array.isArray(o.items));
export const oldOrdersCount = () => store.get('imported', false) ? 0 : oldOrders().length;
const DAYS = { t: 'Today 今天', m: 'Tomorrow 明天', n: 'Next market 下次市集', s: 'In shop 到店' };

export function importView() {
  const L = oldOrders(), P = old('products') || [], shop = old('shop') || {};
  const open = L.filter(o => !o.done).length;
  return {
    title: 'Import old orders 匯入舊訂單', back: '#/more', tab: '#/more',
    body: html`
      <div class="card"><b>${L.length}</b> orders from the old app on this phone (${open} not picked up)<br>
        這支手機舊版有 <b>${L.length}</b> 筆訂單（${open} 筆未取貨）</div>
      <p class="mu small">They are copied, not moved: the old app keeps working. Old QR photos still open the old page.
        Old orders are added as "In shop" pickups with their original date and code.<br>
        只會複製，不會刪除舊資料。</p>
      ${S.isOwner && (P.length || shop.name) ? html`<label class="card row big-check"><span class="grow">Also copy ${P.length} products and shop info 一併複製商品與店家資料</span><input id="alsoP" type="checkbox" checked></label>` : ''}
      <button class="pri" data-act="go">Import 匯入</button>
      <button class="ghost wide" data-act="csv">⬇ Save a backup file (CSV) 下載備份</button>
      ${store.get('imported', false) ? html`<p class="mu c">Already imported on ${store.get('imported')}. 已匯入</p>` : ''}`,
    actions: {
      async go() {
        if (store.get('imported', false) && !confirm('Already imported once. Import again (may duplicate)? 已匯入過，再匯一次？')) return;
        if (S.isOwner && document.getElementById('alsoP')?.checked) await copyProducts(P, shop);
        const byName = new Map(S.products.flatMap(p => [[p.name_zh, p], [p.name_en, p]]).filter(([k]) => k));
        for (const o of [...L].reverse()) {
          const at = o.at ? new Date(o.at) : new Date();
          const date = o.date || (o.day === 't' ? isoDate(at) : o.day === 'm' ? addDays(isoDate(at), 1) : null);
          createOrder({
            code: String(o.id).toUpperCase(), market_id: null, imported: true,
            pickup_kind: 'shop', pickup_market_id: null, pickup_date: date,
            pickup_time: [o.day === 'n' ? DAYS.n : '', o.time || ''].filter(Boolean).join(' '),
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
        toast(`Imported ${L.length} 已匯入`); go('#/orders');
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
