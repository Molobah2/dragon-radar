/* Blinky's Book of Friends: the signing card. Everyone who signs gets the same card, Blinky holding the open
   book, with their own X name written on the page in glowing gold ink. They pick one of 7 painted backgrounds,
   each with its own aura, and save it as a short looping video or an image to post on X.
   Everything is drawn here in the browser on top of the painted artwork; nothing is sent anywhere. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const box = $("sc"), cv = $("sc-canvas");
  if (!box || !cv) return;
  const screenCtx = cv.getContext("2d");
  let ctx = screenCtx;              // frame() draws here; exports point it at a bigger canvas for a moment
  const BASE = ((window.RADAR_SCENE && window.RADAR_SCENE.base) || "").replace(/\/$/, "");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Every card has the same book in the same place (measured on the artwork), so the name and the paw print
  // line up on all 7. Positions are fractions of the card. Each background has its own aura effect.
  // The safe area for the name: inside the page's printed frame, clear of the corner ornaments, the slanted
  // outer edge and the paw print. Measured on the artwork; every name is fitted inside it by its real ink.
  // The page is drawn in slight perspective: its printed frame rises about 4.5 degrees to the right. The name is
  // centred on the page's middle line (the paw print sits on it too) and written along that slope, inside a
  // safe area clear of the frame, the corner ornaments and the paw print. At most 10 letters on a line.
  const PAGE = { cx: 0.5636, cy: 0.546, w: 0.0911, h: 0.092, tilt: -4.5 * Math.PI / 180 };
  const MAX_LINE = 10;
  const PAW = { x: 0.566, y: 0.636 };
  const BOOK = { x0: 0.345, y0: 0.432, x1: 0.655, y1: 0.752 };
  const CARDS = [
    { id: 1, name: "Starry night", glow: [190, 210, 255], kind: "star", cols: ["#ffffff", "#d9e6ff", "#b8ccff"] },
    { id: 2, name: "Sunrise meadow", glow: [255, 196, 170], kind: "petal", cols: ["#ffc2cf", "#ffd8c2", "#ffe9a8"] },
    { id: 3, name: "Cherry blossom", glow: [255, 200, 225], kind: "petal", cols: ["#ffd0e2", "#ffb3cf", "#fff0f6"] },
    { id: 4, name: "Candy clouds", glow: [235, 215, 255], kind: "prism", cols: ["#ffc6e4", "#fff1a8", "#c6f5dc", "#c4e2ff"] },
    { id: 5, name: "Emerald glass", glow: [150, 255, 200], kind: "leaf", cols: ["#9dffcb", "#d4ffb0", "#7ff0e0"] },
    { id: 6, name: "Autumn paper", glow: [255, 190, 110], kind: "leaf", cols: ["#ffb35c", "#ff8f4a", "#ffd27a"] },
    { id: 7, name: "Golden hoard", glow: [255, 215, 120], kind: "glint", cols: ["#fff2b0", "#ffd56a", "#ffb3d9", "#9ff0f0", "#d9b8ff"] },
  ];
  const img = (w, id) => `${BASE}/image/upload/c_scale,w_${w}/f_jpg/q_90/dragon-radar/sign-cards/sign-${id}`;
  const thumb = (id) => `${BASE}/image/upload/c_fill,w_320,h_181/f_auto/q_auto/dragon-radar/sign-cards/sign-${id}`;

  let me = null, pick = Number(store.get("pd:signCard")) || 1;
  if (!CARDS.some((c) => c.id === pick)) pick = 1;
  const card = () => CARDS.find((c) => c.id === pick);

  // ---------- loading: the painted art and the handwriting font ----------
  const cache = {};
  const load = (src) => cache[src] || (cache[src] = new Promise((ok) => {
    const i = new Image(); i.crossOrigin = "anonymous"; i.decoding = "async";
    i.onload = () => ok(i); i.onerror = () => { delete cache[src]; ok(null); }; i.src = src;
  }));
  let fontReady = null;
  function font() {
    if (fontReady) return fontReady;
    fontReady = (async () => {
      try {
        const f = new FontFace("PD Script", "url(/static/fonts/dancing-script-latin-700-normal.woff2) format('woff2')", { weight: "700" });
        document.fonts.add(await f.load());
      } catch (e) { /* falls back to a serif italic */ }
      try { await document.fonts.load('700 40px "Fredoka"'); } catch (e) { /* fine */ }
    })();
    return fontReady;
  }

  // ---------- the aura: gentle particles in each card's own style ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  let parts = [];
  function seed(c) {
    const n = c.kind === "star" || c.kind === "glint" ? 38 : 26;
    parts = Array.from({ length: n }, () => spawn(c, true));
  }
  function spawn(c, anywhere) {
    const falling = c.kind === "petal" || c.kind === "leaf";
    return {
      x: rnd(0, 1), y: anywhere ? rnd(0, 1) : (falling ? rnd(-0.08, -0.02) : rnd(0.85, 1.05)),
      s: falling ? rnd(0.006, 0.011) : rnd(0.0018, 0.0045),
      vx: falling ? rnd(0.012, 0.035) : rnd(-0.006, 0.006), vy: falling ? rnd(0.025, 0.05) : rnd(-0.035, -0.012),
      rot: rnd(0, Math.PI * 2), vr: rnd(-1.2, 1.2), ph: rnd(0, Math.PI * 2), col: c.cols[Math.floor(Math.random() * c.cols.length)],
      hue: rnd(0, 360),
    };
  }
  // Particles frame Blinky: they fade out as they come near him and the book, so his face and the name stay clear.
  function clearance(p) {
    const dx = (p.x - 0.5) / 0.2, dy = (p.y - 0.52) / 0.42, d = Math.sqrt(dx * dx + dy * dy);
    return Math.max(0, Math.min(1, (d - 0.85) / 0.45));
  }
  function drawPart(p, c, W, H, t) {
    const room = clearance(p);
    if (room <= 0) return;
    const x = p.x * W, y = p.y * H, s = p.s * W, tw = (0.55 + 0.45 * Math.sin(t * 2.4 + p.ph)) * room;
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
    if (c.kind === "petal") {
      ctx.globalAlpha = 0.85 * room; ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35 * room; ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(-s * 0.25, -s * 0.1, s * 0.45, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    } else if (c.kind === "leaf") {
      ctx.globalAlpha = 0.8 * room; ctx.fillStyle = p.col; ctx.shadowColor = p.col; ctx.shadowBlur = s;
      ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.7, s, 0); ctx.quadraticCurveTo(0, s * 0.7, -s, 0); ctx.fill();
    } else {
      const col = c.kind === "prism" ? `hsl(${(p.hue + t * 40) % 360}, 90%, 85%)` : p.col;
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = tw;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 3);
      g.addColorStop(0, col); g.addColorStop(0.25, col); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 3, 0, Math.PI * 2); ctx.fill();
      if (c.kind !== "prism") {                  // four point twinkle
        ctx.globalAlpha = tw * 0.9; ctx.fillStyle = "#ffffff";
        const r = s * 3.2 * tw;
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(s * 0.4, 0); ctx.lineTo(0, r); ctx.lineTo(-s * 0.4, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(0, s * 0.4); ctx.lineTo(r, 0); ctx.lineTo(0, -s * 0.4); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  function stepParts(c, dt) {
    parts.forEach((p, i) => {
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (c.kind === "petal" || c.kind === "leaf") p.x += Math.sin(p.ph + p.y * 8) * 0.0009;
      if (p.y > 1.08 || p.y < -0.1 || p.x > 1.08 || p.x < -0.08) parts[i] = spawn(c, false);
    });
  }

  // ---------- fitting the name on the page ----------
  // Names longer than 10 letters drop to a second line, at a natural point when one fits (after _, before a
  // capital, before numbers; the most balanced one wins), otherwise after the 10th letter. Sizes come from the
  // ink itself, so curly script letters never spill past the safe area.
  const inkBox = (t) => { const m = ctx.measureText(t); return { w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, l: m.actualBoundingBoxLeft, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent }; };
  const nameFont = (sz) => `700 ${sz}px "PD Script", "Georgia", serif`;
  function splitName(text) {
    const h = text.replace(/^@/, "");
    if (h.length <= MAX_LINE) return ["@" + h];
    let best = -1, score = 1e9;
    for (let i = 2; i < h.length; i++) {
      const p = h[i - 1], c = h[i];
      const natural = p === "_" || (/[a-z]/.test(p) && /[A-Z]/.test(c)) || (/\D/.test(p) && /\d/.test(c));
      const sc = Math.abs(h.length / 2 - i) - (p === "_" ? 0.5 : 0);             // an underscore wins a tie
      if (natural && i <= MAX_LINE && h.length - i <= MAX_LINE && sc < score) { best = i; score = sc; }
    }
    // no natural break: 10 letters, then the rest; but never leave one or two letters alone on a line
    const cut = best > 0 ? best : (h.length - MAX_LINE <= 2 ? Math.ceil(h.length / 2) : MAX_LINE);
    const rest = h.slice(cut);
    return ["@" + h.slice(0, cut), ...(rest.length > MAX_LINE ? [rest.slice(0, MAX_LINE), rest.slice(MAX_LINE)] : [rest])];
  }
  let laidFor = "", laid = null;
  function layoutName(text, W, H) {
    const key = `${text}|${W}|${H}`;
    if (laidFor === key) return laid;
    const lines = splitName(text), bw = PAGE.w * W, bh = PAGE.h * H;
    let sz = H * 0.07, bs = [], gap = 0, hh = 0;
    for (let i = 0; i < 40; i++) {
      ctx.font = nameFont(sz); bs = lines.map(inkBox); gap = sz * 0.14;
      const w = Math.max(...bs.map((q) => q.w)); hh = bs.reduce((t, q) => t + q.a + q.d, 0) + gap * (lines.length - 1);
      if (w <= bw && hh <= bh) break;
      sz *= Math.min(0.97, Math.sqrt(Math.min(bw / w, bh / hh)));
    }
    let y = -hh / 2;                       // positions are relative to the page's centre, before the tilt
    const rows = lines.map((t, i) => { const q = bs[i]; y += q.a; const row = { t, x: -q.w / 2 + q.l, left: -q.w / 2, y, w: q.w, a: q.a, d: q.d }; y += q.d + gap; return row; });
    laidFor = key; laid = { sz, rows };
    return laid;
  }

  // ---------- one frame of the card ----------
  // The loop: the name writes itself in, the paw print glows like a seal, a sheen passes over the pages,
  // then the ink fades and it begins again. 8 seconds, so a saved video loops smoothly on X.
  const LOOP = 8;
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 3));
  function frame(art, c, handle, t, W, H) {
    const lt = t % LOOP;
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    if (art) ctx.drawImage(art, 0, 0, W, H); else { ctx.fillStyle = "#2a2650"; ctx.fillRect(0, 0, W, H); }

    // the aura breathes softly around Blinky
    const [r, g, b] = c.glow, br = 0.10 + 0.06 * Math.sin(t * 1.3);
    ctx.save(); ctx.globalCompositeOperation = "screen";
    const ag = ctx.createRadialGradient(W * 0.5, H * 0.46, H * 0.08, W * 0.5, H * 0.46, H * 0.62);
    ag.addColorStop(0, `rgba(${r},${g},${b},${br})`); ag.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H); ctx.restore();

    // a sheen of light passes over the open book
    const sw = ((lt - 3.2) / 1.6);
    if (sw > 0 && sw < 1) {
      ctx.save();
      ctx.beginPath(); ctx.rect(BOOK.x0 * W, BOOK.y0 * H, (BOOK.x1 - BOOK.x0) * W, (BOOK.y1 - BOOK.y0) * H); ctx.clip();
      ctx.globalCompositeOperation = "screen";
      const sx = (BOOK.x0 + (BOOK.x1 - BOOK.x0 + 0.2) * sw - 0.1) * W;
      const sg = ctx.createLinearGradient(sx - W * 0.06, 0, sx + W * 0.06, 0);
      sg.addColorStop(0, "rgba(255,240,200,0)"); sg.addColorStop(0.5, "rgba(255,240,200,.32)"); sg.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = sg; ctx.setTransform(1, 0, -0.35, 1, H * 0.2, 0); ctx.fillRect(0, 0, W * 1.2, H);
      ctx.restore();
    }

    // the name, written in glowing gold ink from left to right
    const write = ease((lt - 0.5) / 1.9), fade = lt > LOOP - 0.7 ? 1 - (lt - (LOOP - 0.7)) / 0.7 : 1;
    if (write > 0 && handle) {
      const L = layoutName(`@${handle}`, W, H), sz = L.sz, n = L.rows.length;
      const pulse = 0.75 + 0.25 * Math.sin(t * 2);
      ctx.save();
      ctx.translate(PAGE.cx * W, PAGE.cy * H); ctx.rotate(PAGE.tilt);     // write along the page's slope
      L.rows.forEach((row, i) => {
        const k = Math.max(0, Math.min(1, write * n - i));          // lines are written one after the other
        if (k <= 0) return;
        ctx.save();
        ctx.font = nameFont(sz); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.beginPath(); ctx.rect(row.left - sz * 0.3, row.y - row.a - sz * 0.4, (row.w + sz * 0.6) * k, row.a + row.d + sz * 0.8); ctx.clip();
        ctx.globalAlpha = fade;
        ctx.shadowColor = `rgba(255, 190, 60, ${0.7 * pulse})`; ctx.shadowBlur = sz * 0.35;
        const ink = ctx.createLinearGradient(0, row.y - row.a, 0, row.y + row.d);
        ink.addColorStop(0, "#c07a08"); ink.addColorStop(0.55, "#8f5306"); ink.addColorStop(1, "#6e3c04");
        ctx.fillStyle = ink; ctx.fillText(row.t, row.x, row.y);
        ctx.shadowBlur = 0; ctx.fillText(row.t, row.x, row.y);           // a second pass keeps the strokes crisp over the glow
        ctx.globalAlpha = fade * 0.35; ctx.fillStyle = "#ffe7a6"; ctx.fillText(row.t, row.x - sz * 0.012, row.y - sz * 0.03);
        ctx.restore();
        if (k < 1) {                                                   // the glowing nib at the tip of the ink
          const nx = row.left + row.w * k, ny = row.y - row.a * 0.4;
          ctx.save(); ctx.globalCompositeOperation = "lighter";
          const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, sz * 0.7);
          ng.addColorStop(0, "rgba(255,245,200,.95)"); ng.addColorStop(1, "rgba(255,200,80,0)");
          ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, sz * 0.7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      });
      ctx.restore();
    }

    // the paw print glows like a seal once the name is written
    const seal = lt > 2.5 ? Math.max(0, 1 - (lt - 2.5) / 1.4) : 0, idle = 0.25 + 0.15 * Math.sin(t * 2.2);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const pr = H * (0.028 + 0.03 * seal), pg = ctx.createRadialGradient(PAW.x * W, PAW.y * H, 0, PAW.x * W, PAW.y * H, pr);
    pg.addColorStop(0, `rgba(255,225,140,${0.12 + 0.45 * seal + idle * 0.15})`); pg.addColorStop(1, "rgba(255,200,90,0)");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(PAW.x * W, PAW.y * H, pr, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    // particles of the aura
    parts.forEach((p) => drawPart(p, c, W, H, t));

    // the site, small and clear at the bottom
    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    const fs = Math.round(H * 0.03);
    ctx.font = `600 ${fs}px "Fredoka", "Nunito", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = fs * 0.5; ctx.fillStyle = "#ffffff";
    ctx.fillText("pdtools.xyz", W / 2, H - fs * 0.9);
    ctx.restore();
  }

  // ---------- live preview ----------
  let art = null, running = false, last = 0, t0 = 0, raf = 0;
  async function prepare() {
    const c = card();
    msg("");
    await font();
    art = await load(img(1280, c.id));
    seed(c);
    if (!art) msg("The card art did not load. Check your connection and try again.");
  }
  function loop(now) {
    if (!running) return;
    const W = cv.width, H = cv.height, dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    stepParts(card(), dt);
    frame(art, card(), me && me.handle, (now - t0) / 1000, W, H);
    raf = requestAnimationFrame(loop);
  }
  function still() { frame(art, card(), me && me.handle, 6.0, cv.width, cv.height); }
  function start() {
    if (calm) { still(); return; }
    if (running) return;
    running = true; last = performance.now(); t0 = last; raf = requestAnimationFrame(loop);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }
  // only animate while the card is on screen, so phones stay cool
  const seen = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting && !box.hidden ? start() : stop())));
  seen.observe(cv);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : (!box.hidden && start())));

  // ---------- the background picker ----------
  function pickers() {
    const row = $("sc-picks");
    if (row.children.length) { mark(); return; }
    CARDS.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "mw-design"; b.dataset.id = c.id; b.setAttribute("aria-label", c.name);
      const im = document.createElement("img"); im.src = thumb(c.id); im.alt = ""; im.loading = "lazy"; im.width = 160; im.height = 90;
      const s = document.createElement("span"); s.textContent = c.name;
      b.append(im, s);
      b.addEventListener("click", async () => {
        if (pick === c.id) return;
        pick = c.id; store.set("pd:signCard", String(pick)); mark();
        await prepare(); t0 = performance.now(); if (calm) still();
      });
      row.append(b);
    });
    mark();
  }
  const mark = () => document.querySelectorAll("#sc-picks .mw-design").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.id === pick)));
  const msg = (text) => { $("sc-msg").textContent = text; };
  const track = (kind) => { try { window.pdTrack && window.pdTrack(kind, "signcard"); } catch (e) { /* ignore */ } };
  // The words that go with the card on X. Each signer gets one of five at random (kept on their device, so
  // pressing Post again shows the same words), so the timeline sees fresh words instead of one copied line.
  const POSTS = [
    "Just signed Blinky's Book of Friends \u{1F409}\u{1F4D6} My name is in, and now the job is simple: carry Blinky and @Pocket_Dragons_ into every corner of CT. Come sign yours and let's do it together \u{1F447} pdtools.xyz/friends",
    "My name is officially in Blinky's Book of Friends \u{1F409}\u2728 This little yellow dragon deserves to be seen on every timeline in CT, and that starts with us showing up for each other. Your page is waiting \u{1F447} pdtools.xyz/friends @Pocket_Dragons_",
    "Signed, sealed and stamped with a paw \u{1F43E} I'm in Blinky's Book of Friends. Next stop, every corner of CT. Keepers, come sign with me \u{1F409} pdtools.xyz/friends @Pocket_Dragons_",
    "Blinky keeps a book of every Keeper who has his back, and today I signed it \u{1F409}\u{1F4D6} We're taking @Pocket_Dragons_ to every corner of CT, one friend at a time. Add your name \u{1F447} pdtools.xyz/friends",
    "New quest unlocked: put Blinky in front of every corner of CT \u{1F409}\u{1F30D} First step done, I signed Blinky's Book of Friends. Grab your quill and join me, Keeper \u{1F447} pdtools.xyz/friends @Pocket_Dragons_",
  ];
  let postPick = Number(store.get("pd:signPost"));
  if (!(postPick >= 0 && postPick < POSTS.length)) { postPick = Math.floor(Math.random() * POSTS.length); store.set("pd:signPost", String(postPick)); }
  const postText = () => POSTS[postPick];

  // ---------- saving: an image, or a short looping video made right here ----------
  async function stillBlob() {
    const c = card(), W = 1920, H = Math.round(1920 * 1520 / 2688);
    const big = await load(img(1920, c.id)) || art;
    const off = document.createElement("canvas"); off.width = W; off.height = H;
    const was = parts; seed(c);
    swapCtx(off.getContext("2d")); frame(big, c, me && me.handle, 6.0, W, H); swapCtx(null); parts = was;
    return new Promise((r) => { try { off.toBlob(r, "image/png"); } catch (e) { r(null); } });
  }
  const swapCtx = (o) => { ctx = o || screenCtx; };

  function videoType() {
    if (!window.MediaRecorder || !cv.captureStream) return "";
    const ok = (k) => { try { return MediaRecorder.isTypeSupported(k); } catch (e) { return false; } };
    // X takes H.264 video. Chrome and Edge name it avc1; Safari records H.264 under plain mp4 and has no webm.
    const h264 = ["video/mp4;codecs=avc1.42E01F", "video/mp4;codecs=avc1.4D401F", "video/mp4;codecs=avc1"].find(ok);
    if (h264) return h264;
    if (ok("video/mp4") && !ok("video/webm")) return "video/mp4";
    return ["video/webm;codecs=vp9", "video/webm"].find(ok) || "";
  }
  let busy = false, lastVideo = null;          // the newest video made, reused by Share on phones
  async function recordVideo() {
    const type = videoType();
    if (!type) return null;
    const c = card(), W = 1280, H = 724;
    const big = await load(img(1280, c.id)) || art;
    const off = document.createElement("canvas"); off.width = W; off.height = H;
    const o = off.getContext("2d");
    const stream = off.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    stop();                                        // the preview rests while the video is made
    const was = parts; seed(c);
    const begin = performance.now(); let prev = begin;
    rec.start(250);
    await new Promise((finish) => {
      const tick = (now) => {
        const t = (now - begin) / 1000;
        stepParts(c, Math.min(0.05, (now - prev) / 1000)); prev = now;
        swapCtx(o); frame(big, c, me && me.handle, t, W, H); swapCtx(null);
        msg(`Making your video... ${Math.max(1, Math.ceil(LOOP - t))}`);
        if (t >= LOOP) { finish(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop(); await done; parts = was;
    stream.getTracks().forEach((tr) => tr.stop());
    if (!box.hidden) start();
    msg("");
    const blob = new Blob(chunks, { type: type.split(";")[0] });
    lastVideo = { blob, ext: type.startsWith("video/mp4") ? "mp4" : "webm", key: `${c.id}:${me && me.handle}` };
    return lastVideo;
  }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  const fileName = (ext) => `blinky-book-of-friends-${(me && me.handle) || "card"}.${ext}`;

  $("sc-video").addEventListener("click", async () => {
    if (busy) return;
    if (!videoType()) { msg("This browser cannot make videos. Save the image instead."); return; }
    busy = true; $("sc-video").disabled = true;
    try {
      const v = await recordVideo();
      if (v && v.blob.size) {
        download(v.blob, fileName(v.ext)); track("save");
        msg(v.ext === "mp4" ? "Video saved. Attach it to your post on X." : "Video saved. If X does not take it, save the image instead.");
      } else msg("Could not make the video. Save the image instead.");
    } catch (e) { msg("Could not make the video. Save the image instead."); }
    busy = false; $("sc-video").disabled = false;
  });
  $("sc-image").addEventListener("click", async () => {
    const b = await stillBlob();
    if (!b) { msg("Long press the card to save it."); return; }
    download(b, fileName("png")); track("save");
    msg("Saved. Attach it to your post on X.");
  });
  $("sc-post").addEventListener("click", () => track("share"));
  // Phones only allow sharing straight after a tap, so Share sends the video already made with Save video
  // (same card and name), or else the image, which is ready in a moment.
  $("sc-share").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try {
      let file = null;
      const v = lastVideo && lastVideo.key === `${pick}:${me && me.handle}` && lastVideo.ext === "mp4" ? lastVideo : null;
      if (v) file = new File([v.blob], fileName(v.ext), { type: v.blob.type });
      if (!file || !navigator.canShare({ files: [file] })) {
        const b = await stillBlob(); file = b && new File([b], fileName("png"), { type: "image/png" });
      }
      if (file) { await navigator.share({ files: [file], text: postText() }); track("share"); }
    } catch (e) { /* cancelled */ }
    busy = false;
  });

  // ---------- show it once someone has signed ----------
  async function show(m) {
    me = m;
    const ok = !!(m && m.status === "confirmed" && m.handle);
    box.hidden = !ok;
    if (!ok) { stop(); return; }
    $("sc-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText())}`;
    try { $("sc-share").hidden = !(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.png", { type: "image/png" })] })); } catch (e) { $("sc-share").hidden = true; }
    pickers();
    if (!art) await prepare();
    if (calm) still(); else { stop(); start(); }
  }
  addEventListener("pd:bookme", (e) => show(e.detail));
  if (window.pdBookMe) show(window.pdBookMe);
})();
