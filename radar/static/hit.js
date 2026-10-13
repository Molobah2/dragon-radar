/* Counts visits without knowing who you are: this browser makes up a random number once and sends it
   with the page name. No name, X account or address is ever sent. */
(() => {
  "use strict";
  let vid = "";
  try { vid = localStorage.getItem("pd:vid") || ""; } catch (e) { /* private mode */ }
  if (!/^[a-f0-9]{32}$/.test(vid)) {
    const b = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(b);
    vid = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem("pd:vid", vid); } catch (e) { /* counted as new next time, that is fine */ }
  }
  const send = () => {
    const body = JSON.stringify({ vid, path: location.pathname, ref: document.referrer || "" });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/hit", new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through */ }
    fetch("/api/hit", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
  };
  // after the page has painted, so it never slows anything down
  if (document.readyState === "complete") setTimeout(send, 500); else addEventListener("load", () => setTimeout(send, 500));

  // Anonymous moments that show whether the site helps: daily goal finished, a card shared or saved,
  // the app added to a home screen. Same random number, nothing personal. Sent in the background.
  window.pdTrack = (kind, ref) => {
    const body = JSON.stringify({ vid, kind, ref: ref || "" });
    try { if (navigator.sendBeacon && navigator.sendBeacon("/api/ev", new Blob([body], { type: "text/plain" }))) return; } catch (e) { /* fall through */ }
    fetch("/api/ev", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
  };
  addEventListener("pd:goaldone", () => window.pdTrack("goal"));
  addEventListener("appinstalled", () => window.pdTrack("install"));
})();

/* Add to home screen. Android and computers: the browser's own install prompt, kept for when the visitor
   taps our button. iPhone: Apple has no prompt, so a short how to. Never shown inside the installed app. */
(() => {
  "use strict";
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  let deferred = null;
  const buttons = () => document.querySelectorAll("[data-install]");
  const show = () => buttons().forEach((b) => { b.hidden = false; });
  const hide = () => buttons().forEach((b) => { b.hidden = true; });
  if (standalone) { store.set("pd:installed", "1"); return; }
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; show(); maybeNudge(); });
  addEventListener("appinstalled", () => { store.set("pd:installed", "1"); hide(); closeHow(); });
  const howEl = () => document.getElementById("install-how");
  function closeHow() { const w = howEl(); if (!w) return; w.classList.remove("open"); document.body.classList.remove("sheet-open"); setTimeout(() => { w.hidden = true; }, 250); }
  function openHow() { const w = howEl(); if (!w) return; w.hidden = false; requestAnimationFrame(() => w.classList.add("open")); document.body.classList.add("sheet-open"); }
  async function install() {
    store.set("pd:installNag", "done");
    const nudge = document.getElementById("install-nudge"); if (nudge) nudge.hidden = true;
    if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) { /* ignore */ } deferred = null; return; }
    openHow();
  }
  // a gentle invite, once, for people who keep coming back (third different day). Never on the first visit.
  function maybeNudge() {
    const n = document.getElementById("install-nudge");
    if (!n || store.get("pd:installNag") || store.get("pd:installed")) return;
    let days = []; try { days = JSON.parse(store.get("pd:days") || "[]"); } catch (e) { days = []; }
    if (days.length < 3) return;
    setTimeout(() => { n.hidden = false; requestAnimationFrame(() => n.classList.add("show")); }, 4000);
  }
  function countDay() {
    let days = []; try { days = JSON.parse(store.get("pd:days") || "[]"); } catch (e) { days = []; }
    const d = new Date(); const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!days.includes(key)) { days.push(key); store.set("pd:days", JSON.stringify(days.slice(-10))); }
  }
  function ready() {
    countDay();
    if (store.get("pd:installed")) return;
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-install]"); if (b) { e.preventDefault(); install(); return; }
      if (e.target.closest && e.target.closest("[data-install-close]")) { closeHow(); return; }
      if (e.target.closest && e.target.closest("[data-nudge-close]")) { store.set("pd:installNag", "done"); const n = document.getElementById("install-nudge"); if (n) n.hidden = true; return; }
      if (e.target === howEl()) closeHow();
    });
    if (ios) { show(); maybeNudge(); }
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", ready); else ready();
})();
