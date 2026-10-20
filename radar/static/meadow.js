/* The meadow: a hand-drawn animated scene on canvas. Original baby dragon, not a project character. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // =====================================================================
  // The meadow: a hand-built animated scene drawn on canvas
  // =====================================================================

  function buildMeadow() {
    const canvas = $("meadow"), ctx = canvas.getContext("2d");
    if (!ctx) return null;
    let W = 0, H = 0, dpr = 1, horizon = 0, lowRes = false;
    // Photo mode: the realistic meadow lives in image/video layers behind this canvas, which then only
    // draws light particles (fireflies, floating pollen, shooting stars) on a transparent background.
    const PHOTO = !!(window.RADAR_SCENE && window.RADAR_SCENE.base);
    let motes = [];
    let blades = [], flowers = [], clouds = [], hills = [], stars = [], bugs = [];
    const rnd = (a, b) => a + Math.random() * (b - a);

    // ---------- day and night: the sky follows the visitor's own clock ----------
    // hour, sky top, sky middle, sky low, ground tint [r,g,b,a], darkness (0 day, 1 night)
    const KEYS = [
      [0, "#060a22", "#121842", "#262b5e", [8, 12, 40, .6], 1],
      [4.8, "#0b1033", "#20275a", "#3a3b78", [10, 14, 46, .56], 1],
      [5.8, "#2a3c8c", "#8a6cac", "#f5a688", [70, 40, 90, .3], .6],
      [6.7, "#4a88d8", "#f8b88c", "#ffe2a8", [255, 150, 90, .12], .15],
      [8, "#3aa8f0", "#8fd3ff", "#dff4ff", [0, 0, 0, 0], 0],
      [16.6, "#3aa8f0", "#8fd3ff", "#dff4ff", [0, 0, 0, 0], 0],
      [17.8, "#4b80d2", "#ffa878", "#ffd69c", [255, 130, 70, .15], .15],
      [18.6, "#2b3984", "#a1589a", "#ff906c", [90, 40, 90, .3], .55],
      [19.6, "#0e153e", "#262b64", "#473c7c", [12, 16, 48, .54], .9],
      [24, "#060a22", "#121842", "#262b5e", [8, 12, 40, .6], 1],
    ];
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const KEYS_RGB = KEYS.map((k) => [k[0], hex(k[1]), hex(k[2]), hex(k[3]), k[4], k[5]]);
    const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
    const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
    function palette(h) {
      let i = 0; while (i < KEYS_RGB.length - 2 && KEYS_RGB[i + 1][0] <= h) i++;
      const A = KEYS_RGB[i], B = KEYS_RGB[i + 1];
      let f = (h - A[0]) / (B[0] - A[0]); f = f * f * (3 - 2 * f);   // smooth step between keys
      return { top: mix(A[1], B[1], f), mid: mix(A[2], B[2], f), low: mix(A[3], B[3], f), tint: mix(A[4], B[4], f), dark: A[5] + (B[5] - A[5]) * f };
    }
    const LAPSE_S = 24;                                   // a full day in 24 seconds when someone presses play
    const forced = parseFloat(new URLSearchParams(location.search).get("hour"));
    let lapse = null, onLapse = null, sky = palette(12), hour = 12;
    let mode = "auto";
    try { mode = localStorage.getItem("pd:sky") || "auto"; } catch (e) { /* private mode */ }
    function clockHour(nowMs) {
      if (lapse) {
        const e = (nowMs - lapse.start) / 1000;
        if (e < LAPSE_S) return (lapse.from + (e / LAPSE_S) * 24) % 24;
        lapse = null; onLapse && onLapse(false);
      }
      if (!isNaN(forced)) return ((forced % 24) + 24) % 24;
      if (mode === "day") return 12.5;
      if (mode === "night") return 23.5;
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = lowRes ? 0.5 : Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      horizon = H * 0.56;
      seed();
    }
    function seed() {
      const density = Math.min(1, W / 1200);
      blades = [];
      const n = Math.round(900 * (0.45 + 0.55 * density));
      for (let i = 0; i < n; i++) {
        const depth = Math.pow(Math.random(), 1.6);              // 0 far, 1 near
        blades.push({ x: rnd(-20, W + 20), y: horizon + 30 + depth * (H - horizon - 10), h: 14 + depth * 70 + rnd(0, 18), w: 2 + depth * 4,
          hue: 95 + rnd(-12, 18), light: 36 + rnd(-6, 10) + (1 - depth) * 10, ph: rnd(0, 6.28), depth });
      }
      blades.sort((a, b) => a.y - b.y);
      flowers = Array.from({ length: Math.round(60 * (0.5 + density)) }, () => {
        const depth = Math.pow(Math.random(), 1.4);
        return { x: rnd(0, W), y: horizon + 40 + depth * (H - horizon - 30), s: 3 + depth * 7, ph: rnd(0, 6.28),
          c: ["#ffffff", "#ffd23f", "#ff8fb1", "#b49cff", "#ff7a59"][Math.floor(Math.random() * 5)], depth };
      }).sort((a, b) => a.y - b.y);
      clouds = Array.from({ length: 6 }, (_, i) => ({ x: rnd(-200, W), y: rnd(H * 0.06, H * 0.32), s: rnd(0.7, 1.5), v: rnd(6, 16) }));
      stars = Array.from({ length: Math.round(150 * (0.5 + density * 0.5)) }, () => ({ x: rnd(0, W), y: Math.pow(Math.random(), 1.5) * horizon * 0.95,
        r: rnd(0.5, 1.7), ph: rnd(0, 6.28), sp: rnd(0.8, 2.6) }));
      motes = Array.from({ length: Math.round(26 * (0.5 + density)) }, () => ({ x: rnd(0, W), y: rnd(H * 0.2, H), r: rnd(1, 2.6),
        vx: rnd(4, 14), vy: rnd(-6, -2), ph: rnd(0, 6.28) }));
      bugs = Array.from({ length: Math.round(22 * (0.5 + density)) }, () => ({ x: rnd(0, W), y: rnd(horizon + 10, H - 20), ph: rnd(0, 6.28), sp: rnd(0.3, 0.8), ax: rnd(20, 60), ay: rnd(10, 30) }));
      hills = [
        { base: horizon - 10, amp: 38, f: 0.004, ph: 1.2, c1: "#9fdc8a", c2: "#7cc96c" },
        { base: horizon + 20, amp: 30, f: 0.006, ph: 3.1, c1: "#79cf62", c2: "#5cbd52" },
        { base: horizon + 52, amp: 22, f: 0.009, ph: 0.4, c1: "#5cc95a", c2: "#47b04a" },
      ];
    }

    // --- dragon state (an original baby dragon, coral with butter-yellow horns) ---
    const dragon = { x: 0, y: 0, vx: 0, vy: 0, dir: 1, hop: 0, cheer: 0, blink: 0, nextBlink: 1.5, target: 0 };
    const fly = { x: 0, y: 0, t: 0 };
    const sparkles = [];

    const shooting = { life: 0, x: 0, y: 0, vx: 0, vy: 0, next: 6 };
    function drawSky(t, dt) {
      const g = ctx.createLinearGradient(0, 0, 0, horizon + 60);
      g.addColorStop(0, rgb(sky.top)); g.addColorStop(0.55, rgb(sky.mid)); g.addColorStop(1, rgb(sky.low));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // stars fade in as the light goes
      if (sky.dark > 0.05) {
        ctx.fillStyle = "#fff";
        for (const st of stars) {
          ctx.globalAlpha = sky.dark * (0.45 + 0.55 * Math.sin(t * st.sp + st.ph) ** 2);
          ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
        }
        // now and then a shooting star on a dark night
        shooting.next -= dt;
        if (sky.dark > 0.8 && shooting.next <= 0 && shooting.life <= 0) {
          Object.assign(shooting, { life: 1, x: rnd(W * 0.15, W * 0.8), y: rnd(10, horizon * 0.35), vx: rnd(420, 620), vy: rnd(120, 220), next: rnd(7, 16) });
        }
        if (shooting.life > 0) {
          shooting.life -= dt * 1.4; shooting.x += shooting.vx * dt; shooting.y += shooting.vy * dt;
          const tail = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 0.18, shooting.y - shooting.vy * 0.18);
          tail.addColorStop(0, "rgba(255,255,255,0.95)"); tail.addColorStop(1, "rgba(255,255,255,0)");
          ctx.globalAlpha = Math.max(0, shooting.life) * sky.dark; ctx.strokeStyle = tail; ctx.lineWidth = 2; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - shooting.vx * 0.18, shooting.y - shooting.vy * 0.18); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      const arc = (p) => [W * (0.06 + 0.88 * p), horizon + 30 - Math.sin(Math.PI * p) * horizon * 0.78];
      const R = Math.min(W, H) * 0.07;
      // the sun rises at six and sets at six, warming as it nears the hills
      const sp = (hour - 6) / 12;
      if (sp > -0.06 && sp < 1.06) {
        const [sx, sy] = arc(sp), low = 1 - Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, sp))));
        const warm = Math.min(1, low * 1.3);
        const core = mix([255, 224, 102], [255, 138, 76], warm), halo = mix([255, 236, 160], [255, 150, 90], warm);
        const glow = ctx.createRadialGradient(sx, sy, R * 0.4, sx, sy, R * (5 + warm * 3));
        glow.addColorStop(0, rgb(halo, 0.9)); glow.addColorStop(0.3, rgb(halo, 0.35)); glow.addColorStop(1, rgb(halo, 0));
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 0.05);
        ctx.fillStyle = rgb(halo, 0.28 * (1 - warm));
        for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(R * 1.1, -R * 0.12); ctx.lineTo(R * 2.4, 0); ctx.lineTo(R * 1.1, R * 0.12); ctx.fill(); }
        ctx.restore();
        ctx.fillStyle = rgb(mix([255, 243, 176], [255, 196, 140], warm)); ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(core); ctx.beginPath(); ctx.arc(sx, sy, R * 0.82, 0, Math.PI * 2); ctx.fill();
      }
      // the moon takes the night shift
      const mp = (((hour - 18) % 24) + 24) % 24 / 12;
      if (mp > -0.06 && mp < 1.06) {
        const [mx, my] = arc(mp), r = R * 0.78;
        const glow = ctx.createRadialGradient(mx, my, r * 0.6, mx, my, r * 6);
        glow.addColorStop(0, "rgba(210,220,255,0.45)"); glow.addColorStop(1, "rgba(210,220,255,0)");
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        const mg = ctx.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r);
        mg.addColorStop(0, "#fffdf3"); mg.addColorStop(1, "#dcdcf2");
        ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(160,160,200,0.35)";
        [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.1]].forEach(([a, b, c]) => { ctx.beginPath(); ctx.arc(mx + a * r, my + b * r, c * r, 0, Math.PI * 2); ctx.fill(); });
      }
    }
    function nightTint() {
      // shade everything below the far hill line so the land darkens while the sky keeps its own light
      if (sky.tint[3] <= 0.005) return;
      const h = hills[0];
      ctx.save(); ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 20; x += 20) ctx.lineTo(x, h.base - 40 + Math.sin(x * h.f + h.ph) * h.amp + Math.sin(x * h.f * 2.3 + h.ph) * h.amp * 0.3);
      ctx.lineTo(W, H); ctx.closePath(); ctx.clip();
      ctx.fillStyle = rgb(sky.tint, sky.tint[3]); ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    function fireflies(t) {
      if (sky.dark < 0.2) return;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const pts = bugs.map((b) => [b.x + Math.sin(t * b.sp + b.ph) * b.ax, b.y + Math.cos(t * b.sp * 1.3 + b.ph) * b.ay, 0.35 + 0.65 * Math.max(0, Math.sin(t * 2 * b.sp + b.ph))]);
      pts.push([fly.x, fly.y, 1]);                     // after dark the dragon chases a firefly instead of the butterfly
      for (const [x, y, a] of pts) {
        const al = a * Math.min(1, (sky.dark - 0.2) * 1.6);
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
        g.addColorStop(0, `rgba(240,255,150,${al})`); g.addColorStop(0.25, `rgba(200,255,90,${al * 0.5})`); g.addColorStop(1, "rgba(200,255,90,0)");
        ctx.fillStyle = g; ctx.fillRect(x - 14, y - 14, 28, 28);
      }
      ctx.restore();
    }
    function cloud(c, dt) {
      c.x += c.v * dt; if (c.x - 200 * c.s > W) c.x = -260 * c.s;
      ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.s, c.s);
      ctx.fillStyle = rgb(mix([255, 255, 255], sky.mid, 0.12 + sky.dark * 0.55), 0.95 - sky.dark * 0.45);
      ctx.beginPath();
      [[0, 0, 34], [36, -14, 42], [80, -2, 34], [112, 8, 24], [52, 12, 32], [18, 14, 26]].forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); });
      ctx.fill();
      ctx.fillStyle = rgb(mix([170, 210, 240], sky.top, sky.dark * 0.6), 0.35); ctx.beginPath(); ctx.ellipse(56, 30, 70, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function drawHills() {
      for (const h of hills) {
        const g = ctx.createLinearGradient(0, h.base - h.amp, 0, H);
        g.addColorStop(0, h.c1); g.addColorStop(1, h.c2);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + 20; x += 20) ctx.lineTo(x, h.base + Math.sin(x * h.f + h.ph) * h.amp + Math.sin(x * h.f * 2.3 + h.ph) * h.amp * 0.3);
        ctx.lineTo(W, H); ctx.fill();
      }
      // distant trees on the first hill
      for (let i = 0; i < 9; i++) {
        const x = (i / 9) * W + 40, y = hills[0].base + Math.sin(x * hills[0].f + hills[0].ph) * hills[0].amp - 4;
        ctx.fillStyle = "#4fa65a"; ctx.beginPath(); ctx.arc(x, y - 16, 16, 0, Math.PI * 2); ctx.arc(x + 12, y - 10, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#7a5a3a"; ctx.fillRect(x - 2, y - 6, 4, 10);
      }
      // ground wash near the bottom
      const g = ctx.createLinearGradient(0, horizon + 40, 0, H);
      g.addColorStop(0, "rgba(92,201,90,0)"); g.addColorStop(1, "rgba(47,143,78,0.55)");
      ctx.fillStyle = g; ctx.fillRect(0, horizon + 40, W, H);
    }
    function blade(b, t, wind) {
      const sway = Math.sin(t * 1.6 + b.ph + b.x * 0.01) * (4 + b.depth * 7) + wind * (6 + b.depth * 10);
      ctx.fillStyle = `hsl(${b.hue} 62% ${b.light}%)`;
      ctx.beginPath();
      ctx.moveTo(b.x - b.w, b.y);
      ctx.quadraticCurveTo(b.x - b.w * 0.3 + sway * 0.4, b.y - b.h * 0.6, b.x + sway, b.y - b.h);
      ctx.quadraticCurveTo(b.x + b.w * 0.3 + sway * 0.4, b.y - b.h * 0.6, b.x + b.w, b.y);
      ctx.fill();
    }
    function flower(f, t) {
      const sway = Math.sin(t * 1.5 + f.ph) * 2;
      ctx.strokeStyle = "#3f9b4a"; ctx.lineWidth = 1 + f.depth; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x + sway, f.y - f.s * 3); ctx.stroke();
      const cx = f.x + sway, cy = f.y - f.s * 3;
      ctx.fillStyle = f.c;
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + t * 0.2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * f.s * 0.7, cy + Math.sin(a) * f.s * 0.7, f.s * 0.55, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#ffcf33"; ctx.beginPath(); ctx.arc(cx, cy, f.s * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    function butterfly(t) {
      if (sky.dark > 0.85) return;
      const flap = Math.abs(Math.sin(t * 18)) * 0.9 + 0.1;
      ctx.save(); ctx.translate(fly.x, fly.y); ctx.globalAlpha = 1 - sky.dark / 0.85;
      ctx.fillStyle = "#b49cff";
      ctx.beginPath(); ctx.ellipse(-6 * flap, -2, 7 * flap, 9, -0.4, 0, Math.PI * 2); ctx.ellipse(6 * flap, -2, 7 * flap, 9, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff8fb1";
      ctx.beginPath(); ctx.ellipse(-4 * flap, 6, 4 * flap, 5, -0.6, 0, Math.PI * 2); ctx.ellipse(4 * flap, 6, 4 * flap, 5, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1d2433"; ctx.fillRect(-1, -8, 2, 16);
      ctx.restore();
    }

    // The baby dragon, drawn from simple shapes. s = scale.
    function drawDragon(t) {
      const d = dragon, s = Math.max(0.95, Math.min(1.7, W / 760));
      const squash = d.hop > 0 ? 1 + Math.sin(d.hop * Math.PI) * 0.08 : 1 - Math.max(0, Math.sin(t * 9)) * 0.02;
      ctx.save();
      ctx.translate(d.x, d.y);
      // shadow
      const lift = Math.max(0, dragon.groundY - d.y);
      ctx.fillStyle = `rgba(29,60,30,${0.28 - Math.min(0.18, lift / 400)})`;
      ctx.beginPath(); ctx.ellipse(0, lift + 4, 46 * s * (1 - Math.min(0.4, lift / 300)), 9 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.scale(d.dir * s, s);
      ctx.scale(1 / squash, squash);

      const flap = Math.sin(t * (d.hop > 0 ? 22 : 6)) * (d.hop > 0 ? 0.6 : 0.18);
      const wag = Math.sin(t * 5) * 0.35;
      // tail
      ctx.strokeStyle = "#ff7a59"; ctx.lineWidth = 12; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-26, -18);
      const tx = -62, ty = -30 + Math.sin(t * 5) * 12;
      ctx.quadraticCurveTo(-52, -6, tx, ty); ctx.stroke();
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(-0.6 + wag);
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(13, 0); ctx.lineTo(0, 11); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
      // back wing
      wing(-6, -52, -0.3 - flap, "#9a83f2");
      // legs
      ctx.fillStyle = "#e8563a";
      const step = d.hop > 0 ? 0 : Math.sin(t * 9) * 3;
      ctx.beginPath(); ctx.ellipse(-14 + step, -4, 10, 8, 0, 0, Math.PI * 2); ctx.ellipse(16 - step, -4, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      // body
      const bg = ctx.createRadialGradient(-6, -46, 6, 0, -32, 46);
      bg.addColorStop(0, "#ffa07f"); bg.addColorStop(1, "#ff6a47");
      ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(0, -32, 34, 30, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffe7b8"; ctx.beginPath(); ctx.ellipse(8, -24, 18, 19, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(232,86,58,.35)"; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(8, -14 - i * 9, 12 - i, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
      // back spikes
      ctx.fillStyle = "#ffd23f";
      [[-22, -54], [-8, -62], [-32, -42]].forEach(([x, y]) => { ctx.beginPath(); ctx.moveTo(x - 6, y + 4); ctx.lineTo(x, y - 8); ctx.lineTo(x + 6, y + 4); ctx.fill(); });
      // front wing
      wing(4, -50, -0.1 - flap * 1.2, "#b49cff");
      // head
      const nod = d.hop > 0 ? -0.15 : Math.sin(t * 2.2) * 0.05;
      ctx.save(); ctx.translate(26, -62); ctx.rotate(nod);
      // horns
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath(); ctx.moveTo(-10, -20); ctx.quadraticCurveTo(-18, -38, -6, -40); ctx.quadraticCurveTo(-6, -28, -2, -22); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4, -22); ctx.quadraticCurveTo(4, -40, 16, -38); ctx.quadraticCurveTo(10, -28, 12, -20); ctx.fill();
      const hg = ctx.createRadialGradient(-4, -14, 4, 4, -4, 32);
      hg.addColorStop(0, "#ffa07f"); hg.addColorStop(1, "#ff6a47");
      ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(4, -4, 28, 24, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffb79a"; ctx.beginPath(); ctx.ellipse(24, 4, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8563a"; ctx.beginPath(); ctx.arc(28, 1, 1.8, 0, Math.PI * 2); ctx.arc(22, 0, 1.8, 0, Math.PI * 2); ctx.fill();
      // eye
      const open = d.blink > 0 ? Math.abs(Math.cos(d.blink * Math.PI)) : 1;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(8, -10, 9, 10 * open, 0, 0, Math.PI * 2); ctx.fill();
      if (open > 0.2) {
        const lx = Math.max(-2, Math.min(3, (fly.x - d.x) * d.dir / 80)), ly = Math.max(-3, Math.min(3, (fly.y - (d.y - 70)) / 60));
        ctx.fillStyle = "#1d2433"; ctx.beginPath(); ctx.ellipse(9 + lx, -9 + ly, 5.5, 6.5 * open, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(11 + lx, -12 + ly, 2, 0, Math.PI * 2); ctx.fill();
      }
      // cheek + smile
      ctx.fillStyle = "rgba(255,120,150,.45)"; ctx.beginPath(); ctx.ellipse(12, 6, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#c2412b"; ctx.lineWidth = 2; ctx.beginPath();
      if (d.cheer > 0) { ctx.fillStyle = "#c2412b"; ctx.ellipse(26, 11, 5, 4, 0, 0, Math.PI); ctx.fill(); }
      else { ctx.arc(24, 8, 5, 0.2, Math.PI - 0.6); ctx.stroke(); }
      ctx.restore();
      ctx.restore();

      function wing(x, y, rot, col) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-10, -40, -38, -44); ctx.quadraticCurveTo(-30, -30, -36, -22); ctx.quadraticCurveTo(-24, -18, -26, -8); ctx.quadraticCurveTo(-14, -8, 0, 0); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-14, -30, -36, -42); ctx.stroke();
        ctx.restore();
      }
    }

    function update(dt, t) {
      // butterfly wanders in a lazy loop above the meadow
      fly.t += dt;
      fly.x = W * 0.5 + Math.sin(fly.t * 0.55) * W * 0.28 + Math.sin(fly.t * 1.7) * 30;
      fly.y = dragon.groundY - 120 + Math.sin(fly.t * 1.3) * 40 + Math.cos(fly.t * 2.9) * 14;
      const d = dragon;
      // chase: hop toward the butterfly
      const dx = fly.x - d.x;
      d.dir = dx >= 0 ? 1 : -1;
      if (d.hop <= 0 && Math.abs(dx) > 30) { d.hop = 0.0001; d.vx = Math.max(-260, Math.min(260, dx * 1.6)); d.vy = -260 - Math.min(160, Math.abs(dx) * 0.4) - (d.cheer > 0 ? 160 : 0); }
      if (d.hop <= 0 && d.cheer > 0) { d.hop = 0.0001; d.vx = 0; d.vy = -420; }
      if (d.hop > 0) {
        d.vy += 980 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.hop = Math.min(0.999, d.hop + dt * 1.8);
        if (d.y >= d.groundY) { d.y = d.groundY; d.hop = 0; d.vx = 0; d.vy = 0; puff(d.x); }
      }
      d.x = Math.max(80, Math.min(W - 80, d.x));
      d.cheer = Math.max(0, d.cheer - dt);
      d.nextBlink -= dt;
      if (d.nextBlink <= 0 && d.blink <= 0) { d.blink = 0.001; d.nextBlink = rnd(2, 4.5); }
      if (d.blink > 0) { d.blink += dt * 5; if (d.blink >= 1) d.blink = 0; }
      for (const s of sparkles) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 200 * dt; s.life -= dt; }
      while (sparkles.length && sparkles[0].life <= 0) sparkles.shift();
    }
    function puff(x) {
      for (let i = 0; i < 6; i++) sparkles.push({ x: x + rnd(-24, 24), y: dragon.groundY, vx: rnd(-50, 50), vy: rnd(-90, -30), life: 0.5, c: "rgba(255,255,255,0.9)", r: rnd(3, 6) });
    }
    function burst() {
      const cols = ["#ffd23f", "#ff8fb1", "#b49cff", "#ffffff", "#ff7a59"];
      const bx = PHOTO ? W * 0.3 : dragon.x, by = PHOTO ? H * 0.5 : dragon.y - 70;
      for (let i = 0; i < 26; i++) sparkles.push({ x: bx, y: by, vx: rnd(-220, 220), vy: rnd(-380, -120), life: 1.1, c: cols[i % 5], r: rnd(3, 6) });
    }

    let last = performance.now(), acc = 0, scrollQuiet = 0;
    // Smooth scrolling: while the page moves, the blurred scene behind it holds still, so the phone only has to
    // slide the page and never redraw the meadow (and every glass card's blur) at the same time.
    const STEP = matchMedia("(pointer: coarse)").matches ? 1 / 15 : 1 / 24;
    addEventListener("scroll", () => { scrollQuiet = performance.now() + 220; }, { passive: true });
    addEventListener("touchmove", () => { scrollQuiet = performance.now() + 220; }, { passive: true });
    function frame(nowMs) {
      const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
      const t = nowMs / 1000;
      // after the intro the scene is blurred; draw fewer frames at lower resolution to save battery
      if (lowRes && nowMs < scrollQuiet) { if (!reduce) requestAnimationFrame(frame); return; }
      if (lowRes) { acc += dt; if (acc < STEP) { if (!reduce) requestAnimationFrame(frame); return; } acc = 0; }
      update(lowRes ? STEP : dt, t);
      const wind = Math.sin(t * 0.4) * 0.6 + Math.sin(t * 1.3) * 0.25;
      hour = clockHour(nowMs); sky = palette(hour); syncPage(nowMs);
      if (PHOTO) { photoFrame(t, lowRes ? STEP : dt); if (!reduce) requestAnimationFrame(frame); return; }
      drawSky(t, lowRes ? STEP : dt);
      clouds.forEach((c) => cloud(c, lowRes ? STEP : dt));
      drawHills();
      const dragonDepthY = dragon.groundY;
      let drawn = false;
      let fi = 0;
      for (const b of blades) {
        while (fi < flowers.length && flowers[fi].y <= b.y) flower(flowers[fi++], t);
        if (!drawn && b.y > dragonDepthY + 6) { drawDragon(t); drawn = true; }
        blade(b, t, wind);
      }
      while (fi < flowers.length) flower(flowers[fi++], t);
      if (!drawn) drawDragon(t);
      nightTint();
      butterfly(t);
      fireflies(t);
      for (const s of sparkles) { ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 2)); ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (!reduce) requestAnimationFrame(frame);
    }

    function photoFrame(t, dt) {
      ctx.clearRect(0, 0, W, H);
      // sunlit pollen drifting on the breeze, fading out as night comes
      const day = 1 - sky.dark;
      if (day > 0.05) {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        const warm = sky.tint[3] > 0.05 ? "255,200,140" : "255,250,220";
        for (const m of motes) {
          m.x += m.vx * dt; m.y += m.vy * dt + Math.sin(t * 0.8 + m.ph) * 0.15;
          if (m.x > W + 10) m.x = -10; if (m.y < H * 0.1) m.y = H + 5;
          const a = day * (0.25 + 0.35 * Math.max(0, Math.sin(t * 1.2 + m.ph)));
          const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4);
          g.addColorStop(0, `rgba(${warm},${a})`); g.addColorStop(1, `rgba(${warm},0)`);
          ctx.fillStyle = g; ctx.fillRect(m.x - m.r * 4, m.y - m.r * 4, m.r * 8, m.r * 8);
        }
        ctx.restore();
      }
      // shooting stars and fireflies after dark (reuses the drawn scene's helpers)
      if (sky.dark > 0.8) {
        shooting.next -= dt;
        if (shooting.next <= 0 && shooting.life <= 0)
          Object.assign(shooting, { life: 1, x: rnd(W * 0.1, W * 0.7), y: rnd(10, H * 0.25), vx: rnd(420, 620), vy: rnd(120, 220), next: rnd(7, 16) });
        if (shooting.life > 0) {
          shooting.life -= dt * 1.4; shooting.x += shooting.vx * dt; shooting.y += shooting.vy * dt;
          const tail = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 0.18, shooting.y - shooting.vy * 0.18);
          tail.addColorStop(0, "rgba(255,255,255,0.95)"); tail.addColorStop(1, "rgba(255,255,255,0)");
          ctx.globalAlpha = Math.max(0, shooting.life); ctx.strokeStyle = tail; ctx.lineWidth = 2; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - shooting.vx * 0.18, shooting.y - shooting.vy * 0.18); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      fly.t += dt;
      fly.x = W * 0.5 + Math.sin(fly.t * 0.55) * W * 0.3; fly.y = H * 0.7 + Math.sin(fly.t * 1.3) * 40;
      fireflies(t);
      for (const s of sparkles) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 200 * dt; s.life -= dt; }
      while (sparkles.length && sparkles[0].life <= 0) sparkles.shift();
      for (const s of sparkles) { ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 2)); ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    // let the page around the canvas know what time it is (a few times a second is plenty)
    let lastSync = -1e9, lastDark = null;
    const meta = document.querySelector('meta[name="theme-color"]');
    function phaseName() {
      if (sky.dark > 0.75) return "Night";
      if (sky.dark > 0.08 || sky.tint[3] > 0.06) return hour < 12 ? "Dawn" : "Dusk";
      return "Day";
    }
    function syncPage(nowMs) {
      if (nowMs - lastSync < 250) return; lastSync = nowMs;
      if (PHOTO && window.radarScene) window.radarScene.update(hour);
      const darkSky = sky.dark > 0.5;
      if (darkSky !== lastDark) { lastDark = darkSky; document.body.classList.toggle("dark-sky", darkSky); }
      if (meta && !document.documentElement.classList.contains("theme-dark")) meta.setAttribute("content", rgb(sky.mid).replace(/rgba\((\d+),(\d+),(\d+),1\)/, (_, r, g, b) => "#" + [r, g, b].map((v) => (+v).toString(16).padStart(2, "0")).join("")));
      // the clock always tells the real time; only Play a day shows the sky's own hour
      let shown = hour;
      if (!lapse && mode !== "auto") { const d = new Date(); shown = d.getHours() + d.getMinutes() / 60; }
      const hh = Math.floor(shown), mm = Math.floor((shown - hh) * 60);
      const label = document.getElementById("sky-label"), time = document.getElementById("sky-time"), pill = document.getElementById("sky-pill");
      if (label) label.textContent = phaseName();
      if (time) time.textContent = String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
      if (pill) pill.dataset.phase = phaseName().toLowerCase();
    }

    function place() {
      dragon.groundY = horizon + (H - horizon) * 0.55;
      if (!dragon.x) { dragon.x = W * 0.3; dragon.y = dragon.groundY; }
      dragon.y = Math.min(dragon.y, dragon.groundY);
    }
    window.addEventListener("resize", () => { resize(); place(); if (reduce) frame(performance.now()); });
    resize(); place();
    requestAnimationFrame(frame);
    if (reduce) setInterval(() => frame(performance.now()), 60000);   // still moves with the clock, just without animation

    return {
      cheer() { dragon.cheer = 0.6; burst(); },
      setLowRes(v) { lowRes = v; resize(); place(); if (reduce) frame(performance.now()); },
      setMode(m2) {
        mode = m2;
        try { localStorage.setItem("pd:sky", m2); } catch (e) { /* private mode */ }
        if (reduce) frame(performance.now());
      },
      getMode() { return mode; },
      playDay(cb) {
        if (reduce || lapse) return false;
        onLapse = cb; lapse = { start: performance.now(), from: hour }; cb && cb(true);
        return true;
      },
    };
  }


  const m = buildMeadow();
  window.meadow = m;
  if (m && document.body.classList.contains("static-page")) m.setLowRes(true);
  const pill = $("sky-pill"), menu = $("sky-menu");
  if (m && pill && menu) {
    const hint = pill.querySelector(".sky-hint");
    const LABEL = { auto: "Auto", day: "Day", night: "Night" };
    const mark = () => {
      const cur = m.getMode();
      menu.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === cur)));
      if (hint) hint.textContent = LABEL[cur] || "Auto";
    };
    const close = () => { menu.hidden = true; pill.setAttribute("aria-expanded", "false"); };
    pill.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; pill.setAttribute("aria-expanded", String(!menu.hidden)); });
    menu.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      e.stopPropagation();
      if (b.dataset.mode) m.setMode(b.dataset.mode);
      if (b.dataset.play) m.playDay((on) => { document.body.classList.toggle("lapse", on); pill.setAttribute("aria-pressed", on ? "true" : "false"); });
      mark(); close();
    });
    document.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    mark();
  }
})();
