// Shop details shown on the customer page (name, address, hours, LINE).
import { html, $, toast, formData } from '../util.js';
import { T } from '../i18n.js';
import { sb, S, q, loadBasics } from '../db.js';
import { go } from '../app.js';

export function shopView() {
  const o = S.org || {};
  const ro = S.isOwner ? '' : 'readonly';
  return {
    title: T('Shop details', '店家資料'), back: '#/more', tab: '#/more',
    body: html`
      <div class="card stack" id="sf">
        <label class="field"><span>${T('Shop name', '店名')}</span><input name="name" value="${o.name}" ${ro}></label>
        <label class="field"><span>${T('Address', '地址')}</span><input name="address" value="${o.address}" ${ro}></label>
        <label class="field"><span>${T('Opening hours', '營業時間')}</span><input name="hours" value="${o.hours}" ${ro} placeholder="${T('Tue–Sun 12:00–19:00', '週二至週日 12:00–19:00')}"></label>
        <label class="field"><span>LINE ID</span><input name="line_id" value="${o.line_id}" ${ro} autocapitalize="none" placeholder="@myshop"></label>
        <p class="mu xs" style="margin:0">${T('Customers see these on their order page.', '客人會在訂單頁面看到這些資料。')}</p>
      </div>
      ${S.isOwner ? html`<button class="btn primary lg block" data-act="save">${T('Save', '儲存')}</button>` : ''}`,
    actions: {
      async save() {
        const f = formData($('#sf'));
        await q(sb.from('orgs').update(f).eq('id', o.id));
        await loadBasics(); toast(T('Shop details saved', '店家資料已儲存')); go('#/more');
      },
    },
  };
}
