/* pdtools v2.2: the Sunrise Hatchery home.
   A bright morning on a floating island. Scrolling cracks the egg, Blinky, Pinky and Speed tumble out, the camera glides
   through the four parts of pdtools and ends on a sunny hilltop behind the rest of the home page.
   All scene motion is drawn in code. Every dragon, the egg, the clouds, the butterflies and the letters answer a touch,
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
  function hills(ctx, w, h, base, amp, col, r, seed) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
    const n = 6 + Math.floor(r() * 3);
    let y = base - r() * amp; ctx.lineTo(0, y);
    for (let i = 1; i <= n; i++) {
      const x = (i / n) * w, ny = base - r() * amp;
      ctx.quadraticCurveTo(x - w / n / 2, Math.min(y, ny) - amp * (0.3 + r() * 0.5), x, ny); y = ny;
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  }
  // soft lit foliage: each clump is lit from the sun (upper right) and shaded below, so it reads as rounded, not flat
  function tree(ctx, x, base, s, leaf, dark, r) {
    const tg = ctx.createLinearGradient(x - s * 0.06, 0, x + s * 0.06, 0);
    tg.addColorStop(0, "#6e5238"); tg.addColorStop(1, "#a7835c");
    ctx.fillStyle = tg; ctx.fillRect(x - s * 0.06, base - s * 0.45, s * 0.12, s * 0.45);
    const blobs = 4 + Math.floor(r() * 3);
    for (let i = 0; i < blobs; i++) {
      const bx2 = x + (r() - 0.5) * s * 0.6, by = base - s * (0.55 + r() * 0.35), rr = s * (0.2 + r() * 0.15);
      const g = ctx.createRadialGradient(bx2 + rr * 0.35, by - rr * 0.4, rr * 0.1, bx2, by, rr * 1.05);
      g.addColorStop(0, leaf); g.addColorStop(0.55, i % 2 ? dark : leaf); g.addColorStop(1, dark);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx2, by, rr, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,220,.18)"; ctx.beginPath(); ctx.arc(bx2 + rr * 0.3, by - rr * 0.35, rr * 0.35, 0, 7); ctx.fill();
    }
  }
  function flowerDots(ctx, x0, y0, w, h, n, r) {
    const cols = ["#ff8fb3", "#ffd84d", "#ffffff", "#b9a8ff", "#ff9a5c"];
    for (let i = 0; i < n; i++) { ctx.fillStyle = cols[i % cols.length]; ctx.beginPath(); ctx.arc(x0 + r() * w, y0 + r() * h, 1.2 + r() * 2.6, 0, 7); ctx.fill(); }
  }
  function build() {
    const r = rng(7);
    const EH = Math.min(H * 0.3, W * 0.48);
    layout = { EH, cx: W / 2, base: H * 0.72, k: EH / 312 };
    // sky: a clear morning, warm at the horizon
    const sky = mk(W, H), s = sky.getContext("2d");
    const g = s.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#5fbdf5"); g.addColorStop(0.35, "#9ad8ff"); g.addColorStop(0.6, "#d9f0ff"); g.addColorStop(0.7, "#fff1d1"); g.addColorStop(1, "#ffe2b5");
    s.fillStyle = g; s.fillRect(0, 0, W, H);
    const sx = W * 0.78, sy = H * 0.2;
    const sun = s.createRadialGradient(sx, sy, 0, sx, sy, H * 0.5);
    sun.addColorStop(0, "rgba(255,248,214,.95)"); sun.addColorStop(0.12, "rgba(255,236,170,.65)"); sun.addColorStop(0.45, "rgba(255,220,150,.18)"); sun.addColorStop(1, "rgba(255,220,150,0)");
    s.fillStyle = sun; s.fillRect(0, 0, W, H);
    s.fillStyle = "#fffbea"; s.beginPath(); s.arc(sx, sy, Math.max(16, H * 0.045), 0, 7); s.fill();
    // floating islands far away
    s.fillStyle = "rgba(150,180,230,.55)";
    for (const [ix, iy, iw] of [[0.12, 0.3, 0.12], [0.3, 0.2, 0.06], [0.62, 0.36, 0.09], [0.9, 0.42, 0.07]]) {
      const x = ix * W, y = iy * H, w = iw * W;
      s.beginPath(); s.ellipse(x, y, w, w * 0.12, 0, 0, 7); s.fill();
      s.beginPath(); s.moveTo(x - w * 0.8, y); s.quadraticCurveTo(x, y + w * 0.9, x + w * 0.8, y); s.fill();
    }
    L.sky = sky;
    const PW = W * 1.5, PH = H * 1.2;
    const far = mk(PW, PH), fa = far.getContext("2d");
    hills(fa, PW, PH, PH * 0.6, PH * 0.06, "#b5e3bf", r);
    for (let x = 0; x < PW; x += 30 + r() * 50) tree(fa, x, PH * 0.6 + r() * 10, PH * (0.05 + r() * 0.04), "#b8e6c0", "#8ec99c", r);
    fa.fillStyle = "#a6dcb0"; fa.fillRect(0, PH * 0.62, PW, PH);
    const haze = fa.createLinearGradient(0, PH * 0.45, 0, PH * 0.7);     // morning haze softens the distance
    haze.addColorStop(0, "rgba(230,245,255,.0)"); haze.addColorStop(1, "rgba(230,245,255,.45)");
    fa.fillStyle = haze; fa.fillRect(0, PH * 0.45, PW, PH * 0.55);
    L.far = far;
    const mid = mk(PW, PH), mi = mid.getContext("2d");
    hills(mi, PW, PH, PH * 0.68, PH * 0.05, "#86cf7f", r);
    mi.fillStyle = "#86cf7f"; mi.fillRect(0, PH * 0.69, PW, PH);
    for (let x = -40; x < PW + 40; x += 40 + r() * 60) {
      const dc = Math.abs(x - PW / 2) / (PW / 2);
      if (dc < 0.22) continue;
      tree(mi, x, PH * 0.69 + r() * 8, PH * (0.14 + r() * 0.12) * (0.7 + dc * 0.6), "#8edb7c", "#3f9a4f", r);
    }
    flowerDots(mi, 0, PH * 0.7, PW, PH * 0.3, 260, r);
    L.mid = mid;
    // the island ground under the nest, with flowers
    const gr = mk(W, H * 0.5), gg = gr.getContext("2d");
    const gd = gg.createLinearGradient(0, 0, 0, H * 0.5);
    gd.addColorStop(0, "#9edc76"); gd.addColorStop(0.4, "#74c35e"); gd.addColorStop(1, "#4fa24c");
    gg.fillStyle = gd; gg.beginPath(); gg.ellipse(W / 2, H * 0.5, W * 1.2, H * 0.44, 0, Math.PI, 2 * Math.PI); gg.lineTo(W * 2, H); gg.lineTo(-W, H); gg.fill();
    flowerDots(gg, 0, H * 0.08, W, H * 0.42, 220, r);
    L.ground = gr;
    // flowering bushes framing the bottom corners
    const front = mk(W, H), fr = front.getContext("2d");
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : W;
      for (let i = 0; i < 9; i++) {
        const x = x0 + side * (-W * 0.02 + r() * W * 0.18), y = H * (0.86 + r() * 0.16), rr = Math.min(W, H) * (0.06 + r() * 0.07);
        fr.fillStyle = i % 2 ? "#3f9a52" : "#4fae5e"; fr.beginPath(); fr.arc(x, y, rr, 0, 7); fr.fill();
      }
      flowerDots(fr, side < 0 ? 0 : W * 0.8, H * 0.8, W * 0.2, H * 0.2, 60, r);
    }
    L.front = front;
    // soft round sprites for glows
    L.tint = {};
    for (const [k, col] of Object.entries({ sun: "255,214,120", rose: "255,150,190", white: "255,250,235", blue: "140,170,255", mint: "130,230,190", gold: "255,201,77", lilac: "190,170,255" })) {
      const c = mk(64, 64), x = c.getContext("2d"); const q = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      q.addColorStop(0, `rgba(${col},1)`); q.addColorStop(0.3, `rgba(${col},.5)`); q.addColorStop(1, `rgba(${col},0)`); x.fillStyle = q; x.fillRect(0, 0, 64, 64); L.tint[k] = c;
    }
    buildEggs();
    buildParticles();
  }

  // ---------- three eggs in one nest, drawn in code ----------
  // Each dragon hatches from its own egg, in its own colours. These are pdtools' own egg designs, never official kit
  // eggs (the Creator Kit asks not to invent official egg states). Speed's hatches first, then Pinky's, then Blinky's.
  const EGG_SPECS = [
    { id: "blinky", dx: 0, lift: 0.06, size: 1, base: ["#fff8d6", "#ffe58a", "#f5c542", "#d9a21f"], spots: ["150,215,130", "255,255,235", "240,170,40"],
      crack: [0.44, 0.64], burst: 0.66 },
    { id: "pinky", dx: -0.66, lift: 0, size: 0.9, base: ["#fff2f6", "#ffd0df", "#ff9fbf", "#e06f98"], spots: ["255,255,255", "255,120,160", "255,220,235"],
      crack: [0.26, 0.46], burst: 0.48 },
    { id: "speed", dx: 0.66, lift: 0, size: 0.9, base: ["#fff0dc", "#ffc27a", "#ff9a3c", "#d96a1c"], spots: ["105,90,210", "70,60,170", "255,230,170"],
      crack: [0.06, 0.26], burst: 0.28 },
  ];
  let EGGS = [];
  function eggHalfWidth(v) { const c = clamp(-v, -1, 1), th = Math.acos(c); return Math.sin(th) * (1 - 0.1 * Math.cos(th)); }
  function eggPath(ctx, rx, ry) {
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) { const th = (i / 96) * Math.PI * 2; const x = rx * Math.sin(th) * (1 - 0.1 * Math.cos(th)); const y = -ry * Math.cos(th); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
  }
  function buildEggs() { EGGS = EGG_SPECS.map((sp, i) => buildEgg(sp, 11 + i * 7)); }
  function buildEgg(spec, seed) {
    const ry = layout.EH * 0.34 * spec.size, rx = ry * 0.84;
    const pad = 6, cw = rx * 2.3 + pad * 2, ch = ry * 2 + pad * 2;
    const tex = mk(cw * DPR, ch * DPR), t = tex.getContext("2d");
    t.scale(DPR, DPR); t.translate(cw / 2, ch / 2);
    eggPath(t, rx, ry); t.save(); t.clip();
    const base = t.createRadialGradient(-rx * 0.35, -ry * 0.42, ry * 0.05, -rx * 0.1, -ry * 0.1, ry * 1.35);
    base.addColorStop(0, spec.base[0]); base.addColorStop(0.42, spec.base[1]); base.addColorStop(0.8, spec.base[2]); base.addColorStop(1, spec.base[3]);
    t.fillStyle = base; t.fillRect(-cw, -ch, cw * 2, ch * 2);
    const r = rng(seed);
    for (let i = 0; i < 500; i++) { t.fillStyle = r() < 0.5 ? "rgba(255,255,255,.08)" : "rgba(120,70,30,.05)"; const s = 0.6 + r() * 1.2; t.fillRect((r() * 2 - 1) * rx, (r() * 2 - 1) * ry, s, s); }
    for (let i = 0; i < 30; i++) {
      const v = r() * 2 - 1, u = (r() * 2 - 1) * eggHalfWidth(v) * 0.92, s = ry * (0.04 + Math.pow(r(), 2) * 0.1);
      t.fillStyle = `rgba(${spec.spots[i % spec.spots.length]},${0.55 + r() * 0.35})`;
      t.beginPath(); t.ellipse(u * rx, v * ry, s * (1 + r() * 0.5), s, r() * 3, 0, 7); t.fill();
    }
    const sh = t.createLinearGradient(0, ry * 0.1, 0, ry);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(120,60,20,.25)");
    t.fillStyle = sh; t.fillRect(-cw, -ch, cw * 2, ch * 2);
    t.restore();
    const vein = mk(cw * DPR, ch * DPR), vv = vein.getContext("2d");
    vv.scale(DPR, DPR); vv.translate(cw / 2, ch / 2); eggPath(vv, rx, ry); vv.clip();
    const glow = vv.createRadialGradient(0, -ry * 0.1, 0, 0, -ry * 0.1, ry);
    glow.addColorStop(0, "rgba(255,240,180,.95)"); glow.addColorStop(1, "rgba(255,240,180,0)");
    vv.fillStyle = glow; vv.fillRect(-cw, -ch, cw * 2, ch * 2);
    const v0 = -0.12, zz = [], N = 13;
    for (let i = 0; i < N; i++) { const f = i / (N - 1); const v = v0 + (i % 2 ? 0.085 : -0.06) + (r() - 0.5) * 0.05; zz.push([(f * 2 - 1) * eggHalfWidth(v) * rx, v * ry]); }
    const branches = [];
    for (const [i, dir] of [[2, -1], [4, 1], [6, -1], [8, 1], [10, -1], [5, -1], [9, 1]]) {
      const pts = [zz[i].slice()]; let [x, y] = zz[i];
      for (let j = 0; j < 3; j++) { x += (r() - 0.5) * rx * 0.22; y += dir * ry * (0.08 + r() * 0.1); pts.push([x, y]); }
      branches.push({ pts, at: 0.35 + r() * 0.5 });
    }
    const ring = [], ringIdx = [0, 3, 6, 9, 12];
    for (let j = 0; j < ringIdx.length; j++) { const f = j / (ringIdx.length - 1); ring.push([(f * 2 - 1) * rx * 0.62, -ry * (0.6 + Math.sin(f * Math.PI) * 0.12)]); }
    const shards = [], big = 1.6;
    for (let j = 0; j < ringIdx.length - 1; j++) {
      const poly = [];
      for (let i = ringIdx[j]; i <= ringIdx[j + 1]; i++) poly.push(zz[i]);
      poly.push(ring[j + 1], ring[j]);
      if (j === 0) poly.splice(0, 0, [-rx * big, zz[0][1]]), poly.push([-rx * big, -ry * 0.6]);
      if (j === ringIdx.length - 2) poly.splice(poly.length - 2, 0, [rx * big, zz[N - 1][1]], [rx * big, -ry * 0.6]);
      shards.push(poly);
    }
    shards.push([...ring, [rx * big, -ry * 0.6], [rx * big, -ry * big], [-rx * big, -ry * big], [-rx * big, -ry * 0.6]]);
    const sr = rng(seed + 12);
    const meta = shards.map((poly) => {
      let cx = 0, cy = 0; for (const p of poly) { cx += clamp(p[0], -rx, rx); cy += clamp(p[1], -ry, ry); } cx /= poly.length; cy /= poly.length;
      const ang = Math.atan2(cy + ry * 0.3, cx) + (sr() - 0.5) * 0.4;
      return { poly, cx, cy, vx: Math.cos(ang) * (0.9 + sr() * 0.8), vy: Math.sin(ang) * (1.1 + sr() * 0.6) - 0.6, spin: (sr() - 0.5) * 7 };
    });
    return { spec, rx, ry, tex, vein, cw, ch, zz, branches, shards: meta, v0 };
  }
  // where an egg sits on screen (its bottom centre, before the camera moves)
  const eggSpot = (E) => ({ x: layout.cx + E.spec.dx * layout.EH, y: layout.base - E.spec.lift * layout.EH });
  function lerpPt(zz, f) { const i = Math.floor(clamp(f, 0, zz.length - 1)); const j = Math.min(zz.length - 1, i + 1); const t = f - i; return [lerp(zz[i][0], zz[j][0], t), lerp(zz[i][1], zz[j][1], t)]; }
  function crackPath(ctx, E, g) {
    const zz = E.zz, mid = (zz.length - 1) / 2, reach = g * mid;
    ctx.beginPath();
    for (const dir of [-1, 1]) {
      ctx.moveTo(...lerpPt(zz, mid));
      for (let n = 1, steps = Math.ceil(reach); n <= steps; n++) { const pt = lerpPt(zz, mid + dir * Math.min(n, reach)); ctx.lineTo(pt[0], pt[1]); }
    }
    for (const b of E.branches) {
      const k = seg(g, b.at, b.at + 0.25); if (k <= 0) continue;
      const n = (b.pts.length - 1) * k; ctx.moveTo(b.pts[0][0], b.pts[0][1]);
      for (let j = 1; j <= Math.ceil(n); j++) { const f = Math.min(1, n - (j - 1)); const a = b.pts[j - 1], c = b.pts[j]; ctx.lineTo(lerp(a[0], c[0], f), lerp(a[1], c[1], f)); }
    }
  }
  function strokeCrack(ctx, E, g, light) {
    if (g <= 0) return;
    const ry = E.ry;
    crackPath(ctx, E, g);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,220,120,${0.3 * light})`; ctx.lineWidth = ry * 0.1; ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(120,70,30,.7)"; ctx.lineWidth = ry * 0.022; ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `rgba(255,252,220,${0.95 * light})`; ctx.lineWidth = ry * 0.012; ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }
  function belowLinePath(ctx, E) {
    const { zz, rx, ry } = E; ctx.beginPath(); ctx.moveTo(-rx * 2, zz[0][1]);
    for (const p of zz) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(rx * 2, zz[zz.length - 1][1]); ctx.lineTo(rx * 2, ry * 2); ctx.lineTo(-rx * 2, ry * 2); ctx.closePath();
  }
  const eggKick = { blinky: -9, pinky: -9, speed: -9 };
  // one egg: idle, cracking, or open with its shards flying; the dragon inside is drawn behind the lower shell
  function drawEgg(ctx, E, p, alpha, insideDragon) {
    const { x, y } = eggSpot(E), { rx, ry, spec } = E;
    const crackG = ease(seg(p, spec.crack[0], spec.crack[1])), opened = p >= spec.burst - 0.005;
    const kick = Math.max(0, 1 - (clock - eggKick[spec.id]) / 0.7);
    const wob = opened ? 0 : (seg(p, spec.crack[0] - 0.04, spec.crack[1]) * 0.08 + 0.006) * Math.sin(clock * (6 + crackG * 10) + spec.dx * 3) + kick * 0.16 * Math.sin(clock * 30);
    const drawTex = () => ctx.drawImage(E.tex, -E.cw / 2, -E.ch / 2, E.cw, E.ch);
    ctx.save(); ctx.translate(x, y); ctx.rotate(wob); ctx.translate(0, -ry);
    const openY = E.v0 * ry;
    if (opened) {
      const ow = rx * eggHalfWidth(E.v0) * 0.98, oh = ow * 0.3, heat = 1 - seg(p, spec.burst + 0.05, spec.burst + 0.3) * 0.7;
      const inner = ctx.createRadialGradient(0, openY, 0, 0, openY, ow);
      inner.addColorStop(0, `rgba(255,252,225,${heat})`); inner.addColorStop(0.55, `rgba(255,222,150,${0.9 * heat})`); inner.addColorStop(1, "rgba(214,160,100,1)");
      ctx.fillStyle = inner; ctx.beginPath(); ctx.ellipse(0, openY - oh * 0.2, ow, oh, 0, 0, 7); ctx.fill();
      if (insideDragon) { ctx.save(); ctx.translate(0, ry); insideDragon(); ctx.restore(); }
      ctx.save(); belowLinePath(ctx, E); ctx.clip(); eggPath(ctx, rx, ry); ctx.clip(); drawTex(); ctx.restore();
      ctx.beginPath(); E.zz.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
      ctx.strokeStyle = `rgba(255,245,200,${0.9 * heat})`; ctx.lineWidth = ry * 0.018; ctx.stroke();
      const tt = seg(p, spec.burst, spec.burst + 0.2);
      if (tt < 1) for (const s of E.shards) {
        const dx = s.vx * ry * 3.2 * easeOut(tt), dy = s.vy * ry * 2.6 * easeOut(tt) + ry * 5 * tt * tt;
        ctx.save(); ctx.globalAlpha = alpha * (1 - seg(tt, 0.7, 1));
        ctx.translate(s.cx + dx, s.cy + dy); ctx.rotate(s.spin * tt); ctx.translate(-s.cx, -s.cy);
        ctx.beginPath(); s.poly.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]))); ctx.closePath(); ctx.clip();
        eggPath(ctx, rx, ry); ctx.clip(); drawTex(); ctx.restore();
      }
      ctx.globalAlpha = alpha;
    } else {
      eggPath(ctx, rx, ry); ctx.save(); ctx.clip(); drawTex();
      const beat = Math.pow(Math.max(0, Math.sin(clock * 2.4 + spec.dx * 2)), 6);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = alpha * clamp(0.05 + beat * 0.16 + crackG * 0.5 + kick * 0.3);
      ctx.drawImage(E.vein, -E.cw / 2, -E.ch / 2, E.cw, E.ch);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = alpha;
      ctx.restore();
      strokeCrack(ctx, E, Math.max(crackG, kick * 0.25), clamp(0.6 + crackG * 0.5 + 0.2 * Math.sin(clock * 7)));
    }
    ctx.restore();
    return { x, y, opened, crackG, top: y - 2 * ry, openY: y - ry + openY };
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
  function dot(ctx, spr, x, y, s, a) { if (a <= 0.003 || s <= 0.2) return; ctx.globalAlpha = a; ctx.drawImage(spr, x - s, y - s, s * 2, s * 2); }
  function petal(ctx, x, y, s, rot, col, a) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = a; ctx.fillStyle = `rgb(${col})`;
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 7); ctx.fill(); ctx.restore();
  }
  function heart(ctx, x, y, s, col, a) {
    ctx.save(); ctx.translate(x, y); ctx.globalAlpha = a; ctx.fillStyle = `rgb(${col})`; ctx.beginPath();
    ctx.moveTo(0, s * 0.35); ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.5, -s, 0, -s * 0.45); ctx.bezierCurveTo(s * 0.5, -s, s, -s * 0.3, 0, s * 0.35); ctx.fill(); ctx.restore();
  }
  function star(ctx, x, y, s, col, a, rot = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = a; ctx.fillStyle = `rgb(${col})`; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.38 : s; const ang = (i / 8) * Math.PI * 2; ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r); }
    ctx.fill(); ctx.restore();
  }
  function cloud(ctx, x, y, w, puff, seed) {
    const r = rng(seed), k = puff > 0 ? easeOut(Math.min(1, puff)) : 0, back = puff > 1 ? ease(seg(puff, 1, 2.2)) : 0;
    const spread = (k - back) * w * 0.6, fade = 1 - (k - back) * 0.6;
    ctx.save(); ctx.globalAlpha = 0.92 * fade;
    for (let i = 0; i < 7; i++) {
      const ox = (r() - 0.5) * w, oy = (r() - 0.5) * w * 0.18, rr = w * (0.16 + r() * 0.14), dir = Math.sign(ox) || 1;
      ctx.fillStyle = "rgba(140,170,210,.25)"; ctx.beginPath(); ctx.arc(x + ox + dir * spread, y + oy + rr * 0.25, rr, 0, 7); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x + ox + dir * spread, y + oy, rr, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
  function butterfly(ctx, x, y, s, col, t, ang) {
    const flap = Math.abs(Math.sin(t * 14)) * 0.8 + 0.2;
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = `rgb(${col[0]})`;
    for (const side of [-1, 1]) {
      ctx.save(); ctx.scale(side * flap, 1);
      ctx.beginPath(); ctx.ellipse(s * 0.55, -s * 0.35, s * 0.55, s * 0.42, -0.4, 0, 7); ctx.fill();
      ctx.fillStyle = `rgb(${col[1]})`; ctx.beginPath(); ctx.ellipse(s * 0.45, s * 0.3, s * 0.36, s * 0.3, 0.4, 0, 7); ctx.fill();
      ctx.fillStyle = `rgb(${col[0]})`; ctx.restore();
    }
    ctx.fillStyle = "#4a3a5a"; ctx.fillRect(-s * 0.06, -s * 0.5, s * 0.12, s);
    ctx.restore();
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
  function react(id, x, y, h) {
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
      else if (f.kind === "conf") { ctx.save(); ctx.translate(x, y); ctx.rotate(f.rot + f.vr * e); ctx.globalAlpha = a; ctx.fillStyle = `rgb(${f.col})`; ctx.fillRect(-f.s * 0.6, -f.s * 0.3, f.s * 1.2, f.s * 0.6); ctx.restore(); }
      else if (f.kind === "dust") { ctx.globalAlpha = a * 0.6; ctx.fillStyle = `rgb(${f.col})`; ctx.beginPath(); ctx.arc(x, y, f.s * (1 + q * 2), 0, 7); ctx.fill(); }
      else if (f.kind === "trail") { ctx.globalAlpha = a * 0.7; ctx.fillStyle = `rgb(${f.col})`; ctx.beginPath(); ctx.arc(x, y, f.s * (1 - q), 0, 7); ctx.fill(); }
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
  let lastMove = -9;
  function tickActors() {
    for (const id of Object.keys(ACT)) {
      const a = ACT[id];
      if (clock - a.seen > 0.5) continue;                         // only the dragons on screen
      const near = clock - lastMove < 1.6 && Math.abs(pX - a.x) < W * 0.32 && Math.abs(pY - (a.y - 60)) < H * 0.4;
      if (near && !RX[id] && a.until - clock < 0.6) { a.face = pX < a.x ? -1 : 1; if (has(id, "look")) setPose(id, "look", 1.2); continue; }
      if (clock > a.until && !RX[id]) {
        let tries = 0, next;
        do { next = IDLE[id][a.step++ % IDLE[id].length]; } while (!has(id, next[0]) && ++tries < 8);
        setPose(id, next[0], next[1] * (0.8 + Math.random() * 0.4));
        if (next[0] !== "look") a.face = Math.random() < 0.5 ? -1 : 1;
      }
    }
  }

  // ---------- dragons ----------
  function sprite(ctx, im, x, y, h, o = {}) {
    let prev = null, mix = 1, pop = 0, who = null;
    if (typeof im === "string") {                                // a living dragon: its pose right now
      who = im; const a = ACT[who];
      const pose = o.pose && has(who, o.pose) ? o.pose : a.pose;
      im = has(who, pose) ? PIM[who][pose] : PIM[who].stand;
      if (!o.pose) {
        a.seen = clock; a.x = x; a.y = y;
        const e = clock - a.t;
        if (a.prev && e < 0.22 && has(who, a.prev)) { prev = PIM[who][a.prev]; mix = e / 0.22; }
        if (e < 0.3) pop = Math.sin((e / 0.3) * Math.PI);
        if (pose === "sit" || pose === "popcorn") h *= 0.9;        // sitting is a little lower
        if (pose === "look" && a.face < 0) o = { ...o, flip: !o.flip };
      }
    }
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
    if (prev && ready(prev)) { const pw = h * prev.naturalWidth / prev.naturalHeight; ctx.globalAlpha = alpha * (1 - mix); ctx.drawImage(prev, -pw / 2, -h, pw, h); }
    ctx.globalAlpha = alpha * (prev ? mix : 1);
    ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore();
    if (o.id && alpha > 0.4) HIT.push({ id: o.id, x0: x - w * 0.4, x1: x + w * 0.4, y0: y - h, y1: y, x, y, h });
  }
  function quad(a, b, c, t) { const u = 1 - t; return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]; }

  // ---------- title letters ----------
  const pd = document.getElementById("v22-pd");
  const LCOL = ["#ffb52e", "#ff6fa5", "", "#ff8a3d", "#7d6cff", "#2fc7a0", "#ffb52e", "#ff6fa5"];
  const letters = [..."PD TOOLS"].map((ch, i) => {
    const s = document.createElement("span");
    if (ch === " ") { s.className = "gap"; s.innerHTML = "&nbsp;"; } else { s.textContent = ch; s.style.setProperty("--c", LCOL[i]); }
    pd.appendChild(s); return s;
  });
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

  // ---------- frame ----------
  function frame(now) {
    requestAnimationFrame(frame);
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
    bx.drawImage(L.sky, -tiltX * 6, -tiltY * 4, W + 12, H + 8);
    P.clouds.forEach((c, i) => {
      const x = (((c.x + time * c.sp) % 1.3) - 0.15) * W - tiltX * 10, y = c.y * H - gl * H * 0.08 - tiltY * 6, w = c.w * W;
      cloud(bx, x, y, w, c.puff > -9 ? clock - c.puff : 0, c.seed);
      if (c.puff > -9 && clock - c.puff > 2.4) c.puff = -9;
      HIT.push({ id: "cloud" + i, x0: x - w * 0.5, x1: x + w * 0.5, y0: y - w * 0.2, y1: y + w * 0.15, x, y, h: w * 0.3 });
    });
    const layer = (im, depth) => {
      const z = 1 + gl * depth, w = W * 1.5 * z, h = H * 1.2 * z;
      bx.drawImage(im, cx - w / 2 - tiltX * 14 * depth, H * 0.62 - h * 0.6 + gl * H * 0.1 * depth - tiltY * 8 * depth, w, h);
    };
    layer(L.far, 0.35);
    layer(L.mid, 1.1);
    const gz = 1 + gl * 2.2;
    bx.drawImage(L.ground, cx - W * gz / 2 - tiltX * 20, base - H * 0.06 * gz + gl * H * 0.6, W * gz, H * 0.5 * gz);

    // ===== title =====
    const titleTop = Math.max(84, base - EH - Math.max(54, Math.min(W * 0.15, 200)) * 1.05 - (W < 700 ? H * 0.05 : 0));
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
        const { x, y } = eggSpot(E);
        fx.save(); fx.translate(x, y - E.ry); fx.rotate(clock * 0.05 + sp.dx); fx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2 + Math.sin(i * 3.1) * 0.3, len = H * (0.35 + 0.15 * Math.sin(clock * 0.7 + i));
          const gr = fx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
          gr.addColorStop(0, `rgba(255,236,170,${0.22 * rays})`); gr.addColorStop(1, "rgba(255,236,170,0)");
          fx.fillStyle = gr; fx.beginPath(); fx.moveTo(0, 0);
          fx.lineTo(Math.cos(a - 0.07) * len, Math.sin(a - 0.07) * len); fx.lineTo(Math.cos(a + 0.07) * len, Math.sin(a + 0.07) * len); fx.fill();
        }
        fx.restore(); fx.globalAlpha = sceneAlpha;
      }
      // one wide nest that holds all three
      const nk = k * 1.05, nsx = 1.45, nx = cx - 264 * nk * nsx, ny = base - 306 * nk, nw = 520 * nk * nsx, nh = 465 * nk;
      if (ready(IM.nb)) fx.drawImage(IM.nb, nx, ny, nw, nh);
      // a soft bed of moss and straw inside the nest, where the eggs sit
      fx.save(); fx.beginPath(); fx.ellipse(cx, ny + 262 * nk, 132 * nk * nsx, 52 * nk, 0, 0, 7); fx.clip();
      const moss = fx.createRadialGradient(cx, ny + 250 * nk, 0, cx, ny + 262 * nk, 140 * nk * nsx);
      moss.addColorStop(0, "#8fae4a"); moss.addColorStop(0.6, "#6d8c34"); moss.addColorStop(1, "#4a6224");
      fx.fillStyle = moss; fx.fillRect(cx - 140 * nk * nsx, ny + 200 * nk, 280 * nk * nsx, 130 * nk);
      fx.strokeStyle = "rgba(214,184,120,.75)"; fx.lineWidth = Math.max(1, nk * 2.2); fx.lineCap = "round";
      for (let i = 0; i < 46; i++) { const a = i * 2.39996, rr = (i / 46) * 120 * nk * nsx, x0 = cx + Math.cos(a) * rr, y0 = ny + 262 * nk + Math.sin(a) * rr * 0.38;
        fx.beginPath(); fx.moveTo(x0, y0); fx.quadraticCurveTo(x0 + 9 * nk, y0 - 5 * nk, x0 + 20 * nk * Math.cos(a * 3), y0 + 4 * nk * Math.sin(a * 5)); fx.stroke(); }
      fx.restore();
      for (const E of EGGS) {   // Blinky's egg sits in the middle, a little behind the other two
        const id = E.spec.id;
        const info = drawEgg(fx, E, p, sceneAlpha, () => emergeDragon(fx, id, true));
        if (!info.opened && sceneAlpha > 0.5 && gl <= 0) HIT.push({ id: "egg:" + id, x0: info.x - E.rx, x1: info.x + E.rx, y0: info.top, y1: info.y, x: info.x, y: info.y, h: 2 * E.ry });
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
          else if (b.kind === "conf") { fx.save(); fx.translate(bx2, by); fx.rotate(b.spin * bt); fx.globalAlpha = a; fx.fillStyle = `rgb(${col})`; fx.fillRect(-s, -s * 0.45, s * 2, s * 0.9); fx.restore(); }
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
    fx.drawImage(L.front, cx - W * fz / 2 - tiltX * 26, H - H * fz + gl * H * 0.25 - tiltY * 10, W * fz, H * fz);
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
    if (id === "speed") {
      if (prog >= 1) return;
      const a = easeIn(prog) * 0.6 + prog * 0.4, end = [W * 1.25, H * 0.08], ctrl = [start[0] + EH * 0.3, start[1] - EH * 2.2];
      const h = hFull * (0.45 + 0.75 * a);
      for (let gI = 6; gI >= 0; gI--) {
        const aa = Math.max(0, a - gI * 0.045), pt = quad(start, ctrl, end, aa), nx = quad(start, ctrl, end, Math.min(1, aa + 0.02));
        const rot = Math.atan2(nx[1] - pt[1], nx[0] - pt[0]) * 0.35 + 0.3, [px, py] = at(pt[0], pt[1]);
        if (gI > 0) { ctx.save(); ctx.globalCompositeOperation = "lighter"; dot(ctx, gI % 2 ? L.tint.sun : L.tint.lilac, px, py - h * 0.5, h * 0.35, 0.22 * (1 - gI / 7)); ctx.restore(); sprite(ctx, "speed", px, py, h, { rot, alpha: 0.14 * (1 - gI / 7), pose: "jump" }); }
        else sprite(ctx, "speed", px, py, h, { rot, pose: "jump" });
      }
      return;
    }
    if (id === "pinky") {
      const a = backOut(Math.min(1, prog)), tx = Math.max(cx - EH * 1.25, hFull * 0.45 + 14), ty = base - EH * 0.62;
      const [px, py] = at(lerp(start[0], tx, a), lerp(start[1], ty, a) + Math.sin(clock * 6.5) * EH * 0.035 * clamp(prog * 3));
      const flap = 1 + 0.05 * Math.sin(clock * 13);
      sprite(ctx, "pinky", px, py, hFull * (0.35 + 0.65 * easeOut(Math.min(1, prog))), { sx: 1 / Math.sqrt(flap), sy: flap, rot: Math.sin(clock * 3) * 0.06, id: !inside && prog >= 1 ? "pinky" : undefined, pose: prog < 1 ? "wave" : undefined });
      return;
    }
    // Blinky hops out of the middle egg and lands in front of the nest
    const landX = Math.min(cx + EH * 1.15, W - hFull * 0.42 - 14), landY = base + EH * 0.22, air = clamp(prog / 0.85);
    let sx = 1, sy = 1;
    if (prog > 0.85) { const q = (prog - 0.85) / 0.15; sy = 1 - 0.16 * Math.sin(q * Math.PI); sx = 1 + 0.1 * Math.sin(q * Math.PI); }
    if (prog >= 1) sy = 1 + 0.015 * Math.sin(clock * 2.2);
    const [px, py] = at(lerp(start[0], landX, ease(air)), lerp(start[1], landY, air) - Math.sin(air * Math.PI) * EH * 0.75);
    sprite(ctx, "blinky", px, py, hFull * (0.4 + 0.6 * easeOut(Math.min(1, prog))), { sx, sy, shadow: prog > 0.85, rot: (1 - air) * -0.2 * (prog < 0.85 ? 1 : 0), id: !inside && prog >= 1 ? "blinky" : undefined, pose: prog < 1 ? "stand" : undefined });
    // Speed comes back to stand by the nest once everyone is out
    if (!inside) {
      const back = seg(pp, 0.86, 0.96);
      if (back > 0) {
        const x = lerp(-W * 0.2, Math.max(cx - EH * 1.55, hFull * 0.4 + 10), easeOut(back)), y = base + EH * 0.26;
        sprite(ctx, "speed", x, y, hFull * 0.85, { shadow: back >= 1, rot: (1 - back) * 0.3, id: back >= 1 ? "speed" : undefined, pose: back < 1 ? "jump" : undefined });
      }
    }
  }
  function glideDragons(ctx, gl) {
    const { EH, cx, base } = layout, hFull = EH * 0.82, z = 1 + gl * 2.4, a = 1 - seg(gl, 0.65, 1);
    sprite(ctx, "pinky", lerp(Math.max(cx - EH * 1.25, hFull * 0.45 + 14), -W * 0.2, ease(gl)), lerp(base - EH * 0.62, H * 0.2, gl) + Math.sin(clock * 6.5) * 6, hFull * z, { alpha: a, pose: "wave" });
    sprite(ctx, "blinky", lerp(Math.min(cx + EH * 1.15, W - hFull * 0.42 - 14), W * 1.25, easeIn(gl)), lerp(base + EH * 0.22, H * 1.3, easeIn(gl)), hFull * z, { alpha: a, pose: "wave" });
    const s = seg(gl, 0.2, 0.8);
    if (s > 0 && s < 1) {
      const x = lerp(-W * 0.3, W * 1.3, s), y = H * 0.32 + Math.sin(s * Math.PI * 2) * H * 0.05;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 1; i < 10; i++) dot(ctx, i % 2 ? L.tint.sun : L.tint.lilac, x - i * W * 0.035, y - hFull * 0.45, hFull * 0.28, 0.25 * (1 - i / 10));
      ctx.restore();
      sprite(ctx, "speed", x, y, hFull * 0.9, { rot: 0.35, pose: "jump" });
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
      const ang = clock * 2.4 + c * 8, rr = Math.min(w * 0.62, W * 0.42 - dh * 0.25), sx = x + Math.cos(ang) * rr, sy = y - h * 0.45 + Math.sin(ang) * h * 0.18, front = Math.sin(ang) > 0;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let k2 = 1; k2 < 8; k2++) { const a2 = ang - k2 * 0.12; dot(ctx, k2 % 2 ? L.tint.sun : L.tint.lilac, x + Math.cos(a2) * rr, y - h * 0.45 + Math.sin(a2) * h * 0.18 - dh * 0.35, dh * 0.22, 0.25 * (1 - k2 / 8) * alpha * enter); }
      ctx.restore();
      sprite(ctx, "speed", sx, sy + dh * 0.2, dh * (front ? 0.8 : 0.55) * enter, { alpha: alpha * (front ? 1 : 0.7), flip: Math.cos(ang) > 0, rot: Math.cos(ang) * 0.3, id: "speed" });
    }
    if (i === 3) {
      sprite(ctx, "blinky", kx(x - w * 0.5, dh), y + h * 0.04, dh * 0.85 * (1 + 0.012 * Math.sin(clock * 2.2)), { alpha: alpha * enter, shadow: true, id: "blinky" });
      sprite(ctx, "pinky", kx(x + w * 0.55, dh), y - h * 0.3 + Math.sin(clock * 6) * h * 0.03, dh * 0.75, { alpha: alpha * enter, sy: 1 + 0.04 * Math.sin(clock * 12), id: "pinky" });
      const hop = Math.abs(Math.sin(clock * 3.2));
      sprite(ctx, "speed", kx(x + w * 0.18, dh), y + h * 0.06 - hop * h * 0.12, dh * 0.7, { alpha: alpha * enter, sy: 1 - (1 - hop) * 0.08, id: "speed" });
    }
  }
  function ending(ctx, en) {
    const { EH, cx } = layout, fy = H * 0.8;
    const leave = seg(cur, TRACK - 1.1, TRACK - 0.2);          // the dragons step back as the page content comes up
    const a = ease(en) * (1 - leave * 0.85);
    // a sunny hilltop with a rainbow behind
    ctx.save(); ctx.globalAlpha = ease(en);
    const hill = ctx.createLinearGradient(0, fy - H * 0.1, 0, H);
    hill.addColorStop(0, "#9edc76"); hill.addColorStop(1, "#4fa24c");
    ctx.fillStyle = hill; ctx.beginPath(); ctx.ellipse(cx, H * 1.05, W * 0.9, H * 0.3, 0, Math.PI, 2 * Math.PI); ctx.fill();
    const R = Math.min(W * 0.55, H * 0.7) * (0.6 + 0.4 * easeOut(en));
    ["255,120,120", "255,180,90", "255,225,110", "140,220,140", "120,180,255", "180,150,255"].forEach((col, i) => {
      ctx.strokeStyle = `rgba(${col},${0.55 * ease(en)})`; ctx.lineWidth = R * 0.045; ctx.beginPath(); ctx.arc(cx, fy + R * 0.15, R - i * R * 0.045, Math.PI, 2 * Math.PI); ctx.stroke();
    });
    ctx.restore();
    const dh = Math.min(EH * 0.95, H * 0.3, W * (W < 700 ? 0.3 : 1)), narrowE = W < 700;
    const spread = Math.min(W * (narrowE ? 0.33 : 0.3), dh * 1.4), inX = 1 - easeOut(seg(en, 0.2, 0.8));
    sprite(ctx, "blinky", cx - spread - inX * W * 0.4, fy + dh * 0.08, dh * (1 + 0.012 * Math.sin(clock * 2.2)), { alpha: a, shadow: true, id: "blinky" });
    sprite(ctx, "pinky", cx + spread * (narrowE ? 0.45 : 1) + inX * W * 0.4, fy - dh * (narrowE ? 0.95 : 0.25) + Math.sin(clock * 6) * dh * 0.04, dh * 0.92, { alpha: a, flip: true, sy: 1 + 0.04 * Math.sin(clock * 12), id: "pinky" });
    const hop = Math.abs(Math.sin(clock * 2.6));
    sprite(ctx, "speed", cx + (narrowE ? spread : 0) * 1, fy + dh * 0.12 - hop * dh * 0.08 - inX * H * 0.5, dh * 0.78, { alpha: a, sy: 1 - (1 - hop) * 0.07, id: "speed" });
  }

  size(); readScroll(); cur = target;
  requestAnimationFrame(frame);

  // ---------- the nests: eggs float, tools orbit on a tilted ring ----------
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  document.querySelectorAll(".n22-nest").forEach((nest) => {
    const egg = nest.querySelector(".n22-egg"), cards = [...nest.querySelectorAll(".n22-card")], stg = nest.querySelector(".n22-stage");
    const home = nest.querySelector(".n22-name").getAttribute("href");
    let open = false, ang = 0, vel = 0.35, dragX = null, lastT = 0, raf = 0, hovering = false;
    function place() {
      const R = stg.clientWidth * 0.66, ryy = stg.clientWidth * 0.26, n = cards.length;
      cards.forEach((c, i) => {
        const a = ang + (i / n) * Math.PI * 2, z = Math.cos(a), x = Math.sin(a) * R, y = z * ryy + stg.clientWidth * 0.04;
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
    egg.addEventListener("focus", () => setOpen(true));
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
