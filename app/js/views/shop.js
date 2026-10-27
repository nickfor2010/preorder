// Shop details shown on the customer's receipt (logo, name, phone, address, hours, LINE).
import { html, $, toast, formData } from '../util.js';
import { T } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q, loadBasics, ensureBasics } from '../db.js';
import { go } from '../app.js';

// Shrink a photo to a small logo (max 240 px) so it loads fast on the customer's phone.
function shrink(file) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => {
      const max = 240, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      // PNG keeps transparent backgrounds; photos and big logos become a small JPEG on white
      let url = c.toDataURL('image/png');
      if (url.length > 60000) {
        g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        url = c.toDataURL('image/jpeg', 0.86);
      }
      URL.revokeObjectURL(img.src);
      ok(url);
    };
    img.onerror = () => bad(new Error(T('That file is not a picture we can read. Try a PNG or JPG.', '無法讀取這個檔案，請使用 PNG 或 JPG 圖片。')));
    img.src = URL.createObjectURL(file);
  });
}

export async function shopView() {
  await ensureBasics();
  const o = S.org || {};
  const owner = S.isOwner;
  const ro = owner ? '' : 'readonly';
  let logo = o.logo || '';
  const logoBox = () => logo
    ? html`<img src="${logo}" alt="${T('Shop logo', '店家標誌')}" class="logo-prev">`
    : html`<div class="logo-prev empty-logo">${icon('shop')}</div>`;
  return {
    title: T('Shop details', '店家資料'), back: '#/more', tab: '#/more',
    body: html`
      <div class="card row" style="gap:16px">
        <div id="logobox">${logoBox()}</div>
        <div class="grow stack" style="gap:8px">
          <b>${T('Logo', '標誌')}</b>
          <span class="mu xs">${T('Shown at the top of the customer’s receipt. A square picture works best.', '顯示在客人收據最上方，建議使用正方形圖片。')}</span>
          ${owner ? html`<div class="row gap4 wrap">
            <label class="btn sm" for="logofile">${icon('download')}${logo ? T('Change', '更換') : T('Upload', '上傳')}</label>
            <input id="logofile" type="file" accept="image/*" class="hide" data-change="pickLogo">
            <button class="btn sm ghost ${logo ? '' : 'hide'}" id="rmlogo" data-act="removeLogo">${T('Remove', '移除')}</button></div>` : ''}
        </div>
      </div>
      <div class="card stack" id="sf">
        <label class="field"><span>${T('Shop name', '店名')}</span><input name="name" value="${o.name}" ${ro}></label>
        <label class="field"><span>${T('Phone number', '電話')}</span><input name="phone" type="tel" inputmode="tel" value="${o.phone || ''}" ${ro} placeholder="06-123 4567"></label>
        <label class="field"><span>${T('Address', '地址')}</span><input name="address" value="${o.address}" ${ro}></label>
        <label class="field"><span>${T('Opening hours', '營業時間')}</span><input name="hours" value="${o.hours}" ${ro} placeholder="${T('Tue–Sun 12:00–19:00', '週二至週日 12:00–19:00')}"></label>
        <label class="field"><span>LINE ID</span><input name="line_id" value="${o.line_id}" ${ro} autocapitalize="none" placeholder="@myshop"></label>
        <p class="mu xs" style="margin:0">${T('Customers see all of this on their receipt.', '客人會在收據上看到這些資料。')}</p>
      </div>
      ${owner ? html`<button class="btn primary lg block" data-act="save">${T('Save', '儲存')}</button>` : ''}`,
    actions: {
      async pickLogo(el) {
        const f = el.files && el.files[0];
        if (!f) return;
        try { logo = await shrink(f); }
        catch (e) { return toast(e.message, 'err'); }
        $('#logobox').innerHTML = `<img src="${logo}" alt="" class="logo-prev">`;
        $('#rmlogo').classList.remove('hide');
        toast(T('Logo ready — tap Save', '標誌已選好，請按儲存'));
      },
      removeLogo() {
        logo = '';
        $('#logobox').innerHTML = `<div class="logo-prev empty-logo"></div>`;
        $('#rmlogo').classList.add('hide');
      },
      async save() {
        const f = formData($('#sf'));
        await q(sb.from('orgs').update({ ...f, logo }).eq('id', o.id));
        await loadBasics(); toast(T('Shop details saved', '店家資料已儲存')); go('#/more');
      },
    },
  };
}
