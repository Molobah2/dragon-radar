/* Daily goal card (v2): finish the daily goal, pick a Blinky pose, a scene and a colour, and post a card
   that shows your day. Twelve poses (official Blinky, used with the team's permission), eight scenes and six
   colours are drawn here in code, so every card is sharp and no two days need to look the same.
   Poses unlock as you hatch more eggs: four to start, one more every five eggs. Everything stays on this device. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const sheetEl = $("daycard");
  if (!sheetEl) return;
  const BASE = (window.RADAR_SCENE && window.RADAR_SCENE.base) || "https://res.cloudinary.com/gosbi0oh";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const GOAL = (() => { try { return JSON.parse($("radar-data").textContent).goal || 20; } catch (e) { return 20; } })();
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayGap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  // ---------- the poses, in unlock order ----------
  const POSES = [
    ["wave", "Hello there", "1791838002"], ["cheer", "Goal crushed", "1791837929"], ["wink", "Thumbs up", "1791837934"],
    ["mug", "Morning sip", "1791838008"], ["hatch", "Fresh hatch", "1791837936"], ["read", "Story time", "1791837932"],
    ["heart", "Big love", "1791838076"], ["fly", "Up and away", "1791838007"], ["dance", "Happy dance", "1791838080"],
    ["phone", "Posting", "1791838082"], ["sleep", "Well earned nap", "1791838004"], ["trophy", "Champion", "1791838078"],
  ].map(([id, name, v]) => ({ id, name, v }));
  const START = 4, EVERY = 5;
  const art = (p, w) => `${BASE}/image/upload/c_scale,w_${w}/f_png/v${p.v}/dragon-radar/blinky/${p.id}.png`;

  // ---------- scenes and colours ----------
  // painted scene plates (Higgsfield, dragon-radar/scenes/<id>); the coded sky below stays as a fallback
  const PLATES = { meadow: "v1791858736", night: "v1791858738", lavender: "v1791858740", ocean: "v1791858742",
    forest: "v1791858767", candy: "v1791858770", ember: "v1791858772", golden: "v1791858774" };
  const plate = (id, w) => PLATES[id] ? `${BASE}/image/upload/c_fill,w_${w},h_${Math.round(w * 9 / 16)},q_auto:good,f_jpg/${PLATES[id]}/dragon-radar/scenes/${id}` : "";
  // deep, rich skies so every card looks premium; the light lives in the glow around Blinky
  const SCENES = [
    { id: "meadow", name: "Sunrise meadow", sky: ["#ffc88e", "#d9705e", "#3b2466"], glow: "rgba(255, 226, 160, .8)", hills: ["#3f8a4f", "#2a6a3c"], dots: "rgba(255,255,255,.55)" },
    { id: "night", name: "Starry night", sky: ["#2a2f6e", "#161a44", "#0b0d26"], glow: "rgba(170, 190, 255, .5)", hills: ["#232a5e", "#161c46"], dots: "rgba(255,255,255,.95)", stars: true },
    { id: "lavender", name: "Lavender dream", sky: ["#c7a8ff", "#7a4fd6", "#281458"], glow: "rgba(240, 220, 255, .7)", dots: "rgba(255,255,255,.6)", bokeh: true },
    { id: "ocean", name: "Ocean breeze", sky: ["#9fe3f5", "#2a8cbf", "#0c355f"], glow: "rgba(230, 250, 255, .7)", waves: ["#2f9ccc", "#1d76a8", "#12507e"], dots: "rgba(255,255,255,.7)" },
    { id: "forest", name: "Forest glade", sky: ["#cdebb0", "#4a955a", "#14392a"], glow: "rgba(255, 245, 190, .75)", hills: ["#2f7444", "#1d5232"], dots: "rgba(255,255,210,.7)", rays: true },
    { id: "candy", name: "Candy clouds", sky: ["#ffc1df", "#d877b0", "#4d3290"], glow: "rgba(255, 240, 250, .75)", clouds: true, dots: "rgba(255,255,255,.75)" },
    { id: "ember", name: "Ember hearth", sky: ["#ffba74", "#d34f2c", "#36091c"], glow: "rgba(255, 205, 130, .8)", dots: "rgba(255,200,120,.8)", bokeh: true },
    { id: "golden", name: "Golden hour", sky: ["#ffe29a", "#df9a26", "#5e2e0e"], glow: "rgba(255, 248, 215, .85)", dots: "rgba(255,255,255,.7)", rays: true },
  ];
  const TONES = [
    { id: "gold", name: "Gold", a: "#ffd35a", b: "#f0a020", ink: "#3a2400" },
    { id: "rose", name: "Rose", a: "#ff9ec7", b: "#e5578f", ink: "#3d0a22" },
    { id: "mint", name: "Mint", a: "#9df0c8", b: "#2fbf86", ink: "#063a26" },
    { id: "sky", name: "Sky", a: "#9fd8ff", b: "#3b8de0", ink: "#06274a" },
    { id: "violet", name: "Violet", a: "#c9b2ff", b: "#7a55e8", ink: "#1e0f4d" },
    { id: "pearl", name: "Pearl", a: "#ffffff", b: "#cfd6e6", ink: "#1d2433" },
  ];

  // ---------- captions: three fresh ones a day, the same three for everyone on that day ----------
  const CAPTIONS = [
    "Daily goal done on Blinky's friends. Cheered on {n} Keepers today and it felt good",
    "Another day, another full egg. {n} Keepers got some love from me today",
    "Showed up for the community again today. {n} posts opened, zero regrets",
    "Blinky says thank you to every Keeper who posted today. I opened {n} of you",
    "Day {s} of showing up for the Pocket Dragons fam. Who is next on my list?",
    "Goal done, egg hatched, Blinky happy. Small habits build big communities",
    "Supporting the hatchery one post at a time. {n} today, more tomorrow",
    "If you posted about the dragons today there is a good chance I saw it",
    "{s} day streak and still having fun. Come cheer the Keepers with me",
    "Quick daily round done. The Pocket Dragons timeline is full of good people",
    "Opened {n} Keeper posts today. Go show your favourite poster some love",
    "Blinky and I finished the daily goal. Your turn, Keepers",
    "The best part of my day is finding new Keepers to cheer on",
    "Another full egg. Tag a Keeper who deserves more eyes on their posts",
    "Daily goal complete. Not every day has to be big, just keep showing up",
    "{n} Keepers cheered, one happy dragon. See you tomorrow",
    "Kept the chain going today. {s} days of cheering on the community",
    "Found some gems on Blinky's friends today. Go check the quiet posts",
    "My daily dragon round is done. Who should I check out tomorrow?",
    "Community first. {n} Keeper posts opened today",
    "Blinky is proud of us today. The hatchery keeps growing",
    "Daily goal done. If you are new here, say hi, we are friendly",
    "Cheering on Keepers is my favourite habit. Day {s} done",
    "Every post deserves a reader. Opened {n} today",
  ];
  function dayPick(n) {
    let seed = [...today()].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const idx = [...CAPTIONS.keys()], out = [];
    while (out.length < n) { seed = (seed * 1103515245 + 12345) >>> 0; out.push(idx.splice(seed % idx.length, 1)[0]); }
    return out.map((i) => CAPTIONS[i]);
  }

  // ---------- what the Keeper has done ----------
  function state() {
    const goal = store.get("pd:goal", {}) || {}, dex = store.get("pd:dex", {}) || {}, st = store.get("pd:streak", {}) || {};
    const g = dex.g || {};
    const goalStreak = g.last && dayGap(g.last, today()) <= 1 ? g.count || 0 : 0;
    const visitStreak = st.last && dayGap(st.last, today()) <= 1 ? st.count || 0 : 0;
    return {
      done: goal.day === today() && (goal.n || 0) >= GOAL,
      cheered: goal.day === today() ? Math.max(goal.n || 0, 0) : 0,
      streak: Math.max(goalStreak, visitStreak, 1),
      eggs: Math.max(dex.n | 0, 0),
      hatchedToday: dex.last === today(),
    };
  }
  const unlocked = (s) => Math.min(POSES.length, START + Math.floor(s.eggs / EVERY));

  // ---------- choices, remembered on this device ----------
  let pick = Object.assign({ pose: "wave", scene: "meadow", tone: "gold", cap: 0 }, store.get("pd:daycard", {}) || {});
  const saveChoice = () => store.set("pd:daycard", { pose: pick.pose, scene: pick.scene, tone: pick.tone });
  const xName = () => { const v = (store.get("pd:xname", "") || "").toString().replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15); return v; };

  // ---------- drawing ----------
  const imgs = new Map();
  function load(src) {
    if (imgs.has(src)) return imgs.get(src);
    const p = new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.decoding = "async"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
    imgs.set(src, p); p.catch(() => imgs.delete(src));
    return p;
  }
  function seeded(n) { let s = n >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

  function scene(x, W, H, S) {
    const r = seeded(S.id.length * 977 + S.id.charCodeAt(0));
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, S.sky[0]); g.addColorStop(.55, S.sky[1]); g.addColorStop(1, S.sky[2]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // the light behind Blinky
    const glow = x.createRadialGradient(360, H * .48, 20, 360, H * .48, W * .5);
    glow.addColorStop(0, S.glow); glow.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    if (S.rays) {
      x.save(); x.translate(360, H * .45); x.globalAlpha = .18;
      for (let i = 0; i < 16; i++) { x.rotate(Math.PI / 8); x.fillStyle = "#fff"; x.beginPath(); x.moveTo(0, 0); x.lineTo(W, -60); x.lineTo(W, 60); x.closePath(); x.fill(); }
      x.restore();
    }
    if (S.stars) {
      for (let i = 0; i < 160; i++) { const sx = r() * W, sy = r() * H * .75, sr = r() * 2.4 + .4; x.globalAlpha = .35 + r() * .65; x.fillStyle = S.dots; x.beginPath(); x.arc(sx, sy, sr, 0, 7); x.fill(); }
      x.globalAlpha = 1;
      const m = x.createRadialGradient(110, 96, 8, 110, 96, 90); m.addColorStop(0, "rgba(255,250,225,1)"); m.addColorStop(.35, "rgba(255,250,225,.9)"); m.addColorStop(.4, "rgba(255,250,225,.25)"); m.addColorStop(1, "rgba(255,250,225,0)");
      x.fillStyle = m; x.fillRect(0, 0, W, H);
    }
    if (S.bokeh) for (let i = 0; i < 26; i++) { const bx = r() * W, by = r() * H * .8, br = 14 + r() * 60; const b = x.createRadialGradient(bx, by, 0, bx, by, br); b.addColorStop(0, S.dots); b.addColorStop(1, "rgba(255,255,255,0)"); x.globalAlpha = .25 + r() * .35; x.fillStyle = b; x.beginPath(); x.arc(bx, by, br, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    if (S.clouds) for (let i = 0; i < 9; i++) { const cx = r() * W, cy = H * (.12 + r() * .6), cs = 50 + r() * 70; x.fillStyle = `rgba(255,255,255,${.16 + r() * .22})`; [[0, 0, 1], [-.9, .25, .7], [.9, .25, .75], [-.4, -.35, .7], [.45, -.3, .65]].forEach(([dx, dy, k]) => { x.beginPath(); x.arc(cx + dx * cs, cy + dy * cs, cs * k, 0, 7); x.fill(); }); }
    if (S.hills) {
      [[S.hills[0], .74, 90], [S.hills[1], .8, 70]].forEach(([col, base, amp], k) => {
        x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
        for (let i = 0; i <= 24; i++) { const px = (i / 24) * W; x.lineTo(px, H * base - Math.sin(i / 3.2 + k * 2) * amp * .5 - Math.cos(i / 5 + k) * amp * .3); }
        x.lineTo(W, H); x.closePath(); x.fill();
      });
    }
    if (S.waves) S.waves.forEach((col, k) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i <= 40; i++) { const px = (i / 40) * W; x.lineTo(px, H * (.7 + k * .06) + Math.sin(i / 2.4 + k * 1.7) * 14); }
      x.lineTo(W, H); x.closePath(); x.fill();
    });
    // a little sparkle dust
    for (let i = 0; i < 40; i++) { x.globalAlpha = .3 + r() * .5; x.fillStyle = S.dots; x.beginPath(); x.arc(r() * W, r() * H, r() * 2.6 + .6, 0, 7); x.fill(); }
    x.globalAlpha = 1;
    // soft vignette for depth
    const v = x.createRadialGradient(W / 2, H / 2, W * .35, W / 2, H / 2, W * .95); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(10,6,30,.38)");
    x.fillStyle = v; x.fillRect(0, 0, W, H);
  }

  async function draw(canvas, scale) {
    const K = window.pdCard, W = K.W, H = K.H, P = K.P, s = state();
    const S = SCENES.find((q) => q.id === pick.scene) || SCENES[0], T = TONES.find((q) => q.id === pick.tone) || TONES[0];
    const Pz = POSES.find((q) => q.id === pick.pose) || POSES[0];
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    const x = canvas.getContext("2d"); x.setTransform(scale, 0, 0, scale, 0, 0);
    await K.fonts();
    const blinky = await load(art(Pz, scale > 0.8 ? 1400 : 700)).catch(() => null);
    const bg = plate(S.id) ? await load(plate(S.id, scale > 0.8 ? 2400 : 1200)).catch(() => null) : null;
    if (bg) {
      x.drawImage(bg, 0, 0, W, H);
      // a soft shade on the right so the glass panel always reads clearly
      const sh = x.createLinearGradient(560, 0, W, 0); sh.addColorStop(0, "rgba(8, 6, 24, 0)"); sh.addColorStop(1, "rgba(8, 6, 24, .45)");
      x.fillStyle = sh; x.fillRect(0, 0, W, H);
    } else scene(x, W, H, S);
    K.vignette(x, 0.38);
    K.hero(x, blinky, { cx: 360, cy: 330, maxW: 600, maxH: 560, glow: "255, 240, 210" });
    K.panel(x, "rgba(255, 255, 255, .34)");
    const X = P.x + 40, inner = P.w - 80;
    K.pill(x, "DAILY GOAL DONE", X, P.y + 40, { bg: T.a, ink: T.ink });
    x.fillStyle = K.SOFT; x.font = '700 18px "Nunito", sans-serif'; x.textAlign = "right";
    x.fillText(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" }), P.x + P.w - 40, P.y + 66); x.textAlign = "left";
    const n = Math.max(s.cheered, GOAL);
    x.fillStyle = K.INK; K.fit(x, `${n} Keepers`, X, P.y + 142, inner, 58, 40);
    x.fillStyle = K.SOFT; x.font = '700 24px "Nunito", sans-serif'; x.fillText("cheered on today", X, P.y + 180);
    K.divider(x, P.y + 210);
    const name = xName();
    x.fillStyle = K.INK; K.fit(x, name ? "@" + name : "A proud Keeper", X, P.y + 262, inner, 40, 26);
    K.chip(x, `${s.streak} day streak`, X, P.y + 284);
    // today's hatch, as a neat tile inside the panel
    const hatch = window.pdDex && window.pdDex.todayHatch ? await window.pdDex.todayHatch().catch(() => null) : null;
    const ty = P.y + 352, th = 118;
    K.rr(x, X, ty, inner, th, 22); x.fillStyle = "rgba(255, 255, 255, .1)"; x.fill();
    K.rr(x, X, ty, inner, th, 22); x.strokeStyle = "rgba(255, 255, 255, .16)"; x.lineWidth = 1.5; x.stroke();
    if (hatch && hatch.img) {
      const im = hatch.img, k = Math.min(96 / im.width, 96 / im.height);
      x.drawImage(im, X + 14 + (96 - im.width * k) / 2, ty + (th - im.height * k) / 2, im.width * k, im.height * k);
      K.label(x, "TODAY'S HATCH", X + 128, ty + 46);
      x.fillStyle = K.INK; K.fit(x, `${hatch.name} Dragon`, X + 128, ty + 82, inner - 140, 30, 20);
      x.fillStyle = K.SOFT; x.font = '700 16px "Nunito", sans-serif'; x.fillText(hatch.label, X + 128, ty + 104);
    } else {
      K.label(x, "EGGS HATCHED", X + 24, ty + 46);
      x.fillStyle = K.INK; x.font = '700 40px "Fredoka", sans-serif'; x.fillText(String(s.eggs), X + 24, ty + 92);
    }
    K.footer(x);
    K.grain(x, 0.05);
    return canvas;
  }

  // ---------- the sheet ----------
  const prev = $("dc-preview"), poseRow = $("dc-poses"), sceneRow = $("dc-scenes"), toneRow = $("dc-tones"), capRow = $("dc-caps"), capText = $("dc-text");
  let caps = [], blob = null, file = null, drawing = 0;
  function el(tag, attrs, ...kids) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } kids.forEach((c) => e.append(c)); return e; }
  function fill(t) { const s = state(); return t.replace("{n}", Math.max(s.cheered, GOAL)).replace("{s}", s.streak); }

  function buildPickers() {
    const s = state(), open = unlocked(s);
    if (POSES.findIndex((p) => p.id === pick.pose) >= open) pick.pose = POSES[0].id;
    poseRow.replaceChildren(...POSES.map((p, i) => {
      const locked = i >= open;
      const b = el("button", { type: "button", class: "dc-pose" + (locked ? " locked" : "") + (p.id === pick.pose ? " on" : ""), "aria-pressed": String(p.id === pick.pose),
        title: locked ? `Unlocks after ${(i - START + 1) * EVERY} eggs` : p.name, "aria-label": locked ? `${p.name}, locked` : p.name },
        el("img", { src: art(p, 180), alt: "", loading: "lazy", decoding: "async" }));
      if (locked) b.append(el("span", { class: "dc-lock" }, `${(i - START + 1) * EVERY}`));
      b.addEventListener("click", () => { if (locked) { hint(`Hatch ${(i - START + 1) * EVERY} eggs to unlock this pose. You have ${s.eggs}.`); return; } pick.pose = p.id; saveChoice(); buildPickers(); redraw(); });
      return b;
    }));
    sceneRow.replaceChildren(...SCENES.map((q) => el("button", { type: "button", class: "dc-swatch" + (q.id === pick.scene ? " on" : ""), title: q.name, "aria-label": q.name, "aria-pressed": String(q.id === pick.scene),
      style: PLATES[q.id] ? `background:url(${plate(q.id, 160)}) center/cover` : `background:linear-gradient(160deg,${q.sky[0]},${q.sky[1]} 55%,${q.sky[2]})`, onclick: () => { pick.scene = q.id; saveChoice(); buildPickers(); redraw(); } })));
    toneRow.replaceChildren(...TONES.map((q) => el("button", { type: "button", class: "dc-dot" + (q.id === pick.tone ? " on" : ""), title: q.name, "aria-label": q.name, "aria-pressed": String(q.id === pick.tone),
      style: `background:linear-gradient(160deg,${q.a},${q.b})`, onclick: () => { pick.tone = q.id; saveChoice(); buildPickers(); redraw(); } })));
    $("dc-unlock").textContent = open < POSES.length ? `${open} of ${POSES.length} poses unlocked. Next one after ${(open - START + 1) * EVERY} eggs.` : "Every pose unlocked. Legend.";
  }
  function buildCaptions() {
    caps = dayPick(3).map(fill);
    capRow.replaceChildren(...caps.map((t, i) => el("button", { type: "button", class: "dc-cap" + (i === pick.cap ? " on" : ""), "aria-pressed": String(i === pick.cap),
      onclick: () => { pick.cap = i; capText.value = caps[i]; buildCaptions(); } }, t)));
    if (!capText.value) capText.value = caps[pick.cap] || caps[0];
  }
  function hint(t) { const h = $("dc-hint"); h.textContent = t; h.hidden = !t; }
  async function redraw() {
    const ticket = ++drawing; blob = null; file = null; $("dc-share").hidden = true;
    const c = await draw(document.createElement("canvas"), .5);
    if (ticket !== drawing) return;
    prev.width = c.width; prev.height = c.height; prev.getContext("2d").drawImage(c, 0, 0);
    // the full size picture, made in the background so Share is instant
    const big = await draw(document.createElement("canvas"), 1.5);
    if (ticket !== drawing) return;
    blob = await new Promise((r) => { try { big.toBlob(r, "image/png"); } catch (e) { r(null); } });
    if (!blob || ticket !== drawing) return;
    file = new File([blob], `pdtools-daily-${today()}.png`, { type: "image/png" });
    $("dc-share").hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  }
  const postText = () => `${capText.value.trim()}\n\npdtools.xyz`;
  function openCard() {
    const s = state();
    if (!s.done) return false;
    $("dc-xname").value = xName() ? "@" + xName() : "";
    hint(""); capText.value = ""; buildPickers(); buildCaptions(); redraw();
    sheetEl.hidden = false; requestAnimationFrame(() => sheetEl.classList.add("open")); document.body.classList.add("sheet-open");
    return true;
  }
  function closeCard() { sheetEl.classList.remove("open"); document.body.classList.remove("sheet-open"); setTimeout(() => { if (!sheetEl.classList.contains("open")) sheetEl.hidden = true; }, 250); }

  $("dc-xname").addEventListener("change", (e) => {
    const v = e.target.value.replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
    e.target.value = v ? "@" + v : ""; store.set("pd:xname", v); redraw();
  });
  $("dc-share").addEventListener("click", async () => { if (!file) return; try { await navigator.share({ files: [file], text: postText() }); } catch (e) {} });
  $("dc-post").addEventListener("click", (e) => {
    e.currentTarget.href = `https://x.com/intent/post?text=${encodeURIComponent(postText())}`;
    hint("Save the picture first, then add it to your post on X.");
  });
  $("dc-save").addEventListener("click", async () => {
    let b = blob;
    if (!b) { const big = await draw(document.createElement("canvas"), 1.5); b = await new Promise((r) => { try { big.toBlob(r, "image/png"); } catch (e) { r(null); } }); }
    if (!b) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `pdtools-daily-${today()}.png`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $("dc-close").addEventListener("click", closeCard);
  sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeCard(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheetEl.hidden) closeCard(); });

  // ---------- ways in: the goal chip once the egg is hatched, and a button on the hatch sheet ----------
  const goalBtn = $("goal");
  if (goalBtn) goalBtn.addEventListener("click", (e) => {
    const s = state();
    if (s.done && s.hatchedToday) { e.stopImmediatePropagation(); e.preventDefault(); openCard(); }
  }, true);
  const fromHatch = $("hatch-daycard");
  if (fromHatch) fromHatch.addEventListener("click", () => {
    const h = $("hatch"); if (h) { h.classList.remove("open"); setTimeout(() => { h.hidden = true; openCard(); }, 260); } else openCard();
  });
  function refresh() {
    const s = state();
    if (fromHatch) fromHatch.hidden = !s.done;
    const ready = s.done && s.hatchedToday;
    if (goalBtn) goalBtn.classList.toggle("card-ready", ready);
    if (ready && $("goal-text")) $("goal-text").textContent = "Share your daily card";
  }
  ["pd:goaldone", "pd:goalshow", "pd:dexchange", "pd:hatched"].forEach((ev) => addEventListener(ev, () => setTimeout(refresh, 50)));
  refresh();
  window.pdDayCard = { open: openCard, draw, pick: (p) => Object.assign(pick, p), POSES, SCENES, TONES };
})();
