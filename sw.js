// Caches the app shell so it opens fast and works without signal; data comes live from the server
// (the app also keeps its last data in localStorage to show right away).
const CACHE = "aharon-app-v26";
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
const SHELL = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png", LIB];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
const put = (req, r) => { if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); } return r; };
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET") return;
  // the supabase library never changes for this version: cache first
  if (req.url === LIB) { e.respondWith(caches.match(req).then(h => h || fetch(req).then(r => put(req, r)))); return; }
  if (u.origin !== location.origin) return;
  // app files: network first, but don't wait more than 3s on weak signal
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fallback = () => caches.match(req).then(h => { if (h && !done) { done = true; resolve(h); } });
    const t = setTimeout(fallback, 3000);
    fetch(req).then(r => { clearTimeout(t); put(req, r); if (!done) { done = true; resolve(r); } })
      .catch(() => { clearTimeout(t); caches.match(req).then(h => { if (!done) { done = true; resolve(h || Response.error()); } }); });
  }));
});
