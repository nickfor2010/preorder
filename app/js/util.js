// Small helpers shared by every screen.
import { T } from './i18n.js';

// ---- safe HTML templates -------------------------------------------------
// html`<b>${name}</b>` escapes `name`, so customer text can never break the page.
// Wrap trusted HTML pieces in raw(...) to insert them as-is.
const RAW = Symbol('raw');
export const raw = s => ({ [RAW]: String(s ?? '') });
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = v => Array.isArray(v) ? v.map(part).join('') : (v && v[RAW] !== undefined ? v[RAW] : esc(v));
export function html(strings, ...vals) {
  return raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
}

// turn an html`` result into a plain string
export const str = v => part(v);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- small storage wrapper (never throws) --------------------------------
export const store = {
  get(k, d) { try { const v = localStorage.getItem('mr.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mr.' + k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem('mr.' + k); } catch { } },
};

// ---- ids -----------------------------------------------------------------
export const uuid = () => crypto.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

// ---- dates ---------------------------------------------------------------
export const today = () => isoDate(new Date());
export function isoDate(d) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
export function addDays(iso, n) { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
export function dayWord(iso) {
  const t = today();
  if (iso === t) return T('Today', '今天');
  if (iso === addDays(t, 1)) return T('Tomorrow', '明天');
  if (iso === addDays(t, -1)) return T('Yesterday', '昨天');
  return '';
}
export const money = n => 'NT$' + Number(n || 0).toLocaleString('en-US');

// ---- feedback ------------------------------------------------------------
let toastTimer;
export function toast(msg, kind = '') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'show ' + kind; t.textContent = msg;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', kind === 'err' ? 5000 : 2200);
}
export function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/fetch|network|Failed to|Load failed/i.test(m)) return T('No connection — try again when you have signal.', '沒有網路，請在有訊號時再試。');
  return m;
}

// turn a form's [name] inputs into an object
export function formData(root) {
  const o = {};
  $$('[name]', root).forEach(el => {
    o[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
  });
  return o;
}

// ---- pop-up chooser: await choose('Paid how?', [{label:'Cash 現金', value:'cash'}, …]) -----
export function choose(title, options) {
  return new Promise(resolve => {
    const d = document.createElement('div');
    d.className = 'sheet-bg';
    d.innerHTML = str(html`<div class="sheet" role="dialog" aria-label="${title}"><h3>${title}</h3>
      ${options.map((o, i) => html`<button class="${o.cls || ''}" data-i="${i}">${o.label}</button>`)}
      <button class="ghost" data-i="-1">${T('Cancel', '取消')}</button></div>`);
    d.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b && ev.target !== d) return;
      const i = b ? +b.dataset.i : -1;
      d.remove(); resolve(i >= 0 ? options[i].value : undefined);
    });
    document.body.appendChild(d);
  });
}

// load a script only when needed (e.g. the QR scanner)
const loaded = {};
export const loadScript = src => loaded[src] || (loaded[src] = new Promise((ok, bad) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s);
}));

export const digits = s => String(s || '').replace(/\D/g, '');
