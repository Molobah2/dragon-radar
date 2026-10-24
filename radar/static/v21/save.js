/* v2.1: one way to save a card or sticker that works everywhere.
   Phones: the share sheet (it has "Save image"). In-app browsers (X, Telegram, Discord, Instagram) ignore
   download links, so the picture opens full size to press and hold. Laptops: a normal download. */
(() => {
  "use strict";
  const UA = navigator.userAgent || "";
  const inApp = /FBAN|FBAV|Instagram|Line\/|Twitter|Telegram|Discord|; wv\)/i.test(UA);
  const touch = matchMedia("(pointer: coarse)").matches;
  const T = (t) => (window.pdT ? window.pdT(t) : t);

  function overlay(url) {
    const old = document.getElementById("pd-save-peek"); if (old) old.remove();
    const back = document.createElement("div");
    back.id = "pd-save-peek"; back.setAttribute("role", "dialog"); back.setAttribute("aria-modal", "true");
    back.style.cssText = "position:fixed;inset:0;z-index:90;display:grid;place-items:center;gap:14px;padding:20px;background:rgba(10,6,20,.88);text-align:center;";
    const img = document.createElement("img");
    img.src = url; img.alt = "";
    img.style.cssText = "max-width:100%;max-height:70vh;border-radius:16px;box-shadow:0 20px 50px -20px #000;-webkit-touch-callout:default;user-select:auto;";
    const p = document.createElement("p");
    p.textContent = T("Press and hold the picture to save it.");
    p.style.cssText = "margin:0;color:#fff3dd;font:800 16px/1.35 var(--body, sans-serif);";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = T("Close");
    x.style.cssText = "height:46px;padding:0 22px;border-radius:999px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.1);color:#fff;font:800 15px/1 var(--body, sans-serif);cursor:pointer;";
    const wrap = document.createElement("div"); wrap.style.cssText = "display:grid;gap:14px;justify-items:center;";
    wrap.append(img, p, x); back.append(wrap);
    const opener = document.activeElement;
    const close = () => { back.remove(); removeEventListener("keydown", esc); if (opener && opener.focus) opener.focus(); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    x.addEventListener("click", close);
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    addEventListener("keydown", esc);
    document.body.append(back); x.focus();
  }

  // returns "shared", "cancelled", "shown" or "saved"
  window.pdSave = async function (blob, name) {
    if (!blob) throw new Error("no picture");
    const file = typeof File === "function" ? new File([blob], name, { type: blob.type || "image/png" }) : null;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    if (inApp) { overlay(url); return "shown"; }
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    return "saved";
  };
  window.pdSaveToast = (how, done) => (how === "shown" ? "" : how === "cancelled" ? "" : done);
})();
