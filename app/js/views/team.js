// Owner: who can use the app. Adding an email here is the "invite":
// that person then opens the app and logs in with the code sent to that email.
import { html, $, toast } from '../util.js';
import { T } from '../i18n.js';
import { icon } from '../icons.js';
import { sb, S, q } from '../db.js';
import { render } from '../app.js';

export async function teamView() {
  const team = await q(sb.from('members').select('*').order('role').order('email'));
  const link = location.href.split('#')[0];
  return {
    title: T('Team', '團隊'), back: '#/more', tab: '#/more',
    body: html`
      <div class="list">${team.map(m => html`<div>
        <span class="lead serif">${(m.name || m.email)[0].toUpperCase()}</span>
        <div class="grow col"><b>${m.name || m.email}</b><span class="mu xs">${m.email}</span></div>
        <span class="pill ${m.role === 'owner' ? 'accent' : ''}">${m.role === 'owner' ? T('Owner', '老闆') : T('Staff', '員工')}</span>
        ${m.email !== S.email ? html`<button class="btn icon sm ghost" data-act="del" data-id="${m.id}" data-email="${m.email}" aria-label="${T('Remove', '移除')}">${icon('x')}</button>` : ''}
      </div>`)}</div>
      <div class="h2">${T('Add a person', '新增成員')}</div>
      <div class="card stack" id="tf">
        <label class="field"><span>${T('Name', '名字')}</span><input id="tname" placeholder="Amy"></label>
        <label class="field"><span>${T('Email', '電子郵件')}</span><input id="temail" type="email" inputmode="email" autocapitalize="none" placeholder="amy@gmail.com"></label>
        <div class="seg">
          <label><input type="radio" name="role" value="staff" checked>${T('Staff', '員工')}</label>
          <label><input type="radio" name="role" value="owner">${T('Owner', '老闆')}</label>
        </div>
        <p class="mu xs" style="margin:0">${T('Staff take orders and record sales. Owners also see money totals and change products, markets and the team.', '員工可接單與記錄銷售；老闆另可查看金額，並管理商品、市集與團隊。')}</p>
        <button class="btn primary block" data-act="add">${T('Add to team', '加入團隊')}</button>
      </div>
      <div class="card stack">
        <span class="mu small">${T('Then send them this link. They log in with their own email.', '接著把這個連結傳給對方，用自己的信箱登入。')}</span>
        <code class="small" style="user-select:all;word-break:break-all">${link}</code>
        <button class="btn sm" data-act="share">${icon('share')}${T('Share link', '分享連結')}</button>
      </div>`,
    actions: {
      async add() {
        const email = $('#temail').value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return toast(T('Please check the email address.', '請確認電子郵件地址。'), 'err');
        const role = $('#tf [name=role]:checked').value;
        const { error } = await sb.from('members').insert({ org_id: S.me.org_id, email, role, name: $('#tname').value.trim() });
        if (error) return toast(/duplicate|unique/i.test(error.message) ? T('This email is already on a team.', '此信箱已在團隊中。') : error.message, 'err');
        toast(T('Added to the team', '已加入團隊')); render();
      },
      async del(el) {
        if (!confirm(T(`Remove ${el.dataset.email} from the team?`, `確定將 ${el.dataset.email} 移出團隊？`))) return;
        await q(sb.from('members').delete().eq('id', el.dataset.id));
        toast(T('Removed', '已移除')); render();
      },
      async share() {
        if (navigator.share) return navigator.share({ title: 'MarketRecipe', url: link }).catch(() => { });
        try { await navigator.clipboard.writeText(link); toast(T('Link copied', '已複製連結')); } catch { toast(link); }
      },
    },
  };
}
