/* The Dragon Circle as a short video. Drawn on the Keeper's own device, 1920 by 1080 at 60 frames a second, and
   encoded frame by frame (WebCodecs H.264 + mp4-muxer) so it is perfectly smooth on any phone: a slow phone only takes
   longer, it never drops a frame. Older Safari records the canvas live instead.

   The idea: a night sky, and you light up in the middle like a star. A comet of light leaves you for each of your
   Keepers, closest first, and where it lands that Keeper appears, so your circle is drawn as your own constellation.
   The orbits trace themselves, your top three catch a golden glint, and the words slide in while the sky keeps slowly
   turning.

   pdCircleVideo.ready()                 resolves to a plan when this browser can make an MP4 that X takes, or null
   pdCircleVideo.play(canvas, o)         plays the preview in a loop; returns a stop function
   pdCircleVideo.make(o)                 resolves to an MP4 Blob
   o: { handle, me: { img, letter }, people: [{ user, img, letter }], count, onProgress, muxer } */
(() => {
  "use strict";
  const W = 1920, H = 1080, FPS = 60, DUR = 7600;
  const K = 1.6;                                   // the still card is laid out at 1200 x 675
  const CX = 870 * K, CY = 338 * K, R1 = 175 * K, R2 = 268 * K, S1 = 88 * K, S2 = 64 * K, SME = 170 * K;
  const INNER = 8;
  const UA = navigator.userAgent || "";
  const SAFARI = /Safari\//.test(UA) && !/Chrome|Chromium|CriOS|Edg|Android/.test(UA);
  const TYPES = ['video/mp4;codecs="avc1.42E01E"', "video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1"].concat(SAFARI ? ["video/mp4"] : []);
  const CODECS = ["avc1.640033", "avc1.640032", "avc1.4d0032", "avc1.42003e", "avc1.640028"];
  let plan = null;
  async function ready() {
    if (plan) return plan;
    if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
      for (const codec of CODECS) {
        const cfg = { codec, width: W, height: H, bitrate: 16_000_000, framerate: FPS, avc: { format: "avc" } };
        try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) return (plan = { kind: "codec", cfg }); } catch (e) { /* next */ }
      }
    }
    if (typeof MediaRecorder !== "undefined" && HTMLCanvasElement.prototype.captureStream) {
      for (const t of TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return (plan = { kind: "live", type: t }); } catch (e) { /* next */ } }
    }
    return (plan = null);
  }

  const clamp = (k) => Math.max(0, Math.min(1, k));
  const out3 = (k) => 1 - Math.pow(1 - clamp(k), 3);
  const out5 = (k) => 1 - Math.pow(1 - clamp(k), 5);
  const inout = (k) => { k = clamp(k); return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };

  function scene(o) {
    const ppl = (o.people || []).slice(0, 20);
    // the sky: drawn once
    const sky = document.createElement("canvas"); sky.width = W; sky.height = H;
    const s = sky.getContext("2d");
    const g = s.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#130b29"); g.addColorStop(1, "#2a1640"); s.fillStyle = g; s.fillRect(0, 0, W, H);
    const rg = s.createRadialGradient(CX, CY, 40, CX, CY, 760); rg.addColorStop(0, "rgba(170, 80, 140, .55)"); rg.addColorStop(.55, "rgba(110, 50, 120, .22)"); rg.addColorStop(1, "rgba(40, 20, 70, 0)");
    s.fillStyle = rg; s.fillRect(0, 0, W, H);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const stars = Array.from({ length: 220 }, () => ({ x: rnd() * W, y: rnd() * H, r: .5 + rnd() * 1.8, p: rnd() * 6.28, sp: .6 + rnd() * 1.6, d: .2 + rnd() * .8 }));
    // each Keeper's disc: drawn once
    function disc(img, letter, size, ring) {
      const pad = 10, c = document.createElement("canvas"); c.width = c.height = size + pad * 2;
      const x = c.getContext("2d"), r = size / 2, m = c.width / 2;
      x.save(); x.beginPath(); x.arc(m, m, r, 0, 6.2832); x.closePath(); x.clip();
      if (img) { x.drawImage(img, m - r, m - r, size, size); }
      else { x.fillStyle = "#5c408c"; x.fillRect(0, 0, c.width, c.height); x.fillStyle = "#ffecd2"; x.font = `700 ${Math.round(size * .46)}px Fredoka, system-ui, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(letter || "?", m, m + 3); }
      x.restore(); return { c, ring, size };
    }
    const meDisc = disc(o.me && o.me.img, o.me && o.me.letter, SME, "#ff9f6e");
    const spots = ppl.map((p, i) => {
      const inner = i < INNER, n = inner ? Math.min(INNER, ppl.length) : Math.max(1, ppl.length - INNER), j = inner ? i : i - INNER;
      const ang = -Math.PI / 2 + (j / n) * Math.PI * 2 + (inner ? 0 : .26);
      return { ang, r: inner ? R1 : R2, d: disc(p.img, p.letter, inner ? S1 : S2, inner ? "#ffc45c" : "#c4aaff"), rank: i + 1,
        t0: inner ? 1.0 + j * .1 : 1.75 + j * .065, inner };
    });
    const handle = "@" + (o.handle || "");
    const count = `${o.count || ppl.length} Keepers in my circle`;

    return function draw(x, ms) {
      const t = ms / 1000;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.drawImage(sky, 0, 0);
      // stars twinkle and drift a little with the camera
      const cam = 1.08 - .08 * out3(t / 2.4), rot = -.25 + .25 * out5(t / 3.2) + t * .018;
      for (const st of stars) {
        const a = .25 + .55 * (.5 + .5 * Math.sin(st.p + t * st.sp * 1.6));
        x.globalAlpha = a; x.fillStyle = "#fff4e4";
        const px = CX + (st.x - CX) * (1 + (cam - 1) * st.d), py = CY + (st.y - CY) * (1 + (cam - 1) * st.d);
        x.beginPath(); x.arc(px, py, st.r, 0, 6.2832); x.fill();
      }
      x.globalAlpha = 1;
      // the camera: a slow pull back that settles on the card's framing
      x.setTransform(cam, 0, 0, cam, CX * (1 - cam), CY * (1 - cam));
      const pos = (sp) => [CX + sp.r * Math.cos(sp.ang + rot), CY + sp.r * Math.sin(sp.ang + rot)];
      // orbits trace themselves with a bright head
      for (const [r, a, t0] of [[R1, .3, .9], [R2, .2, 1.5]]) {
        const k = inout((t - t0) / 1.4); if (k <= 0) continue;
        const a0 = -Math.PI / 2 + rot;
        x.strokeStyle = `rgba(255, 214, 150, ${a})`; x.lineWidth = 2.4;
        x.beginPath(); x.arc(CX, CY, r, a0, a0 + k * 6.2832); x.stroke();
        if (k < 1) { const hx = CX + r * Math.cos(a0 + k * 6.2832), hy = CY + r * Math.sin(a0 + k * 6.2832); glowDot(x, hx, hy, 18, "255, 226, 170", .9); }
      }
      // stardust drifting round the orbits, so the finished circle stays alive
      const kd = clamp((t - 2.3) / 1.2);
      if (kd > 0) for (let i = 0; i < 36; i++) {
        const inner = i < 16, r = inner ? R1 : R2, n = inner ? 16 : 20, j = inner ? i : i - 16;
        const a = (j / n) * 6.2832 + t * (inner ? .22 : -.14) + rot;
        const tw = .35 + .65 * (.5 + .5 * Math.sin(t * 2.4 + i * 1.7));
        glowDot(x, CX + r * Math.cos(a), CY + r * Math.sin(a), inner ? 9 : 7, "255, 226, 170", kd * tw * .55);
      }
      // constellation threads from you to each Keeper, then the comet that draws them
      for (const sp of spots) {
        const k = out3((t - sp.t0) / .5); if (k <= 0) continue;
        const [px, py] = pos(sp), ex = CX + (px - CX) * k, ey = CY + (py - CY) * k;
        const lg = x.createLinearGradient(CX, CY, ex, ey);
        lg.addColorStop(0, "rgba(255, 190, 120, 0)"); lg.addColorStop(1, `rgba(255, 220, 160, ${sp.inner ? .34 : .22})`);
        x.strokeStyle = lg; x.lineWidth = sp.inner ? 2.4 : 1.8; x.beginPath(); x.moveTo(CX, CY); x.lineTo(ex, ey); x.stroke();
        if (k < 1) {   // the comet: a bright head with a short fading tail
          const kt = Math.max(0, k - .22), tx = CX + (px - CX) * kt, ty = CY + (py - CY) * kt;
          const tg = x.createLinearGradient(tx, ty, ex, ey); tg.addColorStop(0, "rgba(255, 230, 180, 0)"); tg.addColorStop(1, "rgba(255, 246, 225, .95)");
          x.strokeStyle = tg; x.lineWidth = 6; x.lineCap = "round"; x.beginPath(); x.moveTo(tx, ty); x.lineTo(ex, ey); x.stroke(); x.lineCap = "butt";
          glowDot(x, ex, ey, 26, "255, 232, 190", 1);
        }
      }
      // you, lighting up like a star
      const kb = clamp((t - .15) / 1.1);
      if (kb > 0 && kb < 1) {
        const br = 60 + 520 * out3(kb), ba = (1 - kb) * .9;
        const bg = x.createRadialGradient(CX, CY, 0, CX, CY, br); bg.addColorStop(0, `rgba(255, 244, 220, ${ba})`); bg.addColorStop(.4, `rgba(255, 190, 120, ${ba * .5})`); bg.addColorStop(1, "rgba(255, 150, 100, 0)");
        x.fillStyle = bg; x.beginPath(); x.arc(CX, CY, br, 0, 6.2832); x.fill();
        x.strokeStyle = `rgba(255, 230, 190, ${(1 - kb) * .8})`; x.lineWidth = 3; x.beginPath(); x.arc(CX, CY, SME * .5 + 380 * out5(kb), 0, 6.2832); x.stroke();
      }
      const km = out3((t - .25) / .7);
      if (km > 0) {
        const breathe = 1 + .012 * Math.sin(t * 2.2);
        haloDisc(x, meDisc, CX, CY, (.9 + .1 * km) * breathe, km, 1, 7);
      }
      // each Keeper arrives where their comet lands: the ring draws round, the picture fades in
      for (const sp of spots) {
        const k = clamp((t - sp.t0 - .42) / .38); if (k <= 0) continue;
        const [px, py] = pos(sp);
        if (k < .6) glowDot(x, px, py, sp.d.size * .9, "255, 236, 200", (1 - k / .6) * .7);
        haloDisc(x, sp.d, px, py, .94 + .06 * out3(k), out3(k), out3(k * 1.4), sp.inner ? 6 : 5);
      }
      // the top three catch a golden glint and get their number
      for (const sp of spots) {
        if (sp.rank > 3) continue;
        const [px, py] = pos(sp), k = clamp((t - 3.15 - sp.rank * .12) / .6); if (k <= 0) continue;
        const rr = sp.d.size / 2 + 6;
        if (k < 1) { x.strokeStyle = `rgba(255, 246, 210, ${1 - k})`; x.lineWidth = 6; const a = -Math.PI / 2 + k * 6.2832; x.beginPath(); x.arc(px, py, rr, a - .6, a); x.stroke(); }
        const bx = px + sp.d.size * .36, by = py - sp.d.size * .5 + 10 * (1 - out3(k));
        x.globalAlpha = out3(k);
        x.fillStyle = "#ffd65c"; x.beginPath(); x.arc(bx, by, 27, 0, 6.2832); x.fill();
        x.lineWidth = 4.5; x.strokeStyle = "#3c1e50"; x.stroke();
        x.fillStyle = "#321a3c"; x.font = "700 34px Fredoka, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(sp.rank), bx, by + 2);
        x.globalAlpha = 1;
      }
      // the words, wiped in from the left
      x.setTransform(1, 0, 0, 1, 0, 0);
      const kw = out5((t - 3.0) / .9);
      if (kw > 0) {
        x.save(); x.beginPath(); x.rect(0, 0, 96 + 820 * kw, H); x.clip();
        const dy = 18 * (1 - kw);
        x.fillStyle = "#ffc45c"; rrect(x, 96, 342 + dy, 404, 74, 37); x.fill();
        x.fillStyle = "#281636"; x.font = "700 38px Fredoka, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("DRAGON CIRCLE", 298, 380 + dy);
        let fs = 112; x.font = `700 ${fs}px Fredoka, system-ui, sans-serif`; while (x.measureText(handle).width > 760 && fs > 56) { fs -= 4; x.font = `700 ${fs}px Fredoka, system-ui, sans-serif`; }
        x.textAlign = "left"; x.fillStyle = "#fff6e4"; x.shadowColor = "rgba(0, 0, 0, .35)"; x.shadowBlur = 18; x.fillText(handle, 96, 528 + dy);
        x.shadowBlur = 0; x.fillStyle = "#ffd696"; x.font = "700 51px Fredoka, system-ui, sans-serif"; x.fillText(count, 96, 656 + dy);
        x.restore();
      }
      const ks = out3((t - 3.6) / .6);
      if (ks > 0) { x.globalAlpha = ks * .86; x.fillStyle = "#fff6e4"; x.font = "700 42px Fredoka, system-ui, sans-serif"; x.textAlign = "right"; x.textBaseline = "middle"; x.fillText("pdtools.xyz", W - 58, H - 48); x.globalAlpha = 1; }
      // a soft fade in at the very start
      if (t < .35) { x.fillStyle = `rgba(10, 6, 20, ${1 - t / .35})`; x.fillRect(0, 0, W, H); }
    };
  }
  function rrect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function glowDot(x, X, Y, r, rgb, a) {
    const g = x.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, `rgba(255, 255, 255, ${a})`); g.addColorStop(.25, `rgba(${rgb}, ${a * .8})`); g.addColorStop(1, `rgba(${rgb}, 0)`);
    x.fillStyle = g; x.beginPath(); x.arc(X, Y, r, 0, 6.2832); x.fill();
  }
  // a disc with a soft shadow, its ring drawn round to `ring` (0 to 1) and the picture at `alpha`
  function haloDisc(x, d, X, Y, scale, alpha, ring, width) {
    const r = d.size / 2 * scale;
    x.save(); x.globalAlpha = alpha * .5; x.fillStyle = "#000"; x.shadowColor = "rgba(0, 0, 0, .6)"; x.shadowBlur = 26; x.shadowOffsetY = 12;
    x.beginPath(); x.arc(X, Y, r + width, 0, 6.2832); x.fill(); x.restore();
    x.save(); x.globalAlpha = alpha; const w = d.c.width * scale; x.drawImage(d.c, X - w / 2, Y - w / 2, w, w); x.restore();
    if (ring > 0) { x.strokeStyle = d.ring; x.lineWidth = width * scale * 1.6; x.lineCap = "round"; x.beginPath(); x.arc(X, Y, r + width * .55, -Math.PI / 2, -Math.PI / 2 + ring * 6.2832); x.stroke(); x.lineCap = "butt"; }
  }

  function play(canvas, o) {
    canvas.width = W; canvas.height = H; const x = canvas.getContext("2d"), draw = scene(o);
    let id = 0, t0 = performance.now();
    const tick = (now) => { const ms = (now - t0) % (DUR + 600); draw(x, Math.min(ms, DUR)); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }

  async function make(o) {
    const how = await ready(); if (!how) throw new Error("no video");
    const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d", { alpha: false }); const draw = scene(o);
    const frames = Math.round(DUR / 1000 * FPS);
    if (how.kind === "codec") {
      const M = o.muxer; if (!M) throw new Error("no muxer");
      const target = new M.ArrayBufferTarget();
      const mux = new M.Muxer({ target, video: { codec: "avc", width: W, height: H, frameRate: FPS }, fastStart: "in-memory" });
      let failed = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => mux.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
      enc.configure(how.cfg);
      for (let i = 0; i < frames; i++) {
        if (failed) throw failed;
        draw(x, i * 1000 / FPS);
        const vf = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % FPS === 0 }); vf.close();
        while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 3));
        if (i % 10 === 0) { if (o.onProgress) o.onProgress(i / frames); await new Promise((r) => setTimeout(r, 0)); }
      }
      await enc.flush(); enc.close(); if (failed) throw failed;
      mux.finalize(); if (o.onProgress) o.onProgress(1);
      return new Blob([target.buffer], { type: "video/mp4" });
    }
    draw(x, 0);
    const stream = c.captureStream(FPS), rec = new MediaRecorder(stream, { mimeType: how.type, videoBitsPerSecond: 16_000_000 }), parts = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    const done = new Promise((res, rej) => { rec.onstop = () => res(); rec.onerror = (e) => rej(e.error || e); });
    rec.start(250); const t0 = performance.now();
    await new Promise((res) => { const tick = () => { const ms = performance.now() - t0; draw(x, Math.min(ms, DUR)); if (o.onProgress) o.onProgress(Math.min(1, ms / DUR)); if (ms >= DUR + 300) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    rec.stop(); stream.getTracks().forEach((tr) => tr.stop()); await done;
    const blob = new Blob(parts, { type: "video/mp4" }); if (!blob.size) throw new Error("empty"); return blob;
  }

  window.pdCircleVideo = { ready, play, make, scene, W, H, FPS, DUR };
})();
