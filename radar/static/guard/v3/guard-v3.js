/* Dragon Guard v3: the notice on a real scroll.
   First visit: the scroll drops in rolled up and sealed. The Keeper breaks the seal, it unrolls, they read,
   then press and hold to stamp their own seal: the pledge. "Read the notice again" just unrolls.
   One value (open: 0 closed, 1 open) drives the bottom roller, the paper's edge and the shadow together,
   so they can never drift apart. Only transform, opacity and clip-path move. */
(function () {
  "use strict";
  var A = "/static/v3/art/";
  // the scroll's own measurements, in pixels of the 1238 px wide source picture
  var SRC = { w: 1238, top: [9, 3, 1217], paper: [49, 192, 1177, 1876], bot: [11, 1219, 149], rollerEnd: 198,
    textTop: 690, textBottom: 2000, textX: [235, 1010] };
  function pic(name, cls) {
    return '<picture><source type="image/avif" srcset="' + A + name + '-s.avif 620w, ' + A + name + '-l.avif 1240w" sizes="(max-width:600px) 92vw, 460px">' +
      '<img class="' + cls + '" src="' + A + name + '-s.webp" srcset="' + A + name + '-s.webp 620w, ' + A + name + '-l.webp 1240w" sizes="(max-width:600px) 92vw, 460px" alt="" decoding="async" draggable="false"></picture>';
  }
  function sealPic(cls) {
    return '<picture><source type="image/avif" srcset="' + A + 'seal-s.avif 160w, ' + A + 'seal-l.avif 320w" sizes="120px"><img class="' + cls +
      '" src="' + A + 'seal-s.webp" alt="" decoding="async" draggable="false"></picture>';
  }

  // the Keeper's X name, if this device signed Blinky's Book of Friends; empty otherwise
  function keeperName() {
    try {
      var c = JSON.parse(sessionStorage.getItem("pd:me") || "null");
      if (c && c.st === "confirmed" && /^[A-Za-z0-9_]{1,15}$/.test(c.h || "")) return Promise.resolve(c.h);
      var v = localStorage.getItem("pd:vid") || "";
      if (!/^[a-f0-9]{32}$/.test(v)) return Promise.resolve("");
      return fetch("/api/book/me?vid=" + v, { headers: { Accept: "application/json" } }).then(function (r) { return r.json(); })
        .then(function (j) { return j && j.status === "confirmed" && /^[A-Za-z0-9_]{1,15}$/.test(j.handle || "") ? j.handle : ""; }).catch(function () { return ""; });
    } catch (e) { return Promise.resolve(""); }
  }

  function scroll(wrap, o) {
    var gsap = window.gsap, still = !!o.still;
    wrap.innerHTML =
      '<div class="gs3" role="dialog" aria-modal="true" aria-labelledby="ave">' +
        '<div class="gs3-shadow" aria-hidden="true"></div>' +
        '<div class="gs3-paper">' + pic("scroll-paper", "gs3-paper-img") +
          '<div class="gs3-words">' + o.words +
            '<div class="gs3-pledge"><button class="gs3-hold" type="button" id="swear"><span>' + esc(o.btn) + '</span></button>' +
            '<small class="gs3-hint">' + esc(o.holdHint) + '</small>' +
            '<div class="gs3-stamp" aria-hidden="true">' + sealPic("gs3-stamp-img") + '</div></div>' +
          '</div>' +
        '</div>' +
        pic("scroll-bottom", "gs3-bot") + pic("scroll-top", "gs3-top") +
        (o.first ? '<button class="gs3-seal" type="button" id="gs3-break" aria-label="' + esc(o.breakLabel) + '">' +
          '<span class="gs3-half l">' + sealPic("") + '</span><span class="gs3-half r">' + sealPic("") + '</span></button>' +
          '<p class="gs3-tap" aria-hidden="true">' + esc(o.breakLabel) + '</p>' : '') +
      '</div>';
    wrap.hidden = false;
    var st = wrap.querySelector(".gs3"), paper = st.querySelector(".gs3-paper"), words = st.querySelector(".gs3-words"),
      top = st.querySelector(".gs3-top"), bot = st.querySelector(".gs3-bot"), shadow = st.querySelector(".gs3-shadow"),
      hold = st.querySelector("#swear"), stamp = st.querySelector(".gs3-stamp"), brk = st.querySelector("#gs3-break"),
      tap = st.querySelector(".gs3-tap");
    var geo = {}, o2 = { open: 0 }, busy = false, who = "";
    keeperName().then(function (h) { who = h; });

    function layout() {
      var W = st.clientWidth, u = W / SRC.w;
      // the paper grows taller when the words need it (long languages); the rollers keep their shape
      words.style.width = ((SRC.textX[1] - SRC.textX[0]) * u) + "px";
      words.style.left = ((SRC.textX[0] - SRC.paper[0]) * u) + "px";
      words.style.top = ((SRC.textTop - SRC.paper[1]) * u) + "px";
      var need = words.scrollHeight + (SRC.textTop - SRC.paper[1]) * u + (2068 - SRC.textBottom) * u;
      var ph = Math.max(SRC.paper[3] * u, need);
      paper.style.left = (SRC.paper[0] * u) + "px"; paper.style.top = (SRC.paper[1] * u) + "px";
      paper.style.width = (SRC.paper[2] * u) + "px"; paper.style.height = ph + "px";
      top.style.left = (SRC.top[0] * u) + "px"; top.style.top = (SRC.top[1] * u) + "px"; top.style.width = (SRC.top[2] * u) + "px";
      var botTop = SRC.paper[1] * u + ph - 6 * u;
      bot.style.left = (SRC.bot[0] * u) + "px"; bot.style.top = botTop + "px"; bot.style.width = (SRC.bot[1] * u) + "px";
      st.style.height = (botTop + SRC.bot[2] * u) + "px";
      shadow.style.top = (botTop + SRC.bot[2] * u * 0.7) + "px";
      geo = { u: u, travel: botTop - (SRC.rollerEnd - 8) * u, paperH: ph, sealY: SRC.rollerEnd * u };
      if (brk) { var s = 300 * u; brk.style.width = brk.style.height = s + "px"; brk.style.left = (W / 2 - s / 2) + "px"; brk.style.top = (geo.sealY - s * 0.42) + "px"; }
      if (tap) tap.style.top = (geo.sealY + 300 * u * 0.62) + "px";
      draw();
    }
    // one value moves the roller, the paper edge and the shadow together
    function draw() {
      var off = geo.travel * (1 - o2.open);
      gsap.set(bot, { y: -off }); gsap.set(shadow, { y: -off });
      paper.style.clipPath = "inset(0 0 " + Math.max(0, off) + "px 0)";
    }
    function unroll(delay) {
      if (still) {   // reduced motion: open at once, words shown, focus on the pledge
        o2.open = 1; draw(); gsap.set(words.children, { autoAlpha: 1, y: 0 }); gsap.set(stamp, { autoAlpha: 0 });
        setTimeout(function () { hold.focus({ preventScroll: true }); }, 30);
        return null;
      }
      return gsap.timeline({ delay: delay || 0 })
        .to(o2, { open: 1, duration: still ? 0 : 1.05, ease: "power2.inOut", onUpdate: draw })
        .to(o2, { open: 1.006, duration: still ? 0 : 0.1, ease: "power1.out", onUpdate: draw })
        .to(o2, { open: 1, duration: still ? 0 : 0.3, ease: "bounce.out", onUpdate: draw })
        .fromTo(words.children, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: still ? 0 : 0.45, stagger: still ? 0 : 0.06, ease: "power2.out" }, "-=0.2")
        .add(function () { hold.focus({ preventScroll: true }); });
    }

    layout();
    gsap.set(words.children, { autoAlpha: 0 });
    gsap.set(stamp, { autoAlpha: 0 });
    // rolled up, the scroll sits in the middle of the screen; it settles to the top as it opens
    var lift = brk && !still ? Math.max(0, Math.min(window.innerHeight * 0.32, geo.travel * 0.6)) : 0;
    gsap.set(st, { y: lift });
    if (!still) gsap.from(st, { y: lift - 40, autoAlpha: 0, duration: 0.5, ease: "back.out(1.6)" });

    if (brk) {
      gsap.set(brk, { autoAlpha: 1 });
      if (!still) gsap.from([brk, tap], { scale: 0.6, autoAlpha: 0, duration: 0.4, delay: 0.35, ease: "back.out(2)" });
      setTimeout(function () { brk.focus({ preventScroll: true }); }, still ? 0 : 500);
      brk.onclick = function () {
        if (busy) return; busy = true;
        var l = brk.querySelector(".l"), r = brk.querySelector(".r");
        gsap.timeline()
          .to(brk, { scale: 0.94, duration: still ? 0 : 0.08 })
          .to(l, { x: -30 * geo.u * 3, y: 60, rotation: -24, autoAlpha: 0, duration: still ? 0 : 0.55, ease: "power2.in" })
          .to(r, { x: 30 * geo.u * 3, y: 70, rotation: 20, autoAlpha: 0, duration: still ? 0 : 0.55, ease: "power2.in" }, "<")
          .to(tap, { autoAlpha: 0, duration: still ? 0 : 0.2 }, "<")
          .add(function () { brk.remove(); tap && tap.remove(); busy = false; unroll(0); gsap.to(st, { y: 0, duration: still ? 0 : 1.05, ease: "power2.inOut" }); }, still ? 0 : "-=0.25");
      };
    } else {
      unroll(still ? 0 : 0.35);
    }

    // press and hold to stamp the pledge
    var tw = null, done = false, ring = document.createElement("i");
    ring.className = "gs3-fill"; ring.setAttribute("aria-hidden", "true"); hold.appendChild(ring);
    gsap.set(ring, { scaleX: 0, transformOrigin: "0 50%" });
    function start(e) {
      if (busy || done) return;
      if (e.type === "keydown") { if (e.key !== "Enter" && e.key !== " ") return; if (e.repeat) return; }
      e.preventDefault();
      tw = gsap.to(ring, { scaleX: 1, duration: still ? 0.3 : 1.1, ease: "none", onComplete: sealIt });
    }
    function stop() { if (done) return; if (tw) tw.kill(); gsap.to(ring, { scaleX: 0, duration: 0.25 }); }
    hold.addEventListener("pointerdown", start); hold.addEventListener("keydown", start);
    ["pointerup", "pointerleave", "pointercancel", "keyup", "blur"].forEach(function (t) { hold.addEventListener(t, stop); });
    hold.addEventListener("click", function (e) { e.preventDefault(); });
    function sealIt() {
      done = true; busy = true; hold.disabled = true;
      gsap.timeline()
        .to([hold, st.querySelector(".gs3-hint")], { autoAlpha: 0, duration: still ? 0 : 0.15 })
        .add(function () { signName(); })
        .to({}, { duration: who && !still ? 0.95 : 0 })
        .fromTo(stamp, { autoAlpha: 0, scale: 1.8, rotation: -14 }, { autoAlpha: 1, scale: 1, rotation: -6, duration: still ? 0 : 0.28, ease: "power3.in" })
        .to(st, { x: 3, duration: 0.04, yoyo: true, repeat: still ? 0 : 3, ease: "none" })
        .to({}, { duration: still ? 0 : 0.7 })
        .to(words.children, { autoAlpha: 0, duration: still ? 0 : 0.25 })
        .to(o2, { open: 0, duration: still ? 0 : 0.8, ease: "power2.inOut", onUpdate: draw }, "<")
        .to(st, { y: -30, autoAlpha: 0, duration: still ? 0 : 0.35, ease: "power2.in" })
        .add(function () { gsap.killTweensOf([o2, st]); o.onDone(); });
    }

    // the Keeper's name writes itself under the pledge, left to right, like a pen
    function signName() {
      if (!who) return;
      var p = document.createElement("p"); p.className = "gs3-sign"; p.textContent = "@" + who;
      st.querySelector(".gs3-pledge").appendChild(p);
      if (still) return;
      gsap.fromTo(p, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.9, ease: "power1.inOut" });
    }
    wrap.onkeydown = function (e) {
      if (e.key === "Escape" && !busy) { o.onDone(); }
      if (e.key === "Tab") { e.preventDefault(); (brk && brk.isConnected ? brk : hold).focus(); }
    };
    var rs = function () { if (!wrap.hidden && st.isConnected) layout(); };
    window.addEventListener("resize", rs, { passive: true });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // a lesson passed: the egg seal stamps onto the result card
  function stamp(card, still) {
    if (!card) return;
    var s = document.createElement("div"); s.className = "g3-pass-seal"; s.setAttribute("aria-hidden", "true"); s.innerHTML = sealPic("");
    card.appendChild(s);
    if (still) return;
    window.gsap.fromTo(s, { autoAlpha: 0, scale: 1.9, rotation: -18 }, { autoAlpha: 1, scale: 1, rotation: -8, duration: 0.3, delay: 0.5, ease: "power3.in",
      onComplete: function () { window.gsap.fromTo(card, { x: -2 }, { x: 0, duration: 0.25, ease: "elastic.out(1, 0.3)" }); } });
  }
  document.documentElement.classList.add("gv3");
  window.GuardV3 = { scroll: scroll, stamp: stamp };
})();
