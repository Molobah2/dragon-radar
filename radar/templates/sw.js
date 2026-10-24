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
    .then((ks) => {
      // keep the newest older set of static files too, so a tab still open from before the update gets its own files
      const statics = ks.filter((k) => k.startsWith("pd-static-") && k !== STATIC);
      const keep = new Set([PAGES, STATIC, statics[statics.length - 1]]);
      return Promise.all(ks.filter((k) => k.startsWith("pd-") && !keep.has(k)).map((k) => caches.delete(k)));
    })
    // navigation preload: the page request starts while this helper is still waking up, so pages are not slowed by it
    .then(() => self.registration.navigationPreload && self.registration.navigationPreload.enable().catch(() => {}))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), ms)); }

async function page(req, preload) {
  const cache = await caches.open(PAGES);
  try {
    const early = preload ? await Promise.race([preload, timeout(6000)]) : null;   // undefined when preload is off
    const res = early || await Promise.race([fetch(req), timeout(6000)]);
    const u = new URL(req.url);
    // only the plain page is kept (a filtered feed would come back with the wrong posts), never a private one
    if (res && res.ok && res.type === "basic" && !u.search && !/no-store/.test(res.headers.get("Cache-Control") || "")) cache.put(u.pathname, res.clone());
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
  const hit = await caches.match(req);       // any version this helper still holds, including the one before an update
  if (hit) return hit;
  const res = await fetch(req);
  // only this version's files are kept: an old version's name would otherwise be stored with today's file
  if (res && res.ok && new URL(req.url).searchParams.get("v") === VERSION) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin") || url.pathname.startsWith("/cron")) return;
  if (url.pathname.startsWith("/preview") || url.pathname.startsWith("/lab")) return;   // v2 preview pages are never kept offline
  if (url.pathname.startsWith("/static/audio/") || req.headers.has("range")) return;
  // share pictures take a few seconds to draw the first time, and the locked v2.1 pages are never kept offline
  if (/\.(png|jpe?g|webp)$/.test(url.pathname) || /^\/(welcome|creator|circle|dragondle|wrapped|cheers|stickers|canvas)(\/|$)/.test(url.pathname)) return;
  if (req.mode === "navigate") { e.respondWith(page(req, e.preloadResponse)); return; }
  if (url.pathname.startsWith("/static/") && url.searchParams.get("v")) { e.respondWith(asset(req)); return; }
});
{% endif %}
