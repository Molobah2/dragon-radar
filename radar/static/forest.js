/* pdtools home: Blinky walks out of his hut once, then a calm loop plays.
   Kept light: a tiny blurred still paints first, the sharp still and videos load after,
   the loop pauses when the tab is hidden and always picks up again when the visitor comes back
   (back button, app switch, phone low power autoplay blocks: the first touch or scroll restarts it).
   Data saver gets a smaller video; only reduced motion gets the still alone. */
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
  const vidW = Math.min(lean ? 720 : mid ? 1280 : 1920, want);
  const path = (name) => `v${cfg.ver}/${cfg.folder}/${name}`;
  const img = (name) => `${cfg.base}/image/upload/c_scale,w_${imgW}/f_auto/q_auto/${path(name)}`;
  const vid = (name) => `${cfg.base}/video/upload/ac_none,c_scale,w_${vidW}/f_auto:video/q_auto/${path(name)}`;

  let seen = false;
  try { seen = sessionStorage.getItem("pd:walked") === "1"; } catch (e) { /* private mode */ }
  const motion = !reduce && !window.PD_LITE;
  for (const v of [intro, loop]) { v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); }
  let stage = null;   // "intro" or "loop": the video that should be moving right now
  let far = false;
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
    looping = true; stage = "loop";
    if (!loop.src) { loop.preload = "auto"; loop.src = vid(cfg.loop); }
    loop.addEventListener("playing", () => {
      loop.classList.add("on");
      intro.classList.remove("on");
      if (far) loop.pause();
      // the intro is done with: free its decoder
      setTimeout(() => { intro.removeAttribute("src"); intro.load(); }, 1000);
    }, { once: true });
    play(loop);
  }

  if (playIntro) {
    stage = "intro";
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

  // keep it moving: whatever should be playing gets a gentle nudge whenever the page is back in view
  // down at the tools the loop rests on its frame (no decoding under the glass), back at the top it moves
  function nudge() {
    if (document.hidden || !motion) return;
    if (far && stage === "loop") return;
    if (stage === "intro" && intro.paused && !intro.ended) play(intro);
    else if (stage === "loop" && loop.paused) play(loop);
    else if (!stage) startLoop();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (stage === "loop") loop.pause(); else if (stage === "intro") intro.pause(); }
    else nudge();
  });
  addEventListener("pageshow", nudge);        // coming back with the back button (page kept in memory)
  addEventListener("focus", nudge);
  ["pointerdown", "touchstart", "scroll"].forEach((ev) => addEventListener(ev, nudge, { passive: true }));
  setInterval(nudge, 3000);                   // last safety net, costs nothing while it is playing

  // the scene dims a little as the tool cards scroll over it
  let tick = false, dimNow = "";
  function onScroll() {
    tick = false;
    const d = Math.min(0.45, scrollY / (innerHeight * 1.6)).toFixed(2);
    if (d !== dimNow) { dimNow = d; root.style.setProperty("--dim", d); }
    const f = scrollY > innerHeight * 0.55;
    if (f !== far) {
      far = f;
      if (far && stage === "loop") loop.pause();
      else if (!far) nudge();
    }
  }
  addEventListener("scroll", () => {
    if (tick) return;
    tick = true;
    requestAnimationFrame(onScroll);
  }, { passive: true });
  onScroll();
})();
