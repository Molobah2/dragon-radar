/* The suggestions mailbox: a real photo at rest, and a short 5 second clip when someone hovers
   (flag up, lid opens, a letter flies out). The clip only downloads on first hover. */
(() => {
  "use strict";
  const box = document.querySelector(".mailbox");
  const clip = box && box.querySelector(".mb-clip");
  if (!clip || !clip.dataset.src) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const conn = navigator.connection || {};
  if (reduce || conn.saveData) return;

  let busy = false;
  const stop = () => { box.classList.remove("playing"); busy = false; };
  function go() {
    if (busy) return;
    busy = true;
    if (!clip.src) { clip.preload = "auto"; clip.src = clip.dataset.src; }
    try { clip.currentTime = 0; } catch (e) { /* not ready yet */ }
    const p = clip.play();
    if (p && p.catch) p.catch(stop);
  }
  clip.addEventListener("playing", () => box.classList.add("playing"));
  clip.addEventListener("ended", stop);
  clip.addEventListener("error", stop);
  box.addEventListener("mouseenter", go);
  box.addEventListener("focus", go);
  // warm the clip up when the pointer gets close, so the hover starts instantly
  box.addEventListener("pointerenter", () => { if (!clip.src) { clip.preload = "auto"; clip.src = clip.dataset.src; } }, { once: true });
  // phones have no hover: play it once a little after the page settles
  if (matchMedia("(hover: none)").matches) setTimeout(go, 6000);
})();
