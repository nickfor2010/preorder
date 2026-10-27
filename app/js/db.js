// Connection to Supabase + the data every screen shares.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { store } from './util.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Throw on error so screens can use plain try/catch.
export async function q(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

// Shared state. Lists are also kept on the phone so the app opens instantly
// (and still shows something with no signal).
export const S = {
  email: '',
  me: null,            // my row in "members": { email, role, name, org_id }
  org: store.get('org', null),
  markets: store.get('markets', []),
  products: store.get('products', []),
  marketId: store.get('market', null),
  get isOwner() { return this.me?.role === 'owner'; },
  get market() { return this.markets.find(m => m.id === this.marketId) || null; },
};

export async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  S.email = session?.user?.email?.toLowerCase() || '';
  if (!S.email) { S.me = null; return null; }
  const cached = store.get('me', null);
  try {
    const rows = await q(sb.from('members').select('email,role,name,org_id').eq('email', S.email));
    S.me = rows[0] || null;
    store.set('me', S.me);
  } catch (e) {
    if (cached && cached.email === S.email) S.me = cached; else throw e;   // offline: trust last known
  }
  return S.me;
}

export async function loadBasics() {
  const [org, markets, products] = await Promise.all([
    q(sb.from('orgs').select('*').maybeSingle()),
    q(sb.from('markets').select('*').order('date', { ascending: false }).limit(200)),
    q(sb.from('products').select('*').order('sort').order('name_en')),
  ]);
  S.org = org; S.markets = markets; S.products = products;
  store.set('org', org); store.set('markets', markets); store.set('products', products);
}

// make sure the market list is loaded (first start on a new phone)
export async function ensureBasics() {
  if (!S.markets.length || !S.org) { try { await loadBasics(); } catch { } }
}

export function setMarket(id) { S.marketId = id; store.set('market', id); }

export async function signOut() {
  await sb.auth.signOut().catch(() => { });
  ['me', 'org', 'markets', 'products', 'market', 'orders', 'lastSync'].forEach(store.del);   // unsent changes (outbox) are kept
  S.me = null; S.org = null; S.markets = []; S.products = []; S.marketId = null;
}

// Ask the server, but give up after a few seconds on bad wifi and use the copy saved on the phone.
export async function cached(key, fn, ms = 5000) {
  try {
    const data = await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
    store.set('c.' + key, data);
    return data;
  } catch (e) {
    const old = store.get('c.' + key, null);
    if (old) return old;
    throw e;
  }
}
export const marketProducts = id => cached('mp.' + id, () =>
  q(sb.from('market_products').select('product_id,price,qty_brought,sold_out,sort').eq('market_id', id).order('sort')));
export const marketStock = id => cached('stock.' + id, () => q(sb.rpc('market_stock', { p_market: id })), 4000);
