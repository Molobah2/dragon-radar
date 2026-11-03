/* The Keeper Art hall: a small museum corridor in three.js.
   A warm plaster wall with the week's art in real frames, each under its own spotlight, a smoked oak floor,
   Blinky the curator at the entrance, and dust drifting in the beams. The visitor walks along the wall
   (swipe, arrows, keys or the wheel) and taps a piece to look closer.
   Kept light for phones: no real-time shadows, the light pools are painted once into light maps,
   and one soft directional light gives the frames their shine. */
(function () {
  "use strict";
  var T = window.THREE, D = window.KA_HALL, host = document.getElementById("hall-gl");
  if (!T || !D || !host) return;
  var R;
  try { R = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); } catch (e) { return; }
  var hall = document.getElementById("hall"), ui = window.KA_UI || {};
  var lite = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 3;
  R.setPixelRatio(Math.min(devicePixelRatio || 1, lite ? 1.5 : 2));
  if ("outputColorSpace" in R) R.outputColorSpace = T.SRGBColorSpace;
  R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  var cv = R.domElement; cv.setAttribute("aria-hidden", "true"); host.appendChild(cv);

  var H = 4.4, EYE = 1.62, ART_Y = 1.78, SP = 3.3;
  var scene = new T.Scene(), BG = 0x120d0a;
  scene.background = new T.Color(BG); scene.fog = new T.Fog(BG, 9, 24);
  var cam = new T.PerspectiveCamera(50, 1, 0.1, 60);
  var loader = new T.TextureLoader(); loader.setCrossOrigin("anonymous");
  var maxAniso = R.capabilities.getMaxAnisotropy ? R.capabilities.getMaxAnisotropy() : 1;
  function srgb(t) { t.colorSpace = T.SRGBColorSpace; return t; }
  function canvas(w, h, draw) { var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; }
  function ctex(c) { var t = srgb(new T.CanvasTexture(c)); t.anisotropy = Math.min(8, maxAniso); return t; }
  var DISP = getComputedStyle(document.documentElement).getPropertyValue("--disp").trim() || "Fredoka, system-ui, sans-serif";
  var BODY = getComputedStyle(document.documentElement).getPropertyValue("--body").trim() || "Nunito, system-ui, sans-serif";

  // ---------- the walk: the stops along the wall ----------
  function seeded(str) { var h = 1779033703 ^ str.length; for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return function () { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
  var items = (D.items || []).slice(), rnd = seeded((ui.vid ? ui.vid() : "guest") + D.week);
  for (var i = items.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = items[i]; items[i] = items[j]; items[j] = t; }   // every visitor walks their own order
  var stops = [{ kind: "entrance", w: 3.0 }];
  if (D.last) stops.push({ kind: "winner", w: 3.6, item: D.last });
  items.forEach(function (it) { stops.push({ kind: "piece", w: SP, item: it }); });
  if (!items.length) stops.push({ kind: "empty", w: 5.4 });
  if (D.hall && D.hall.length) stops.push({ kind: "hall", w: 4.6 });
  stops.push({ kind: "end", w: SP });
  var x = 0; stops.forEach(function (s, k) { if (k) x += (stops[k - 1].w + s.w) / 2; s.x = x; });
  var X0 = -5, X1 = x + 6, LEN = X1 - X0, CX = (X0 + X1) / 2;

  // ---------- light maps: the pools of light from each spotlight, painted once ----------
  var LPU = Math.max(24, Math.min(64, Math.floor(4096 / LEN)));   // light map pixels per metre
  function pool(g, cx, cy, rx, ry, a, warm) {
    g.save(); g.translate(cx, cy); g.scale(1, ry / rx);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, "rgba(" + warm + "," + a + ")"); gr.addColorStop(0.45, "rgba(" + warm + "," + (a * 0.55) + ")"); gr.addColorStop(1, "rgba(" + warm + ",0)");
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, 6.2832); g.fill(); g.restore();
  }
  function lit(s) { return s.kind !== "entrance"; }
  var wallLM = canvas(Math.ceil(LEN * LPU), Math.ceil(H * LPU), function (g, w, h) {
    g.fillStyle = "rgb(52,44,37)"; g.fillRect(0, 0, w, h);                                          // the room's own soft light
    var top = g.createLinearGradient(0, 0, 0, h); top.addColorStop(0, "rgba(0,0,0,.45)"); top.addColorStop(0.35, "rgba(0,0,0,0)"); top.addColorStop(0.85, "rgba(0,0,0,0)"); top.addColorStop(1, "rgba(0,0,0,.35)");
    g.fillStyle = top; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    stops.forEach(function (s) {
      var px = (s.x - X0) * LPU, py = (H - ART_Y) * LPU;
      if (s.kind === "entrance") { pool(g, px - 0.2 * LPU, (H - 2.5) * LPU, 2.4 * LPU, 1.5 * LPU, 0.75, "255,214,160"); return; }
      var big = s.kind === "winner" ? 1.25 : s.kind === "hall" || s.kind === "empty" ? 1.7 : 1;
      // the beam fanning down from the fixture, then the bright pool on the art
      g.save(); var bm = g.createLinearGradient(0, 0, 0, py); bm.addColorStop(0, "rgba(255,226,180,.32)"); bm.addColorStop(1, "rgba(255,226,180,0)");
      g.fillStyle = bm; g.beginPath(); g.moveTo(px - 0.18 * LPU, 0); g.lineTo(px + 0.18 * LPU, 0); g.lineTo(px + 1.3 * big * LPU, py); g.lineTo(px - 1.3 * big * LPU, py); g.closePath(); g.fill(); g.restore();
      pool(g, px, py, 1.55 * big * LPU, 1.35 * LPU, 1, "255,228,186");
      pool(g, px, py, 0.9 * big * LPU, 0.85 * LPU, 0.7, "255,240,215");
    });
  });
  var floorD = 11, floorLM = canvas(Math.ceil(LEN * LPU / 2), Math.ceil(floorD * LPU / 2), function (g, w, h) {
    var k = LPU / 2; g.fillStyle = "rgb(40,33,28)"; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    stops.forEach(function (s) { if (!lit(s) && s.kind !== "entrance") return; var px = (s.x - X0) * k;
      pool(g, px, 0.55 * k, 1.5 * k * (s.kind === "hall" || s.kind === "empty" ? 1.6 : 1), 0.9 * k, s.kind === "entrance" ? 0.55 : 0.8, "255,214,160"); });
    g.globalCompositeOperation = "source-over";
    var fall = g.createLinearGradient(0, 0, 0, h); fall.addColorStop(0, "rgba(0,0,0,0)"); fall.addColorStop(0.5, "rgba(0,0,0,.25)"); fall.addColorStop(1, "rgba(0,0,0,.6)");
    g.fillStyle = fall; g.fillRect(0, 0, w, h);
  });

  // ---------- the room ----------
  function surf(src, rx, ry, fallback) {
    var t = src ? loader.load(src, function () { R.__dirty = true; }) : null;
    if (t) { srgb(t); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = Math.min(8, maxAniso); }
    return t;
  }
  var tex = D.tex || {};
  var wallLMt = ctex(wallLM); wallLMt.channel = 0;
  var wall = new T.Mesh(new T.PlaneGeometry(LEN, H), new T.MeshBasicMaterial({ color: 0xf3ead8, map: surf(tex.wall, LEN / 2.4, H / 2.4), lightMap: wallLMt, lightMapIntensity: Math.PI * 1.2 }));
  wall.position.set(CX, H / 2, 0); scene.add(wall);
  var floorLMt = ctex(floorLM); floorLMt.channel = 0;
  var floor = new T.Mesh(new T.PlaneGeometry(LEN, floorD), new T.MeshBasicMaterial({ color: 0xd9c6b0, map: surf(tex.floor, LEN / 2.2, floorD / 2.2), lightMap: floorLMt, lightMapIntensity: Math.PI * 1.3 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(CX, 0, floorD / 2); scene.add(floor);
  var ceil = new T.Mesh(new T.PlaneGeometry(LEN, floorD), new T.MeshBasicMaterial({ color: 0x120d0a }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(CX, H, floorD / 2); scene.add(ceil);
  var wood = new T.MeshPhongMaterial({ color: 0x2a1a10, shininess: 30, specular: 0x332218 });
  var skirt = new T.Mesh(new T.BoxGeometry(LEN, 0.16, 0.04), wood); skirt.position.set(CX, 0.08, 0.02); scene.add(skirt);
  var rail = new T.Mesh(new T.BoxGeometry(LEN, 0.035, 0.05), new T.MeshPhongMaterial({ color: 0x18120f })); rail.position.set(CX, H - 0.06, 1.25); scene.add(rail);
  scene.add(new T.AmbientLight(0xfff1e0, 0.28));
  var key = new T.DirectionalLight(0xffe2bf, 1.2); key.position.set(0.3, 4, 3.2); scene.add(key); scene.add(key.target);

  // a spotlight fixture on the rail above every lit stop
  var fixG = new T.CylinderGeometry(0.055, 0.075, 0.2, 14), fixM = new T.MeshPhongMaterial({ color: 0x141010, shininess: 70, specular: 0x555555 });
  var lensG = new T.CircleGeometry(0.05, 14), lensM = new T.MeshBasicMaterial({ color: 0xfff1d6 });
  function fixture(px) {
    var f = new T.Group(), body = new T.Mesh(fixG, fixM), lens = new T.Mesh(lensG, lensM);
    lens.position.y = -0.101; lens.rotation.x = Math.PI / 2; body.add(lens);
    var stem = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.12, 6), fixM); stem.position.y = 0.12;
    f.add(stem); f.add(body); body.rotation.x = 0.62;
    f.position.set(px, H - 0.2, 1.25); scene.add(f);
  }
  // soft beams of light in the air (seen best from the side as the camera walks)
  var beamTex = ctex(canvas(64, 256, function (g, w, h) { var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(255,232,190,.9)"); gr.addColorStop(1, "rgba(255,232,190,0)");
    g.fillStyle = gr; g.beginPath(); g.moveTo(w * 0.42, 0); g.lineTo(w * 0.58, 0); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill(); }));
  var beamM = new T.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.07, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
  function beam(px, wide) {
    var b = new T.Mesh(new T.PlaneGeometry(1.5 * wide, 2.8), beamM); b.position.set(px, H - 1.55, 0.72); b.rotation.x = -0.42; scene.add(b);
  }

  // ---------- frames ----------
  var gold = new T.MeshPhongMaterial({ color: 0xc89a46, specular: 0xffe2a0, shininess: 80, emissive: 0x2a1a06 });
  var walnut = new T.MeshPhongMaterial({ color: 0x3b2618, specular: 0x6b4a30, shininess: 45, emissive: 0x0d0704 });
  var matM = new T.MeshLambertMaterial({ color: 0xf6f0e4, emissive: 0x6a645a });
  var sheenTex = ctex(canvas(256, 256, function (g, w, h) { var gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.42, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, "rgba(255,255,255,.55)"); gr.addColorStop(0.56, "rgba(255,255,255,0)"); gr.addColorStop(0.7, "rgba(255,255,255,.18)"); gr.addColorStop(0.74, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  var shadowTex = ctex(canvas(128, 128, function (g, w, h) { var gr = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(20,12,6,.6)"); gr.addColorStop(1, "rgba(20,12,6,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  var shadowM = new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  var arts = [];   // meshes the visitor can tap
  function frame(px, py, maxW, maxH, opt) {
    var g = new T.Group(); g.position.set(px, py, 0); scene.add(g);
    var mould = opt.gold ? gold : walnut, bw = opt.small ? 0.06 : 0.09, d = 0.06;
    var parts = [0, 1, 2, 3].map(function () { var m = new T.Mesh(new T.BoxGeometry(1, 1, d), mould); g.add(m); return m; });
    var mat = new T.Mesh(new T.PlaneGeometry(1, 1), matM); mat.position.z = 0.012; g.add(mat);
    var shadow = new T.Mesh(new T.PlaneGeometry(1, 1), shadowM); shadow.position.set(0.03, -0.06, 0.002); g.add(shadow);
    var art = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: opt.blank ? 0xffffff : 0x9a9088, map: opt.blank || null }));
    art.position.z = 0.016; g.add(art);
    var glass = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: sheenTex, transparent: true, opacity: opt.small ? 0.05 : 0.09, blending: T.AdditiveBlending, depthWrite: false }));
    glass.position.z = 0.04; g.add(glass);
    function size(ar) {
      var w = maxW, h = w / ar; if (h > maxH) { h = maxH; w = h * ar; }
      var m = opt.small ? 0.07 : 0.15, W = w + m * 2, Hh = h + m * 2;
      art.scale.set(w, h, 1); glass.scale.set(w, h, 1); mat.scale.set(W, Hh, 1);
      parts[0].scale.set(W + bw * 2, bw, d); parts[0].position.set(0, Hh / 2 + bw / 2, d / 2);
      parts[1].scale.set(W + bw * 2, bw, d); parts[1].position.set(0, -Hh / 2 - bw / 2, d / 2);
      parts[2].scale.set(bw, Hh, d); parts[2].position.set(-W / 2 - bw / 2, 0, d / 2);
      parts[3].scale.set(bw, Hh, d); parts[3].position.set(W / 2 + bw / 2, 0, d / 2);
      shadow.scale.set(W + bw * 2 + 0.35, Hh + bw * 2 + 0.35, 1);
      g.userData.h = Hh + bw * 2; g.userData.w = W + bw * 2;
    }
    size(opt.ar || 0.8);
    if (opt.src) loader.load(opt.src, function (t) {
      srgb(t); t.anisotropy = Math.min(8, maxAniso); art.material.map = t; art.material.color.set(0xf7f2ea); art.material.needsUpdate = true;
      size(t.image.width / t.image.height); if (g.userData.onSize) g.userData.onSize();
    });
    if (opt.item || opt.send) { art.userData.item = opt.item; art.userData.stop = opt.stop; art.userData.send = !!opt.send; arts.push(art); }
    g.userData.art = art; g.userData.size = size;
    return g;
  }
  // a small museum label beside the art
  function label(g, lines, w) {
    var c = canvas(512, 256, function (x, W, Hh) {
      x.fillStyle = "#f6f1e7"; x.fillRect(0, 0, W, Hh); x.strokeStyle = "rgba(90,70,50,.25)"; x.lineWidth = 4; x.strokeRect(2, 2, W - 4, Hh - 4);
      x.fillStyle = "#2a1d14"; x.font = "700 44px " + DISP; x.textBaseline = "top";
      fit(x, lines[0] || "", 40, 30, W - 80);
      x.fillStyle = "#8a5a1c"; x.font = "800 30px " + BODY; x.fillText(lines[1] || "", 40, 92);
      x.fillStyle = "#5d4b3c"; x.font = "600 28px " + BODY; fit(x, lines[2] || "", 40, 142, W - 80);
      if (lines[3]) { x.fillStyle = "#9a8a78"; x.font = "800 22px " + BODY; x.fillText(lines[3].toUpperCase(), 40, 196); }
    });
    var m = new T.Mesh(new T.PlaneGeometry(w, w / 2), new T.MeshBasicMaterial({ map: ctex(c), color: 0xe9e2d6 }));
    m.position.z = 0.012; g.add(m); return m;
  }
  function fit(x, s, px, py, max) { var t = s; while (t.length > 3 && x.measureText(t).width > max) t = t.slice(0, -2); if (t !== s) t = t.replace(/\s+\S*$/, "") + "…"; x.fillText(t, px, py); }
  function placeLabel(lab, g) { lab.position.set(g.position.x + g.userData.w / 2 - lab.geometry.parameters.width / 2, ART_Y - g.userData.h / 2 - 0.26, 0.012); }

  // ---------- the entrance: the hall's name painted on the wall, and Blinky the curator ----------
  var curator = null, curatorTop = new T.Vector3();
  function entrance(s) {
    var c = canvas(1536, 768, function (x, W, Hh) {
      x.textAlign = "center"; x.textBaseline = "alphabetic";
      x.fillStyle = "rgba(122,84,30,.9)"; x.font = "800 34px " + BODY; x.letterSpacing = "10px";
      x.fillText("POCKET DRAGONS · " + (D.label || "").toUpperCase(), W / 2, 190);
      x.letterSpacing = "0px"; x.fillStyle = "#2d1f15"; x.font = "700 196px " + DISP; x.fillText("Keeper Art", W / 2, 390);
      x.fillStyle = "#6a5444"; x.font = "600 52px " + DISP; x.fillText("Made by hand, by Keepers", W / 2, 478);
      if (D.prompt) { x.fillStyle = "#8a5a1c"; x.font = "800 30px " + BODY; x.letterSpacing = "6px"; x.fillText("THIS WEEK'S THEME", W / 2, 580); x.letterSpacing = "0px";
        x.fillStyle = "#3a2a1d"; x.font = "700 50px " + DISP; fit2(x, "“" + D.prompt + "”", W / 2, 642, W - 160); }
      x.fillStyle = "rgba(138,90,28,.55)"; x.fillRect(W / 2 - 90, 520, 180, 4);
    });
    var title = new T.Mesh(new T.PlaneGeometry(3.0, 1.5), new T.MeshLambertMaterial({ map: ctex(c), transparent: true, lightMap: null, emissive: 0x111111 }));
    title.position.set(s.x + 0.15, 2.55, 0.01); scene.add(title);
    if (tex.curator) loader.load(tex.curator, function (t) {
      srgb(t); var ar = t.image.width / t.image.height, h = 0.82, base = 0.36;
      curator = new T.Mesh(new T.PlaneGeometry(h * ar, h), new T.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.02, color: 0xf2e8da }));
      var side = host.clientWidth > host.clientHeight ? -1.45 : -0.45;              // beside the title on wide screens, under it on phones
      curator.position.set(s.x + side, base + h / 2 - 0.01, 1.5); scene.add(curator);
      var plinth = new T.Mesh(new T.BoxGeometry(0.78, base, 0.5), wood); plinth.position.set(curator.position.x + 0.03, base / 2, 1.42); scene.add(plinth);
      var sh = new T.Mesh(new T.PlaneGeometry(h * ar * 0.9, 0.34), shadowM); sh.rotation.x = -Math.PI / 2; sh.position.set(curator.position.x + 0.03, 0.004, 1.42); sh.scale.set(1.4, 1.6, 1); scene.add(sh);
      curator.userData.h = h; curator.userData.base = base;
    });
  }
  function fit2(x, s, cx, cy, max) { var t = s; while (t.length > 4 && x.measureText(t).width > max) t = t.slice(0, -3) + "…”"; x.fillText(t, cx, cy); }

  // a mat with "Your art here", for empty frames
  function blankTex(line1, line2) {
    return ctex(canvas(512, 640, function (x, W, Hh) {
      x.fillStyle = "#efe7d8"; x.fillRect(0, 0, W, Hh);
      x.strokeStyle = "rgba(138,90,28,.5)"; x.setLineDash([18, 14]); x.lineWidth = 5; x.strokeRect(40, 40, W - 80, Hh - 80);
      x.textAlign = "center"; x.fillStyle = "#8a5a1c"; x.font = "700 120px " + DISP; x.fillText("+", W / 2, Hh / 2 - 20);
      x.fillStyle = "#3a2a1d"; x.font = "700 46px " + DISP; x.fillText(line1, W / 2, Hh / 2 + 70);
      x.fillStyle = "#7a6656"; x.font = "700 28px " + BODY; x.fillText(line2, W / 2, Hh / 2 + 118);
    }));
  }

  function build() {
    stops.forEach(function (s, k) {
      if (s.kind === "entrance") { entrance(s); return; }
      fixture(s.x); beam(s.x, s.kind === "hall" || s.kind === "empty" ? 1.6 : 1);
      if (s.kind === "piece" || s.kind === "winner") {
        var it = s.item, win = s.kind === "winner";
        var g = frame(s.x, ART_Y, win ? 1.75 : 1.5, win ? 1.85 : 1.6, { item: it, stop: k, gold: win, src: "/art/" + it.id + ".webp", ar: 1 });
        var lab = label(scene, [it.title, "@" + it.user, it.medium || (it.line ? "“" + it.line + "”" : ""), win ? "Keeper Art of last week" : "Tap to look closer"], 0.56);
        placeLabel(lab, g);
        g.userData.onSize = (function (l, gg) { return function () { placeLabel(l, gg); }; })(lab, g);
        s.group = g;
      } else if (s.kind === "hall") {
        var list = D.hall.slice(0, 6), cols = list.length > 3 ? 3 : list.length, rows = Math.ceil(list.length / cols);
        list.forEach(function (h, n) {
          var cx = s.x + ((n % cols) - (cols - 1) / 2) * 1.15, cy = rows > 1 ? (n < cols ? 2.35 : 1.15) : ART_Y;
          frame(cx, cy, 0.78, 0.82, { item: h, stop: k, gold: true, small: true, src: "/art/" + h.id + ".webp", ar: 1 });
        });
        var sign = label(scene, ["Wall of winners", "Keeper Art of the week", "Chosen by Keepers' votes", ""], 0.6);
        sign.position.set(s.x, rows > 1 ? 0.42 : 0.62, 0.012);
      } else if (s.kind === "empty") {
        [-1.55, 0, 1.55].forEach(function (dx, n) {
          frame(s.x + dx, ART_Y, 1.05, 1.32, { blank: blankTex("Your art here", "Send it in this week"), ar: 0.8, stop: k, send: true });
        });
      } else if (s.kind === "end") {
        frame(s.x, ART_Y, 1.2, 1.5, { blank: blankTex("Your art here", "Tap to send yours in"), ar: 0.8, stop: k, send: true });
      }
    });
  }

  // ---------- dust in the light ----------
  var dust;
  (function () {
    var n = lite ? 140 : 260, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (var i = 0; i < n; i++) { pos[i * 3] = X0 + Math.random() * LEN; pos[i * 3 + 1] = 0.3 + Math.random() * 3.6; pos[i * 3 + 2] = 0.15 + Math.random() * 2.6; seed[i] = Math.random() * 6.28; }
    var geo = new T.BufferGeometry(); geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    var dot = ctex(canvas(64, 64, function (g, w, h) { var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,240,210,1)"); gr.addColorStop(0.3, "rgba(255,226,170,.6)"); gr.addColorStop(1, "rgba(255,220,160,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
    dust = new T.Points(geo, new T.PointsMaterial({ map: dot, size: 0.035, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    dust.userData.seed = seed; scene.add(dust);
  })();

  // ---------- walking ----------
  var at = 0, camX = stops[0].x, goal = stops[0].x, dist = 5, sway = 0;
  if (D.focus) stops.forEach(function (s, k) { if (s.item && s.item.id === D.focus) at = k; });
  camX = goal = stops[at].x;
  function go(k, quiet) {
    k = Math.max(0, Math.min(stops.length - 1, k)); if (k === at && !quiet) return;
    at = k; goal = stops[k].x; if (ui.stop) ui.stop(stops[k], k, stops.length);
    if (stops[k].item && stops[k].group && !stops[k].full) {          // the piece in front gets its full size picture
      stops[k].full = true; var a = stops[k].group.userData.art;
      loader.load("/art/" + stops[k].item.id + ".webp?s=f", function (t) { srgb(t); t.anisotropy = Math.min(8, maxAniso); var old = a.material.map; a.material.map = t; a.material.needsUpdate = true; if (old) old.dispose(); });
    }
  }
  window.KA_GO = function (d) { go(at + d); };
  window.KA_AT = function () { return stops[at]; };
  function fitCam() {
    var w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    R.setSize(w, h, false); cam.aspect = w / h;
    cam.fov = w < h ? 52 : 48; cam.updateProjectionMatrix();
    var tv = Math.tan(T.MathUtils.degToRad(cam.fov / 2));
    dist = Math.min(7.2, Math.max(4.6, 1.3 / (tv * cam.aspect), 1.4 / tv));
  }
  addEventListener("resize", function () { clearTimeout(fitCam.t); fitCam.t = setTimeout(fitCam, 120); });

  // swipe, drag, tap
  var ray = new T.Raycaster(), ptr = new T.Vector2(), down = null, mx = 0, my = 0, tmx = 0, tmy = 0;
  cv.style.touchAction = "pan-y";
  cv.addEventListener("pointerdown", function (e) { down = { x: e.clientX, y: e.clientY, t: performance.now(), cx: camX }; });
  cv.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "touch") { var r = cv.getBoundingClientRect(); tmx = (e.clientX - r.left) / r.width - 0.5; tmy = (e.clientY - r.top) / r.height - 0.5; }
    if (down && Math.abs(e.clientX - down.x) > 8) { goal = down.cx - (e.clientX - down.x) / (cv.clientWidth || 1) * 3.2; }
  });
  addEventListener("pointercancel", function () { if (down) { down = null; goal = stops[at].x; } });
  addEventListener("pointerup", function (e) {
    if (!down) return; var dx = e.clientX - down.x, dy = e.clientY - down.y, d0 = down; down = null;
    if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) {             // a swipe: one step, or two for a long fast one
      var n = Math.abs(dx) > (cv.clientWidth || 400) * 0.55 ? 2 : 1; go(at + (dx < 0 ? n : -n), true); return;
    }
    goal = stops[at].x;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && e.target === cv) tap(e);
    void d0;
  });
  function tap(e) {
    var r = cv.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, cam); var hit = ray.intersectObjects(arts, false)[0];
    if (!hit) return; var u = hit.object.userData;
    if (u.send) { if (ui.send) ui.send(); return; }
    if (u.stop !== at) { go(u.stop); if (stops[u.stop].kind !== "hall") return; }
    if (u.item && ui.open) ui.open(u.item);
  }
  var wheelT = 0;
  cv.addEventListener("wheel", function (e) { var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0; if (!d && !e.shiftKey) return; d = d || e.deltaY;
    e.preventDefault(); var now = performance.now(); if (now - wheelT < 450 || Math.abs(d) < 12) return; wheelT = now; go(at + (d > 0 ? 1 : -1)); }, { passive: false });
  hall.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1); }
    else if ((e.key === "Enter" || e.key === " ") && e.target === hall) { e.preventDefault(); var s = stops[at]; if (s.item && ui.open) ui.open(s.item); else if (s.kind === "end" || s.kind === "empty") { if (ui.send) ui.send(); } }
  });

  // ---------- each frame ----------
  var t0 = performance.now(), last = t0, live = true, seen = true, shown = false, v3 = new T.Vector3();
  if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { seen = en[0].isIntersecting; }).observe(hall);
  function frameLoop(now) {
    if (!live) return; requestAnimationFrame(frameLoop);
    if (document.hidden || !seen) { last = now; return; }
    var dt = Math.min(0.05, (now - last) / 1000); last = now; var t = (now - t0) / 1000;
    var k = 1 - Math.pow(0.0025, dt);                                    // smooth, frame rate independent easing
    var before = camX; camX += (goal - camX) * k; var speed = Math.abs(camX - before) / Math.max(dt, 0.001);
    sway += (Math.min(1, speed / 3) - sway) * 0.08;
    mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
    cam.position.set(camX + mx * 0.5 + Math.sin(t * 0.21) * 0.06, EYE + Math.sin(t * 0.33) * 0.025 + Math.abs(Math.sin(t * 7)) * 0.02 * sway - my * 0.15, dist + Math.sin(t * 0.17) * 0.08);
    cam.lookAt(camX + mx * 0.15, EYE + 0.06, 0);
    var p = dust.geometry.attributes.position, sd = dust.userData.seed;
    for (var i = 0; i < sd.length; i++) { var y = p.array[i * 3 + 1] + dt * (0.03 + 0.03 * Math.sin(sd[i])); if (y > 4) y = 0.3; p.array[i * 3 + 1] = y; p.array[i * 3] += Math.sin(t * 0.4 + sd[i]) * dt * 0.03; }
    p.needsUpdate = true;
    if (curator) { curator.scale.y = 1 + Math.sin(t * 1.6) * 0.008; curator.position.y = curator.userData.base + curator.userData.h / 2 * curator.scale.y - 0.01;
      if (ui.bubble) { v3.set(curator.position.x + 0.15, curator.userData.base + curator.userData.h + 0.06, curator.position.z).project(cam);
        var near = Math.abs(camX - stops[0].x) < 1.2; ui.bubble(near, (v3.x * 0.5 + 0.5) * 100, (-v3.y * 0.5 + 0.5) * 100); } }
    R.render(scene, cam);
    if (!shown) { shown = true; hall.classList.add("live"); if (ui.ready) ui.ready(); }
  }
  function start() { build(); fitCam(); go(at, true); requestAnimationFrame(frameLoop);
    if (D.focus && stops[at].item && ui.open) setTimeout(function () { ui.open(stops[at].item); }, 900); }
  // the wall's lettering waits for the site's fonts, so it is never drawn in a fallback font
  var fontsReady = document.fonts && document.fonts.load ? Promise.all([document.fonts.load("700 60px " + DISP), document.fonts.load("800 30px " + BODY)]).catch(function () {}) : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 1500); })]).then(start);
  cv.addEventListener("webglcontextlost", function (e) { e.preventDefault(); live = false; hall.classList.remove("live"); hall.classList.add("flat"); });
})();
