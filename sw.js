/* Site Ledger offline cache: app shell first, then libraries and reference data as they are used. */
const V = "sl-1795077238", SHELL = ["./", "index.html", "bridge.js", "firebase-config.js", "manifest.webmanifest", "lib/firebase-app-compat.js", "lib/firebase-auth-compat.js", "lib/firebase-firestore-compat.js", "dar2023.json", "spec2019.json", "refs/index.json", "icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;           // Firebase traffic goes straight to the network
  const page = e.request.mode === "navigate" || /\/(index\.html|bridge\.js|firebase-config\.js)?$/.test(u.pathname);
  if (page) { e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))); return; }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((x) => x.put(e.request, c)); } return r; })));
});
