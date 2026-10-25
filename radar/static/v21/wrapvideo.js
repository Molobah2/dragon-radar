/* Hatchery Wrapped as a short video (v2.1). Drawn on the Keeper's own device from the same story they just watched,
   so the server does no work. Every frame is drawn on its own and handed to the device's H.264 encoder (WebCodecs),
   then packed into an MP4 (mp4-muxer, loaded only when needed). That keeps the video perfectly smooth on any phone:
   a slow device just takes longer, it never drops frames. 1920 by 1080, 30 frames a second, silent, about 12 to 15 s.
   Browsers without WebCodecs but with an H.264 MediaRecorder (older Safari) record it live as a fallback.

   pdWrapVideo.ready()       resolves to a plan when this browser can make an MP4 that X takes, or null
   pdWrapVideo.make(o)       resolves to an MP4 Blob. o: { month, soFar, me, hatchery, uniq, dragons: [{ img, name, tier }],
                             top: [{ user, name, n, img }], circle: [{ user, name, img }], scene, blinky, card, T, onProgress, muxer } */
(() => {
  "use strict";
  const W = 1280, H = 720, FPS = 30, Q = 1.5;            // laid out at 1280 x 720, drawn at 1920 x 1080
  const UA = navigator.userAgent || "";
  // X only takes H.264 video. Chrome and Edge name the codec; Safari records H.264 whenever it records MP4 at all.
  // Some browsers record VP9 inside an MP4, which X refuses, so a plain "video/mp4" counts only on Safari.
  const SAFARI = /Safari\//.test(UA) && !/Chrome|Chromium|CriOS|Edg|Android/.test(UA);
  const TYPES = ['video/mp4;codecs="avc1.42E01E"', "video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1"].concat(SAFARI ? ["video/mp4"] : []);
  function recorderType() {
    if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) return "";
    for (const t of TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* next */ } }
    return "";
  }
  // High, then Main, then Baseline profile; the first one this device can encode at full size wins
  const CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.420028"];
  let plan = null;
  async function ready() {
    if (plan) return plan;
    if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
      for (const codec of CODECS) {
        const cfg = { codec, width: W * Q, height: H * Q, bitrate: 12_000_000, framerate: FPS, avc: { format: "avc" } };
        try { const r = await VideoEncoder.isConfigSupported(cfg); if (r && r.supported) return (plan = { kind: "codec", cfg }); } catch (e) { /* next */ }
      }
    }
    const t = recorderType();
    return (plan = t ? { kind: "live", type: t } : null);
  }

  const ease = (k) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
  const back = (k) => { k = Math.max(0, Math.min(1, k)); const c = 1.6; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const fmt = (n) => Number(n || 0).toLocaleString();

  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function font(x, size, weight = 700, fam = "Fredoka") { x.font = `${weight} ${size}px "${fam}", system-ui, sans-serif`; }
  function fitFont(x, text, width, size, floor, weight, fam) { let s = size; font(x, s, weight, fam); while (x.measureText(text).width > width && s > floor) { s -= 2; font(x, s, weight, fam); } return s; }
  // a line of text that rises a little and fades in
  function line(x, text, X, Y, k, { size = 40, floor = 20, width = 1000, weight = 700, fam = "Fredoka", color = "#fff7ec", align = "center", glow = 0 } = {}) {
    const a = ease(k); if (a <= 0) return;
    x.save(); x.globalAlpha *= a; x.textAlign = align; x.fillStyle = color;
    fitFont(x, text, width, size, floor, weight, fam);
    if (glow) { x.shadowColor = "rgba(255, 196, 110, .55)"; x.shadowBlur = glow; }
    x.fillText(text, X, Y + (1 - a) * 18); x.restore();
  }
  function kicker(x, text, Y, k) {
    const a = ease(k); if (a <= 0) return;
    x.save(); x.globalAlpha *= a; font(x, 19, 800, "Nunito");
    const t = text.toUpperCase(), w = x.measureText(t).width + 44;
    rr(x, W / 2 - w / 2, Y - 28, w, 40, 20); x.fillStyle = "rgba(255, 205, 110, .95)"; x.fill();
    x.fillStyle = "#3a1a06"; x.textAlign = "center"; x.fillText(t, W / 2, Y - 2); x.restore();
  }
  function chip(x, big, small, cx, Y, k) {
    const a = back(k); if (k <= 0) return;
    x.save(); x.globalAlpha *= Math.min(1, ease(k) * 1.2); x.translate(cx, Y); x.scale(.6 + .4 * a, .6 + .4 * a);
    rr(x, -150, -58, 300, 116, 26); x.fillStyle = "rgba(255, 255, 255, .1)"; x.fill(); x.strokeStyle = "rgba(255, 255, 255, .2)"; x.lineWidth = 2; x.stroke();
    x.textAlign = "center"; x.fillStyle = "#ffe3a3"; font(x, 50, 700); x.fillText(big, 0, 6);
    x.fillStyle = "#d9d0f5"; fitFont(x, small, 270, 19, 13, 800, "Nunito"); x.fillText(small, 0, 40); x.restore();
  }
  function avatar(x, img, letter, cx, cy, r) {
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.closePath();
    const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, "#7a4fd0"); g.addColorStop(1, "#e0679c"); x.fillStyle = g; x.fill();
    if (img) { x.clip(); x.drawImage(img, cx - r, cy - r, r * 2, r * 2); }
    else { x.fillStyle = "#fff"; x.textAlign = "center"; font(x, r, 700); x.fillText((letter || "?").toUpperCase(), cx, cy + r * .36); }
    x.restore();
    x.beginPath(); x.arc(cx, cy, r + 3, 0, 6.283); x.strokeStyle = "rgba(255, 214, 140, .9)"; x.lineWidth = 4; x.stroke();
  }
  function contain(x, img, cx, cy, maxW, maxH) {
    const k = Math.min(maxW / img.width, maxH / img.height), w = img.width * k, h = img.height * k;
    x.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }

  async function make(o) {
    const how = await ready(); if (!how) throw new Error("no mp4");
    const T = o.T || ((t) => t), me = o.me || {}, hh = o.hatchery || {};
    try { await document.fonts.load('700 60px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) { /* fall back */ }
    const c = document.createElement("canvas"); c.width = W * Q; c.height = H * Q;
    const x = c.getContext("2d", { alpha: false }); x.setTransform(Q, 0, 0, Q, 0, 0);
    x.imageSmoothingQuality = "high";
    let sceneCv = null;
    if (o.scene) {
      sceneCv = document.createElement("canvas"); sceneCv.width = Math.round(W * 1.12 * Q); sceneCv.height = Math.round(H * 1.12 * Q);
      const sx = sceneCv.getContext("2d"), k = Math.max(sceneCv.width / o.scene.width, sceneCv.height / o.scene.height);
      sx.drawImage(o.scene, (sceneCv.width - o.scene.width * k) / 2, (sceneCv.height - o.scene.height * k) / 2, o.scene.width * k, o.scene.height * k);
    }
    const stars = Array.from({ length: 120 }, () => ({ x: Math.random() * W, y: Math.random() * H * .65, r: Math.random() * 1.4 + .4, p: Math.random() * 6.28, s: .6 + Math.random() * 1.6 }));

    // the story, scene by scene; scenes with nothing to show are left out
    const S = [];
    S.push({ d: 2000, draw(t, k) {
      kicker(x, T("Hatchery Wrapped"), 120, k * 3);
      line(x, T(o.soFar ? `My ${o.month} so far in the hatchery` : `My ${o.month} in the hatchery`), W / 2, 200, k * 3 - .3, { size: 58, width: 1080 });
      if (o.blinky) { const a = ease(k * 2.4 - .5); x.save(); x.globalAlpha *= a; contain(x, o.blinky, W / 2, 470 + (1 - a) * 40 + Math.sin(t / 500) * 5, 380, 400); x.restore(); }
    } });
    S.push({ d: 2400, draw(t, k) {
      kicker(x, T("Cheering on fellow Keepers"), 110, k * 4);
      const n = Math.round((me.opens || 0) * ease(k * 1.8));
      line(x, fmt(n), W / 2, 330, k * 4, { size: 170, glow: 30 });
      line(x, T("posts from fellow Keepers opened"), W / 2, 395, k * 4 - .4, { size: 34, weight: 700, color: "#e9e1ff" });
      chip(x, fmt(me.days), T("Days you showed up"), W / 2 - 330, 540, k * 3 - 1.1);
      chip(x, fmt(me.streak), T("Best streak in days"), W / 2, 540, k * 3 - 1.3);
      chip(x, fmt(me.keepers), T("Keepers you cheered on"), W / 2 + 330, 540, k * 3 - 1.5);
    } });
    const ds = (o.dragons || []).slice(0, 7);
    S.push({ d: ds.length ? 2600 : 2000, draw(t, k) {
      kicker(x, T("Your dragons"), 110, k * 4);
      const n = o.uniq || ds.length;
      line(x, T(ds.length ? (n === 1 ? "You hatched 1 dragon" : `You hatched ${n} dragons`) : "Your first egg is waiting"), W / 2, 200, k * 4 - .2, { size: 58 });
      if (!ds.length) { line(x, T("Finish the daily goal on Blinky's Friends to hatch an egg into a dragon."), W / 2, 260, k * 3 - .6, { size: 26, weight: 800, fam: "Nunito", color: "#d9d0f5" }); return; }
      const big = ds.length === 1 ? 330 : ds.length <= 3 ? 280 : ds.length <= 5 ? 210 : 170, gap = big * .92;
      const x0 = W / 2 - (ds.length - 1) * gap / 2;
      ds.forEach((d, i) => {
        const kk = k * 3.4 - .7 - i * .18; if (kk <= 0 || !d.img) return;
        const a = back(kk), cx = x0 + i * gap, cy = 455 + Math.sin(t / 600 + i) * 6;
        x.save(); x.globalAlpha *= Math.min(1, ease(kk) * 1.4); x.translate(cx, cy); x.scale(.4 + .6 * a, .4 + .6 * a);
        const glow = d.tier === "l" ? "255, 214, 110" : d.tier === "r" ? "190, 160, 255" : "255, 255, 255";
        const g = x.createRadialGradient(0, 0, 10, 0, 0, big * .62); g.addColorStop(0, `rgba(${glow}, .38)`); g.addColorStop(1, `rgba(${glow}, 0)`);
        x.fillStyle = g; x.fillRect(-big, -big, big * 2, big * 2);
        x.shadowColor = "rgba(0, 0, 0, .45)"; x.shadowBlur = 24; x.shadowOffsetY = 12; contain(x, d.img, 0, 0, big, big); x.restore();
      });
      const best = ds[0];
      if (best) line(x, `${best.tier === "l" ? T("Golden legend") : best.tier === "r" ? T("Rare holo") : T("Common")} · ${best.name}`, W / 2, 665, k * 3 - 1.4, { size: 26, weight: 800, fam: "Nunito", color: "#ffe3a3" });
    } });
    const people = (rows, title, sub) => ({ d: 2300, draw(t, k) {
      kicker(x, title, 110, k * 4);
      line(x, sub, W / 2, 200, k * 4 - .2, { size: 54 });
      rows.slice(0, 3).forEach((p, i) => {
        const kk = k * 3.2 - .6 - i * .25; if (kk <= 0) return;
        const a = ease(kk), Y = 300 + i * 120;
        x.save(); x.globalAlpha *= a; x.translate((1 - a) * -60, 0);
        rr(x, W / 2 - 360, Y - 48, 720, 96, 28); x.fillStyle = "rgba(255, 255, 255, .09)"; x.fill();
        x.fillStyle = "#ffcd6e"; x.textAlign = "center"; font(x, 36, 700); x.fillText(String(i + 1), W / 2 - 316, Y + 13);
        avatar(x, p.img, (p.name || p.user || "?")[0], W / 2 - 236, Y, 34);
        x.textAlign = "left"; x.fillStyle = "#fff7ec"; fitFont(x, p.name || p.user, 330, 30, 18, 700); x.fillText(p.name || p.user, W / 2 - 184, Y - 2);
        x.fillStyle = "#c9bff0"; fitFont(x, "@" + p.user, 330, 21, 14, 800, "Nunito"); x.fillText("@" + p.user, W / 2 - 184, Y + 28);
        if (p.n) { x.textAlign = "right"; x.fillStyle = "#ffe3a3"; font(x, 34, 700); x.fillText(fmt(p.n), W / 2 + 330, Y + 12); }
        x.restore();
      });
    } });
    if (o.top && o.top.length) S.push(people(o.top, T("Your Keepers"), T("The Keepers you cheered on most")));
    if (o.circle && o.circle.length) S.push(people(o.circle, T("Your Dragon Circle"), T("The Keepers closest to you")));
    S.push({ d: 2100, draw(t, k) {
      kicker(x, T("The whole hatchery"), 110, k * 4);
      line(x, T(`Together in ${o.month}`), W / 2, 200, k * 4 - .2, { size: 54 });
      const n = Math.round((hh.opens || 0) * ease(k * 1.9 - .2));
      line(x, fmt(n), W / 2, 390, k * 4 - .4, { size: 150, glow: 30 });
      line(x, T("opens on dragon posts shared on pdtools"), W / 2, 450, k * 4 - .8, { size: 30, color: "#e9e1ff" });
      chip(x, fmt(hh.posts), T("Dragon posts shared"), W / 2 - 330, 590, k * 3 - 1.2);
      chip(x, fmt(hh.new), T("Keepers who shared their first post"), W / 2, 590, k * 3 - 1.4);
      chip(x, fmt(hh.hatches), T("Eggs hatched"), W / 2 + 330, 590, k * 3 - 1.6);
    } });
    S.push({ d: 3000, last: true, draw(t, k) {
      if (o.card) { const a = ease(k * 2.5), s = .86 + .1 * a; x.save(); x.globalAlpha *= a; x.translate(W / 2, H / 2); x.scale(s, s);
        x.shadowColor = "rgba(0, 0, 0, .55)"; x.shadowBlur = 40; x.shadowOffsetY = 18; x.drawImage(o.card, -W / 2, -W * o.card.height / o.card.width / 2, W, W * o.card.height / o.card.width); x.restore(); }
    } });
    const FADE = 320, total = S.reduce((n, s) => n + s.d, 0);

    function frame(ms) {
      const t = Math.min(ms, total);
      // the background: the night scene drifting slowly, a calm wash, twinkling stars
      x.globalAlpha = 1; x.fillStyle = "#120c26"; x.fillRect(0, 0, W, H);
      if (sceneCv) { const z = 1.04 + .05 * (t / total), w = W * z, h = H * z; x.drawImage(sceneCv, (W - w) / 2 - 18 * (t / total), (H - h) / 2, w, h); }
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(14, 9, 36, .8)"); g.addColorStop(.5, "rgba(14, 9, 36, .7)"); g.addColorStop(1, "rgba(14, 9, 36, .86)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      const v = x.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, W * .7); v.addColorStop(0, "rgba(8, 5, 22, 0)"); v.addColorStop(1, "rgba(8, 5, 22, .55)");
      x.fillStyle = v; x.fillRect(0, 0, W, H);
      for (const s of stars) { x.globalAlpha = .2 + .5 * (.5 + .5 * Math.sin(s.p + t / 1000 * s.s)); x.fillStyle = "#fff"; x.beginPath(); x.arc(s.x, s.y, s.r, 0, 6.283); x.fill(); }
      x.globalAlpha = 1;
      let at = 0;
      for (const s of S) {
        const local = t - at;
        if (local >= -FADE && local < s.d + (s.last ? 1 : 0)) {
          const fin = Math.min(1, (local + FADE) / FADE), fout = s.last ? 1 : Math.min(1, (s.d - local) / FADE);
          x.save(); x.globalAlpha = Math.max(0, Math.min(fin, fout)); s.draw(local, Math.max(0, local) / s.d); x.restore();
        }
        at += s.d;
      }
      // a thin progress line like the story bars
      x.fillStyle = "rgba(255, 255, 255, .16)"; x.fillRect(60, 30, W - 120, 4);
      x.fillStyle = "#ffcd6e"; x.fillRect(60, 30, (W - 120) * (t / total), 4);
    }

    const frames = Math.ceil((total + 500) / 1000 * FPS);
    if (how.kind === "codec") {
      // frame by frame through the H.264 encoder: smooth whatever the device, and as sharp as the canvas
      const M = o.muxer; if (!M) throw new Error("no muxer");
      const target = new M.ArrayBufferTarget();
      const mux = new M.Muxer({ target, video: { codec: "avc", width: W * Q, height: H * Q, frameRate: FPS }, fastStart: "in-memory" });
      let failed = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => mux.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
      enc.configure(how.cfg);
      for (let i = 0; i < frames; i++) {
        if (failed) throw failed;
        frame(i * 1000 / FPS);
        const vf = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
        while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
        if (i % 6 === 0) { if (o.onProgress) o.onProgress(i / frames); await new Promise((r) => setTimeout(r, 0)); }
      }
      await enc.flush(); enc.close();
      if (failed) throw failed;
      mux.finalize();
      if (o.onProgress) o.onProgress(1);
      return new Blob([target.buffer], { type: "video/mp4" });
    }
    // fallback: record the canvas live (older Safari)
    frame(0);
    const stream = c.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: how.type, videoBitsPerSecond: 12_000_000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    const done = new Promise((res, rej) => { rec.onstop = () => res(); rec.onerror = (e) => rej(e.error || e); });
    rec.start(250);
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const ms = performance.now() - t0;
        frame(ms);
        if (o.onProgress) o.onProgress(Math.min(1, ms / total));
        if (ms >= total + 400) res(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop(); stream.getTracks().forEach((tr) => tr.stop());
    await done;
    const blob = new Blob(parts, { type: "video/mp4" });
    if (!blob.size) throw new Error("empty");
    return blob;
  }

  window.pdWrapVideo = { ready, make };
})();
