// Shop info shown on the customer page (name, address, hours, LINE).
import { html, $, toast, formData } from '../util.js';
import { sb, S, q, loadBasics } from '../db.js';
import { go } from '../app.js';

export function shopView() {
  const o = S.org || {};
  const ro = S.isOwner ? '' : 'readonly';
  return {
    title: 'Shop info 店家資料', back: '#/more', tab: '#/more',
    body: html`
      <div class="card form" id="sf">
        <label class="lbl">Shop name 店名<input name="name" value="${o.name}" ${ro}></label>
        <label class="lbl">Address 地址<input name="address" value="${o.address}" ${ro}></label>
        <label class="lbl">Opening hours 營業時間<input name="hours" value="${o.hours}" ${ro} placeholder="Tue–Sun 12:00–19:00"></label>
        <label class="lbl">LINE ID<input name="line_id" value="${o.line_id}" ${ro} autocapitalize="none" placeholder="@myshop"></label>
        <p class="mu small">Customers see this on their order page. 客人在訂單頁面會看到這些資料。</p>
      </div>
      ${S.isOwner ? html`<button class="pri" data-act="save">Save 儲存</button>` : ''}`,
    actions: {
      async save() {
        const f = formData($('#sf'));
        await q(sb.from('orgs').update(f).eq('id', o.id));
        await loadBasics(); toast('Saved 已儲存'); go('#/more');
      },
    },
  };
}
