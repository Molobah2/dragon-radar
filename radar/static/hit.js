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
})();
