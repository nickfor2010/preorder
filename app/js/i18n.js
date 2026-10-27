// Language: English or Taiwan Mandarin (繁體中文). Starts from the phone's language,
// can be changed in More › Language and is remembered on this phone.
const KEY = 'mr.lang';
const fromPhone = () => ((navigator.languages || [navigator.language || '']).some(l => /^zh/i.test(l)) ? 'zh' : 'en');
let lang;
try { lang = JSON.parse(localStorage.getItem(KEY)) || fromPhone(); } catch { lang = fromPhone(); }
document.documentElement.lang = lang === 'zh' ? 'zh-Hant-TW' : 'en';

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem(KEY, JSON.stringify(lang)); } catch { }
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant-TW' : 'en';
}

// T('Picked up', '已取貨') → the text for the current language
export const T = (en, zh) => (lang === 'zh' ? zh : en);

// product / item names: prefer the current language, fall back to the other one
export const pname = p => !p ? '' : (lang === 'zh' ? (p.name_zh || p.name_en || p.zh || p.en) : (p.name_en || p.name_zh || p.en || p.zh)) || '';

const WD_ZH = '日一二三四五六';
// "Sat 1 Nov"  /  "11月1日（六）"
export function fmtDate(iso, long = false) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00');
  if (lang === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日（${WD_ZH[d.getDay()]}）`;
  return d.toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
}
export const fmtTime = t => t ? new Date(t).toLocaleTimeString(lang === 'zh' ? 'zh-TW' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
export const fmtDateTime = t => t ? new Date(t).toLocaleString(lang === 'zh' ? 'zh-TW' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export const PAY = () => ({ cash: T('Cash', '現金'), linepay: 'LINE Pay', transfer: T('Transfer', '轉帳'), unknown: T('Not recorded', '未記錄') });

// run fn with another language for a moment (e.g. to write a message in both languages)
export function inLang(l, fn) {
  const old = lang; lang = l;
  try { return fn(); } finally { lang = old; }
}
