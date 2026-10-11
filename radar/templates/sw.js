/* pdtools offline helper, version {{ version }}.
   Pages: network first (fresh posts), with the last copy as a fallback when the signal drops.
   Versioned static files: from the cache, they never change for a given version.
   Posts API, sounds and other sites: always straight from the network. */
{% if not enabled %}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.registration.unregister())));
{% else %}
const VERSION = "{{ version }}";
const PAGES = "pd-pages-" + VERSION;
const STATIC = "pd-static-" + VERSION;
const SHELL = ["/", "/friends", "/friends/keepers"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith("pd-") && k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), ms)); }

async function page(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([fetch(req), timeout(6000)]);
    if (res && res.ok && res.type === "basic") cache.put(new URL(req.url).pathname, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(new URL(req.url).pathname) || await cache.match("/friends") || await cache.match("/");
    if (hit) return hit;
    return new Response("<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>pdtools</title>" +
      "<body style='font:600 17px system-ui;display:grid;place-items:center;height:90vh;text-align:center;padding:16px'>" +
      "<div>You seem to be offline.<br>Blinky will be here when you are back 🐉</div>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function asset(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || url.pathname.startsWith("/cron")) return;
  if (url.pathname.startsWith("/static/audio/") || req.headers.has("range")) return;
  if (req.mode === "navigate") { e.respondWith(page(req)); return; }
  if (url.pathname.startsWith("/static/") && url.searchParams.get("v") === VERSION) { e.respondWith(asset(req)); return; }
});
{% endif %}
