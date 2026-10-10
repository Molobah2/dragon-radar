// My Keeper card: personal stats kept only in this browser, drawn onto the 3D Hatchery scene.
(() => {
  "use strict";
  const KEY = "radar:keeper";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Called by app.js every time a post is opened for the first time
  window.keeperBump = () => {
    const s = read();
    s.total = (s.total || 0) + 1;
    s.days = s.days || {};
    const k = dayKey();
    s.days[k] = (s.days[k] || 0) + 1;
    const keys = Object.keys(s.days).sort();           // keep about a year of days
    while (keys.length > 400) delete s.days[keys.shift()];
    write(s);
  };

  function stats() {
    const s = read(), days = s.days || {};
    let streak = 0;
    const d = new Date();
    if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);    // today not started yet keeps yesterday's streak
    while (days[dayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
    return { today: days[dayKey()] || 0, total: s.total || 0, streak };
  }
  const RANKS = [[500, "Elder Keeper"], [150, "Sky Rider"], [50, "Ember Keeper"], [10, "Egg Warden"], [0, "Hatchling"]];
  const rank = (n) => RANKS.find(([min]) => n >= min)[1];

  // ---------- drawing ----------
  const W = 2000, H = 1000;
  let bg = null;
  const loadBg = () => bg ? Promise.resolve(bg) : new Promise((ok, fail) => {
    const im = new Image(); im.onload = () => ok(bg = im); im.onerror = fail; im.src = "/static/keeper-bg.jpg";
  });
  const F = "FredokaCard, Fredoka, sans-serif";
  function sticker(ctx, x, y, w, h, r, fill, rot) {
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot);
    ctx.shadowColor = "rgba(30,40,80,.28)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14, r + 7); ctx.fill();
    ctx.shadowColor = "transparent";
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.beginPath(); ctx.roundRect(-w / 2 + 12, -h / 2 + 10, w - 24, h * 0.32, r * 0.7); ctx.fill();
    return () => ctx.restore();
  }
  function bubble(ctx, x, y, w, h, text) {
    ctx.save();
    ctx.shadowColor = "rgba(30,40,80,.25)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2);
    ctx.moveTo(x + w - 70, y + h - 6); ctx.lineTo(x + w + 28, y + h + 46); ctx.lineTo(x + w - 130, y + h - 6); ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#2b2f55"; ctx.font = `600 38px ${F}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + 2);
    ctx.restore();
  }
  async function draw(canvas) {
    await Promise.all([loadBg(), document.fonts.load(`700 120px ${F}`), document.fonts.load(`600 40px ${F}`)]).catch(() => {});
    const ctx = canvas.getContext("2d"), st = stats(), title = rank(st.total);
    canvas.width = W; canvas.height = H;
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = "#7cc8ff"; ctx.fillRect(0, 0, W, H); }

    // Tag sticker
    ctx.font = `700 30px ${F}`;
    const tag = "MY KEEPER CARD", tw = ctx.measureText(tag).width + 60;
    let done = sticker(ctx, 110, 92, tw, 64, 32, ["#ff8a68", "#ff5f8f"], -0.035);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(tag, 0, 2); done();

    // Rank title, chunky white with a coral outline
    let size = 136; ctx.font = `700 ${size}px ${F}`;
    while (ctx.measureText(title).width > 1080 && size > 70) { size -= 4; ctx.font = `700 ${size}px ${F}`; }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
    ctx.save(); ctx.shadowColor = "rgba(40,30,90,.35)"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 12;
    ctx.lineWidth = 26; ctx.strokeStyle = "#6b4fd8"; ctx.strokeText(title, 110, 320); ctx.restore();
    ctx.lineWidth = 12; ctx.strokeStyle = "#ffffff"; ctx.strokeText(title, 110, 320);
    const tg = ctx.createLinearGradient(0, 320 - size * 0.75, 0, 320);
    tg.addColorStop(0, "#ffe46b"); tg.addColorStop(1, "#ff9d3d");
    ctx.fillStyle = tg; ctx.fillText(title, 110, 320);

    // Three stat stickers
    const tiles = [[st.today, "opened today", ["#4fb3ff", "#3b82f6"], -0.03], [st.total, "all time", ["#ff8a68", "#f2557a"], 0.025],
      [st.streak, "day streak", ["#7ee07a", "#2fae5b"], -0.02]];
    tiles.forEach(([n, label, fill, rot], i) => {
      const x = 110 + i * 300, y = 410;
      const end = sticker(ctx, x, y, 262, 200, 40, fill, rot);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#fff";
      ctx.font = `700 ${String(n).length > 3 ? 80 : 100}px ${F}`; ctx.fillText(String(n), 0, 22);
      ctx.font = `600 30px ${F}`; ctx.fillText(label, 0, 70);
      end();
    });

    // Blinky speaks
    bubble(ctx, 900, 150, 560, 96, "blinky remembers his friends");

    // Footer: site and credit
    ctx.font = `700 28px ${F}`;
    const site = "dragon radar", sw = ctx.measureText(site).width + 52;
    done = sticker(ctx, 110, 880, sw, 58, 29, ["#ffffff", "#f3f7ff"], 0);
    ctx.fillStyle = "#2fae5b"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(site, 0, 2); done();
    ctx.save(); ctx.font = `700 30px ${F}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#fff"; ctx.fillText("Jon Wynn", W - 60, H - 46); ctx.restore();
    return st;
  }

  // ---------- modal ----------
  const $ = (id) => document.getElementById(id);
  const open = $("keeper-open"), modal = $("keeper"), canvas = $("keeper-canvas");
  if (!open || !modal) return;
  async function show() {
    modal.hidden = false; document.body.classList.add("modal-open");
    const st = await draw(canvas);
    $("keeper-save").onclick = () => canvas.toBlob((b) => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "keeper-card.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
    const text = `blinky remembers his friends. ${st.today} opened today, ${st.streak} day streak on Dragon Radar 🐉`;
    $("keeper-post").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin)}`;
  }
  function hide() { modal.hidden = true; document.body.classList.remove("modal-open"); }
  open.addEventListener("click", show);
  $("keeper-close").addEventListener("click", hide);
  modal.addEventListener("click", (e) => { if (e.target === modal) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) hide(); });
})();
