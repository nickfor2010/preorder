// Scan the customer's QR (their photo or screenshot) with the phone camera.
import { html, $, toast, loadScript } from '../util.js';
import { sb, q } from '../db.js';
import { go } from '../app.js';
import { allOrders } from '../orders.js';

export function scanView() {
  let stream, raf, done = false;
  const stop = () => { done = true; cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); };

  async function found(text) {
    let o;
    const t = (text.match(/#t=([A-Za-z0-9]{20,})/) || [])[1];
    if (t) {
      o = allOrders().find(x => x.token === t);
      if (!o && navigator.onLine) o = (await q(sb.from('orders').select('id').eq('token', t)).catch(() => []))[0];
    } else if (/#o=/.test(text)) {                     // QR from the old app: find by order number
      try {
        const b = text.split('#o=')[1].replace(/-/g, '+').replace(/_/g, '/');
        const code = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)))).i;
        o = allOrders().find(x => x.code === code);
      } catch { }
    }
    if (o) { stop(); navigator.vibrate?.(80); go('#/order/' + o.id); }
    else { toast('Order not found 找不到訂單', 'err'); setTimeout(() => { if (!done) loop(); }, 1500); }
  }

  let canvas, ctx, video, last = 0;
  function loop(ts = 0) {
    if (done) return;
    raf = requestAnimationFrame(loop);
    if (ts - last < 180 || !video.videoWidth) return;      // ~5 checks a second is plenty
    last = ts;
    const w = 480, h = Math.round(video.videoHeight * w / video.videoWidth);
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (r?.data) { cancelAnimationFrame(raf); found(r.data); }
  }

  return {
    title: 'Scan 掃描', back: '#/orders', tab: '#/orders',
    body: html`<div class="scanbox"><video id="cam" playsinline muted></video><div class="aim"></div></div>
      <p class="mu c">Point at the customer's QR photo 對準客人的 QR 照片</p>
      <p class="mu c small" id="camerr"></p>
      <a class="btn wide" href="#/orders">🔍 Search by phone instead 改用電話搜尋</a>`,
    async after() {
      video = $('#cam'); canvas = document.createElement('canvas'); ctx = canvas.getContext('2d', { willReadFrequently: true });
      try {
        await loadScript('vendor/jsQR.js');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (done) return stop();
        video.srcObject = stream; await video.play(); loop();
      } catch (e) {
        $('#camerr').textContent = 'Camera not available 無法使用相機: ' + (e.message || e) + ' — allow camera in Settings › Safari › Camera 請在設定中允許相機';
      }
    },
    cleanup: stop,
  };
}
