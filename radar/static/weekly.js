/* This week's top posts: a shareable card drawn in the browser from the posts Keepers opened most.
   The board is a 3D render; the names and posts are written onto its plates live. Avatars are skipped on purpose (they would block saving the image). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cv = $("weekly-canvas"), wrap = $("weekly");
  if (!cv || !wrap) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  let top = [];

  const load = (src) => new Promise((res) => {
    if (!src) return res(null);
    const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
  });
  const decoder = document.createElement("textarea");
  const clean = (t) => { decoder.innerHTML = t || ""; return decoder.value.replace(/https:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim(); };
  function round(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fit(text, max) { if (ctx.measureText(text).width <= max) return text; let t = text; while (t.length && ctx.measureText(t + "...").width > max) t = t.slice(0, -1); return t.trimEnd() + "..."; }

  // where the plates sit on the 3D board (measured on the 1200 x 675 artwork)
  const TITLE = { x0: 521, x1: 1051, y0: 80, y1: 143 };
  const ROWS = [185, 266, 345, 425, 504].map((y0) => ({ x0: 579, x1: 1051, y0, y1: y0 + 47 }));
  const MEDAL_X = 534;
  const INK = "#3a2412", INK_SOFT = "#6b4a2b";

  function engraved(text, x, y, color) {
    ctx.fillStyle = "rgba(255,248,230,.85)"; ctx.fillText(text, x, y + 1.2);   // light catch below the cut
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  async function draw() {
    try { await document.fonts.load('700 40px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) { /* system fonts */ }
    const bg = await load(cv.dataset.bg);
    const D = '"Fredoka", "Trebuchet MS", sans-serif', B = '"Nunito", system-ui, sans-serif';
    ctx.setTransform(W / 1200, 0, 0, H / 675, 0, 0);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    if (bg) ctx.drawImage(bg, 0, 0, 1200, 675);
    else {
      const g = ctx.createLinearGradient(0, 0, 0, 675); g.addColorStop(0, "#2f5a33"); g.addColorStop(1, "#14301a"); ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 675);
      [TITLE, ...ROWS].forEach((r) => { round(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 12); ctx.fillStyle = "#f3e6c8"; ctx.fill(); });
    }
    // title plaque
    const cx = (TITLE.x0 + TITLE.x1) / 2;
    ctx.textAlign = "center";
    ctx.font = `700 30px ${D}`; engraved("This week in the Hatchery", cx, TITLE.y0 + 35, INK);
    ctx.font = `800 13.5px ${B}`; engraved("COMMUNITY POSTS KEEPERS OPENED MOST", cx, TITLE.y0 + 54, INK_SOFT);
    ctx.textAlign = "left";
    if (!top.length) {
      const r = ROWS[0];
      ctx.font = `800 18px ${B}`; engraved("Quiet week so far. Go show some love!", r.x0 + 18, r.y0 + 30, INK);
    }
    top.forEach((p, i) => {
      const r = ROWS[i]; if (!r) return;
      // rank number stamped into the coin
      const my = (r.y0 + r.y1) / 2;
      ctx.textAlign = "center"; ctx.font = `700 26px ${D}`;
      if (i < 3) {   // stamped into the metal: dark cut with a bright lip
        ctx.fillStyle = "rgba(255,255,240,.8)"; ctx.fillText(String(i + 1), MEDAL_X, my + 10.5);
        ctx.fillStyle = ["#6b4500", "#4a5260", "#5a2a0e"][i]; ctx.fillText(String(i + 1), MEDAL_X, my + 9);
      } else {
        ctx.fillStyle = "rgba(0,40,20,.6)"; ctx.fillText(String(i + 1), MEDAL_X + 1, my + 10);
        ctx.fillStyle = "#fffaf0"; ctx.fillText(String(i + 1), MEDAL_X, my + 9);
      }
      ctx.textAlign = "left";
      // opens, right side
      const label = `${p.opens} ${p.opens === 1 ? "Keeper" : "Keepers"}`;
      ctx.font = `800 13px ${B}`; const lw = ctx.measureText(label).width;
      const px = r.x1 - 16 - lw;
      ctx.fillStyle = "#c2410c"; ctx.fillText(label, px, r.y0 + 21);
      // who
      const left = r.x0 + 18;
      ctx.font = `700 20px ${D}`; const name = fit(p.name || p.user, 240);
      ctx.fillStyle = "rgba(255,248,230,.9)"; ctx.fillText(name, left, r.y0 + 22.5);
      ctx.fillStyle = "#24120a"; ctx.fillText(name, left, r.y0 + 21);
      ctx.lineWidth = 0.6; ctx.strokeStyle = "#24120a"; ctx.strokeText(name, left, r.y0 + 21);   // a touch heavier than the font's boldest
      const nw = ctx.measureText(name).width;
      ctx.font = `700 12px ${B}`; engraved(fit("@" + p.user, Math.max(40, px - left - nw - 22)), left + nw + 8, r.y0 + 21, INK_SOFT);
      // what
      ctx.font = `600 13px ${B}`; engraved(fit(clean(p.text), r.x1 - left - 18), left, r.y0 + 39, "#4a3420");
    });
    // address, small and quiet on the ground under the board
    ctx.textAlign = "center"; ctx.font = `800 15px ${B}`;
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillText("pdtools.xyz", cx, 653);
    ctx.fillStyle = "#fff4d6"; ctx.fillText("pdtools.xyz", cx, 652);
    ctx.textAlign = "left";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  async function open() {
    wrap.hidden = false; requestAnimationFrame(() => wrap.classList.add("open")); document.body.classList.add("sheet-open");
    $("weekly-msg").textContent = "Drawing the card...";
    try {
      const r = await fetch("/api/posts?range=7d&who=community&quotes=1");
      const j = await r.json();
      top = (j.posts || []).filter((p) => p.opens > 0).sort((a, b) => b.opens - a.opens || (a.t < b.t ? 1 : -1)).slice(0, 5);
    } catch (e) { top = []; }
    await draw();
    $("weekly-msg").textContent = "";
    const text = "This week in the Pocket Dragons Hatchery \u{1F409} the community posts Keepers loved most. See them all at pdtools.xyz";
    $("weekly-post").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  }
  function close() { wrap.classList.remove("open"); document.body.classList.remove("sheet-open"); setTimeout(() => { if (!wrap.classList.contains("open")) wrap.hidden = true; }, 250); }
  $("weekly-open").addEventListener("click", open);
  $("weekly-close").addEventListener("click", close);
  const track = (kind) => { try { window.pdTrack && window.pdTrack(kind, "weekly"); } catch (e) {} };
  $("weekly-post").addEventListener("click", () => track("share"));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  $("weekly-save").addEventListener("click", () => {
    try {
      cv.toBlob((blob) => {
        if (!blob) throw new Error("blocked");
        track("save");
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pdtools-week.png";
        document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        $("weekly-msg").textContent = "Saved. Attach it to your post on X.";
      }, "image/png");
    } catch (e) { $("weekly-msg").textContent = "Long press the card to save it."; }
  });
})();
