// Keeps a copy of the app on the phone so it opens with no signal.
// Online: always fetch the newest files (so updates arrive at once). Offline: use the saved copy.
const CACHE = 'mr-v11';
const FILES = [
  './', 'index.html', 'o.html', 'manifest.webmanifest',
  'js/app.js', 'js/config.js', 'js/db.js', 'js/util.js', 'js/orders.js',
  'js/views/home.js', 'js/views/login.js', 'js/views/markets.js', 'js/views/products.js',
  'js/views/shop.js', 'js/views/team.js', 'js/views/neworder.js', 'js/views/orderlist.js',
  'js/views/scan.js', 'js/views/import.js', 'js/views/summary.js', 'js/i18n.js', 'js/icons.js', 'js/views/export.js',
  'vendor/supabase.js', 'vendor/qrcode.js', 'vendor/jsQR.js',
  '../apple-touch-icon.png', '../icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // database calls go straight to the internet
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);                         // bad wifi: don't wait forever
      const res = await fetch(e.request, { signal: ctl.signal, cache: 'no-cache' });
      clearTimeout(t);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true }))
        || (e.request.mode === 'navigate' && await cache.match('index.html')) || Response.error();
    }
  })());
});
