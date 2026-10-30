/* v2.2: the dragons in the pages' own pictures come alive. Each posted dragon picture (Pinky with her quill, Blinky with
   his lantern...) has a seamless loop made from that exact picture. A canvas is laid over the picture, in the same
   box, and plays the loop while it is on screen. The picture stays underneath: it shows first, it is the fallback,
   and it is what lite mode and reduced motion keep. Only the files named in window.PD_LIVE are touched. */
(() => {
  "use strict";
  const LIVE = window.PD_LIVE;
  if (!LIVE) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lite = window.PD_LITE || (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.connection && navigator.connection.saveData);
  if (reduce || lite) return;

  const nameOf = (img) => { const m = (img.getAttribute("src") || "").match(/\/v21\/([a-z-]+)\.webp/); return m && LIVE[m[1]] ? m[1] : null; };
  const sheets = {};
  const sheet = (src) => {
    if (!sheets[src]) { const im = new Image(); im.decoding = "async"; im.src = src; sheets[src] = im; }
    return sheets[src];
  };
  const ready = (im) => im.complete && im.naturalWidth > 0;
  const items = [];

  // the box the picture is actually drawn in (object-fit contain leaves bands around it)
  function content(img) {
    const w = img.offsetWidth, h = img.offsetHeight, cs = getComputedStyle(img), fit = cs.objectFit;
    if (fit === "contain" || fit === "scale-down") {
      const nw = img.naturalWidth || +img.getAttribute("width") || w, nh = img.naturalHeight || +img.getAttribute("height") || h;
      let s = Math.min(w / nw, h / nh); if (fit === "scale-down") s = Math.min(s, 1);
      const cw = nw * s, ch = nh * s, [px, py] = (cs.objectPosition || "50% 50%").split(" ");
      const at = (v, room) => (v && v.endsWith("%") ? room * parseFloat(v) / 100 : parseFloat(v) || 0);
      return { x: at(px, w - cw), y: at(py, h - ch), w: cw, h: ch };
    }
    return { x: 0, y: 0, w, h };
  }

  // where the canvas goes: the picture's own box, grown to the whole loop frame (an arm or a lantern may move past it)
  function place(it) {
    const { img, c } = it;
    if (!img.offsetWidth || !img.offsetHeight) { it.ok = false; return; }
    const b = content(img);
    const m = it.m = b.w > 180 ? it.big : it.small;     // small cards get the small sheet
    const kx = b.w / m.sw, ky = b.h / m.sh;
    const left = img.offsetLeft + b.x - m.sx * kx, top = img.offsetTop + b.y - m.sy * ky;
    c.style.left = left + "px"; c.style.top = top + "px";
    c.style.width = (m.cw * kx) + "px"; c.style.height = (m.ch * ky) + "px";
    // a hop or bob on the picture itself: the canvas copies it, turning about the same point
    const o = getComputedStyle(img).transformOrigin.split(" ").map(parseFloat);
    c.style.transformOrigin = (img.offsetLeft + (o[0] || 0) - left) + "px " + (img.offsetTop + (o[1] || 0) - top) + "px";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(m.cw * kx * dpr)); c.height = Math.max(1, Math.round(m.ch * ky * dpr));
    it.ok = true; it.drawn = -1;
  }

  const seen = new IntersectionObserver((es) => {
    for (const e of es) { const it = items.find((x) => x.img === e.target); if (it) { it.vis = e.isIntersecting; if (it.vis) sheet(it.m ? it.m.src : it.big.src); } }
  }, { rootMargin: "200px" });
  const sized = new ResizeObserver((es) => { for (const e of es) { const it = items.find((x) => x.img === e.target); if (it) place(it); } });

  function attach(img) {
    if (img.dataset.live || img.hasAttribute("data-still")) return;    // data-still: something is laid on this picture
    const name = nameOf(img);
    if (!name) return;
    const cs = getComputedStyle(img);
    if (cs.objectFit === "cover" || cs.objectFit === "none") return;
    if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor)) return;          // a picture on its own card colour stays still
    if (img.getAttribute("width") && +img.getAttribute("width") < 100 && img.offsetWidth < 100) return;   // tiny thumbnails stay still
    img.dataset.live = name;
    const c = document.createElement("canvas");
    c.className = "pd-live"; c.setAttribute("aria-hidden", "true");
    c.style.cssText = "position:absolute;pointer-events:none;opacity:0;transition:opacity .45s ease;max-width:none;";
    const f = cs.filter; if (f && f !== "none") c.style.filter = f;   // the picture's own shadow
    img.insertAdjacentElement("afterend", c);
    const it = { img, c, name, big: LIVE[name].big, small: LIVE[name].small, t0: 0, vis: false, ok: false, shown: false };
    items.push(it); place(it); seen.observe(img); sized.observe(img);
    if (!img.complete) img.addEventListener("load", () => place(it), { once: true });
  }

  function frame(now) {
    if (!document.hidden) for (const it of items) {
      if (!it.ok || !it.vis || !it.img.isConnected) continue;
      const m = it.m, im = sheet(m.src);
      if (!ready(im)) continue;
      if (!it.t0) it.t0 = now;                // the loop starts on its first frame, which is the picture itself
      const f = Math.floor(((now - it.t0) / 1000) * m.fps) % m.n;
      const tf = getComputedStyle(it.img).transform;
      if (tf !== it.tf) { it.tf = tf; it.c.style.transform = tf === "none" ? "" : tf; }
      if (f === it.drawn) continue;
      const ctx = it.c.getContext("2d"), col = f % m.cols, row = Math.floor(f / m.cols);
      ctx.clearRect(0, 0, it.c.width, it.c.height);
      ctx.drawImage(im, col * m.cw, row * m.ch, m.cw, m.ch, 0, 0, it.c.width, it.c.height);
      it.drawn = f;
      if (!it.shown) {          // first frame is the picture itself: swap without a jump
        it.shown = true; it.c.style.opacity = "1";
        it.img.style.transition = "opacity .45s ease"; it.img.style.opacity = "0";
      }
    }
    requestAnimationFrame(frame);
  }

  const scan = (root) => { if (root.querySelectorAll) root.querySelectorAll("img").forEach(attach); };
  const start = () => {
    scan(document);
    // pages that draw their slides later (Wrapped) add pictures after load
    new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === "IMG") attach(n); else scan(n); } }); })
      .observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(frame);
  };
  if (document.readyState === "complete") start(); else addEventListener("load", start);
})();
