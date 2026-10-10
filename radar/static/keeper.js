// My Keeper card. Personal stats live only in this browser. If the visitor types their
// X handle, their name, picture and posts come from posts the site already collected.
(() => {
  "use strict";
  const KEY = "radar:keeper";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Called by app.js the first time a post is opened
  window.keeperBump = () => {
    const s = read(), now = new Date();
    s.total = (s.total || 0) + 1;
    s.days = s.days || {};
    s.days[dayKey(now)] = (s.days[dayKey(now)] || 0) + 1;
    s.hours = s.hours || new Array(24).fill(0);
    s.hours[now.getHours()]++;
    const keys = Object.keys(s.days).sort();
    while (keys.length > 400) delete s.days[keys.shift()];
    write(s);
  };

  function stats() {
    const s = read(), days = s.days || {};
    let streak = 0;
    const d = new Date();
    if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (days[dayKey(d)]) { streak++; d.setDate(d.getDate() - 1); }
    const hours = s.hours || [];
    const band = (a, b) => hours.slice(a, b).reduce((x, y) => x + (y || 0), 0);
    const bands = [["Early Bird", band(5, 11)], ["Sun Chaser", band(11, 17)], ["Twilight Keeper", band(17, 22)],
      ["Night Owl", band(22, 24) + band(0, 5)]];
    const best = bands.sort((a, b) => b[1] - a[1])[0];
    return { today: days[dayKey()] || 0, total: s.total || 0, streak, type: best[1] ? best[0] : "Fresh Hatchling" };
  }
  const RANKS = [[500, "Elder Keeper", "Legendary"], [150, "Sky Rider", "Epic"], [50, "Ember Keeper", "Rare"],
    [10, "Egg Warden", "Uncommon"], [0, "Hatchling", "Common"]];
  const rank = (n) => RANKS.find(([min]) => n >= min);

  // ---------- drawing ----------
  const W = 2000, H = 1000, F = "FredokaCard, Fredoka, sans-serif";
  const images = {};
  const img = (src) => images[src] || (images[src] = new Promise((ok) => {
    const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src;
  }));
  // Edges are dragon scales in the colour of the card's rarity
  const RARITY = { Common: ["#9bd86f", "#5fae45"], Uncommon: ["#7fcbff", "#3a8fe0"], Rare: ["#ffa178", "#e8563a"],
    Epic: ["#c4a6ff", "#6b4fd8"], Legendary: ["#ffdb5c", "#d99a00"] };
  let EDGE = RARITY.Common;
  // Edge colours: two harmonising colours blended all the way around the card
  const PAIR = ["#14b8a6", "#ffc23d"];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (t, light = 0) => {
    const a = hex(PAIR[0]), b = hex(PAIR[1]);
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t + (255 - (v + (b[i] - v) * t)) * light));
    return `rgb(${c.join(",")})`;
  };
  const loop = (t) => 0.5 - 0.5 * Math.cos(t * Math.PI * 2);   // 0 to 1 and back, so the seam never shows
  function scales(ctx, x, y, w, h, r, size) {
    // A ring of overlapping scales just outside a rounded rectangle
    ctx.save();
    const path = new Path2D(); path.roundRect(x, y, w, h, r);
    const per = (w + h) * 2, step = size * 1.05, n = Math.floor(per / step);
    const pt = (t) => {             // walk the outline: top, right, bottom, left
      t = ((t % per) + per) % per;
      if (t < w) return [x + t, y, 0, -1];
      if (t < w + h) return [x + w, y + t - w, 1, 0];
      if (t < 2 * w + h) return [x + w - (t - w - h), y + h, 0, 1];
      return [x, y + h - (t - 2 * w - h), -1, 0];
    };
    for (let i = 0; i < n; i++) {
      const [px, py, nx, ny] = pt(i * step), th = Math.atan2(ny, nx);
      ctx.fillStyle = mix(loop(i / n), i % 2 ? 0.22 : 0);
      ctx.beginPath(); ctx.arc(px, py, size, th - Math.PI / 2, th + Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, size * 0.62, th - 1.0, th + 0.2); ctx.stroke();
    }
    ctx.restore();
  }
  function panel(ctx, x, y, w, h, r, lip = mix(0.5)) {
    // Solid lip underneath gives each panel a little depth, like a pressed button
    ctx.save();
    ctx.shadowColor = "rgba(30,40,80,.18)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
    ctx.fillStyle = lip; ctx.beginPath(); ctx.roundRect(x, y + 7, w, h, r); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#fffdf7"; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  }
  function tile(ctx, x, y, w, h, label, value, color, sub) {
    panel(ctx, x, y, w, h, 26, color);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = color; ctx.font = `700 23px ${F}`;
    ctx.fillText(label.toUpperCase(), x + w / 2, y + 44);
    let size = 62; ctx.font = `700 ${size}px ${F}`;
    while (ctx.measureText(value).width > w - 40 && size > 30) { size -= 4; ctx.font = `700 ${size}px ${F}`; }
    ctx.fillStyle = "#1f2440"; ctx.fillText(value, x + w / 2, y + (sub ? 110 : 122));
    if (sub) { ctx.font = `600 19px ${F}`; ctx.fillStyle = "#6b7290"; ctx.fillText(sub.toUpperCase(), x + w / 2, y + 143); }
  }
  function bubble(ctx, x, y, w, h, text) {
    ctx.save();
    ctx.shadowColor = "rgba(30,40,80,.25)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2);
    ctx.moveTo(x + w - 70, y + h - 6); ctx.lineTo(x + w + 28, y + h + 46); ctx.lineTo(x + w - 130, y + h - 6); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#2b2f55"; ctx.font = `600 34px ${F}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + 2);
  }

  async function draw(canvas, who) {
    const [bg, av] = await Promise.all([img("/static/keeper-bg.jpg"), img(who && who.avatar ? who.avatar : "/static/blinky-avatar.jpg"),
      document.fonts.load(`700 60px ${F}`).catch(() => {}), document.fonts.load(`600 30px ${F}`).catch(() => {})]);
    const ctx = canvas.getContext("2d"), st = stats(), [, title, rarity] = rank(st.total);
    EDGE = RARITY[rarity];
    canvas.width = W; canvas.height = H;
    if (bg) ctx.drawImage(bg, 0, 0, W, H); else { ctx.fillStyle = "#7cc8ff"; ctx.fillRect(0, 0, W, H); }

    // Card body on the left, Blinky stays visible on the right
    const X = 70, Y = 130, CW = 1200, CH = 740;
    const fg = ctx.createLinearGradient(X, Y, X + CW, Y + CH); fg.addColorStop(0, PAIR[0]); fg.addColorStop(1, PAIR[1]);
    ctx.fillStyle = fg; ctx.beginPath(); ctx.roundRect(X - 4, Y - 4, CW + 8, CH + 8, 44); ctx.fill();
    scales(ctx, X, Y, CW, CH, 40, 24);
    ctx.fillStyle = "rgba(255,251,242,.86)"; ctx.beginPath(); ctx.roundRect(X + 6, Y + 6, CW - 12, CH - 12, 36); ctx.fill();

    // Identity panel
    const IX = X + 36, IY = Y + 36, IW = 330, IH = 460;
    panel(ctx, IX, IY, IW, IH, 30);
    const cx = IX + IW / 2, cy = IY + 130, R = 92;
    for (let i = 0; i < 28; i++) {         // scale ring around the picture
      const a = i / 28 * Math.PI * 2; ctx.fillStyle = mix(loop(i / 28), i % 2 ? 0.22 : 0);
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2), 15, a - Math.PI / 2, a + Math.PI / 2); ctx.closePath(); ctx.fill();
    }
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#ffecaa"; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (av) ctx.drawImage(av, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    const name = who && who.found ? who.name : (who && who.handle ? who.handle : "A Keeper");
    let ns = 46; ctx.font = `700 ${ns}px ${F}`;
    while (ctx.measureText(name).width > IW - 40 && ns > 24) { ns -= 2; ctx.font = `700 ${ns}px ${F}`; }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#1f2440"; ctx.fillText(name, cx, IY + 290);
    ctx.font = `600 26px ${F}`; ctx.fillStyle = "#2fae5b";
    ctx.fillText(who && who.handle ? `@${who.handle}` : "of the meadow", cx, IY + 330);
    ctx.font = `700 22px ${F}`; ctx.fillStyle = "#6b7290"; ctx.fillText("RANK", cx, IY + 390);
    ctx.font = `700 40px ${F}`; ctx.fillStyle = "#ff7a3d"; ctx.fillText(title, cx, IY + 435);

    // Keeper type and rarity
    const HX = IX + IW + 30, HW = X + CW - 36 - HX;
    panel(ctx, HX, IY, HW, 110, 26);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `700 22px ${F}`; ctx.fillStyle = "#6b7290"; ctx.fillText("KEEPER TYPE", HX + 28, IY + 40);
    ctx.font = `700 46px ${F}`; ctx.fillStyle = "#1f2440"; ctx.fillText(st.type, HX + 28, IY + 90);
    const rarCol = [EDGE[1], "#ffffff"];
    ctx.font = `700 26px ${F}`;
    const rtxt = rarity.toUpperCase(), rw = ctx.measureText(rtxt).width + 40, rx = HX + HW - rw - 26;
    ctx.fillStyle = rarCol[0]; ctx.beginPath(); ctx.roundRect(rx, IY + 31, rw, 48, 24); ctx.fill();
    ctx.fillStyle = rarCol[1]; ctx.textBaseline = "middle"; ctx.fillText(rtxt, rx + 20, IY + 56);

    // Stat tiles, 3 by 2
    const TW = (HW - 2 * 20) / 3, TH = 160;
    const t1 = IY + 110 + 24, t2 = t1 + TH + 20;
    const found = who && who.found;
    tile(ctx, HX, t1, TW, TH, "Opened today", String(st.today), "#3b82f6");
    tile(ctx, HX + TW + 20, t1, TW, TH, "Day streak", `${st.streak} ${st.streak === 1 ? "day" : "days"}`, "#2fae5b");
    tile(ctx, HX + 2 * (TW + 20), t1, TW, TH, "All time", String(st.total), "#f2557a", "posts opened");
    tile(ctx, HX, t2, TW, TH, "Posts this week", found ? String(who.posts_week) : "?", "#ff7a3d", found ? "about the dragons" : "add your handle");
    const love = found && who.love !== null && who.love !== undefined;
    tile(ctx, HX + TW + 20, t2, TW, TH, "Love received", love ? String(who.love) : "?", "#8a6bff", love ? "likes, replies, reposts" : "add your handle");
    tile(ctx, HX + 2 * (TW + 20), t2, TW, TH, "Forged", new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" }), "#0ea5b7", "card date");

    // Bottom strip
    const BY = IY + IH + 24;
    panel(ctx, IX, BY, X + CW - 36 - IX, CH - (BY - Y) - 36, 26);
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `700 34px ${F}`; ctx.fillStyle = "#1f2440";
    ctx.fillText("Keep the meadow warm. Open a post, say hi, come back tomorrow.", IX + 32, BY + 60);
    ctx.font = `700 28px ${F}`; ctx.fillStyle = "#2fae5b"; ctx.fillText("dragon radar", IX + 32, BY + 128);
    ctx.textAlign = "right"; ctx.fillStyle = "#1f2440"; ctx.fillText("Jon Wynn", X + CW - 36 - 32, BY + 128);

    bubble(ctx, 1320, 120, 470, 90, "blinky remembers his friends");
    return st;
  }

  // ---------- the forging flow ----------
  const $ = (id) => document.getElementById(id);
  const open = $("keeper-open"), modal = $("keeper"), canvas = $("keeper-canvas");
  if (!open || !modal) return;
  const steps = ["Waking Blinky", "Counting your eggs", "Reading the meadow", "Hatching your card"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function stage(name) { for (const s of ["ask", "forge", "card"]) $(`keeper-${s}`).hidden = s !== name; }

  async function forge() {
    const handle = $("keeper-handle").value.trim().replace(/^@/, "");
    const s = read(); s.handle = handle; write(s);
    stage("forge");
    const list = $("keeper-steps");
    list.replaceChildren(...steps.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
    const lookup = handle ? fetch(`/api/keeper/${encodeURIComponent(handle)}`).then((r) => r.json()).catch(() => null) : Promise.resolve(null);
    for (let i = 0; i < steps.length; i++) {
      list.children[i].className = "doing";
      await sleep(i === 1 ? 900 : 650);
      list.children[i].className = "done";
    }
    const who = handle ? Object.assign({ handle }, await lookup) : null;
    await draw(canvas, who);
    stage("card");
    const st = stats();
    $("keeper-found").textContent = who && who.note ? who.note
      : handle && who && who.found && who.posts_week === "0" ? `No posts about Pocket Dragons from @${who.handle} in the last 7 days yet.` : "";
    $("keeper-save").onclick = () => canvas.toBlob((b) => {
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "keeper-card.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
    const text = `blinky remembers his friends. ${st.streak} day streak on Dragon Radar 🐉`;
    $("keeper-post").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin)}`;
  }
  function show() {
    modal.hidden = false; document.body.classList.add("modal-open");
    $("keeper-handle").value = read().handle || "";
    stage("ask"); setTimeout(() => $("keeper-handle").focus(), 50);
  }
  function hide() { modal.hidden = true; document.body.classList.remove("modal-open"); }
  open.addEventListener("click", show);
  $("keeper-go").addEventListener("click", forge);
  $("keeper-handle").addEventListener("keydown", (e) => { if (e.key === "Enter") forge(); });
  $("keeper-again").addEventListener("click", () => stage("ask"));
  for (const b of modal.querySelectorAll("[data-close]")) b.addEventListener("click", hide);
  modal.addEventListener("click", (e) => { if (e.target === modal) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) hide(); });

  // Gentle tilt and shine on the finished card
  const frame = $("keeper-frame");
  frame.addEventListener("pointermove", (e) => {
    const r = frame.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    frame.style.setProperty("--ry", `${(x - 0.5) * 8}deg`); frame.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
    frame.style.setProperty("--sx", `${x * 100}%`); frame.style.setProperty("--sy", `${y * 100}%`);
  });
  frame.addEventListener("pointerleave", () => { frame.style.setProperty("--rx", "0deg"); frame.style.setProperty("--ry", "0deg"); });
})();
