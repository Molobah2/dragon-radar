/* The realistic meadow: four matching renders (night, dawn, day, dusk) that cross fade with the
   visitor's clock, plus a short living video loop for the opening. Built to stay light:
   - after the intro only tiny pre-blurred images are shown (no live CSS blur, no video decoding)
   - sharp images and the video load only while the clear scene is on screen
   - phones and data saver get smaller files, reduced motion gets no video */
(() => {
  "use strict";
  const cfg = window.RADAR_SCENE;
  if (!cfg || !cfg.base) return;
  const root = document.getElementById("photo");
  if (!root) return;

  const PHASES = ["night", "dawn", "day", "dusk"];
  // hour -> which render is showing; neighbours blend linearly
  const KEYS = [[0, "night"], [4.9, "night"], [5.9, "dawn"], [7.3, "day"], [16.7, "day"], [18.0, "dusk"], [19.4, "night"], [24, "night"]];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const conn = navigator.connection || {};
  const lean = !!conn.saveData || /2g$/.test(conn.effectiveType || "");       // smallest video
  const mid = conn.effectiveType === "3g";                                     // video and images, but smaller
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const sharpW = Math.min(2560, Math.ceil(Math.max(screen.width, screen.height) * dpr / 320) * 320) || 1920;
  const ver = cfg.ver ? `v${cfg.ver}/` : "";   // bump SCENE_VERSION after replacing art so every cache refreshes
  const img = (ph, t) => `${cfg.base}/image/upload/${t}/f_auto/q_auto${t.includes("e_blur") ? ":eco" : ""}/${ver}${cfg.folder}/meadow-${ph}`;
  const SOFT = (ph) => img(ph, "c_scale,w_640/e_blur:1400");
  const SHARP = (ph) => img(ph, `c_scale,w_${lean || mid ? Math.min(1280, sharpW) : sharpW}`);

  const layers = {};
  for (const ph of PHASES) {
    const soft = document.createElement("div"); soft.className = "ph soft";
    const sharp = document.createElement("div"); sharp.className = "ph sharp";
    root.append(soft, sharp);
    layers[ph] = { soft, sharp, softSet: false, sharpSet: false };
  }
  const video = document.createElement("video");
  Object.assign(video, { muted: true, playsInline: true, loop: true, preload: "none" });
  video.setAttribute("muted", ""); video.setAttribute("playsinline", ""); video.className = "ph clip";
  root.append(video);

  function weights(h) {
    let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
    const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
    const f = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
    const w = { night: 0, dawn: 0, day: 0, dusk: 0 };
    w[a] += 1 - f; w[b] += f;
    return w;
  }

  let sharpOn = false, current = null, lastW = null;
  function apply(w) {
    // the earlier layer in paint order shows fully, the later one fades in on top: an exact cross fade
    const live = PHASES.filter((p) => w[p] > 0.001);
    for (const ph of PHASES) {
      const L = layers[ph], on = live.includes(ph);
      const op = !on ? 0 : (live.length === 1 || ph === live[0] ? 1 : w[ph]);
      if (on && !L.softSet) { L.soft.style.backgroundImage = `url("${SOFT(ph)}")`; L.softSet = true; }
      if (on && sharpOn && !L.sharpSet) { L.sharp.style.backgroundImage = `url("${SHARP(ph)}")`; L.sharpSet = true; }
      L.soft.style.opacity = op; L.sharp.style.opacity = op;
    }
    const top = live.reduce((a, b) => (w[b] > w[a] ? b : a), live[0]);
    current = top;
  }

  function wantClip() {
    return sharpOn && !reduce && !window.PD_LITE && cfg.video && cfg.video[current] && !document.body.classList.contains("lapse");
  }
  function syncVideo() {
    if (wantClip()) {
      const src = `${cfg.base}/video/upload/c_scale,w_${Math.min(lean ? 720 : mid ? 1280 : 1600, sharpW)}/f_auto:video/q_auto/${ver}${cfg.folder}/${cfg.video[current]}`;
      if (video.dataset.src !== src) { video.dataset.src = src; video.src = src; video.classList.remove("on"); }
      const p = video.play(); if (p && p.catch) p.catch(() => {});
    } else {
      video.classList.remove("on");
      if (!video.paused) setTimeout(() => { if (!wantClip()) video.pause(); }, 900);
    }
  }
  video.addEventListener("playing", () => { if (wantClip()) video.classList.add("on"); });

  function setSharp(on) {
    if (on === sharpOn) return;
    sharpOn = on;
    root.classList.toggle("sharp-on", on);
    if (lastW) apply(lastW);
    syncVideo();
  }

  // the clear scene shows during the opening and while a day plays; otherwise the soft one
  const body = document.body;
  const watch = () => setSharp(!body.classList.contains("ready") || body.classList.contains("lapse"));
  new MutationObserver(watch).observe(body, { attributes: true, attributeFilter: ["class"] });

  // phones pause videos when you switch apps or come back with the back button: pick it up again
  const nudge = () => { if (!document.hidden && wantClip() && video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); } };
  document.addEventListener("visibilitychange", nudge);
  addEventListener("pageshow", nudge);
  ["pointerdown", "touchstart"].forEach((ev) => addEventListener(ev, nudge, { passive: true }));

  window.radarScene = {
    update(hour) {
      const w = weights(hour);
      const changed = !lastW || PHASES.some((p) => Math.abs(w[p] - lastW[p]) > 0.002);
      const prev = current;
      if (changed) { lastW = w; apply(w); }
      if (current !== prev) syncVideo();
    },
  };
  // first paint: show the right render straight away, before the canvas starts ticking
  const d = new Date(), forced = parseFloat(new URLSearchParams(location.search).get("hour"));
  let skyMode = "auto";
  try { skyMode = localStorage.getItem("pd:sky") || "auto"; } catch (e) { /* private mode */ }
  const first = !isNaN(forced) ? ((forced % 24) + 24) % 24 : skyMode === "day" ? 12.5 : skyMode === "night" ? 23.5 : d.getHours() + d.getMinutes() / 60;
  window.radarScene.update(first);
  watch();
})();
