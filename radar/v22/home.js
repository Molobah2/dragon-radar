/* pdtools v2.2: the Sunrise Hatchery home.
   A bright morning on a floating island. Scrolling cracks the egg, Blinky, Pinky and Speed tumble out, the camera glides
   through the four parts of pdtools and ends on a sunny hilltop behind the rest of the home page.
   Everything on stage is a real 3D render: the paintings, the dragons and their clips, the eggs that crack on film, the
   clouds, rainbow, butterflies, confetti and title letters. Every dragon, egg, cloud, butterfly and letter answers a touch,
   and none of it leaves the page. */
(() => {
  "use strict";
  const A = window.PD22;
  const stageEl = document.getElementById("v22-stage"), track = document.getElementById("v22-track");
  if (!A || !stageEl || !track) return;
  const img = (src) => { const i = new Image(); i.decoding = "async"; i.src = src; return i; };
  const IM = { nb: img(A.nestBack), nf: img(A.nestFront), eggs: A.eggs.map(img) };
  // every pose each dragon has; the dragons move between them on their own and when touched
  const PIM = {};
  for (const [id, set] of Object.entries(A.poses)) { PIM[id] = {}; for (const [k, src] of Object.entries(set)) PIM[id][k] = img(src); }
  const ready = (i) => i.complete && i.naturalWidth > 0;
  // the painted scene (sky, far hills, the trees and meadow, the flowering bushes). Until a picture arrives, the scene
  // drawn in code stands in for it, so the page is never empty.
  // Each painting first arrives at a width that suits this screen (much smaller on phones and laptops); the full size
  // one follows quietly once the page is showing, ready for the camera's glide in.
  const cld = (src, w) => /res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(src) ? src.replace("/image/upload/", `/image/upload/c_limit,w_${w},q_auto/`) : src;
  const sceneW = Math.min(3200, Math.max(1280, Math.ceil(Math.max(innerWidth, innerHeight * 1.6) * Math.min(window.devicePixelRatio || 1, 2) / 320) * 320));
  const widthFor = (k) => k === "mid" && A.midExt ? Math.round(sceneW * (1 + 2 * A.midExt)) : sceneW;
  const SC = {}; for (const [k, src] of Object.entries(A.scene || {})) SC[k] = img(sceneW < 3200 ? cld(src, widthFor(k)) : src);
  function sharpenScene() {
    if (sceneW >= 3200) return;
    for (const [k, src] of Object.entries(A.scene || {})) {
      const hi = img(src); hi.onload = () => { SC[k] = hi; if (k === "mid") soft.mid = null; };
    }
  }
  const soft = {};
  const art = (k) => {
    const a = SC[k] && ready(SC[k]) ? SC[k] : null;
    if (!a || k !== "mid") return a;
    if (A.midExt) {                                            // the wide Hatchery painting: trees and meadow carry on past both ends
      if (!a.cw) { a.cw = a.naturalWidth / (1 + 2 * A.midExt); a.E = a.cw * A.midExt; }
      return a;
    }
    if (!soft.mid) {                                           // older painting: just fade its two ends
      const c = mk(a.naturalWidth, a.naturalHeight), g = c.getContext("2d");
      g.drawImage(a, 0, 0); g.globalCompositeOperation = "destination-in";
      const gr = g.createLinearGradient(0, 0, c.width, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.035, "#000"); gr.addColorStop(0.965, "#000"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height); soft.mid = c; c.naturalWidth = c.width; c.naturalHeight = c.height;
    }
    return soft.mid;
  };
  // real Creator Kit pieces, placed exactly as the team made them: the Hatchery banners, the lit braziers, the stone dais
  const KITI = {}; for (const [k, src] of Object.entries(A.kit || {})) KITI[k] = img(src);
  const kit = (k) => KITI[k] && ready(KITI[k]) ? KITI[k] : null;
  // real 3D renders for everything that used to be drawn in code. Until one arrives, its code version stands in.
  const F3 = A.fx3d || {}, F3I = {};
  for (const k of ["clouds", "bfly", "conf", "rainbow", "rays", "spark", "dust", "moss", "bfly2", "petals"]) if (F3[k]) F3I[k] = img(F3[k].src);
  const f3 = (k) => F3I[k] && ready(F3I[k]) ? F3I[k] : null;
  const EGI = {}; for (const [id, m] of Object.entries(F3.eggs || {})) EGI[id] = img(m.src);
  // one piece of a sheet of renders, centred on x, y and w wide; sx squeezes it (a wing beat, a tumbling flake)
  function piece(ctx, k, i, x, y, w, rot, a, sx) {
    const im = f3(k); if (!im || a <= 0.003) return !!im;
    const r = F3[k].r[i], h = w * r[3] / r[2];
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (sx != null && sx !== 1) ctx.scale(sx, 1); ctx.globalAlpha = a;
    ctx.drawImage(im, r[0], r[1], r[2], r[3], -w / 2, -h / 2, w, h); ctx.restore(); return true;
  }
  const near = new Map();          // the confetti piece closest in colour to what the moment asks for
  function confFor(group, col) {
    const key = group + col; if (near.has(key)) return near.get(key);
    const c = String(col).split(",").map(Number), G = F3.conf.g[group]; let best = G[0], bd = 1e9;
    for (const i of G) { const q = F3.conf.c[i], d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } }
    near.set(key, best); return best;
  }
  const bg = document.getElementById("v22-bg"), fg = document.getElementById("v22-fg");
  const bx = bg.getContext("2d"), fx = fg.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lite = reduce || window.PD_LITE || (navigator.deviceMemory && navigator.deviceMemory <= 2);

  // ---------- helpers ----------
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const seg = (v, a, b) => clamp((v - a) / (b - a));
  const ease = (t) => t * t * (3 - 2 * t);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const backOut = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // a painting's bottom edge carried on downward as its own mirror image, so the grass keeps going with no band or seam
  function mirrorDown(ctx, im, dx, dw, yb, fillH) {
    if (fillH <= 0) return;
    const s = dw / im.naturalWidth, sh = Math.min(im.naturalHeight * 0.45, fillH / s);
    ctx.save(); ctx.translate(0, yb * 2); ctx.scale(1, -1);
    ctx.drawImage(im, 0, im.naturalHeight - sh, im.naturalWidth, sh, dx, yb - sh * s, dw, sh * s); ctx.restore();
  }
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const DRAGON = { blinky: ["255,201,77", "255,236,150"], pinky: ["255,143,179", "255,210,226"], speed: ["255,150,60", "120,105,230"] };

  // ---------- timeline in screen heights of scroll ----------
  const T = { hero: 5.6, glideEnd: 6.6, ch: 6.6, chLen: 1.55, endStart: 12.8, endLen: 1.3 };   // three hatches need a longer opening
  const TRACK = T.endStart + T.endLen + 0.8;     // the hilltop holds a moment before the page content arrives

  // ---------- sizing ----------
  let W = 0, H = 0, DPR = 1, VH = 0, layout = null;
  function size() {
    const w = innerWidth, h = Math.max(innerHeight, document.documentElement.clientHeight);
    const widthChanged = w !== W;
    W = w; H = h;
    DPR = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.6 : 2);
    for (const c of [bg, fg]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
    if (widthChanged || !VH) { VH = H; track.style.height = Math.round(TRACK * VH) + "px"; }
    build();
  }

  // ---------- the scene, cached in layers ----------
  let L = {};
  function build() {
    const EH = Math.min(H * 0.3, W * 0.48);
    layout = { EH, cx: W / 2, base: H * 0.72, k: EH / 312 };
    // soft round sprites for glows
    L.tint = {};
    for (const [k, col] of Object.entries({ sun: "255,214,120", rose: "255,150,190", white: "255,250,235", blue: "140,170,255", mint: "130,230,190", gold: "255,201,77", lilac: "190,170,255" })) {
      const c = mk(64, 64), x = c.getContext("2d"); const q = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      q.addColorStop(0, `rgba(${col},1)`); q.addColorStop(0.3, `rgba(${col},.5)`); q.addColorStop(1, `rgba(${col},0)`); x.fillStyle = q; x.fillRect(0, 0, 64, 64); L.tint[k] = c;
    }
    makeSparks();
    buildEggs();
    buildParticles();
  }
  // small lights (pollen, the sparkle ring, the dash trail) are a real rendered twinkle, tinted in each glow's colour
  const SPK = new Map();
  const SPCOL = { sun: "255,214,120", rose: "255,150,190", white: "255,250,235", blue: "140,170,255", mint: "130,230,190", gold: "255,201,77", lilac: "190,170,255" };
  function makeSparks() {
    const sp = f3("spark"); SPK.clear(); if (!sp || !L.tint) return;
    for (const [k, c0] of Object.entries(L.tint)) {
      const c = mk(96, 96), x = c.getContext("2d"); x.drawImage(sp, 0, 0, 96, 96);
      x.globalCompositeOperation = "source-atop"; x.fillStyle = `rgba(${SPCOL[k]},.55)`; x.fillRect(0, 0, 96, 96);
      SPK.set(c0, c);
    }
  }
  if (F3I.spark) F3I.spark.addEventListener("load", () => makeSparks(), { once: true });

  // ---------- three eggs in one nest: real 3D eggs that crack open on film ----------
  // Each dragon hatches from its own egg, in its own colours. These are pdtools' own egg designs, never official kit
  // eggs (the Creator Kit asks not to invent official egg states). Speed's hatches first, then Pinky's, then Blinky's.
  const EGG_SPECS = [
    { id: "blinky", dx: 0, lift: 0.06, size: 1, tilt: 0, base: ["#fff8d6", "#ffe58a", "#f5c542", "#d9a21f"], spots: ["150,215,130", "255,255,235", "240,170,40"],
      crack: [0.44, 0.64], burst: 0.66 },
    { id: "pinky", dx: -0.6, lift: 0, size: 0.9, tilt: -0.11, base: ["#fff2f6", "#ffd0df", "#ff9fbf", "#e06f98"], spots: ["255,255,255", "255,120,160", "255,220,235"],
      crack: [0.26, 0.46], burst: 0.48 },
    { id: "speed", dx: 0.6, lift: 0, size: 0.9, tilt: 0.11, base: ["#fff0dc", "#ffc27a", "#ff9a3c", "#d96a1c"], spots: ["105,90,210", "70,60,170", "255,230,170"],
      crack: [0.06, 0.26], burst: 0.28 },
  ];
  let EGGS = [];
  function buildEggs() { EGGS = EGG_SPECS.map(buildEgg); }
  // an egg's size, and until its film arrives a simple rim (the film brings the real one)
  function buildEgg(spec) {
    const ry = layout.EH * 0.34 * spec.size, rx = ry * 0.84, v0 = -0.12, zz = [];
    for (let i = 0; i < 13; i++) { const f = i / 12; zz.push([(f * 2 - 1) * rx, v0 * ry + (i % 2 ? 0.06 : -0.04) * ry]); }
    return { spec, rx, ry, zz, v0 };
  }
  // where an egg sits on screen (its bottom centre, before the camera moves)
  // where an egg sits: settled down into the moss, not standing on top of it (PD22.eggSink tunes how deep)
  const eggSpot = (E) => ({ x: layout.cx + E.spec.dx * layout.EH, y: layout.base - E.spec.lift * layout.EH + (A.eggSink ?? 0.16) * layout.EH * (f3("moss") ? 1 : 0) });
  function belowLinePath(ctx, E) {
    const { zz, rx, ry } = E; ctx.beginPath(); ctx.moveTo(-rx * 2, zz[0][1]);
    for (const p of zz) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(rx * 2, zz[zz.length - 1][1]); ctx.lineTo(rx * 2, ry * 2); ctx.lineTo(-rx * 2, ry * 2); ctx.closePath();
  }
  const eggKick = { blinky: -9, pinky: -9, speed: -9 };
  // one egg: idle, cracking, or open with its shards flying; the dragon inside is drawn behind the lower shell
  // the egg on film: a real 3D egg cracking open, its frame chosen by the scroll so scrolling back closes it again
  function filmOf(E) {
    const m = F3.eggs && F3.eggs[E.spec.id], im = EGI[E.spec.id];
    if (!m || !im || !ready(im)) return null;
    if (E.film !== m) {               // once: the open shell's real rim and width replace the drawn egg's
      const ry = E.ry, half = ry * m.egg[2] / m.egg[3];
      E.film = m; E.rx = half;
      E.zz = m.rim.map(([u, v]) => [u * half, ry - v * 2 * ry]);
      E.v0 = E.zz.reduce((a, q) => a + q[1], 0) / E.zz.length / ry;
    }
    return { m, im };
  }
  function drawFilmEgg(ctx, E, F, p, alpha, insideDragon) {
    const { x, y } = eggSpot(E), { ry, spec } = E, m = F.m;
    const c0 = spec.crack[0], bu = spec.burst;
    const t = p < c0 ? m.cr * seg(p, c0 - 0.1, c0) : p < bu ? lerp(m.cr, m.bu, seg(p, c0, bu)) : lerp(m.bu, 1, seg(p, bu, bu + 0.14));
    const f = Math.round(clamp(t) * (m.n - 1)), opened = p >= bu - 0.005;
    const kick = Math.max(0, 1 - (clock - eggKick[spec.id]) / 0.7);
    const wob = opened ? 0 : kick * 0.16 * Math.sin(clock * 30) + 0.012 * Math.sin(clock * 2.2 + spec.dx * 3);
    const k = 2 * ry / m.egg[3], ex = m.egg[0] + m.egg[2] / 2, eb = m.egg[1] + m.egg[3];
    const col = f % m.cols, row = Math.floor(f / m.cols);
    const draw = () => ctx.drawImage(F.im, col * m.cw, row * m.ch, m.cw, m.ch, -ex * k, -eb * k, m.cw * k, m.ch * k);
    ctx.save(); ctx.translate(x, y); ctx.rotate(wob + (spec.tilt || 0) * (1 - seg(p, bu, bu + 0.1))); ctx.globalAlpha = alpha;
    draw();
    if (opened && insideDragon) {     // the dragon sits inside: behind the front of the shell, in front of its back wall
      insideDragon();
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(0, -ry); belowLinePath(ctx, E); ctx.clip(); ctx.translate(0, ry); draw(); ctx.restore();
    }
    ctx.restore();
    return { x, y, opened, crackG: seg(p, c0, spec.crack[1]), top: y - 2 * ry, openY: y - ry + E.v0 * ry };
  }
  function drawEgg(ctx, E, p, alpha, insideDragon) {
    const F = filmOf(E);
    if (F) return drawFilmEgg(ctx, E, F, p, alpha, insideDragon);
    const { x, y } = eggSpot(E), { ry, spec } = E;          // not loaded yet: nothing is drawn (the stage waits for it)
    return { x, y, opened: p >= spec.burst - 0.005, crackG: 0, top: y - 2 * ry, openY: y - ry + E.v0 * ry };
  }


  // ---------- living things ----------
  let P = {};
  function buildParticles() {
    const r = rng(99), n = (q) => Math.round(q * (lite ? 0.4 : 1) * clamp(W / 1100, 0.55, 1.2));
    P.burst = Array.from({ length: n(220) }, () => { const a = -Math.PI * (0.05 + r() * 0.9); return { a, s: 0.35 + Math.pow(r(), 0.6) * 1.25, life: 0.4 + r() * 0.6, size: 0.6 + r() * 1.2, kind: r() < 0.55 ? "petal" : r() < 0.7 ? "spark" : "conf", col: ["255,201,77", "255,143,179", "255,150,60", "255,255,255", "185,168,255"][Math.floor(r() * 5)], spin: (r() - 0.5) * 12 }; });
    P.clouds = Array.from({ length: lite ? 4 : 7 }, (_, i) => ({ x: r(), y: 0.08 + r() * 0.35, w: 0.12 + r() * 0.16, sp: 0.004 + r() * 0.008, ph: r() * 6, puff: -9, seed: i * 17 + 3 }));
    P.flies = Array.from({ length: n(12) }, () => ({ x: r(), y: 0.4 + r() * 0.4, ph: r() * 9, sp: 0.15 + r() * 0.3, sz: 0.8 + r() * 0.6, col: [["255,143,179", "255,201,77"], ["185,168,255", "255,255,255"], ["255,150,60", "255,230,120"], ["130,200,255", "255,255,255"]][Math.floor(r() * 4)], ox: 0, oy: 0 }));
    P.pollen = Array.from({ length: n(40) }, () => ({ x: r(), y: r(), sp: 0.01 + r() * 0.02, ph: r() * 6, sz: 0.5 + r() }));
    P.petals = Array.from({ length: n(14) }, () => ({ x: r(), y: r(), sp: 0.02 + r() * 0.03, rot: r() * 6, vr: (r() - 0.5) * 1.6, sz: 0.6 + r() * 0.8, ph: r() * 6, col: r() < 0.5 ? "255,190,214" : "255,248,240" }));
    P.spark = Array.from({ length: n(70) }, () => ({ a: r() * Math.PI * 2, rad: 0.5 + r() * 0.9, sp: 0.2 + r() * 0.6, ph: r(), sz: 0.4 + r() }));
  }
  function dot(ctx, spr, x, y, s, a) {
    if (a <= 0.003 || s <= 0.2) return;
    if (s < 14 && SPK.has(spr)) { spr = SPK.get(spr); s *= 1.7; }      // a small light: the rendered twinkle; big ones stay soft halos
    ctx.globalAlpha = a; ctx.drawImage(spr, x - s, y - s, s * 2, s * 2);
  }
  // the small things in the air are all real renders; one that has not loaded yet is simply not drawn
  const PETALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];
  function petal(ctx, x, y, s, rot, col, a) {
    if (F3.petals) piece(ctx, "petals", PETALS[(Math.round(s * 13) + col.length) % PETALS.length], x, y, s * 2.4, rot, a, Math.max(0.25, Math.abs(Math.cos(rot * 1.3))));
  }
  function heart(ctx, x, y, s, col, a) { if (F3.conf) piece(ctx, "conf", confFor("heart", col), x, y, s * 2, Math.sin(x * 0.05) * 0.2, a); }
  function star(ctx, x, y, s, col, a, rot = 0) { if (F3.conf) piece(ctx, "conf", confFor("star", col), x, y, s * 2.2, rot, a); }
  function cloud(ctx, x, y, w, puff, seed) {
    const k = puff > 0 ? easeOut(Math.min(1, puff)) : 0, back = puff > 1 ? ease(seg(puff, 1, 2.2)) : 0;
    if (F3.clouds) piece(ctx, "clouds", seed % 4, x, y - w * 0.05, w * 1.25 * (1 + (k - back) * 0.3), 0, 0.97 * (1 - (k - back) * 0.55));
  }
  const BFLY2 = { "255,143,179": 0, "255,150,60": 1, "130,200,255": 2, "185,168,255": 3 };
  function butterfly(ctx, x, y, s, col, t, ang) {
    const b2 = f3("bfly2"); if (!b2) return;     // a real 3D butterfly; its wings beat about its body
    const i = BFLY2[col[0]] ?? 1, r = F3.bfly2.r[i], bp = F3.bfly2.body[i], w = s * 3.2, h = w * r[3] / r[2];
    const beat = 0.45 + 0.55 * Math.abs(Math.cos(t * 9));
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang * 0.5); ctx.scale(1, beat);
    ctx.drawImage(b2, r[0], r[1], r[2], r[3], -bp[0] * w, -bp[1] * h, w, h); ctx.restore();
  }


  // ---------- touch: reactions and effects ----------
  let HIT = [];                       // what can be touched this frame (front-most last)
  const FX = [];                      // sparkles, hearts, confetti, dust
  const RX = {};                      // the reaction each dragon is playing
  const MOVES = { blinky: ["jump", "spin", "wiggle"], pinky: ["flutter", "twirl", "wink"], speed: ["zip", "button", "skid"] };
  const moveIdx = { blinky: 0, pinky: 0, speed: 0 };
  let clock = 0;
  function burst(x, y, kind, col, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = power * (0.4 + Math.random() * 0.8);
      FX.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.6, t0: clock, life: 0.7 + Math.random() * 0.7, kind, col: Array.isArray(col) ? col[i % col.length] : col, s: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
    }
  }
  const TAPS = {};
  function react(id, x, y, h) {
    if (ACT[id].clip) return;
    TAPS[id] = (TAPS[id] || 0) + 1;
    if (TAPS[id] % 2 === 1 && playClip(id, "react")) {
      const [c1, c2] = DRAGON[id];
      if (id === "blinky") burst(x, y - h * 0.6, "star", [c1, c2, "255,255,255"], 14, h * 1.3);
      if (id === "pinky") burst(x, y - h * 0.7, "heart", [c1, c2, "255,255,255"], 10, h * 1.1);
      if (id === "speed") burst(x, y - h * 0.5, "conf", [c1, c2, "255,201,77", "255,143,179", "120,200,255"], 20, h * 1.6);
      return;
    }
    const kind = MOVES[id][moveIdx[id]++ % 3];
    RX[id] = { kind, t0: clock };
    const POSE_FOR = { jump: ["wave", 1.4], spin: ["stand", 1.1], wiggle: ["popcorn", 2.6], flutter: ["wave", 1.6], twirl: ["look", 1.3], wink: ["sit", 2.2], zip: ["jump", 1.5], button: ["wave", 1.4], skid: ["look", 1.4] };
    setPose(id, ...POSE_FOR[kind]);
    const [c1, c2] = DRAGON[id];
    if (id === "blinky") burst(x, y - h * 0.6, "star", [c1, c2, "255,255,255"], 18, h * 1.4);
    if (id === "pinky") { burst(x, y - h * 0.7, "heart", [c1, c2, "255,255,255"], kind === "wink" ? 6 : 12, h * 1.1); }
    if (id === "speed" && kind === "button") burst(x, y - h * 0.5, "conf", [c1, c2, "255,201,77", "255,143,179", "120,200,255"], 34, h * 2.2);
    if (id === "speed" && kind === "skid") burst(x, y, "dust", ["230,220,200"], 10, h * 0.9);
  }
  // how a reaction moves a dragon right now: offsets in pixels and a rotation and stretch
  function moveNow(id, h) {
    const r = RX[id]; if (!r) return null;
    const e = clock - r.t0, k = r.kind;
    const out = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
    const done = (d) => { if (e > d) { delete RX[id]; return true; } return false; };
    if (k === "jump") { if (done(0.8)) return null; const q = e / 0.8; out.dy = -Math.sin(q * Math.PI) * h * 0.45; if (q > 0.85) { const s = Math.sin((q - 0.85) / 0.15 * Math.PI); out.sy = 1 - 0.14 * s; out.sx = 1 + 0.08 * s; } }
    else if (k === "spin") { if (done(0.9)) return null; out.rot = ease(e / 0.9) * Math.PI * 2; out.dy = -Math.sin(e / 0.9 * Math.PI) * h * 0.15; }
    else if (k === "wiggle") { if (done(0.8)) return null; out.rot = Math.sin(e * 28) * 0.14 * (1 - e / 0.8); out.sy = 1 + Math.sin(e * 20) * 0.04; }
    else if (k === "flutter") { if (done(1.1)) return null; out.dy = -Math.sin(e / 1.1 * Math.PI) * h * 0.35; out.sy = 1 + Math.sin(e * 30) * 0.06; }
    else if (k === "twirl") { if (done(0.9)) return null; out.sx = Math.cos(ease(e / 0.9) * Math.PI * 2); if (Math.abs(out.sx) < 0.08) out.sx = 0.08 * Math.sign(out.sx || 1); }
    else if (k === "wink") { if (done(0.7)) return null; out.sx = 1 + Math.sin(e / 0.7 * Math.PI) * 0.1; out.sy = 1 - Math.sin(e / 0.7 * Math.PI) * 0.08; out.rot = Math.sin(e * 9) * 0.08; }
    else if (k === "zip") {
      if (done(1.25)) return null;
      out.dx = e < 0.55 ? easeIn(e / 0.55) * W * 1.1 : -W * 1.1 * (1 - easeOut((e - 0.55) / 0.7));
      out.rot = 0.25; out.trail = true;
    }
    else if (k === "button") { if (done(0.8)) return null; out.dy = -Math.sin(e / 0.8 * Math.PI) * h * 0.25; out.sy = 1 + Math.sin(e * 24) * 0.05; }
    else if (k === "skid") { if (done(0.7)) return null; out.dx = Math.sin(e * 55) * 7 * (1 - e / 0.7); out.rot = -0.12 * (1 - e / 0.7); }
    return out;
  }
  function drawFX(ctx) {
    for (let i = FX.length - 1; i >= 0; i--) {
      const f = FX[i], e = clock - f.t0;
      if (e > f.life) { FX.splice(i, 1); continue; }
      const q = e / f.life, a = 1 - q * q;
      const grav = f.kind === "heart" ? -40 : f.kind === "dust" ? -10 : 420;
      const x = f.x + f.vx * e, y = f.y + f.vy * e + 0.5 * grav * e * e;
      if (f.kind === "star") star(ctx, x, y, f.s * (1 - q * 0.5), f.col, a, f.rot + f.vr * e);
      else if (f.kind === "heart") heart(ctx, x, y, f.s * 1.6, f.col, a);
      else if (f.kind === "conf" && F3.conf && piece(ctx, "conf", confFor("ribbon", f.col), x, y, f.s * 2.4, f.rot + f.vr * e, a)) { /* a real ribbon */ }
      else if (f.kind === "dust" && f3("dust")) { const im = f3("dust"), d = f.s * (1 + q * 2) * 2.6; ctx.globalAlpha = a * 0.75; ctx.drawImage(im, x - d / 2, y - d * 0.42, d, d * im.naturalHeight / im.naturalWidth); }
      else if (f.kind === "trail" && SPK.size) { const tc = f.col === DRAGON.speed[0] ? L.tint.sun : L.tint.lilac; ctx.save(); ctx.globalCompositeOperation = "lighter"; dot(ctx, tc, x, y, Math.max(1, f.s * (1 - q) * 1.4), a * 0.85); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- living dragons: nobody holds one pose ----------
  // Each dragon has a little routine of its own (standing, looking round, waving, sitting, snacking), turns to look at
  // the visitor's pointer, and changes pose when it reacts to a touch. A pose change pops with a quick squash.
  const IDLE = {
    blinky: [["stand", 3.4], ["look", 2.4], ["wave", 1.8], ["sit", 3.8], ["stand", 2.6], ["popcorn", 3.4]],
    pinky: [["wave", 2.2], ["stand", 3], ["look", 2.6], ["sit", 3.4], ["wave", 1.6], ["popcorn", 3]],
    speed: [["stand", 2.6], ["look", 2.2], ["jump", 1.2], ["wave", 1.6], ["sit", 2.8]],
  };
  const ACT = {};
  for (const id of Object.keys(IDLE)) ACT[id] = { pose: IDLE[id][0][0], prev: null, t: -9, until: 0, step: id.length, face: 1, x: 0, y: 0, seen: 0 };
  const has = (id, pose) => PIM[id] && PIM[id][pose] && ready(PIM[id][pose]);
  function setPose(id, pose, hold) {
    const a = ACT[id];
    if (!has(id, pose)) pose = "stand";
    if (a.pose !== pose) { a.prev = a.pose; a.pose = pose; a.t = clock; }
    a.until = clock + hold;
  }
  // ---------- real motion: short clips of each dragon, cut out frame by frame into one sheet ----------
  const CLIP = {};
  for (const [id, set] of Object.entries(A.clips || {})) { CLIP[id] = {}; for (const [k, c] of Object.entries(set)) CLIP[id][k] = { c, im: null }; }
  const clipReady = (id, k) => { const e = CLIP[id] && CLIP[id][k]; if (!e || lite) return false; if (!e.im) e.im = img(e.c.src); return ready(e.im); };
  function loadClips() {
    setTimeout(() => { for (const id in CLIP) if (CLIP[id].hatch) clipReady(id, "hatch"); }, 200);
    setTimeout(() => { for (const id in CLIP) for (const k in CLIP[id]) clipReady(id, k); }, 2500);
  }
  // a hatch clip held on one frame chosen by the scroll (t from 0 to 1), so scrolling back plays it backwards
  const scrubbing = (id) => !!(CLIP[id] && CLIP[id].hatch) && clipReady(id, "hatch");
  function playClip(id, k) {
    const a = ACT[id];
    if (a.clip || !clipReady(id, k)) return false;
    const c = CLIP[id][k].c;
    a.clip = { k, t0: clock }; a.until = clock + c.n / c.fps + 0.2; a.face = 1;
    return true;
  }
  // one frame of a clip, in the dragon's own frame (feet at 0,0); hb is the dragon's full standing height
  function clipDraw(ctx, e, f, hb) {
    const c = e.c, k = hb * (c.s || 1) / c.refH, col = f % c.cols, row = Math.floor(f / c.cols);
    ctx.drawImage(e.im, col * c.cw, row * c.ch, c.cw, c.ch, -c.refCx * k, -c.refBottom * k, c.cw * k, c.ch * k);
  }
  let lastMove = -9;
  function tickActors() {
    for (const id of Object.keys(ACT)) {
      const a = ACT[id];
      if (clock - a.seen > 0.5 || a.clip) continue;               // only the dragons on screen, and not mid clip
      const near = clock - lastMove < 1.6 && Math.abs(pX - a.x) < W * 0.32 && Math.abs(pY - (a.y - 60)) < H * 0.4;
      if (near && !RX[id] && a.until - clock < 0.6) { a.face = pX < a.x ? -1 : 1; if (has(id, "look")) setPose(id, "look", 1.2); continue; }
      if (clock > a.until && !RX[id]) {
        if (a.step % 4 === 3 && playClip(id, "idle")) { a.step++; continue; }   // now and then, a real little moment
        let tries = 0, next;
        do { next = IDLE[id][a.step++ % IDLE[id].length]; } while (!has(id, next[0]) && ++tries < 8);
        setPose(id, next[0], next[1] * (0.8 + Math.random() * 0.4));
        if (next[0] !== "look") a.face = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  // ---------- dragons ----------
  // Every pose drawn at the dragon's true size. h is a dragon's full standing height (the same for all three: one
  // creature, three builds). The kit renders share one camera, so their original heights set Blinky's and Pinky's
  // poses (standing is a crouch, 0.85 of upright); Speed's poses were matched by the width of his face mask.
  const KIT = { stand: 0.849, wave: 1, look: 0.825, sit: 0.788, popcorn: 0.786 };
  const FIT = { blinky: KIT, pinky: KIT, speed: { stand: 1, wave: 1, look: 1, sit: 0.923, jump: 1.148 } };
  const fit = (who, pose) => FIT[who][pose] || 1;
  function sprite(ctx, im, x, y, h, o = {}) {
    let prev = null, mix = 1, pop = 0, who = null, hp = h, hb = h, clipE = null, cf = 0, clipIn = 1, endE = null, endF = 0, endMix = 1;
    if (typeof im === "string") {                                // a living dragon: its pose right now
      who = im; const a = ACT[who];
      if (!o.pose && a.clip) {
        const e = CLIP[who][a.clip.k], el = clock - a.clip.t0; cf = Math.floor(el * e.c.fps);
        if (cf >= e.c.n) { a.clipEnd = { e, f: e.c.n - 1, t: clock }; a.clip = null; setPose(who, "stand", 2.2); a.prev = null; a.t = clock - 1; }
        else { clipE = e; clipIn = Math.min(1, el / 0.2); }
      }
      if (!o.pose && !clipE && a.clipEnd && clock - a.clipEnd.t < 0.22) { endE = a.clipEnd.e; endF = a.clipEnd.f; endMix = (clock - a.clipEnd.t) / 0.22; }
      const pose = o.pose && has(who, o.pose) ? o.pose : a.pose;
      const use = has(who, pose) ? pose : "stand";
      im = PIM[who][use]; hp = h; h *= fit(who, use);
      if (!o.pose) {
        a.seen = clock; a.x = x; a.y = y;
        const e = clock - a.t;
        if (a.prev && e < 0.22 && has(who, a.prev)) { prev = PIM[who][a.prev]; hp *= fit(who, a.prev); mix = e / 0.22; }
        if (e < 0.3) pop = Math.sin((e / 0.3) * Math.PI);
        if (pose === "look" && a.face < 0) o = { ...o, flip: !o.flip };
      }
    }
    let scrubE = null, scrubF = 0;
    if (who && o.scrub && clipReady(who, o.scrub.k)) { scrubE = CLIP[who][o.scrub.k]; scrubF = Math.round(clamp(o.scrub.t) * (scrubE.c.n - 1)); }
    if (!ready(im) || h <= 1) return;
    const w = h * im.naturalWidth / im.naturalHeight;
    let rot = o.rot || 0, sx = o.sx || 1, sy = o.sy || 1;
    const m = o.id ? moveNow(o.id, h) : null;
    if (m) {
      x += m.dx; y += m.dy; rot += m.rot; sx *= m.sx; sy *= m.sy;
      if (m.trail && Math.random() < 0.9) FX.push({ x: x + (Math.random() - 0.5) * w * 0.3, y: y - h * (0.3 + Math.random() * 0.4), vx: 0, vy: 0, t0: clock, life: 0.5, kind: "trail", col: Math.random() < 0.5 ? DRAGON.speed[0] : DRAGON.speed[1], s: h * 0.06 });
    }
    if (pop) { sy *= 1 - 0.07 * pop; sx *= 1 + 0.05 * pop; }
    ctx.save(); ctx.translate(x + tiltX * 6, y + tiltY * 4); if (rot) ctx.rotate(rot);
    ctx.scale((o.flip ? -1 : 1) * sx, sy);
    const alpha = o.alpha == null ? 1 : o.alpha;
    if (o.shadow) { ctx.globalAlpha = alpha * 0.25; ctx.fillStyle = "#2a5a30"; ctx.beginPath(); ctx.ellipse(0, 0, w * 0.32, h * 0.04, 0, 0, 7); ctx.fill(); }
    if (scrubE) { ctx.globalAlpha = alpha; clipDraw(ctx, scrubE, scrubF, hb); }
    else if (clipE) {                                          // a real clip frame, faded in over the pose it starts from
      if (clipIn < 1) { ctx.globalAlpha = alpha * (1 - clipIn); ctx.drawImage(im, -w / 2, -h, w, h); }
      ctx.globalAlpha = alpha * clipIn; clipDraw(ctx, clipE, cf, hb);
    } else {
      if (prev && ready(prev)) { const pw = hp * prev.naturalWidth / prev.naturalHeight; ctx.globalAlpha = alpha * (1 - mix); ctx.drawImage(prev, -pw / 2, -hp, pw, hp); }
      ctx.globalAlpha = alpha * (prev ? mix : 1) * endMix;
      ctx.drawImage(im, -w / 2, -h, w, h);
      if (endE) { ctx.globalAlpha = alpha * (1 - endMix); clipDraw(ctx, endE, endF, hb); }
    }
    ctx.restore();
    if (o.id && alpha > 0.4) HIT.push({ id: o.id, x0: x - w * 0.4, x1: x + w * 0.4, y0: y - h, y1: y, x, y, h });
  }
  function quad(a, b, c, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]; }

  // ---------- title letters ----------
  const pd = document.getElementById("v22-pd");
  const LCOL = ["#f2b84b", "#f2b84b", "", "#f2b84b", "#f2b84b", "#f2b84b", "#f2b84b", "#f2b84b"];   // only until the 3D letters arrive
  const letters = [..."PD TOOLS"].map((ch, i) => {
    const s = document.createElement("span");
    if (ch === " ") { s.className = "gap"; s.innerHTML = "&nbsp;"; } else { s.textContent = ch; s.style.setProperty("--c", LCOL[i]); }
    pd.appendChild(s); return s;
  });
  // the letters are real 3D renders (ivory faces, honey gold sides) once their sheet arrives; text stands in until then
  if (A.fx3d && A.fx3d.title) {
    const TT = A.fx3d.title, ti = img(TT.src);
    const dress = () => letters.forEach((s) => {
      const i = TT.ch.indexOf(s.textContent); if (i < 0) return;
      const r = TT.r[i], u = (v) => (v / TT.h).toFixed(4) + "em";
      s.classList.add("l3"); s.style.width = u(r[2]);
      s.style.backgroundImage = `url("${TT.src}")`; s.style.backgroundSize = `${u(TT.w)} 1em`; s.style.backgroundPosition = `-${u(r[0])} 0`;
    });
    if (ready(ti)) dress(); else ti.addEventListener("load", dress, { once: true });
  }
  const jelly = (s) => { if (s.classList.contains("gap")) return; s.classList.remove("jelly"); void s.offsetWidth; s.classList.add("jelly"); };
  letters.forEach((s) => { s.addEventListener("pointerenter", () => jelly(s)); s.addEventListener("pointerdown", () => jelly(s)); s.addEventListener("animationend", () => s.classList.remove("jelly")); });
  const chaps = [...document.querySelectorAll(".v22-chap")].map((el, i) => {
    const h3 = el.querySelector("h3"), word = h3.textContent; h3.textContent = "";
    const col = ["#f0a400", "#ff5c97", "#6c7cff", "#21b98f"][i] || "#f0643f";
    el.style.setProperty("--c", col);
    return { el, spans: [...word].map((c) => { const s = document.createElement("span"); s.textContent = c; h3.appendChild(s); return s; }) };
  });
  const hint = document.getElementById("v22-hint"), skip = document.getElementById("v22-skip");
  const t0 = performance.now();

  // ---------- scroll, touch and tilt ----------
  let target = 0, cur = 0, tiltX = 0, tiltY = 0, tiltTX = 0, tiltTY = 0, pX = -999, pY = -999;
  const readScroll = () => { target = scrollY / VH; };
  addEventListener("scroll", readScroll, { passive: true });
  addEventListener("resize", () => { size(); readScroll(); });
  skip.addEventListener("click", () => { const t = document.getElementById("tools"); if (t) t.scrollIntoView({ behavior: "auto" }); });
  // the page content sits above the stage, so a touch reaches the scene only through empty space
  const onScene = (t) => t === document.body || t === document.documentElement || t.classList.contains("wrap") || !!t.closest(".v22-track,.v22-stage");
  const letterAt = (x, y) => letters.find((s) => { if (s.classList.contains("gap") || +s.style.opacity < 0.5) return false; const r = s.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
  let lastLetter = null;
  addEventListener("pointermove", (e) => {
    pX = e.clientX; pY = e.clientY; lastMove = clock;
    if (e.pointerType === "mouse") { tiltTX = (e.clientX / W) * 2 - 1; tiltTY = (e.clientY / H) * 2 - 1; }
    const scene = onScene(e.target), l = scene ? letterAt(e.clientX, e.clientY) : null;
    if (l && l !== lastLetter) jelly(l);
    lastLetter = l;
    document.documentElement.style.cursor = scene && (l || hitAt(e.clientX, e.clientY)) ? "pointer" : "";
  }, { passive: true });
  addEventListener("deviceorientation", (e) => { if (e.gamma == null) return; tiltTX = clamp(e.gamma / 30, -1, 1); tiltTY = clamp((e.beta - 45) / 30, -1, 1); }, { passive: true });
  function hitAt(x, y) {
    for (let i = HIT.length - 1; i >= 0; i--) { const h = HIT[i]; if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h; }
    return null;
  }
  let eggTaps = [];
  addEventListener("pointerdown", (e) => {
    if (!onScene(e.target)) return;
    const l = letterAt(e.clientX, e.clientY);
    if (l) { jelly(l); return; }
    const h = hitAt(e.clientX, e.clientY);
    if (h) {
      if (h.id.startsWith("egg:")) {
        const id = h.id.slice(4), E = eggOf(id);
        eggKick[id] = clock; eggTaps = eggTaps.filter((t) => clock - t.t < 2.5 && t.id === id).concat({ id, t: clock });
        burst(h.x, h.y - h.h * 0.5, "star", [...DRAGON[id], "255,255,255"], 8, h.h * 0.8);
        if (eggTaps.length >= 3) { eggTaps = []; scrollTo({ top: VH * T.hero * (E.spec.burst + 0.03), behavior: reduce ? "auto" : "smooth" }); }   // three knocks: it hatches now
      } else if (h.id.startsWith("cloud")) { P.clouds[+h.id.slice(5)].puff = clock; }
      else react(h.id, h.x, h.y, h.h);
      return;
    }
  });

  // ---------- the stage shows only once its real art is in (or after 9 s whatever has come), never a stand in ----------
  const MUST = () => [SC.sky, SC.mid, SC.ground, SC.front, IM.nb, IM.nf, ...Object.values(EGI), F3I.moss, F3I.clouds].filter(Boolean);
  let shown = false;
  function reveal() { shown = true; document.body.classList.add("v22-ready"); loadClips(); setTimeout(sharpenScene, 1200); }

  // ---------- frame ----------
  function frame(now) {
    requestAnimationFrame(frame);
    if (!shown && (now - t0 > 9000 || MUST().every((i) => i.complete))) reveal();
    const time = reduce ? 0 : (now - t0) / 1000;
    clock = (now - t0) / 1000;
    if (Math.abs(target - cur) > 1.5) cur = target;          // a big jump (skip, a link to the tools) lands at once, never replays the story
    cur += (target - cur) * (reduce ? 1 : 0.11);
    if (Math.abs(target - cur) < 0.0005) cur = target;
    tiltX += (tiltTX - tiltX) * 0.06; tiltY += (tiltTY - tiltY) * 0.06;
    HIT = [];
    tickActors();
    const v = cur;
    const p = clamp(v / T.hero), gl = ease(seg(v, T.hero, T.glideEnd));
    const { EH, cx, base, k } = layout;
    const shakeAmt = EGGS.reduce((m, E) => Math.max(m, Math.exp(-Math.pow((p - E.spec.burst - 0.005) / 0.012, 2))), 0) * EH * 0.018;
    const shx = shakeAmt * Math.sin(clock * 90), shy = shakeAmt * Math.cos(clock * 77);

    // ===== back: sky, clouds, hills, ground =====
    bx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const skyArt = art("sky");
    if (skyArt) {                                              // cover the screen, keeping the top of the sky
      const sw = W + 12, sh = H + 8, k2 = Math.max(sw / skyArt.naturalWidth, sh / skyArt.naturalHeight);
      const dw = skyArt.naturalWidth * k2, dh2 = skyArt.naturalHeight * k2;
      bx.drawImage(skyArt, (sw - dw) / 2 - tiltX * 6, (sh - dh2) * 0.35 - tiltY * 4, dw, dh2);
    }
    P.clouds.forEach((c, i) => {
      const x = (((c.x + time * c.sp) % 1.3) - 0.15) * W - tiltX * 10, y = c.y * H - gl * H * 0.08 - tiltY * 6, w = c.w * W;
      cloud(bx, x, y, w, c.puff > -9 ? clock - c.puff : 0, c.seed);
      if (c.puff > -9 && clock - c.puff > 2.4) c.puff = -9;
      HIT.push({ id: "cloud" + i, x0: x - w * 0.5, x1: x + w * 0.5, y0: y - w * 0.2, y1: y + w * 0.15, x, y, h: w * 0.3 });
    });
    // the ending's rainbow rises behind the Hatchery, so the wall and the hill stand in front of it
    const enB = seg(v, T.endStart - 0.2, T.endStart + T.endLen * 0.6), rbB = f3("rainbow");
    if (enB > 0 && rbB) {
      const R = Math.max(Math.min(W * 0.55, H * 0.7), H * 0.5) * (0.6 + 0.4 * easeOut(enB)), rw = R * 2.15, rh = rw * rbB.naturalHeight / rbB.naturalWidth;
      bx.globalAlpha = 0.95 * ease(enB); bx.drawImage(rbB, cx - rw / 2 - tiltX * 10, H * 0.8 + R * 0.15 - rh * 0.93 - tiltY * 6, rw, rh); bx.globalAlpha = 1;
    }
    const layer = (im, depth, paint) => {
      const z = 1 + gl * depth, w = W * 1.5 * z, h = H * 1.2 * z;
      const x0 = cx - w / 2 - tiltX * 14 * depth, y0 = H * 0.62 - h * 0.6 + gl * H * 0.1 * depth - tiltY * 8 * depth;
      const a = paint && art(paint.k);
      if (!a) return;
      // the painting sits in the same frame the coded layer used (1.5 screens wide, 1.2 high), its line on the old line
      const PW = W * 1.5, PH = H * 1.2, s2 = w / PW, aw = paint.fit(PW), ah = aw * a.naturalHeight / (a.cw || a.naturalWidth);
      const ax = (PW - aw) / 2, ay = paint.lineY * PH - paint.lineAt * ah, bot = ay + ah;
      const ext = a.E ? a.E / a.cw : 0, ex = x0 + (ax - aw * ext) * s2, ew = aw * (1 + 2 * ext) * s2;
      bx.drawImage(a, ex, y0 + ay * s2, ew, ah * s2);
      if (bot < PH) {
        const fy = y0 + bot * s2 - 1, fh = (PH - bot) * s2 + 2;
        if (!a.E) { bx.fillStyle = paint.fill; bx.fillRect(x0, fy, w, fh); }
        else mirrorDown(bx, a, ex, ew, fy + 1, fh);                // the meadow carries on below the painting
      }
      if (paint.after) paint.after(x0 + ax * s2, y0 + ay * s2, aw * s2, ah * s2);
    };
    // the Hatchery's own pieces on the painted entrance: a banner on each wall panel, a lit brazier each side of the door
    const dressHatchery = (X, Y, AW, AH) => {
      const bn = kit("banner"), br = kit("brazier");
      if (bn) [0.2655, 0.7363].forEach((fxp, i) => {
        const h = AH * 0.31, w = h * bn.naturalWidth / bn.naturalHeight;
        bx.save(); bx.translate(X + AW * fxp, Y + AH * 0.338); bx.rotate(Math.sin(clock * 1.1 + i * 2.1) * 0.018);
        bx.drawImage(bn, -w / 2, 0, w, h); bx.restore();
      });
      if (br) [0.17, 0.83].forEach((fxp, i) => {                // by the corner pillars, clear of the nest
        const h = AH * 0.3, w = h * br.naturalWidth / br.naturalHeight, x = X + AW * fxp, y = Y + AH * 0.9;
        bx.drawImage(br, x - w / 2, y - h, w, h);
        const fl = 0.75 + 0.25 * Math.sin(clock * 9 + i * 1.7) * Math.sin(clock * 5.3 + i);
        bx.save(); bx.globalCompositeOperation = "lighter"; dot(bx, L.tint.sun, x, y - h * 0.86, h * 0.42, 0.35 * fl); bx.restore();
      });
    };
    if (SC.far) layer(null, 0.35, { k: "far", lineY: 0.56, lineAt: 0.37, fill: "rgb(125,167,135)", fit: (PW) => Math.max(PW, H * 1.1) });
    layer(null, 1.1, { k: "mid", lineY: 0.69, lineAt: 0.887, fill: "rgb(139,146,72)", fit: () => Math.max(W * 0.78, H * 0.55), after: dressHatchery });
    const gz = 1 + gl * 2.2;
    const gA = art("ground"), gY = base - H * 0.06 * gz + gl * H * 0.6;
    if (gA) {                                                  // the painted hilltop: its brow just above the nest's foot
      const aw = Math.max(W, H * 0.97) * gz, ah = aw * gA.naturalHeight / gA.naturalWidth, ay = gY + H * 0.04 * gz - 0.48 * ah;
      bx.drawImage(gA, cx - aw / 2 - tiltX * 20, ay, aw, ah);
      // below the painting its own grass carries on down to the bottom of the screen (no flat colour band)
      if (ay + ah < H) mirrorDown(bx, gA, cx - aw / 2 - tiltX * 20, aw, ay + ah, H - ay - ah + 1);
    }

    // ===== title =====
    // on short wide screens the letters would sit on the Hatchery banners: lift them, then shrink them just enough to clear
    const ma = SC.mid && ready(SC.mid) ? SC.mid : null, mR = ma ? ma.naturalHeight / (ma.naturalWidth / (1 + 2 * (A.midExt || 0))) : 1358 / 3200;
    const bannerTop = H * 0.728 - (0.887 - 0.338) * Math.max(W * 0.78, H * 0.55) * mR - 10;   // the mid layer and banner maths at rest
    let tf = Math.max(54, Math.min(W * 0.15, 200));
    let titleTop = Math.max(84, base - EH - tf * 1.05 - (W < 700 ? H * 0.05 : 0));
    if (W >= 700 && titleTop + tf * 0.9 > bannerTop) {
      titleTop = Math.max(84, bannerTop - tf * 0.9);
      if (titleTop + tf * 0.9 > bannerTop) tf = Math.max(54, (bannerTop - titleTop) / 0.9);
    }
    const tfs = tf < Math.max(54, Math.min(W * 0.15, 200)) - 0.5 ? Math.round(tf) + "px" : "";
    if (pd.style.fontSize !== tfs) pd.style.fontSize = tfs;
    pd.style.transform = `translate3d(${-tiltX * 8}px,${titleTop - gl * H * 0.2 - tiltY * 5}px,0)`;
    const out = ease(seg(p, 0.2, 0.42));
    const titleT = (now - t0) / 1000;
    letters.forEach((s, i) => {
      const inT = reduce ? 1 : easeOut(clamp(titleT * 1.6 - i * 0.09 - 0.15));
      const bob = reduce ? 0 : Math.sin(clock * 1.6 + i * 0.7) * 6;
      s.style.transform = `translate3d(${(i - 3.5) * out * 26}px,${(1 - inT) * 60 - out * (40 + (i % 3) * 30) + bob}px,0) rotate(${out * (i - 3.5) * 3}deg)`;
      s.style.opacity = (inT * (1 - out)).toFixed(3);
      s.style.pointerEvents = out > 0.5 ? "none" : "";
    });
    hint.style.opacity = (1 - seg(v, 0.02, 0.3)).toFixed(2);
    skip.hidden = v > T.endStart;

    // ===== front: the nest with three eggs =====
    fx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fx.clearRect(0, 0, W, H);
    const camZ = 1 + gl * 1.8;
    fx.save();
    fx.translate(cx + shx - tiltX * 18, base + shy + gl * H * 0.75 - tiltY * 8);
    fx.scale(camZ, camZ);
    fx.translate(-cx, -base);
    const sceneAlpha = 1 - seg(gl, 0.55, 0.95);
    fx.globalAlpha = sceneAlpha;
    if (sceneAlpha > 0.01) {
      // sunbeams from whichever egg is cracking
      if (!lite) for (const E of EGGS) {
        const sp = E.spec, rays = ease(seg(p, sp.crack[0], sp.crack[1])) * (1 - seg(p, sp.burst, sp.burst + 0.1));
        if (rays <= 0.01) continue;
        const { x, y } = eggSpot(E), rays3 = f3("rays");
        if (!rays3) continue;           // a real burst of morning light behind the cracking egg
        const s2 = H * 0.95 * (0.8 + 0.2 * rays);
        fx.save(); fx.translate(x, y - E.ry); fx.rotate(clock * 0.05 + sp.dx); fx.globalCompositeOperation = "lighter";
        fx.globalAlpha = sceneAlpha * 0.7 * rays; fx.drawImage(rays3, -s2 / 2, -s2 / 2, s2, s2); fx.restore(); fx.globalAlpha = sceneAlpha;
      }
      // one wide nest that holds all three
      const nk = k * 1.05, nsx = 1.45, nx = cx - 264 * nk * nsx, ny = base - 306 * nk, nw = 520 * nk * nsx, nh = 465 * nk;
      const ds = kit("dais");
      if (ds) { const dw = nw * 0.8, dh2 = dw * ds.naturalHeight / ds.naturalWidth; fx.drawImage(ds, cx - dw / 2, ny + nh * 0.9 - dh2 * 0.45, dw, dh2); }
      if (ready(IM.nb)) fx.drawImage(IM.nb, nx, ny, nw, nh);
      // a soft bed of moss and straw inside the nest, where the eggs sit: a real 3D render
      const moss = f3("moss");
      const MW = 270 * nk * nsx * 1.04, MH = MW * 0.31, MX = cx - MW / 2, MY = ny + 262 * nk - MH * 0.5;
      if (moss) {
        fx.drawImage(moss, MX, MY, MW, MH);
        for (const E of EGGS) {           // a soft shadow where each egg presses into the moss
          const { x, y } = eggSpot(E), r2 = E.ry * 1.25, g2 = fx.createRadialGradient(x, y, 0, x, y, r2);
          g2.addColorStop(0, "rgba(22,32,6,.62)"); g2.addColorStop(0.55, "rgba(30,45,10,.3)"); g2.addColorStop(1, "rgba(30,45,10,0)");
          fx.save(); fx.translate(x, y); fx.scale(1, 0.4); fx.translate(-x, -y); fx.fillStyle = g2; fx.beginPath(); fx.arc(x, y, r2, 0, 7); fx.fill(); fx.restore();
        }
      }
      for (const E of EGGS) {   // Blinky's egg sits in the middle, a little behind the other two
        const id = E.spec.id;
        const info = drawEgg(fx, E, p, sceneAlpha, () => emergeDragon(fx, id, true));
        if (!info.opened && sceneAlpha > 0.5 && gl <= 0) HIT.push({ id: "egg:" + id, x0: info.x - E.rx, x1: info.x + E.rx, y0: info.top, y1: info.y, x: info.x, y: info.y, h: 2 * E.ry });
      }
      if (moss) for (const E of EGGS) {   // the moss wraps each egg's foot: its lower shell sits in shade
        const { x, y } = eggSpot(E), r3 = E.rx * 1.2, cy3 = y - E.ry * 0.28, g3 = fx.createRadialGradient(x, cy3, 0, x, cy3, r3);
        g3.addColorStop(0, "rgba(35,48,14,.5)"); g3.addColorStop(0.6, "rgba(35,48,14,.28)"); g3.addColorStop(1, "rgba(35,48,14,0)");
        fx.save(); fx.globalCompositeOperation = "multiply"; fx.translate(x, cy3); fx.scale(1, 0.42); fx.translate(-x, -cy3);
        fx.fillStyle = g3; fx.beginPath(); fx.arc(x, cy3, r3, 0, 7); fx.fill(); fx.restore();
      }
      if (moss) {                         // the front of the moss bed comes up softly around the eggs' feet
        const lo = A.mossLip ?? 0.38, key = Math.round(MW) + ":" + lo;
        if (!L.lip || L.lip.key !== key) {
          const c = mk(MW, MH), g = c.getContext("2d"); g.drawImage(moss, 0, 0, MW, MH);
          const gr = g.createLinearGradient(0, 0, 0, MH); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(lo, "rgba(0,0,0,0)"); gr.addColorStop(Math.min(1, lo + 0.18), "#000"); gr.addColorStop(1, "#000");
          g.globalCompositeOperation = "destination-in"; g.fillStyle = gr; g.fillRect(0, 0, MW, MH); c.key = key; L.lip = c;
        }
        fx.drawImage(L.lip, MX, MY, MW, MH);
      }
      if (ready(IM.nf)) fx.drawImage(IM.nf, nx, ny, nw, nh);
      // each egg's burst, in its dragon's colours and tied to the scroll so it rewinds
      for (const E of EGGS) {
        const sp = E.spec, bt = (p - sp.burst) / 0.24;
        if (bt <= 0 || bt > 1.05) continue;
        const { x, y } = eggSpot(E), oy = y - E.ry + E.v0 * E.ry, pal = [...DRAGON[sp.id], "255,255,255", "255,236,150"];
        for (const b of P.burst) {
          if (bt > b.life) continue;
          const tt = bt / b.life, d = b.s * EH * 1.6 * easeOut(bt);
          const bx2 = x + Math.cos(b.a) * d, by = oy + Math.sin(b.a) * d * 0.85 - EH * 0.5 * bt + EH * 0.8 * bt * bt;
          const a = (1 - tt * tt) * sceneAlpha, s = (1 - tt * 0.5) * EH * 0.026 * b.size + 1.5, col = pal[Math.floor(b.size * 7) % pal.length];
          if (b.kind === "petal") petal(fx, bx2, by, s, b.spin * bt, col, a);
          else if (b.kind === "conf" && F3.conf && piece(fx, "conf", confFor("ribbon", col), bx2, by, s * 2.4, b.spin * bt, a)) { /* a real ribbon */ }
          else star(fx, bx2, by, s * 1.2, col, a, b.spin * bt);
        }
        fx.globalAlpha = 1;
        const flash = Math.exp(-Math.pow((p - sp.burst - 0.008) / 0.014, 2));
        if (flash > 0.01) { fx.globalCompositeOperation = "lighter"; dot(fx, L.tint.white, x, y - E.ry, H * 0.55, 0.55 * flash * sceneAlpha); fx.globalCompositeOperation = "source-over"; }
      }
      fx.globalAlpha = sceneAlpha;
      if (gl <= 0) for (const id of ["blinky", "pinky", "speed"]) emergeDragon(fx, id, false);
    }
    fx.restore(); fx.globalAlpha = 1;
    if (gl > 0 && gl < 1) glideDragons(fx, gl);

    // ===== chapters =====
    const cv = v - T.ch;
    for (let i = 0; i < chaps.length; i++) {
      const c = (cv - i * T.chLen) / T.chLen, el = chaps[i];
      if (c > -0.1 && c < 1.1) chapter(fx, i, c);
      const inA = ease(seg(c, 0.08, 0.25)), outA = 1 - ease(seg(c, 0.8, 0.95)), a = Math.min(inA, outA);
      el.el.style.opacity = a.toFixed(3);
      el.el.style.transform = `translate3d(0,${(1 - inA) * 30 - (1 - outA) * 30}px,0)`;
      el.spans.forEach((s, j) => {
        const lt = easeOut(seg(c, 0.1 + j * 0.018, 0.28 + j * 0.018)), lo = ease(seg(c, 0.8 + j * 0.008, 0.92 + j * 0.008));
        s.style.transform = `translate3d(0,${(1 - lt) * 60 - lo * 50}px,0) rotate(${(1 - lt) * 8}deg)`;
        s.style.opacity = (lt * (1 - lo)).toFixed(3);
      });
    }
    // ===== the hilltop at the end, which stays behind the rest of the home page =====
    const en = seg(v, T.endStart - 0.2, T.endStart + T.endLen * 0.6);
    if (en > 0) ending(fx, en);

    // butterflies, pollen and petals everywhere
    for (const b of P.flies) {
      let x = b.x * W + Math.sin(time * b.sp + b.ph) * 60 + Math.sin(time * 0.3 + b.ph) * 40, y = b.y * H + Math.cos(time * b.sp * 1.3 + b.ph) * 40;
      const dx = x + b.ox - pX, dy = y + b.oy - pY, d = Math.hypot(dx, dy);
      if (d < 140) { b.ox += (dx / (d || 1)) * 9; b.oy += (dy / (d || 1)) * 9; }
      b.ox *= 0.96; b.oy *= 0.96;
      x += b.ox; y += b.oy;
      butterfly(fx, x, y, 7 * b.sz, b.col, clock + b.ph, Math.sin(time + b.ph) * 0.4);
    }
    fx.globalCompositeOperation = "lighter";
    for (const q of P.pollen) {
      const x = ((q.x + Math.sin(time * 0.2 + q.ph) * 0.02) * W), y = (((q.y - time * q.sp) % 1) + 1) % 1 * H;
      dot(fx, L.tint.sun, x, y, 2 + q.sz * 2, 0.3 + 0.3 * Math.sin(time * 2 + q.ph));
    }
    fx.globalCompositeOperation = "source-over"; fx.globalAlpha = 1;
    const fz = 1 + gl * 1.6;
    fx.globalAlpha = 1 - seg(gl, 0.6, 1) * 0.5;
    const fr = art("front"), fX = cx - W * fz / 2 - tiltX * 26, fY = H - H * fz + gl * H * 0.25 - tiltY * 10;
    if (fr) {                                                  // the painting's two halves, each held in its own corner
      const bh = Math.min(H * 0.5, W * 0.45) * fz, bw = bh * (fr.naturalWidth / 2) / fr.naturalHeight, hw = fr.naturalWidth / 2;
      fx.drawImage(fr, 0, 0, hw, fr.naturalHeight, fX, fY + H * fz - bh, bw, bh);
      fx.drawImage(fr, hw, 0, hw, fr.naturalHeight, fX + W * fz - bw, fY + H * fz - bh, bw, bh);
    }
    fx.globalAlpha = 1;
    for (const lf of P.petals) {
      const x = ((lf.x - time * lf.sp * 0.5) % 1 + 1) % 1, y = ((lf.y + time * lf.sp) % 1);
      const s = Math.min(W, H) * 0.012 * lf.sz;
      petal(fx, x * (W + 2 * s) - s, y * (H + 2 * s) - s, s, lf.rot + time * lf.vr + Math.sin(time + lf.ph) * 0.5, lf.col, 0.9);
    }
    drawFX(fx);
    // after the journey the hilltop softens so the rest of the home page reads clearly on top
    const veil = seg(v, TRACK - 1, TRACK) * 0.45;
    if (veil > 0) { fx.fillStyle = `rgba(28,64,110,${veil})`; fx.fillRect(0, 0, W, H); }
  }

  // when each dragon comes out of its egg (share of the hero scroll)
  const BLINKY_HOP = [0.33, 0.57], handed = {};
  const OUT = { speed: [0.29, 0.40], pinky: [0.49, 0.64], blinky: [0.67, 0.82] }, INSIDE = { speed: 0.12, pinky: 0.25, blinky: 0.3 };
  const eggOf = (id) => EGGS.find((E) => E.spec.id === id);
  // a dragon climbing out of its own egg. Inside the egg's frame (origin at the egg's bottom) while still in the shell,
  // on the screen once it is out.
  function emergeDragon(ctx, id, inside) {
    const { EH, cx, base } = layout, hFull = EH * 0.82, E = eggOf(id), pp = cur / T.hero;
    const prog = seg(pp, OUT[id][0], OUT[id][1]);
    if (prog <= 0 || (inside ? prog >= INSIDE[id] : prog < INSIDE[id])) return;
    const spot = eggSpot(E), ox = inside ? spot.x : 0, oy = inside ? spot.y : 0;   // inside: draw relative to the egg
    const start = [spot.x, spot.y - E.ry + E.v0 * E.ry + E.ry * 0.45];
    const at = (x, y) => [x - ox, y - oy];
    // once out, the living dragon takes over: the clip's last frame fades into it, as after a tap clip
    if (id !== "speed" && !inside) {
      if (prog >= 1 && !handed[id] && scrubbing(id)) { const e = CLIP[id].hatch; ACT[id].clipEnd = { e, f: e.c.n - 1, t: clock }; }
      handed[id] = prog >= 1;
    }
    if (id === "speed") {
      if (prog >= 1) return;
      const a = easeIn(prog) * 0.6 + prog * 0.4, end = [W * 1.25, H * 0.08], ctrl = [start[0] + EH * 0.3, start[1] - EH * 2.2];
      const h = hFull * (0.45 + 0.75 * a);
      for (let gI = 6; gI >= 0; gI--) {
        const aa = Math.max(0, a - gI * 0.045), pt = quad(start, ctrl, end, aa), nx = quad(start, ctrl, end, Math.min(1, aa + 0.02));
        const rot = Math.atan2(nx[1] - pt[1], nx[0] - pt[0]) * 0.35 + 0.3, [px, py] = at(pt[0], pt[1]);
        const sc = scrubbing("speed") ? { k: "hatch", t: clamp(aa / 0.5) } : null;   // real launch, then the held dash
        const r2 = sc ? rot * 0.6 - 0.12 : rot;                                         // the dash pose already leans into the flight
        if (gI > 0) { ctx.save(); ctx.globalCompositeOperation = "lighter"; dot(ctx, gI % 2 ? L.tint.sun : L.tint.lilac, px, py - h * 0.5, h * 0.35, 0.22 * (1 - gI / 7)); ctx.restore(); sprite(ctx, "speed", px, py, h, { rot: r2, alpha: 0.14 * (1 - gI / 7), pose: "jump", scrub: sc }); }
        else sprite(ctx, "speed", px, py, h, { rot: r2, pose: "jump", scrub: sc });
      }
      return;
    }
    if (id === "pinky" && scrubbing("pinky") && prog < 1) {
      const rim = spot.y - E.ry + E.v0 * E.ry + E.ry * 0.12;              // sitting in the open shell
      const up = easeOut(seg(prog, 0, 0.3)), fly = seg(prog, 0.4, 1);
      const tx = Math.max(cx - EH * 1.25, hFull * 0.45 + 14), ty = base - EH * 0.8, b = backOut(fly);
      const px0 = lerp(start[0], tx, b), py0 = lerp(lerp(start[1], rim, up), ty, b) + Math.sin(clock * 3.2) * EH * 0.02 * fly;
      const [px, py] = at(px0, py0);
      const t = prog < 0.4 ? lerp(0, 0.58, prog / 0.4) : lerp(0.58, 1, fly);
      sprite(ctx, "pinky", px, py, hFull, { scrub: { k: "hatch", t }, pose: "wave" });
      return;
    }
    if (id === "pinky") {
      const a = backOut(Math.min(1, prog)), tx = Math.max(cx - EH * 1.25, hFull * 0.45 + 14), ty = base - EH * 0.8;
      const [px, py] = at(lerp(start[0], tx, a), lerp(start[1], ty, a) + Math.sin(clock * 6.5) * EH * 0.035 * clamp(prog * 3));
      const flap = 1 + 0.05 * Math.sin(clock * 13);
      sprite(ctx, "pinky", px, py, hFull * (0.35 + 0.65 * easeOut(Math.min(1, prog))), { sx: 1 / Math.sqrt(flap), sy: flap, rot: Math.sin(clock * 3) * 0.06, id: !inside && prog >= 1 ? "pinky" : undefined, pose: prog < 1 ? "wave" : undefined });
      return;
    }
    // Blinky hops out of the middle egg and lands in front of the nest
    if (scrubbing("blinky") && prog < 1) {
      const B = BLINKY_HOP, landX = Math.min(cx + EH * 1.15, W - hFull * 0.42 - 14), landY = base + EH * 0.22;
      const rim = spot.y - E.ry + E.v0 * E.ry + E.ry * 0.1, up = easeOut(seg(prog, 0, 0.25)), air = seg(prog, 0.3, 0.72);
      const x0 = lerp(start[0], landX, ease(air)), y0 = lerp(lerp(start[1], rim, up), landY, air) - Math.sin(air * Math.PI) * EH * 0.75;
      const [px, py] = at(x0, y0);
      const t = prog < 0.3 ? lerp(0, B[0], prog / 0.3) : prog < 0.72 ? lerp(B[0], B[1], air) : lerp(B[1], 1, seg(prog, 0.72, 1));
      sprite(ctx, "blinky", px, py, hFull * (0.6 + 0.4 * easeOut(seg(prog, 0, 0.72))), { scrub: { k: "hatch", t }, shadow: air >= 1, pose: "stand" });
    } else {
    const landX = Math.min(cx + EH * 1.15, W - hFull * 0.42 - 14), landY = base + EH * 0.22, air = clamp(prog / 0.85);
    let sx = 1, sy = 1;
    if (prog > 0.85) { const q = (prog - 0.85) / 0.15; sy = 1 - 0.16 * Math.sin(q * Math.PI); sx = 1 + 0.1 * Math.sin(q * Math.PI); }
    if (prog >= 1) sy = 1 + 0.015 * Math.sin(clock * 2.2);
    const [px, py] = at(lerp(start[0], landX, ease(air)), lerp(start[1], landY, air) - Math.sin(air * Math.PI) * EH * 0.75);
    sprite(ctx, "blinky", px, py, hFull * (0.4 + 0.6 * easeOut(Math.min(1, prog))), { sx, sy, shadow: prog > 0.85, rot: (1 - air) * -0.2 * (prog < 0.85 ? 1 : 0), id: !inside && prog >= 1 ? "blinky" : undefined, pose: prog < 1 ? "stand" : undefined });
    }
    // Speed comes back to stand by the nest once everyone is out
    if (!inside) {
      const back = seg(pp, 0.86, 0.96);
      if (back > 0) {
        const x = lerp(-W * 0.2, Math.max(cx - EH * 1.55, hFull * 0.4 + 10), easeOut(back)), y = base + EH * 0.26;
        sprite(ctx, "speed", x, y, hFull, { shadow: back >= 1, rot: (1 - back) * 0.3, id: back >= 1 ? "speed" : undefined, pose: back < 1 ? "jump" : undefined });
      }
    }
  }
  function glideDragons(ctx, gl) {
    const { EH, cx, base } = layout, hFull = EH * 0.82, z = 1 + gl * 2.4, a = 1 - seg(gl, 0.65, 1);
    sprite(ctx, "pinky", lerp(Math.max(cx - EH * 1.25, hFull * 0.45 + 14), -W * 0.2, ease(gl)), lerp(base - EH * 0.8, H * 0.2, gl) + Math.sin(clock * 6.5) * 6, hFull * z, { alpha: a, pose: "wave" });
    sprite(ctx, "blinky", lerp(Math.min(cx + EH * 1.15, W - hFull * 0.42 - 14), W * 1.25, easeIn(gl)), lerp(base + EH * 0.22, H * 1.3, easeIn(gl)), hFull * z, { alpha: a, pose: "wave" });
    const s = seg(gl, 0.2, 0.8);
    if (s > 0 && s < 1) {
      const x = lerp(-W * 0.3, W * 1.3, s), y = H * 0.32 + Math.sin(s * Math.PI * 2) * H * 0.05;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 1; i < 10; i++) dot(ctx, i % 2 ? L.tint.sun : L.tint.lilac, x - i * W * 0.035, y - hFull * 0.45, hFull * 0.28, 0.25 * (1 - i / 10));
      ctx.restore();
      sprite(ctx, "speed", x, y, hFull, { rot: 0.35, pose: "jump" });
    }
  }
  const CH_TINT = ["gold", "rose", "blue", "mint"];
  function chapter(ctx, i, c) {
    const { cx } = layout, im = IM.eggs[i]; if (!ready(im)) return;
    const narrow = W < 700;
    const inA = easeOut(seg(c, -0.1, 0.25)), outA = ease(seg(c, 0.78, 1.05)), hold = seg(c, 0.25, 0.78);
    const eggH = Math.min(H * (narrow ? 0.36 : 0.52), W * (narrow ? 0.8 : 0.4));
    const homeX = narrow ? cx : W * 0.7, homeY = narrow ? H * 0.52 : H * 0.8;
    const scale = lerp(0.45, 1, inA) * (1 + hold * 0.06) * (1 + outA * 0.9);
    const x = homeX + (1 - inA) * W * 0.35 - outA * W * 0.55 - tiltX * 12, y = homeY + (1 - inA) * H * 0.04 - outA * H * 0.06 - tiltY * 6;
    const alpha = Math.min(inA, 1 - outA); if (alpha <= 0.005) return;
    const h = eggH * scale, w = h * im.naturalWidth / im.naturalHeight;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    dot(ctx, L.tint[CH_TINT[i]], x, y - h * 0.55, h * (0.9 + 0.05 * Math.sin(clock * 2)), 0.35 * alpha);
    ctx.restore();
    for (const s of P.spark) {
      const ang = s.a + clock * s.sp * (i % 2 ? 1 : -1), rr = h * 0.42 * s.rad, tw = Math.pow(Math.max(0, Math.sin(clock * 2 + s.ph * 9)), 4);
      star(ctx, x + Math.cos(ang) * rr, y - h * 0.5 + Math.sin(ang) * rr * 0.55, 2 + s.sz * 3, ["255,201,77", "255,143,179", "140,170,255", "130,230,190"][i], (0.2 + tw * 0.7) * alpha, clock);
    }
    ctx.globalAlpha = alpha; ctx.drawImage(im, x - w / 2, y - h + Math.sin(clock * 1.4) * h * 0.008, w, h); ctx.globalAlpha = 1;
    const dh = h * 0.62, enter = easeOut(seg(c, 0.12, 0.4)), side = narrow ? 0.42 : 0.68;
    const kx = (px, hh) => clamp(px, hh * 0.38 + 12, W - hh * 0.38 - 12);
    if (i === 0) sprite(ctx, "blinky", kx(x - w * side, dh) + (1 - enter) * -W * 0.3, y + h * 0.04 + (1 - enter) * 20, dh * (1 + 0.012 * Math.sin(clock * 2.2)), { alpha, shadow: true, id: "blinky" });
    if (i === 1) sprite(ctx, "pinky", kx(x + w * side * 0.9, dh) + (1 - enter) * W * 0.3, y - h * 0.32 + Math.sin(clock * 6) * h * 0.03, dh, { alpha, sy: 1 + 0.04 * Math.sin(clock * 12), rot: Math.sin(clock * 3) * 0.08, id: "pinky" });
    if (i === 2) {
      const ang = clock * 2.4 + c * 8, rr = Math.min(w * 0.62, W * 0.42 - dh * 0.25), sx = x + Math.cos(ang) * rr, sy = y - h * 0.45 + Math.sin(ang) * h * 0.18;
      const near = 0.5 + 0.5 * Math.sin(ang);                    // 1 in front of the egg, 0 behind it: size and fade follow smoothly
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let k2 = 1; k2 < 8; k2++) { const a2 = ang - k2 * 0.12; dot(ctx, k2 % 2 ? L.tint.sun : L.tint.lilac, x + Math.cos(a2) * rr, y - h * 0.45 + Math.sin(a2) * h * 0.18 - dh * 0.35, dh * 0.22, 0.25 * (1 - k2 / 8) * alpha * enter); }
      ctx.restore();
      sprite(ctx, "speed", sx, sy + dh * 0.2, dh * (0.72 + 0.28 * near) * enter, { alpha: alpha * (0.7 + 0.3 * near), flip: Math.cos(ang) > 0, rot: Math.cos(ang) * 0.3, id: "speed" });
    }
    if (i === 3) {
      const d3 = dh * 0.85;                                      // all three together around the last egg, one size
      sprite(ctx, "blinky", kx(x - w * 0.5, d3), y + h * 0.04, d3 * (1 + 0.012 * Math.sin(clock * 2.2)), { alpha: alpha * enter, shadow: true, id: "blinky" });
      sprite(ctx, "pinky", kx(x + w * 0.55, d3), y - h * (narrow ? 0.6 : 0.3) + Math.sin(clock * 6) * h * 0.03, d3, { alpha: alpha * enter, sy: 1 + 0.04 * Math.sin(clock * 12), id: "pinky" });
      const hop = Math.abs(Math.sin(clock * 3.2));
      sprite(ctx, "speed", kx(x + w * (narrow ? 0.32 : 0.18), d3), y + h * (narrow ? 0.12 : 0.06) - hop * h * 0.12, d3, { alpha: alpha * enter, sy: 1 - (1 - hop) * 0.08, id: "speed" });
    }
  }
  function ending(ctx, en) {
    const { EH, cx } = layout, fy = H * 0.8;
    const leave = seg(cur, TRACK - 1.1, TRACK - 0.2);          // the dragons step back as the page content comes up
    const a = ease(en) * (1 - leave * 0.85);
    // a sunny hilltop with a rainbow behind
    ctx.save(); ctx.globalAlpha = ease(en);
    const gA = art("ground");
    if (gA) {                                                  // the same painted hilltop, its brow just above where they stand
      const aw = Math.max(W * 1.1, H), ah = aw * gA.naturalHeight / gA.naturalWidth, ay = H * 0.755 - 0.48 * ah;
      ctx.drawImage(gA, cx - aw / 2, ay, aw, ah);
      if (ay + ah < H) mirrorDown(ctx, gA, cx - aw / 2, aw, ay + ah, H - ay - ah + 1);
    }
    ctx.restore();
    const dh = Math.min(EH * 0.95, H * 0.3, W * (W < 700 ? 0.3 : 1)), narrowE = W < 700;
    const spread = Math.min(W * (narrowE ? 0.33 : 0.3), dh * 1.4), inX = 1 - easeOut(seg(en, 0.2, 0.8));
    sprite(ctx, "blinky", cx - spread - inX * W * 0.4, fy + dh * 0.08, dh * (1 + 0.012 * Math.sin(clock * 2.2)), { alpha: a, shadow: true, id: "blinky" });
    sprite(ctx, "pinky", cx + spread * (narrowE ? 0.45 : 1) + inX * W * 0.4, fy - dh * (narrowE ? 0.95 : 0.25) + Math.sin(clock * 6) * dh * 0.04, dh, { alpha: a, flip: true, sy: 1 + 0.04 * Math.sin(clock * 12), id: "pinky" });
    const hop = Math.abs(Math.sin(clock * 2.6));
    sprite(ctx, "speed", cx + (narrowE ? spread : 0) * 1, fy + dh * 0.12 - hop * dh * 0.08 - inX * H * 0.5, dh, { alpha: a, sy: 1 - (1 - hop) * 0.07, id: "speed" });
  }

  size(); readScroll(); cur = target;
  requestAnimationFrame(frame);

  // ---------- the nests: eggs float, tools orbit on a tilted ring ----------
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  document.querySelectorAll(".n22-nest").forEach((nest) => {
    const egg = nest.querySelector(".n22-egg"), cards = [...nest.querySelectorAll(".n22-card")], stg = nest.querySelector(".n22-stage");
    const home = nest.querySelector(".n22-name").getAttribute("href");
    let open = false, ang = 0, vel = 0.35, dragX = null, lastT = 0, raf = 0, hovering = false;
    const links = cards.map((c) => c.querySelector("a"));
    function place() {
      // keep every card inside the screen: a narrower ring if it is wider than the screen, then slide it toward the middle
      const r = stg.getBoundingClientRect(), mid = r.left + r.width / 2, vw = document.documentElement.clientWidth;
      const hc = Math.max(0, ...links.map((a) => a.offsetWidth)) / 2 + 8, n = cards.length;
      const R = Math.max(0, Math.min(stg.clientWidth * 0.66, vw / 2 - hc)), ryy = stg.clientWidth * 0.26;
      const shift = clamp(0, hc - (mid - R), vw - hc - (mid + R));
      cards.forEach((c, i) => {
        const a = ang + (i / n) * Math.PI * 2, z = Math.cos(a), x = Math.sin(a) * R + shift, y = z * ryy + stg.clientWidth * 0.04;
        const s = 0.74 + 0.26 * (z + 1) / 2;
        c.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(3)})`;
        c.style.zIndex = z > -0.05 ? 3 : 1;
        c.style.filter = z < 0 ? `saturate(.8) brightness(${(0.88 + 0.12 * (z + 1)).toFixed(2)})` : "";
      });
    }
    function tick(t) {
      const dt = Math.min(0.05, (t - (lastT || t)) / 1000); lastT = t;
      if (dragX === null && !hovering && !reduce) ang += vel * dt;
      if (dragX === null) vel += (0.35 - vel) * 0.02;
      place();
      raf = open ? requestAnimationFrame(tick) : 0;
    }
    function setOpen(o) {
      if (open === o) return;
      open = o; nest.classList.toggle("open", o); egg.setAttribute("aria-expanded", o ? "true" : "false");
      nest.parentNode.classList.toggle("has-open", !!nest.parentNode.querySelector(".n22-nest.open"));
      if (o) { lastT = 0; if (!raf) raf = requestAnimationFrame(tick); egg.classList.remove("knock"); void egg.offsetWidth; egg.classList.add("knock"); }
    }
    egg.addEventListener("animationend", () => egg.classList.remove("knock"));
    nest.addEventListener("mouseenter", () => { if (fine.matches) setOpen(true); });
    nest.addEventListener("mouseleave", () => { if (fine.matches) setOpen(false); });
    egg.addEventListener("click", () => {
      if (!open) { setOpen(true); return; }
      egg.classList.remove("knock"); void egg.offsetWidth; egg.classList.add("knock");
      setTimeout(() => { location.href = home; }, 260);
    });
    egg.addEventListener("focus", () => { if (egg.matches(":focus-visible")) setOpen(true); });   // keyboard only: a tap focuses first and must not count as the first tap
    cards.forEach((c) => {
      const a = c.querySelector("a");
      c.addEventListener("pointerenter", () => { hovering = true; });
      c.addEventListener("pointerleave", () => { hovering = false; });
      a.addEventListener("focus", () => setOpen(true));
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault(); c.classList.add("go");
        setTimeout(() => { location.href = a.getAttribute("href"); }, reduce ? 0 : 380);
      });
    });
    // swipe or drag to spin the ring
    stg.addEventListener("pointerdown", (e) => { if (!open || e.target.closest(".n22-egg")) return; dragX = e.clientX; });
    addEventListener("pointermove", (e) => { if (dragX === null) return; const d = e.clientX - dragX; dragX = e.clientX; ang += d / (stg.clientWidth * 0.6); vel = d * 0.6; }, { passive: true });
    addEventListener("pointerup", () => { dragX = null; });
    document.addEventListener("pointerdown", (e) => { if (!fine.matches && open && !nest.contains(e.target)) setOpen(false); });
    place();
  });
})();
