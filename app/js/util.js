// Small helpers shared by every screen.

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
// "Sat 1 Nov · 11/1（六）"
export function dateBi(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00');
  const en = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const zh = `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
  return `${en} · ${zh}`;
}
export function dayWord(iso) {
  const t = today();
  if (iso === t) return 'Today 今天';
  if (iso === addDays(t, 1)) return 'Tomorrow 明天';
  if (iso === addDays(t, -1)) return 'Yesterday 昨天';
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
  if (/fetch|network|Failed to/i.test(m)) return 'No connection 沒有網路';
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
