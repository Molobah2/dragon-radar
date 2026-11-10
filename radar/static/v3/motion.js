/* pdtools v3 motion: one clock (GSAP's ticker) for every animation, so nothing fights.
   Pages opt in with data attributes; nothing here moves layout, only transform, opacity and clip-path.
   Reduced motion: everything is shown at once and nothing animates.

   data-v3-reveal          the element rises in once when it comes into view
   data-v3-hold="1200"     press and hold to confirm (ms); fires a "v3:held" event, then the normal click
   window.v3.loader.show() / .hide()   the gold mark, only for real waits (a card being made, a video saving) */
(function () {
  var root = document.documentElement;
  if (!root.classList.contains("v3") || !window.gsap) return;
  var gsap = window.gsap, ST = window.ScrollTrigger;
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (ST) gsap.registerPlugin(ST);
  gsap.defaults({ ease: "power3.out", duration: 0.6 });
  var v3 = window.v3 = { gsap: gsap, still: still };

  /* ---- reveals ---- */
  function reveals() {
    var els = gsap.utils.toArray("[data-v3-reveal]");
    if (!els.length) return;
    if (still || !ST) { gsap.set(els, { autoAlpha: 1, y: 0 }); return; }
    gsap.set(els, { autoAlpha: 0, y: 18 });
    ST.batch(els, { start: "top 92%", once: true,
      onEnter: function (b) { gsap.to(b, { autoAlpha: 1, y: 0, stagger: 0.06, overwrite: true }); } });
  }

  /* ---- hold to confirm ---- */
  function holds() {
    document.querySelectorAll("[data-v3-hold]").forEach(function (el) {
      if (el.dataset.v3HoldOn) return; el.dataset.v3HoldOn = "1";
      var ms = parseInt(el.dataset.v3Hold, 10) || 1200, fill = document.createElement("i"), tw = null, done = false;
      fill.className = "v3-hold-fill"; fill.setAttribute("aria-hidden", "true"); el.appendChild(fill);
      el.classList.add("v3-hold");
      gsap.set(fill, { scaleX: 0, transformOrigin: "0 50%" });
      function start(e) {
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        if (e.type === "keydown" && e.repeat) return;
        e.preventDefault(); done = false;
        tw = gsap.to(fill, { scaleX: 1, duration: still ? 0.01 : ms / 1000, ease: "none", onComplete: function () {
          done = true; el.dispatchEvent(new CustomEvent("v3:held", { bubbles: true }));
        } });
      }
      function stop() { if (tw) tw.kill(); if (!done) gsap.to(fill, { scaleX: 0, duration: 0.25 }); }
      el.addEventListener("pointerdown", start); el.addEventListener("keydown", start);
      ["pointerup", "pointerleave", "pointercancel", "keyup", "blur"].forEach(function (t) { el.addEventListener(t, stop); });
      el.addEventListener("click", function (e) { if (!done) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      if (!el.getAttribute("aria-description")) el.setAttribute("aria-description", "Press and hold to confirm");
    });
  }

  /* ---- the gold mark, for real waits only ---- */
  var box = null, draw = null;
  v3.loader = {
    show: function () {
      if (still || box) return;
      box = document.createElement("div"); box.className = "v3-loader"; box.setAttribute("role", "status"); box.setAttribute("aria-label", "Loading");
      box.innerHTML = '<svg viewBox="0 0 64 64"><path class="egg" d="M32 6c11 0 19 14 19 28 0 13-8 22-19 22S13 47 13 34C13 20 21 6 32 6z"/><path class="crack" d="M20 33l6 5 6-7 6 7 6-5"/></svg>';
      document.body.appendChild(box);
      var paths = box.querySelectorAll("path");
      paths.forEach(function (p) { var l = p.getTotalLength(); gsap.set(p, { strokeDasharray: l, strokeDashoffset: l }); });
      draw = gsap.timeline({ repeat: -1, repeatDelay: 0.2 })
        .to(paths[0], { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut" })
        .to(paths[1], { strokeDashoffset: 0, duration: 0.5 }, "-=0.2")
        .to(paths, { opacity: 0, duration: 0.3 }, "+=0.3")
        .set(paths, { opacity: 1 });
      gsap.from(box, { autoAlpha: 0, duration: 0.2 });
    },
    hide: function () {
      if (!box) return; var b = box; box = null;
      gsap.to(b, { autoAlpha: 0, duration: 0.25, onComplete: function () { if (draw) draw.kill(); b.remove(); } });
    }
  };

  /* ---- Feed: an opened post folds into a sealed letter and flies into the letter tray ---- */
  v3.letterAway = function (card, done) {
    var tray = document.getElementById("left"), chip = tray && tray.closest(".chip");
    if (still || !chip || !card.isConnected) { card.classList.add("leaving"); setTimeout(done, 360); return; }
    var r = card.getBoundingClientRect(), t = chip.getBoundingClientRect();
    var L = document.createElement("img");
    L.src = "/static/v3/art/letter-s.webp"; L.alt = ""; L.className = "v3-letter";
    var w = Math.min(150, r.width * 0.42);
    L.style.width = w + "px"; L.style.left = (r.left + r.width / 2 - w / 2) + "px"; L.style.top = (r.top + r.height / 2 - w * 0.37) + "px";
    document.body.appendChild(L);
    var dx = (t.left + 34) - (r.left + r.width / 2), dy = (t.top + t.height / 2) - (r.top + r.height / 2);
    gsap.timeline({ onComplete: function () { L.remove(); done(); } })
      .to(card, { scaleY: 0.12, autoAlpha: 0, duration: 0.3, ease: "power2.in", transformOrigin: "50% 50%" })
      .fromTo(L, { scale: 0.5, autoAlpha: 0, rotation: -6 }, { scale: 1, autoAlpha: 1, duration: 0.22, ease: "back.out(2)" }, 0.12)
      .to(L, { x: dx, y: dy, scale: 0.28, rotation: 10, duration: 0.6, ease: "power2.in" })
      .to(L, { autoAlpha: 0, duration: 0.12 }, "-=0.08")
      .fromTo(chip, { scale: 1 }, { scale: 1.06, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.out" }, "-=0.1");
  };

    /* ---- rooms: every page's painted room comes alive. The picture moves on its own layer
     (transform only), the dust drifts in the lamp light, the words rise in, and the room
     sinks a little as you scroll past it. Nothing here touches layout. ---- */
  var ROOMS = ".hero.room-stage, .sx-head.room, .ama-hero-main.room-ama";
  function rooms() {
    gsap.utils.toArray(ROOMS).forEach(function (el) {
      if (el.dataset.v3Room) return; el.dataset.v3Room = "1";
      if (el.matches(".room-feed")) {   // the Feed room's picture stays still (Jon, 10 Nov); only its words settle in
        if (!still) gsap.from(el.querySelectorAll("h1, .lede, .tally .chip"), { y: 16, opacity: .25, duration: .7, stagger: .06, ease: "power3.out", clearProps: "transform,opacity" });
        return;
      }
      var cs = getComputedStyle(el), bg = document.createElement("div");
      bg.className = "v3-room-bg"; bg.setAttribute("aria-hidden", "true");
      bg.style.backgroundImage = cs.backgroundImage; bg.style.backgroundPosition = cs.backgroundPosition;
      bg.style.backgroundSize = cs.backgroundSize; bg.style.backgroundRepeat = cs.backgroundRepeat;
      el.insertBefore(bg, el.firstChild); el.classList.add("v3-room-live");
      var dust = document.createElement("div"); dust.className = "v3-dust"; dust.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 14; i++) { var d = document.createElement("i"); dust.appendChild(d); }
      el.insertBefore(dust, bg.nextSibling);
      var words = el.querySelectorAll(".kick, .eyebrow, .ama-kicker, h1, .lede, p, .tally .chip, .ama-meta, .hero-go");
      if (still) return;
      gsap.fromTo(bg, { scale: 1.1 }, { scale: 1.02, duration: 1.6, ease: "power2.out" });   // the room is there from the first frame
      gsap.to(bg, { scale: 1.09, xPercent: -2, yPercent: -1, duration: 9, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1.6 });
      gsap.from(words, { y: 16, opacity: .25, duration: .7, stagger: .06, ease: "power3.out", clearProps: "transform,opacity" });   // words readable at once, then settle
      dust.querySelectorAll("i").forEach(function (d) {
        var x = gsap.utils.random(4, 96), y = gsap.utils.random(10, 95), s = gsap.utils.random(1.5, 4);
        gsap.set(d, { left: x + "%", top: y + "%", width: s, height: s, autoAlpha: 0 });
        (function drift() {
          gsap.to(d, { x: gsap.utils.random(-40, 40), y: gsap.utils.random(-60, -10), autoAlpha: gsap.utils.random(.25, .8),
            duration: gsap.utils.random(5, 9), ease: "sine.inOut", onComplete: function () {
              gsap.to(d, { autoAlpha: 0, duration: 1.4, onComplete: function () { gsap.set(d, { x: 0, y: 0 }); drift(); } }); } });
        })();
      });
      if (ST) gsap.to(bg, { yPercent: 8, ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true } });
      clip(el, bg, cs);
    });
  }

  /* ---- a room's dragon really moves: a short clip that starts on the room's own picture, plays once when the
     room is on screen and rests on its last frame. Skipped for reduced motion and data saver. ---- */
  function clip(el, bg, cs) {
    var src = el.dataset.v3Clip, c = navigator.connection;
    if (!src || still || (c && c.saveData)) return;
    var v = document.createElement("video");
    v.className = "v3-room-clip" + (/^100%/.test(cs.backgroundSize) ? " tall" : ""); v.muted = true; v.playsInline = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.preload = "auto"; v.setAttribute("aria-hidden", "true");
    v.style.objectPosition = cs.backgroundPosition; v.src = src; v.style.opacity = "0";
    bg.appendChild(v);
    function go() { v.play().then(function () { v.style.opacity = "1"; }).catch(function () { v.remove(); }); }
    v.addEventListener("ended", function () { v.pause(); }, { once: true });
    if (ST) ST.create({ trigger: el, start: "top 80%", once: true, onEnter: function () { setTimeout(go, 1200); } });
    else setTimeout(go, 1200);
  }

  /* ---- living pictures: every painted picture on a page (card art, the safety coin, the Help film poster)
     drifts slowly while it is on screen and rests when it is not, so nothing moves off screen ---- */
  var LIVE = ".sx-art .bg, .sfn-art img, .nests .nest img, .ama-thanks .ama-av img";
  function living() {
    if (still || !ST) return;
    gsap.utils.toArray(LIVE).forEach(function (img, k) {
      if (img.dataset.v3Live) return; img.dataset.v3Live = "1";
      var tw = gsap.fromTo(img, { scale: 1.02, xPercent: 0 }, { scale: 1.13, xPercent: k % 2 ? -3 : 3, yPercent: -2,
        duration: gsap.utils.random(6, 9), ease: "sine.inOut", yoyo: true, repeat: -1, paused: true });
      ST.create({ trigger: img, start: "top bottom", end: "bottom top", onToggle: function (self) { self.isActive ? tw.play() : tw.pause(); } });
    });
    // the safety coin turns and catches the light now and then
    var coin = document.querySelector(".sfn-art img");
    if (coin) gsap.to(coin, { rotation: 4, duration: 3.2, ease: "sine.inOut", yoyo: true, repeat: -1 });
  }

  /* ---- depth while scrolling: card pictures move a little slower than their cards ---- */
  function depth() {
    if (still || !ST) return;
    document.querySelectorAll(".sx-art, .sfn-art").forEach(function (box) {
      if (box.dataset.v3Depth) return; box.dataset.v3Depth = "1";
      var inner = box.querySelector("img"); if (!inner) return;
      gsap.fromTo(box, { "--py": "-14px" }, { "--py": "14px", ease: "none", scrollTrigger: { trigger: box, start: "top bottom", end: "bottom top", scrub: true } });
    });
  }

  /* ---- the room's lamp breathes: a warm light that swells and settles on every room ---- */
  function lamps() {
    if (still) return;
    document.querySelectorAll(".v3-room-live, .g3-room-live").forEach(function (el) {
      if (el.querySelector(".v3-lamp")) return;
      var l = document.createElement("div"); l.className = "v3-lamp"; l.setAttribute("aria-hidden", "true");
      var dust = el.querySelector(".v3-dust, .g3-embers"); el.insertBefore(l, dust || null);
      gsap.to(l, { opacity: .55, duration: 2.6, ease: "sine.inOut", yoyo: true, repeat: -1 });
      gsap.to(l, { scale: 1.08, duration: 4.1, ease: "sine.inOut", yoyo: true, repeat: -1 });
    });
  }

  /* ---- embers drifting up the whole page, behind everything: few, slow, and only while the tab is open ---- */
  function embers() {
    if (still || document.querySelector(".v3-page-embers") || document.querySelector(".v22-stage")) return;
    var box = document.createElement("div"); box.className = "v3-page-embers"; box.setAttribute("aria-hidden", "true");
    document.body.appendChild(box);
    var n = innerWidth < 700 ? 8 : 16;
    for (var i = 0; i < n; i++) (function (d) {
      box.appendChild(d);
      (function rise() {
        gsap.set(d, { left: gsap.utils.random(0, 100) + "%", top: "102%", y: 0, x: 0, opacity: 0, scale: gsap.utils.random(.5, 1.3) });
        gsap.to(d, { y: -innerHeight * gsap.utils.random(.5, 1.1), x: gsap.utils.random(-60, 60), opacity: gsap.utils.random(.25, .6),
          duration: gsap.utils.random(9, 16), delay: gsap.utils.random(0, 8), ease: "none",
          onComplete: function () { gsap.to(d, { opacity: 0, duration: 1, onComplete: rise }); } });
      })();
    })(document.createElement("i"));
  }

  /* ---- clicks and taps answer the finger: whatever is pressed sinks a little and springs back, gold buttons
     throw a few sparks from the exact spot, and everything else sends out a soft ring. One listener for the page,
     so buttons added later (posts, sheets) get it too. ---- */
  var PRESS = "button, .btn, .pill, .pd-s, .pd-t, .sx-card, .chip, .tab, .tabs button, .star, .nest, .maker a, .day-chip, [role=tab], [role=radio], label.toggle, .hg-main, .hg-soft, .hs-btn, .sx-others a";
  var GOLD = ".btn-go, .btn.go, .hg-main, .mk-play, .pd-s.on, .gs3-btn";
  function taps() {
    if (still || document.documentElement.dataset.v3Taps) return; document.documentElement.dataset.v3Taps = "1";
    var layer = document.createElement("div"); layer.className = "v3-taps"; layer.setAttribute("aria-hidden", "true"); document.body.appendChild(layer);
    document.addEventListener("pointerdown", function (e) {
      var el = e.target.closest && e.target.closest(PRESS); if (!el || el.disabled) return;
      var big = el.matches(".sx-card, .nest, .maker a");
      gsap.to(el, { scale: big ? .975 : .93, duration: .12, ease: "power2.out", overwrite: "auto" });
      var up = function () { gsap.to(el, { scale: 1, duration: .55, ease: "elastic.out(1.1, .45)", overwrite: "auto", clearProps: "transform" });
        el.removeEventListener("pointerup", up); el.removeEventListener("pointerleave", up); el.removeEventListener("pointercancel", up); };
      el.addEventListener("pointerup", up); el.addEventListener("pointerleave", up); el.addEventListener("pointercancel", up);
      if (el.matches(GOLD)) sparks(layer, e.clientX, e.clientY); else ring(layer, e.clientX, e.clientY, big);
    }, { passive: true });
    // keyboard: Enter or Space on a button gives the same little press
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return; var el = document.activeElement; if (!el || !el.matches || !el.matches(PRESS)) return;
      gsap.fromTo(el, { scale: .94 }, { scale: 1, duration: .5, ease: "elastic.out(1.1, .45)", overwrite: "auto", clearProps: "transform" });
    });
  }
  function sparks(layer, x, y) {
    for (var i = 0; i < 9; i++) {
      var d = document.createElement("i"); d.className = "v3-spark"; layer.appendChild(d);
      var a = Math.random() * Math.PI * 2, r = gsap.utils.random(26, 64);
      gsap.set(d, { left: x, top: y, scale: gsap.utils.random(.6, 1.2) });
      gsap.to(d, { x: Math.cos(a) * r, y: Math.sin(a) * r - 18, opacity: 0, scale: .2, duration: gsap.utils.random(.45, .75), ease: "power2.out",
        onComplete: (function (n) { return function () { n.remove(); }; })(d) });
    }
  }
  function ring(layer, x, y, big) {
    var d = document.createElement("i"); d.className = "v3-ring"; layer.appendChild(d);
    gsap.set(d, { left: x, top: y });
    gsap.fromTo(d, { scale: .2, opacity: .7 }, { scale: big ? 3.4 : 2.2, opacity: 0, duration: .55, ease: "power2.out", onComplete: function () { d.remove(); } });
  }

  /* ---- scroll reveals for the parts every page already has, so no template has to opt in ---- */
  var AUTO = ".sx-card, .ama-item, .ama-thanks, .ama-chart, .maker, .nests .nest, .hub-news, .help-card, .pv-row, .panel, .safety, .faq details, .start-here";
  function autoReveal() {
    document.querySelectorAll(AUTO).forEach(function (el) { if (!el.closest(ROOMS) && !el.hasAttribute("data-v3-reveal")) el.setAttribute("data-v3-reveal", ""); });
  }

  /* ---- cards lean toward the pointer a little (pointer devices only) ---- */
  function tilt() {
    if (still || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.querySelectorAll(".sx-card, .maker, .nests .nest").forEach(function (el) {
      if (el.dataset.v3Tilt) return; el.dataset.v3Tilt = "1";
      var rx = gsap.quickTo(el, "rotationX", { duration: .5 }), ry = gsap.quickTo(el, "rotationY", { duration: .5 });
      gsap.set(el, { transformPerspective: 800 });
      el.addEventListener("pointermove", function (e) { var r = el.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - .5) * 6); rx(-((e.clientY - r.top) / r.height - .5) * 6); });
      el.addEventListener("pointerleave", function () { rx(0); ry(0); });
    });
  }

  function ready() { rooms(); lamps(); autoReveal(); reveals(); holds(); tilt(); living(); depth(); embers(); taps(); }
  v3.refresh = ready;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
})();
