// Owner: product catalogue (names in both languages, usual price, on/off, order).
import { html, $, toast, uuid, money, formData } from '../util.js';
import { T, pname } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q, loadBasics } from '../db.js';
import { go, render } from '../app.js';

export function productsView() {
  const list = S.products;
  return {
    title: T('Products', '商品'), back: '#/more', tab: '#/more',
    body: html`
      <a class="btn primary block" href="#/product/new">${icon('plus')}${T('New product', '新增商品')}</a>
      ${list.length ? html`<div class="list">${list.map((p, i) => html`<div style="${p.active ? '' : 'opacity:.55'}">
        <a class="grow col" href="#/product/${p.id}"><b class="serif" style="font-size:17px">${pname(p)}</b>
          <span class="mu small num">${money(p.default_price)}${p.active ? '' : ' · ' + T('Hidden', '已隱藏')}</span></a>
        <button class="btn icon sm ghost" data-act="up" data-i="${i}" ${i ? '' : 'disabled'} aria-label="${T('Move up', '上移')}">${icon('arrowUp')}</button>
        <button class="btn icon sm ghost" data-act="down" data-i="${i}" ${i < list.length - 1 ? '' : 'disabled'} aria-label="${T('Move down', '下移')}">${icon('arrowDown')}</button>
      </div>`)}</div>`
        : html`<div class="empty"><b>${T('No products yet', '還沒有商品')}</b>${T('Add what you sell, with its name in English and Chinese.', '新增你販售的商品，含中英文名稱。')}</div>`}`,
    actions: {
      up: el => move(+el.dataset.i, -1),
      down: el => move(+el.dataset.i, +1),
    },
  };
}

async function move(i, d) {
  const list = [...S.products];
  [list[i], list[i + d]] = [list[i + d], list[i]];
  S.products = list; render();
  await q(sb.from('products').upsert(list.map((p, n) => ({ ...p, sort: n }))));
  await loadBasics();
}

export async function productEditView(id) {
  const isNew = id === 'new';
  const p = isNew ? { id: uuid(), name_en: '', name_zh: '', default_price: 0, active: true, sort: S.products.length }
    : S.products.find(x => x.id === id) || await q(sb.from('products').select('*').eq('id', id).single());
  return {
    title: isNew ? T('New product', '新增商品') : T('Edit product', '編輯商品'), back: '#/products', tab: '#/more',
    body: html`
      <div class="card stack" id="pf">
        <label class="field"><span>${T('Name in Chinese', '中文名稱')}</span><input name="name_zh" value="${p.name_zh}" placeholder="提拉米蘇"></label>
        <label class="field"><span>${T('Name in English', '英文名稱')}</span><input name="name_en" value="${p.name_en}" placeholder="Tiramisu"></label>
        <label class="field"><span>${T('Usual price (NT$)', '一般價格（NT$）')}</span><input name="default_price" type="number" inputmode="numeric" min="0" value="${p.default_price}"></label>
        <label class="check-row"><span class="grow"><b>${T('On sale', '上架中')}</b><br><span class="mu small">${T('Turn off to hide it from new markets.', '關閉後不會出現在新的市集。')}</span></span>
          <input name="active" type="checkbox" ${p.active ? 'checked' : ''}></label>
      </div>
      <button class="btn primary lg block" data-act="save">${T('Save product', '儲存商品')}</button>
      ${isNew ? '' : html`<button class="btn danger block" data-act="del">${icon('trash')}${T('Delete product', '刪除商品')}</button>`}`,
    actions: {
      async save() {
        const f = formData($('#pf'));
        if (!f.name_zh && !f.name_en) return toast(T('Give the product a name.', '請輸入商品名稱。'), 'err');
        await q(sb.from('products').upsert({
          id: p.id, sort: p.sort, name_zh: f.name_zh, name_en: f.name_en,
          default_price: Math.max(0, f.default_price || 0), active: f.active,
        }));
        await loadBasics(); toast(T('Product saved', '商品已儲存')); go('#/products');
      },
      async del() {
        const [a, b, c] = await Promise.all([
          sb.from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
          sb.from('sales').select('id', { count: 'exact', head: true }).eq('product_id', p.id),
          sb.from('market_products').select('product_id', { count: 'exact', head: true }).eq('product_id', p.id),
        ]);
        if (a.count || b.count || c.count) return toast(T('This product is used in markets or orders. Turn “On sale” off instead.', '此商品已被市集或訂單使用，請改為關閉「上架中」。'), 'err');
        if (!confirm(T('Delete this product?', '確定刪除此商品？'))) return;
        await q(sb.from('products').delete().eq('id', p.id));
        await loadBasics(); toast(T('Product deleted', '商品已刪除')); go('#/products');
      },
    },
  };
}
