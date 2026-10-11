/* pdtools home: Blinky walks out of his hut once, then a calm loop plays.
   Kept light: a tiny blurred still paints first, the sharp still and videos load after,
   the loop pauses when the tab is hidden, and data saver or reduced motion get the still only. */
(() => {
  "use strict";
  const cfg = window.PD_FOREST;
  const $ = (id) => document.getElementById(id);
  const sharp = $("f-sharp"), intro = $("f-intro"), loop = $("f-loop"), root = $("forest");
  if (!cfg || !root) return;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const conn = navigator.connection || {};
  const lean = !!conn.saveData || /2g$/.test(conn.effectiveType || "");
  const mid = conn.effectiveType === "3g";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const want = Math.ceil(Math.max(screen.width, screen.height) * dpr / 320) * 320 || 1920;
  const imgW = Math.min(lean || mid ? 1280 : 2560, want);
  const vidW = Math.min(mid ? 1280 : 1920, want);
  const path = (name) => `v${cfg.ver}/${cfg.folder}/${name}`;
  const img = (name) => `${cfg.base}/image/upload/c_scale,w_${imgW}/f_auto/q_auto/${path(name)}`;
  const vid = (name) => `${cfg.base}/video/upload/ac_none,c_scale,w_${vidW}/f_auto:video/q_auto/${path(name)}`;

  let seen = false;
  try { seen = sessionStorage.getItem("pd:walked") === "1"; } catch (e) { /* private mode */ }
  const motion = !reduce && !lean;
  const playIntro = motion && !seen && cfg.intro;

  // sharp still: the doorway frame when the walk out is about to play, otherwise Blinky ready at the door
  // (the doorway frame is the intro's own first frame, so the hand over is invisible)
  const doorway = `${cfg.base}/video/upload/so_0,c_scale,w_${Math.min(1920, imgW)}/q_auto/${path(cfg.intro)}.jpg`;
  const pic = new Image();
  pic.decoding = "async";
  pic.onload = () => { sharp.style.backgroundImage = `url("${pic.src}")`; sharp.classList.add("on"); };
  pic.onerror = () => { if (pic.src !== img(cfg.still)) pic.src = img(cfg.still); };
  pic.src = playIntro ? doorway : img(cfg.still);

  const play = (v) => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
  let looping = false;
  function startLoop() {
    if (looping || !motion || !cfg.loop) return;
    looping = true;
    if (!loop.src) { loop.preload = "auto"; loop.src = vid(cfg.loop); }
    loop.addEventListener("playing", () => {
      loop.classList.add("on");
      intro.classList.remove("on");
      // the intro is done with: free its decoder
      setTimeout(() => { intro.removeAttribute("src"); intro.load(); }, 1000);
    }, { once: true });
    play(loop);
  }

  if (playIntro) {
    intro.preload = "auto";
    intro.src = vid(cfg.intro);
    intro.addEventListener("playing", () => {
      intro.classList.add("on");
      try { sessionStorage.setItem("pd:walked", "1"); } catch (e) { /* ignore */ }
      new Image().src = img(cfg.still);
      // warm up the loop while he walks
      if (cfg.loop && !loop.src) { loop.preload = "auto"; loop.src = vid(cfg.loop); }
    }, { once: true });
    intro.addEventListener("ended", () => {
      // hold on the last frame (same as the still) until the loop is ready
      sharp.style.backgroundImage = `url("${img(cfg.still)}")`;
      startLoop();
    });
    intro.addEventListener("error", startLoop);
    play(intro);
    // if autoplay is blocked, still end up on the calm scene
    setTimeout(() => { if (intro.paused && !intro.ended && intro.currentTime === 0) { pic.src = img(cfg.still); startLoop(); } }, 4000);
  } else if (motion) {
    // a short pause so the page itself paints first
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(startLoop);
  }

  document.addEventListener("visibilitychange", () => {
    if (!looping) return;
    if (document.hidden) loop.pause(); else play(loop);
  });

  // the scene dims a little as the tool cards scroll over it
  let tick = false;
  addEventListener("scroll", () => {
    if (tick) return;
    tick = true;
    requestAnimationFrame(() => {
      tick = false;
      root.style.setProperty("--dim", Math.min(0.45, scrollY / (innerHeight * 1.6)).toFixed(3));
    });
  }, { passive: true });
})();
