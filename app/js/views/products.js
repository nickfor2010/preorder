// Owner: product catalogue (names in both languages, default price, on/off, order).
import { html, $, toast, uuid, money, formData } from '../util.js';
import { sb, S, q, loadBasics } from '../db.js';
import { go, render } from '../app.js';

export function productsView() {
  const list = S.products;
  return {
    title: 'Products 商品', back: '#/more', tab: '#/more',
    body: html`
      <a class="btn pri wide" href="#/product/new">＋ New product 新增商品</a>
      ${list.map((p, i) => html`<div class="card row ${p.active ? '' : 'off'}">
        <a class="grow" href="#/product/${p.id}"><b>${p.name_zh}</b> <span class="mu">${p.name_en}</span>
          <div class="mu">${money(p.default_price)}${p.active ? '' : ' · Hidden 已隱藏'}</div></a>
        <button class="sm" data-act="up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="Move up">▲</button>
        <button class="sm" data-act="down" data-i="${i}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Move down">▼</button>
      </div>`)}
      ${list.length ? '' : html`<p class="mu c">No products yet. 還沒有商品。</p>`}`,
    actions: {
      up: el => move(+el.dataset.i, -1),
      down: el => move(+el.dataset.i, +1),
    },
  };
}

async function move(i, d) {
  const list = [...S.products];
  [list[i], list[i + d]] = [list[i + d], list[i]];
  S.products = list; render();                                  // instant on screen
  await q(sb.from('products').upsert(list.map((p, n) => ({ ...p, sort: n }))));
  await loadBasics();
}

export async function productEditView(id) {
  const isNew = id === 'new';
  const p = isNew ? { id: uuid(), name_en: '', name_zh: '', default_price: 0, active: true, sort: S.products.length }
    : S.products.find(x => x.id === id) || await q(sb.from('products').select('*').eq('id', id).single());
  return {
    title: isNew ? 'New product 新增商品' : 'Edit product 編輯商品', back: '#/products', tab: '#/more',
    body: html`
      <div class="card form" id="pf">
        <label class="lbl">Name (Chinese) 中文名稱<input name="name_zh" value="${p.name_zh}" placeholder="提拉米蘇"></label>
        <label class="lbl">Name (English) 英文名稱<input name="name_en" value="${p.name_en}" placeholder="Tiramisu"></label>
        <label class="lbl">Usual price 一般價格 (NT$)<input name="default_price" type="number" inputmode="numeric" min="0" value="${p.default_price}"></label>
        <label class="row toggle"><span class="grow">Active 上架中<br><span class="mu small">Off = hidden from new markets 關閉＝不出現在新市集</span></span>
          <input name="active" type="checkbox" ${p.active ? 'checked' : ''}></label>
      </div>
      <button class="pri sticky" data-act="save">Save 儲存</button>
      ${isNew ? '' : html`<button class="ghost wide danger" data-act="del">Delete 刪除</button>`}`,
    actions: {
      async save() {
        const f = formData($('#pf'));
        if (!f.name_zh && !f.name_en) return toast('Name needed 請輸入名稱', 'err');
        await q(sb.from('products').upsert({
          id: p.id, sort: p.sort, name_zh: f.name_zh, name_en: f.name_en,
          default_price: Math.max(0, f.default_price || 0), active: f.active,
        }));
        await loadBasics(); toast('Saved 已儲存'); go('#/products');
      },
      async del() {
        const [a, b, c] = await Promise.all([
          sb.from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
          sb.from('sales').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
          sb.from('market_products').select('product_id', { count: 'exact', head: true }).eq('product_id', p.id),
        ]);
        if (a.count || b.count || c.count) return toast('Already used in markets or orders — switch "Active" off instead. 已被使用，請改為關閉上架。', 'err');
        if (!confirm('Delete this product? 確定刪除？')) return;
        await q(sb.from('products').delete().eq('id', p.id));
        await loadBasics(); toast('Deleted 已刪除'); go('#/products');
      },
    },
  };
}
