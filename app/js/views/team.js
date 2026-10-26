// Owner: who can use the app. Adding an email here is the "invite":
// that person then opens the app and logs in with the code sent to that email.
import { html, $, toast } from '../util.js';
import { sb, S, q } from '../db.js';
import { render } from '../app.js';

export async function teamView() {
  const team = await q(sb.from('members').select('*').order('role').order('email'));
  const link = location.href.split('#')[0];
  return {
    title: 'Team 團隊', back: '#/more', tab: '#/more',
    body: html`
      ${team.map(m => html`<div class="card row">
        <div class="grow"><b>${m.name || m.email}</b><div class="mu">${m.email}</div></div>
        <span class="tag">${m.role === 'owner' ? 'Owner 老闆' : 'Staff 員工'}</span>
        ${m.email !== S.email ? html`<button class="sm" data-act="del" data-id="${m.id}" data-email="${m.email}" aria-label="Remove">✕</button>` : ''}
      </div>`)}
      <h2>Add a person 新增成員</h2>
      <div class="card form" id="tf">
        <label class="lbl">Name 名字<input id="tname" placeholder="Amy"></label>
        <label class="lbl">Email 電子郵件<input id="temail" type="email" inputmode="email" autocapitalize="none" placeholder="amy@gmail.com"></label>
        <div class="chips">
          <label class="chip"><input type="radio" name="role" value="staff" checked><span>Staff 員工</span></label>
          <label class="chip"><input type="radio" name="role" value="owner"><span>Owner 老闆</span></label>
        </div>
        <button class="pri" data-act="add">Add 新增</button>
      </div>
      <div class="card mu small">Then send them this link and tell them to log in with their email:<br>
        把這個連結傳給他們，用自己的信箱登入：<br><b class="sel-all">${link}</b>
        <button class="sm" data-act="share">Share 分享</button></div>`,
    actions: {
      async add() {
        const email = $('#temail').value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Check the email 請確認信箱', 'err');
        const role = $('#tf [name=role]:checked').value;
        const { error } = await sb.from('members').insert({ org_id: S.me.org_id, email, role, name: $('#tname').value.trim() });
        if (error) return toast(/duplicate|unique/i.test(error.message) ? 'Already added (maybe in another shop) 已存在' : error.message, 'err');
        toast('Added 已新增'); render();
      },
      async del(el) {
        if (!confirm(`Remove ${el.dataset.email}? 確定移除？`)) return;
        await q(sb.from('members').delete().eq('id', el.dataset.id));
        toast('Removed 已移除'); render();
      },
      async share() {
        const text = `MarketRecipe ${link}`;
        if (navigator.share) await navigator.share({ title: 'MarketRecipe', url: link }).catch(() => { });
        else { await navigator.clipboard?.writeText(text); toast('Copied 已複製'); }
      },
    },
  };
}
