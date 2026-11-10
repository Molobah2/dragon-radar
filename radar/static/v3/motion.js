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
      gsap.fromTo(bg, { scale: 1.12, autoAlpha: 0 }, { scale: 1.02, autoAlpha: 1, duration: 1.6, ease: "power2.out" });
      gsap.to(bg, { scale: 1.06, xPercent: -1.2, duration: 16, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1.6 });
      gsap.from(words, { y: 22, autoAlpha: 0, duration: .8, stagger: .08, delay: .25, ease: "power3.out", clearProps: "transform" });
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

  function ready() { rooms(); autoReveal(); reveals(); holds(); tilt(); }
  v3.refresh = ready;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
})();
