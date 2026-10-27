// Staff login: email → 6-digit code from the email → in.
import { html, $, toast, store } from '../util.js';
import { T, getLang, setLang } from '../i18n.js';
import { sb, S, signOut } from '../db.js';
import { render } from '../app.js';

let sentTo = store.get('loginEmail', '');   // remembers the email if the app is closed while waiting for the code
let sentAt = 0;

const langSwitch = () => html`<div class="langswitch"><div class="seg" style="width:220px">
  <button class="${getLang() === 'en' ? 'on' : ''}" data-act="lang" data-l="en">English</button>
  <button class="${getLang() === 'zh' ? 'on' : ''}" data-act="lang" data-l="zh">中文</button></div></div>`;
const langAction = { lang(el) { setLang(el.dataset.l); render(); } };

export function loginView() {
  const step2 = !!sentTo;
  return {
    title: '', tab: false,
    body: html`
      <div class="hero"><img src="../apple-touch-icon.png" alt=""><h2>MarketRecipe</h2>
        <p class="mu" style="margin:0">${T('Staff login', '員工登入')}</p></div>
      ${step2 ? html`
        <div class="card stack">
          <p style="margin:0">${T('We emailed a 6-digit code to', '驗證碼已寄到')}<br><b>${sentTo}</b></p>
          <input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="8" placeholder="••••••" aria-label="${T('Code', '驗證碼')}">
          <button class="btn primary lg block" data-act="verify">${T('Log in', '登入')}</button>
        </div>
        <div class="grid2">
          <button class="btn ghost" data-act="resend">${T('Send again', '重新寄送')}</button>
          <button class="btn ghost" data-act="other">${T('Use another email', '換一個信箱')}</button>
        </div>
        <p class="mu small c">${T('No email? Check your spam or promotions folder.', '沒收到嗎？請查看垃圾郵件或促銷內容。')}</p>`
      : html`
        <div class="card stack">
          <label class="field"><span>${T('Email', '電子郵件')}</span>
            <input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" placeholder="you@example.com" value="${S.email}"></label>
          <button class="btn primary lg block" data-act="send">${T('Send login code', '寄送登入驗證碼')}</button>
        </div>`}
      ${langSwitch()}`,
    after(root) { const i = $(step2 ? '#code' : '#email', root); i && i.focus(); },
    actions: {
      ...langAction,
      async send() {
        const email = $('#email').value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return toast(T('Please check the email address.', '請確認電子郵件地址。'), 'err');
        await sendCode(email);
      },
      async resend() {
        if (Date.now() - sentAt < 60000) return toast(T('Please wait a minute before sending again.', '請稍等一分鐘再寄送。'));
        await sendCode(sentTo);
      },
      other() { sentTo = ''; store.del('loginEmail'); render(); },
      async verify() {
        const token = $('#code').value.replace(/\D/g, '');
        if (token.length < 6) return toast(T('Enter the 6-digit code.', '請輸入 6 位數驗證碼。'), 'err');
        const { error } = await sb.auth.verifyOtp({ email: sentTo, token, type: 'email' });
        if (error) return toast(T('That code is wrong or has expired.', '驗證碼錯誤或已過期。'), 'err');
        sentTo = ''; store.del('loginEmail');
      },
    },
  };
}

async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    if (/rate|seconds/i.test(error.message)) return toast(T('Too many tries. Wait a few minutes.', '嘗試次數過多，請稍候幾分鐘。'), 'err');
    throw error;
  }
  sentTo = email; sentAt = Date.now(); store.set('loginEmail', email);
  toast(T('Code sent', '驗證碼已寄出')); render();
}

export function notInvitedView() {
  return {
    title: '', tab: false,
    body: html`
      <div class="hero"><img src="../apple-touch-icon.png" alt=""><h2>MarketRecipe</h2></div>
      <div class="card stack">
        <b>${S.email}</b>
        <p class="mu" style="margin:0">${T('This email is not on the team yet. Ask the owner to add it in More › Team.', '此信箱尚未加入團隊，請老闆在「更多 › 團隊」中新增。')}</p>
      </div>
      <button class="btn primary lg block" data-act="retry">${T('Check again', '再試一次')}</button>
      <button class="btn ghost block" data-act="out">${T('Log out', '登出')}</button>
      ${langSwitch()}`,
    actions: {
      ...langAction,
      retry: () => location.reload(),
      async out() { await signOut(); location.hash = '#/'; location.reload(); },
    },
  };
}
