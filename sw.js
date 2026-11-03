/* sw.js — makes Antz Cuts installable and quick to open.
   Pages and styles: network first, cached copy if offline.
   Images: cache first. API calls (/api/*), PayPal and videos: never cached. */

const CACHE = "antz-cuts-v2";
const SHELL = [
  "/", "/index.html", "/about.html", "/contact.html", "/book.html", "/style-finder.html",
  "/styles.css", "/booking.js", "/app.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/logo.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;   // PayPal etc. go straight to the network
  if (url.pathname.startsWith("/api/") || url.pathname.endsWith(".mp4")) return;

  if (/\.(png|jpe?g|svg|webp)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match("/book.html")))
  );
});
