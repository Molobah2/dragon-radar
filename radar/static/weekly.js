/* This week's top posts: a shareable card drawn in the browser from the posts Keepers opened most.
   Credit to Jon Wynn sits on the card once. Avatars are skipped on purpose (they would block saving the image). */
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

  async function draw() {
    try { await document.fonts.load('700 40px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) { /* system fonts */ }
    const [bg, logo] = await Promise.all([load(cv.dataset.bg), load(cv.dataset.logo)]);
    const D = '"Fredoka", "Trebuchet MS", sans-serif', B = '"Nunito", system-ui, sans-serif';
    // background: the meadow, softened, with depth
    if (bg) ctx.drawImage(bg, 0, 0, W, H);
    else { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#7cc8ff"); g.addColorStop(1, "#5cc95a"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    const shade = ctx.createLinearGradient(0, 0, W, H); shade.addColorStop(0, "rgba(12,18,40,.55)"); shade.addColorStop(1, "rgba(12,18,40,.25)");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
    // glass panel
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    round(48, 40, W - 96, H - 80, 36); ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fill(); ctx.restore();
    const sheen = ctx.createLinearGradient(0, 40, 0, 200); sheen.addColorStop(0, "rgba(255,255,255,.9)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
    round(48, 40, W - 96, H - 80, 36); ctx.fillStyle = sheen; ctx.fill();
    // header
    if (logo) ctx.drawImage(logo, 84, 70, 74, 74);
    ctx.fillStyle = "#1d2433"; ctx.font = `700 46px ${D}`; ctx.textBaseline = "alphabetic";
    ctx.fillText("This week in the Hatchery", logo ? 176 : 84, 118);
    ctx.fillStyle = "#4a5468"; ctx.font = `700 21px ${B}`;
    ctx.fillText("Community posts Keepers opened most", logo ? 178 : 86, 150);
    // rows
    const rowY = 176, rowH = 68;
    if (!top.length) {
      ctx.fillStyle = "#4a5468"; ctx.font = `700 26px ${B}`; ctx.fillText("Quiet week so far. Go show some love!", 86, rowY + 80);
    }
    top.forEach((p, i) => {
      const y = rowY + i * (rowH + 8);
      round(78, y, W - 156, rowH, 22); ctx.fillStyle = i === 0 ? "rgba(255,210,63,.22)" : "rgba(29,36,51,.05)"; ctx.fill();
      // rank medal
      const mx = 120, my = y + rowH / 2;
      const medal = ctx.createLinearGradient(mx, my - 24, mx, my + 24);
      const tone = [["#ffe27a", "#e0a422"], ["#eef1f6", "#aab4c3"], ["#ffc9a3", "#d27c43"]][i] || ["#c9d6ff", "#6b7fd8"];
      medal.addColorStop(0, tone[0]); medal.addColorStop(1, tone[1]);
      ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.fillStyle = medal; ctx.fill();
      ctx.fillStyle = "#1d2433"; ctx.font = `700 24px ${D}`; ctx.textAlign = "center"; ctx.fillText(String(i + 1), mx, my + 8); ctx.textAlign = "left";
      // who and what
      ctx.fillStyle = "#1d2433"; ctx.font = `800 23px ${B}`;
      const name = fit(p.name || p.user, 300); ctx.fillText(name, 164, y + 29);
      const nw = ctx.measureText(name).width;
      ctx.fillStyle = "#6b7280"; ctx.font = `700 18px ${B}`; ctx.fillText(fit("@" + p.user, 220), 172 + nw, y + 29);
      ctx.fillStyle = "#374151"; ctx.font = `600 19px ${B}`; ctx.fillText(fit(clean(p.text), W - 156 - 120 - 210), 164, y + 54);
      // opens pill
      const label = `${p.opens} Keepers`;
      ctx.font = `800 18px ${B}`; const lw = ctx.measureText(label).width + 30;
      round(W - 100 - lw, y + rowH / 2 - 18, lw, 36, 18); ctx.fillStyle = "#ff7a59"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(label, W - 100 - lw + 15, y + rowH / 2 + 6);
    });
    // footer: one bold credit
    ctx.fillStyle = "#1d2433"; ctx.font = `800 20px ${B}`; ctx.fillText("Built by Jon Wynn", 86, H - 60);
    ctx.fillStyle = "#4a5468"; ctx.font = `700 19px ${B}`; ctx.textAlign = "right"; ctx.fillText("pdtools.xyz", W - 86, H - 60); ctx.textAlign = "left";
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
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  $("weekly-save").addEventListener("click", () => {
    try {
      cv.toBlob((blob) => {
        if (!blob) throw new Error("blocked");
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "pdtools-week.png";
        document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        $("weekly-msg").textContent = "Saved. Attach it to your post on X.";
      }, "image/png");
    } catch (e) { $("weekly-msg").textContent = "Long press the card to save it."; }
  });
})();
