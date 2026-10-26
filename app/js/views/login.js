// Staff login: email → 6-digit code from the email → in.
import { html, $, toast, store } from '../util.js';
import { sb, S, signOut } from '../db.js';
import { render } from '../app.js';

let sentTo = store.get('loginEmail', '');   // remembers the email if the app is closed while waiting for the code
let sentAt = 0;

export function loginView() {
  const step2 = !!sentTo;
  return {
    title: 'MarketRecipe', tab: false,
    body: html`
      <div class="hero"><img src="../apple-touch-icon.png" alt=""><p class="mu">Staff login 員工登入</p></div>
      ${step2 ? html`
        <div class="card">
          <p>We emailed a code to 驗證碼已寄到<br><b>${sentTo}</b></p>
          <input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="8" placeholder="123456">
          <button class="pri" data-act="verify">Log in 登入</button>
        </div>
        <div class="row gap">
          <button class="ghost" data-act="resend">Send again 重寄</button>
          <button class="ghost" data-act="other">Other email 換信箱</button>
        </div>
        <p class="mu small">Not there? Check spam / promotions. 沒收到？請看垃圾郵件。</p>`
      : html`
        <div class="card">
          <label class="lbl" for="email">Email 電子郵件</label>
          <input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" placeholder="you@example.com" value="${S.email}">
          <button class="pri" data-act="send">Send code 寄送驗證碼</button>
        </div>`}`,
    after(root) { const i = $(step2 ? '#code' : '#email', root); i && i.focus(); },
    actions: {
      async send() {
        const email = $('#email').value.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Check the email 請確認信箱', 'err');
        await sendCode(email);
      },
      async resend() {
        if (Date.now() - sentAt < 60000) return toast('Wait 1 minute 請等一分鐘');
        await sendCode(sentTo);
      },
      other() { sentTo = ''; store.del('loginEmail'); render(); },
      async verify() {
        const token = $('#code').value.replace(/\D/g, '');
        if (token.length < 6) return toast('Enter the code 請輸入驗證碼', 'err');
        const { error } = await sb.auth.verifyOtp({ email: sentTo, token, type: 'email' });
        if (error) return toast('Wrong or expired code 驗證碼錯誤或過期', 'err');
        sentTo = ''; store.del('loginEmail');
        // app.js notices the login and opens the app
      },
    },
  };
}

async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    if (/rate|seconds/i.test(error.message)) return toast('Too many tries, wait a bit 太多次，請稍候', 'err');
    throw error;
  }
  sentTo = email; sentAt = Date.now(); store.set('loginEmail', email);
  toast('Code sent 已寄出'); render();
}

export function notInvitedView() {
  return {
    title: 'MarketRecipe', tab: false,
    body: html`<div class="card">
        <p><b>${S.email}</b></p>
        <p>This email is not on the team yet. Ask the owner to add it.</p>
        <p>此信箱尚未加入團隊，請老闆新增。</p>
      </div>
      <button class="pri" data-act="retry">Check again 再試一次</button>
      <button class="ghost wide" data-act="out">Log out 登出</button>`,
    actions: {
      retry: () => location.reload(),
      async out() { await signOut(); location.hash = '#/'; location.reload(); },
    },
  };
}
