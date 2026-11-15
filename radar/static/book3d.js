/* Blinky's Book of Friends in 3D. A real leather book, built in three.js, lies on a dark desk. Its cover swings
   open, a few pages riffle over, and the Keeper's X name writes itself across the page in gold ink.
   Drag to tilt it. Everything is drawn here in the browser; nothing is sent anywhere.
   PDBook3D.mount(el, { handle }) returns { replay(), blob(), destroy() }. */
(() => {
  "use strict";
  const T3 = () => window.THREE;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (x) => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const lerp = (a, b, k) => a + (b - a) * k;
  // a seeded random, so the leather grain and paper fibres look the same every time
  function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // book size in scene units: each half of the spread is W wide and H tall, the pages T thick, covers C thick
  const W = 1.42, H = 1.96, T = 0.16, C = 0.045, O = 0.045;
  // the story, in seconds
  const OPEN0 = 0.5, OPEN1 = 2.3, RIFF0 = 1.75, RIFF_N = 5, RIFF_GAP = 0.17, RIFF_LEN = 0.75, INK0 = 3.25, INK1 = 5.6;
  const GOLD = "#e2b25a", INK = "#5e3405";

  let fontsReady = null;
  function fonts() {
    if (fontsReady) return fontsReady;
    const add = (fam, url, w, style) => { try { const f = new FontFace(fam, `url(${url}) format('woff2')`, { weight: w, style: style || "normal" }); document.fonts.add(f); return f.load(); } catch (e) { return Promise.resolve(); } };
    fontsReady = Promise.all([
      add("PD Script", "/static/fonts/dancing-script-latin-700-normal.woff2", "700"),
      add("PD Cinzel", "/static/fonts/cinzel-latin-700-normal.woff2", "700"),
      add("PD Lora", "/static/fonts/lora-latin-400-italic.woff2", "400", "italic"),
    ]).catch(() => {});
    return fontsReady;
  }

  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  // ---------- leather: colour, roughness and metal for the gold tooling, and a bump for the stamping ----------
  function leather(size, face) {
    const r = rnd(face ? 7 : 11);
    const col = canvas(size, size * 1.38), orm = canvas(col.width, col.height), bump = canvas(col.width, col.height);
    const cw = col.width, ch = col.height;
    const g = col.getContext("2d"), o = orm.getContext("2d"), b = bump.getContext("2d");
    // base: deep oxblood, darker at the edges like handled leather
    const base = g.createRadialGradient(cw * 0.5, ch * 0.45, cw * 0.1, cw * 0.5, ch * 0.5, cw * 0.85);
    base.addColorStop(0, "#6a2a1e"); base.addColorStop(0.7, "#4f1d15"); base.addColorStop(1, "#33120d");
    g.fillStyle = base; g.fillRect(0, 0, cw, ch);
    o.fillStyle = "rgb(0,214,0)"; o.fillRect(0, 0, cw, ch);
    b.fillStyle = "#808080"; b.fillRect(0, 0, cw, ch);
    // grain: many small soft pores
    for (let i = 0; i < cw * ch / 90; i++) {
      const x = r() * cw, y = r() * ch, s = 0.6 + r() * 2.2, d = r();
      g.fillStyle = d > 0.5 ? `rgba(20,6,4,${0.10 + r() * 0.12})` : `rgba(140,70,50,${0.05 + r() * 0.06})`;
      g.beginPath(); g.arc(x, y, s, 0, 6.283); g.fill();
      b.fillStyle = d > 0.5 ? "rgba(60,60,60,.5)" : "rgba(170,170,170,.35)";
      b.beginPath(); b.arc(x, y, s, 0, 6.283); b.fill();
    }
    // a few soft creases
    g.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      const x = r() * cw, y = r() * ch, a = r() * 6.283, l = 20 + r() * 90;
      g.strokeStyle = `rgba(25,8,5,${0.12 + r() * 0.1})`; g.lineWidth = 0.8 + r() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    if (!face) return { col, orm, bump };

    // gold tooling: a double frame, corner leaves, a medallion and the title
    const gold = (fn, lw) => {
      [[g, GOLD], [o, "rgb(0,95,255)"], [b, "#3a3a3a"]].forEach(([k, s]) => { k.save(); k.strokeStyle = s; k.fillStyle = s; k.lineWidth = lw || 3; fn(k); k.restore(); });
    };
    const m = cw * 0.07, m2 = cw * 0.1;
    gold((k) => { k.strokeRect(m, m, cw - 2 * m, ch - 2 * m); }, cw * 0.006);
    gold((k) => { k.strokeRect(m2, m2, cw - 2 * m2, ch - 2 * m2); }, cw * 0.0025);
    // corner leaves
    const leaf = (k, x, y, sx, sy) => {
      k.save(); k.translate(x, y); k.scale(sx, sy);
      const s = cw * 0.11;
      k.beginPath(); k.moveTo(0, 0); k.bezierCurveTo(s * 0.55, s * 0.05, s * 0.8, s * 0.35, s, s * 0.08); k.bezierCurveTo(s * 0.75, s * 0.55, s * 0.3, s * 0.45, 0, 0); k.fill();
      k.beginPath(); k.moveTo(0, 0); k.bezierCurveTo(s * 0.05, s * 0.55, s * 0.35, s * 0.8, s * 0.08, s); k.bezierCurveTo(s * 0.55, s * 0.75, s * 0.45, s * 0.3, 0, 0); k.fill();
      k.beginPath(); k.arc(s * 0.12, s * 0.12, s * 0.07, 0, 6.283); k.fill();
      k.restore();
    };
    gold((k) => { leaf(k, m2, m2, 1, 1); leaf(k, cw - m2, m2, -1, 1); leaf(k, m2, ch - m2, 1, -1); leaf(k, cw - m2, ch - m2, -1, -1); });
    // medallion: a ring with a dragon egg inside
    const mx = cw / 2, my = ch * 0.56, mr = cw * 0.19;
    gold((k) => { k.beginPath(); k.arc(mx, my, mr, 0, 6.283); k.stroke(); }, cw * 0.007);
    gold((k) => { k.beginPath(); k.arc(mx, my, mr * 0.88, 0, 6.283); k.stroke(); }, cw * 0.0025);
    gold((k) => {
      for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; k.beginPath(); k.arc(mx + Math.cos(a) * mr * 1.1, my + Math.sin(a) * mr * 1.1, cw * 0.005, 0, 6.283); k.fill(); }
    });
    gold((k) => {
      const ex = mx, ey = my + mr * 0.04, ew = mr * 0.46, eh = mr * 0.6;
      k.beginPath(); k.moveTo(ex, ey - eh);
      k.bezierCurveTo(ex + ew, ey - eh, ex + ew * 1.05, ey + eh * 0.55, ex, ey + eh * 0.62);
      k.bezierCurveTo(ex - ew * 1.05, ey + eh * 0.55, ex - ew, ey - eh, ex, ey - eh); k.stroke();
      // rows of little scales across the egg, clipped to its shape
      k.save(); k.clip();
      k.lineWidth = cw * 0.0035;
      for (let row = 0; row < 6; row++) {
        const yy = ey - eh * 0.55 + row * eh * 0.24, n = 5, sw = ew * 2 / n, off = row % 2 ? sw / 2 : 0;
        for (let i = -1; i <= n; i++) { k.beginPath(); k.arc(ex - ew + off + i * sw + sw / 2, yy, sw / 2, 0.1, Math.PI - 0.1); k.stroke(); }
      }
      k.restore();
    }, cw * 0.006);
    // title
    gold((k) => {
      k.textAlign = "center"; k.textBaseline = "middle";
      k.font = `700 ${Math.round(cw * 0.05)}px "PD Cinzel", Georgia, serif`;
      k.fillText("BLINKY'S", cw / 2, ch * 0.2);
      k.font = `700 ${Math.round(cw * 0.098)}px "PD Cinzel", Georgia, serif`;
      k.fillText("BOOK OF", cw / 2, ch * 0.275);
      k.fillText("FRIENDS", cw / 2, ch * 0.355);
      k.fillRect(cw * 0.36, ch * 0.405, cw * 0.28, cw * 0.004);
      k.beginPath(); k.arc(cw / 2, ch * 0.407, cw * 0.009, 0, 6.283); k.fill();
      k.font = `700 ${Math.round(cw * 0.032)}px "PD Cinzel", Georgia, serif`;
      k.fillText("PDTOOLS.XYZ", cw / 2, ch * 0.86);
    });
    // wear on the gold: tiny breaks so it reads as stamped foil, not a sticker
    for (let i = 0; i < cw * ch / 400; i++) { const x = r() * cw, y = r() * ch; g.fillStyle = "rgba(70,28,18,.55)"; g.fillRect(x, y, 1.5, 1.5); }
    return { col, orm, bump };
  }

  // ---------- paper ----------
  function paper(w, h, seed, gutterLeft) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rnd(seed);
    g.fillStyle = "#e6d3ad"; g.fillRect(0, 0, w, h);
    // fibres and tiny flecks
    for (let i = 0; i < w * h / 160; i++) { g.fillStyle = `rgba(${150 + r() * 60},${110 + r() * 50},${60 + r() * 40},${0.03 + r() * 0.05})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    // the page darkens toward its edges and into the gutter
    const v = g.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.85);
    v.addColorStop(0, "rgba(120,80,30,0)"); v.addColorStop(1, "rgba(120,80,30,.28)");
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    const gx = gutterLeft ? 0 : w, gu = g.createLinearGradient(gx, 0, gutterLeft ? w * 0.16 : w * 0.84, 0);
    gu.addColorStop(0, "rgba(70,40,10,.38)"); gu.addColorStop(1, "rgba(70,40,10,0)");
    g.fillStyle = gu; g.fillRect(0, 0, w, h);
    return c;
  }
  function ornament(g, x, y, s, col) {
    g.save(); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = s * 0.03; g.lineCap = "round";
    g.beginPath(); g.moveTo(x - s, y); g.lineTo(x - s * 0.18, y); g.moveTo(x + s * 0.18, y); g.lineTo(x + s, y); g.stroke();
    g.beginPath(); g.moveTo(x, y - s * 0.12); g.lineTo(x + s * 0.12, y); g.lineTo(x, y + s * 0.12); g.lineTo(x - s * 0.12, y); g.closePath(); g.fill();
    [-1, 1].forEach((d) => { g.beginPath(); g.arc(x + d * s * 1.06, y, s * 0.04, 0, 6.283); g.fill(); });
    g.restore();
  }

  function leftPage(w, h) {
    const c = paper(w, h, 3, false), g = c.getContext("2d");
    g.fillStyle = "#5a3a1a"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.font = `700 ${Math.round(w * 0.085)}px "PD Cinzel", Georgia, serif`;
    g.fillText("Book of Friends", w / 2, h * 0.3);
    ornament(g, w / 2, h * 0.355, w * 0.22, "rgba(120,80,30,.8)");
    g.font = `italic 400 ${Math.round(w * 0.052)}px "PD Lora", Georgia, serif`; g.fillStyle = "rgba(70,45,20,.85)";
    ["Every name in this book", "belongs to a Keeper who", "cheered on a fellow Keeper", "in the Pocket Dragons world."].forEach((t, i) => g.fillText(t, w / 2, h * 0.47 + i * w * 0.08));
    ornament(g, w / 2, h * 0.78, w * 0.12, "rgba(120,80,30,.55)");
    return c;
  }

  // the right page: drawn again while the name is being written; returns the colour canvas and an ink only mask
  function rightPage(w, h) {
    const base = paper(w, h, 5, true), bg = base.getContext("2d");
    bg.textAlign = "center"; bg.textBaseline = "alphabetic";
    bg.font = `italic 400 ${Math.round(w * 0.054)}px "PD Lora", Georgia, serif`; bg.fillStyle = "rgba(70,45,20,.8)";
    bg.fillText("Signed into the book by", w / 2, h * 0.3);
    ornament(bg, w / 2, h * 0.6, w * 0.26, "rgba(120,80,30,.7)");
    const col = canvas(w, h), ink = canvas(w, h);
    return { base, col, ink };
  }
  function nameLayout(g, text, w) {
    let sz = Math.round(w * 0.16);
    g.font = `700 ${sz}px "PD Script", Georgia, serif`;
    while (g.measureText(text).width > w * 0.8 && sz > 20) { sz -= 2; g.font = `700 ${sz}px "PD Script", Georgia, serif`; }
    const m = g.measureText(text);
    return { sz, tw: m.width, x0: (w - m.width) / 2 };
  }
  function paintRight(P, handle, date, k, w, h) {
    const g = P.col.getContext("2d"), n = P.ink.getContext("2d");
    g.clearRect(0, 0, w, h); g.drawImage(P.base, 0, 0);
    n.clearRect(0, 0, w, h); n.fillStyle = "#000"; n.fillRect(0, 0, w, h);
    const text = `@${handle}`, L = nameLayout(g, text, w), y = h * 0.48;
    let tip = null;
    if (k > 0) {
      const reveal = L.tw * k + L.sz * 0.25;
      [g, n].forEach((c, i) => {
        c.save(); c.beginPath(); c.rect(0, y - L.sz * 1.2, L.x0 + reveal, L.sz * 1.8); c.clip();
        c.font = `700 ${L.sz}px "PD Script", Georgia, serif`; c.textAlign = "left"; c.textBaseline = "alphabetic";
        if (i === 0) {
          const gr = c.createLinearGradient(0, y - L.sz * 0.8, 0, y + L.sz * 0.2);
          gr.addColorStop(0, "#8f5a0a"); gr.addColorStop(0.6, INK); gr.addColorStop(1, "#3c1f03");
          c.fillStyle = gr; c.fillText(text, L.x0, y);
          c.globalAlpha = 0.22; c.fillStyle = "#ffd98a"; c.fillText(text, L.x0 - L.sz * 0.01, y - L.sz * 0.025);
        } else { c.fillStyle = "#fff"; c.fillText(text, L.x0, y); }
        c.restore();
      });
      if (k < 1) tip = { u: (L.x0 + L.tw * k) / w, v: (y - L.sz * 0.3) / h };
    }
    // the date and the seal appear once the name is done
    const after = clamp((k - 0.85) / 0.15, 0, 1);
    if (after > 0) {
      g.save(); g.globalAlpha = after; g.textAlign = "center";
      g.font = `italic 400 ${Math.round(w * 0.05)}px "PD Lora", Georgia, serif`; g.fillStyle = "rgba(70,45,20,.85)";
      g.fillText(date, w / 2, h * 0.68);
      // a small wax seal with a paw
      const sx = w * 0.5, sy = h * 0.82, sr = w * 0.075;
      const sg = g.createRadialGradient(sx - sr * 0.3, sy - sr * 0.3, sr * 0.1, sx, sy, sr);
      sg.addColorStop(0, "#b8463a"); sg.addColorStop(1, "#6e1d16");
      g.fillStyle = sg; g.beginPath();
      for (let i = 0; i <= 20; i++) { const a = i / 20 * 6.283, rr = sr * (1 + 0.06 * Math.sin(i * 2.7)); g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
      g.fill();
      g.fillStyle = "rgba(40,8,6,.55)";
      g.beginPath(); g.ellipse(sx, sy + sr * 0.18, sr * 0.3, sr * 0.24, 0, 0, 6.283); g.fill();
      [[-0.36, -0.22], [-0.13, -0.42], [0.13, -0.42], [0.36, -0.22]].forEach(([dx, dy]) => { g.beginPath(); g.ellipse(sx + dx * sr, sy + dy * sr, sr * 0.11, sr * 0.14, 0, 0, 6.283); g.fill(); });
      g.restore();
    }
    return tip;
  }

  // ---------- the scene ----------
  function mount(el, opts) {
    const THREE = T3();
    if (!THREE) throw new Error("three.js missing");
    opts = opts || {};
    let handle = (opts.handle || "keeper").replace(/^@/, "");
    const date = opts.date || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const small = Math.min(screen.width, screen.height) < 500 || (navigator.deviceMemory && navigator.deviceMemory <= 3);
    const renderer = new THREE.WebGLRenderer({ antialias: !small, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#120b07");
    scene.fog = new THREE.Fog("#120b07", 7, 13);
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 50);

    // a soft warm room for the gold to reflect
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const envGeo = new THREE.SphereGeometry(10, 32, 16);
    const envCols = new Float32Array(envGeo.attributes.position.count * 3);
    for (let i = 0; i < envGeo.attributes.position.count; i++) {
      const y = envGeo.attributes.position.getY(i) / 10, x = envGeo.attributes.position.getX(i) / 10;
      const warm = clamp(y * 0.9 + 0.35 + x * 0.25, 0, 1);
      envCols[i * 3] = lerp(0.06, 1.0, warm); envCols[i * 3 + 1] = lerp(0.04, 0.78, warm); envCols[i * 3 + 2] = lerp(0.03, 0.5, warm);
    }
    envGeo.setAttribute("color", new THREE.BufferAttribute(envCols, 3));
    env.add(new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    scene.environment = pm.fromScene(env, 0.04).texture;
    scene.environmentIntensity = 0.45;

    // light: one warm key from the upper right like a desk lamp, a cool low fill, and a faint candle flicker
    scene.add(new THREE.HemisphereLight("#ffdcb0", "#2a160c", 0.14));
    const key = new THREE.SpotLight("#ffd6a0", 72, 0, 0.62, 0.85, 2);
    key.position.set(1.8, 5.4, 2.6); key.target.position.set(0, 0, 0); scene.add(key.target); key.castShadow = true;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 14;
    key.shadow.bias = -0.0004; key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight("#8fa6d8", 0.35); fill.position.set(-4, 2, -2); scene.add(fill);
    const candle = new THREE.PointLight("#ffa04a", 1.2, 6, 2); candle.position.set(-2.2, 1.2, -1.2); scene.add(candle);

    // the desk: dark walnut
    const dc = canvas(1024, 1024), dg = dc.getContext("2d"), dr = rnd(19);
    dg.fillStyle = "#22120a"; dg.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 260; i++) {
      const y = dr() * 1024; dg.strokeStyle = `rgba(${dr() > 0.5 ? "70,40,22" : "15,7,3"},${0.15 + dr() * 0.25})`; dg.lineWidth = 0.6 + dr() * 2.5;
      dg.beginPath(); dg.moveTo(0, y); for (let x = 0; x <= 1024; x += 64) dg.lineTo(x, y + Math.sin(x * 0.006 + i) * 6 + (dr() - 0.5) * 2); dg.stroke();
    }
    const deskTex = new THREE.CanvasTexture(dc); deskTex.colorSpace = THREE.SRGBColorSpace;
    deskTex.wrapS = deskTex.wrapT = THREE.RepeatWrapping; deskTex.repeat.set(3, 3); deskTex.anisotropy = 4;
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ map: deskTex, roughness: 0.82, metalness: 0 }));
    desk.rotation.x = -Math.PI / 2; desk.position.y = -C - 0.001; desk.receiveShadow = true;
    scene.add(desk);

    const book = new THREE.Group(); scene.add(book);
    const tilt = new THREE.Group(); tilt.add(book); scene.add(tilt);
    const disposables = [renderer, pm, deskTex, desk.geometry, desk.material, envGeo];
    const tex = (c, srgb, rep) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } disposables.push(t); return t; };

    // a cover board: a rounded slab, lying flat, with its uvs spread over the whole face
    function board(map) {
      const w = W + O, h = H + 2 * O, r = 0.05, s = new THREE.Shape();
      s.moveTo(0, -h / 2); s.lineTo(w - r, -h / 2); s.quadraticCurveTo(w, -h / 2, w, -h / 2 + r); s.lineTo(w, h / 2 - r); s.quadraticCurveTo(w, h / 2, w - r, h / 2); s.lineTo(0, h / 2); s.lineTo(0, -h / 2);
      const geo = new THREE.ExtrudeGeometry(s, { depth: C - 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
      const p = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w, (p.getY(i) + h / 2) / h);
      geo.rotateX(-Math.PI / 2); geo.translate(0, -C / 2 + 0.006, 0);   // now it lies in x (0..w) and z, C thick, centred on y = 0
      // ExtrudeGeometry's front face looks down the shape's z, which after the turn faces +y: the cover's outside
      disposables.push(geo);
      const m = new THREE.MeshStandardMaterial({ map: map.col, roughnessMap: map.orm, metalnessMap: map.orm, bumpMap: map.bump, bumpScale: 1.6, roughness: 1, metalness: 1 });
      disposables.push(m);
      const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    }
    const faceL = leather(768, true), plainL = leather(512, false);
    const face = { col: tex(faceL.col, true), orm: tex(faceL.orm), bump: tex(faceL.bump) };
    const plain = { col: tex(plainL.col, true), orm: tex(plainL.orm), bump: tex(plainL.bump) };

    // page blocks: paper colour on top, gilded edges on the three open sides
    const edgeC = canvas(512, 64), eg = edgeC.getContext("2d");
    for (let y = 0; y < 64; y++) { eg.fillStyle = y % 3 === 0 ? "#9c7430" : (y % 3 === 1 ? "#d8ad5a" : "#c4963f"); eg.fillRect(0, y, 512, 1); }
    const edgeTex = tex(edgeC, true);
    const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.45, metalness: 0.75 });
    const topMat = new THREE.MeshStandardMaterial({ color: "#e9d8b4", roughness: 0.95 });
    const gutMat = new THREE.MeshStandardMaterial({ color: "#3a2412", roughness: 1 });
    disposables.push(edgeMat, topMat, gutMat);
    function block() {
      const g = new THREE.BoxGeometry(W - 0.02, T / 2, H - 0.02); disposables.push(g);
      // box faces: +x, -x, +y, -y, +z, -z
      const m = new THREE.Mesh(g, [edgeMat, gutMat, topMat, topMat, edgeMat, edgeMat]); m.castShadow = true; m.receiveShadow = true;
      return m;
    }

    // back half: back cover and the right page block, which stay put
    const back = board(plain); back.position.set(0, -C / 2, 0);
    // the back board's outside must face down; flip it
    back.rotation.x = Math.PI; book.add(back);
    const rightBlock = block(); rightBlock.position.set(W / 2, T / 4, 0); book.add(rightBlock);

    // front half: hinged at the spine, at the height of the page tops
    const hinge = new THREE.Group(); hinge.position.set(0, T / 2, 0); book.add(hinge);
    const front = board(face); front.position.set(0, T / 2 + C / 2, 0); hinge.add(front);
    const leftBlock = block(); leftBlock.position.set(W / 2, T / 4, 0); hinge.add(leftBlock);

    // the pages themselves
    const PW = 1024, PH = Math.round(1024 * (H - 0.03) / (W - 0.03));
    const leftTex = tex(leftPage(PW, PH), true);
    const RP = rightPage(PW, PH), rightTex = tex(RP.col, true), inkTex = tex(RP.ink, false);
    const pageGeo = (gutterAt) => {
      const pw = W - 0.03, g = new THREE.PlaneGeometry(pw, H - 0.03, 40, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const d = gutterAt < 0 ? p.getX(i) + pw / 2 : pw / 2 - p.getX(i), u = d / pw;
        p.setZ(i, 0.05 * (1 - Math.exp(-d / 0.09)) * (1 - u * u) - 0.012 * Math.exp(-d / 0.03));
      }
      g.computeVertexNormals(); disposables.push(g); return g;
    };
    const leftMat = new THREE.MeshStandardMaterial({ map: leftTex, roughness: 0.92 });
    const rightMat = new THREE.MeshStandardMaterial({ map: rightTex, roughness: 0.92, emissive: new THREE.Color("#ffb44a"), emissiveMap: inkTex, emissiveIntensity: 0 });
    disposables.push(leftMat, rightMat);
    const rightPageM = new THREE.Mesh(pageGeo(-1), rightMat);
    rightPageM.rotation.x = -Math.PI / 2; rightPageM.position.set(W / 2, T / 2 + 0.0016, 0); rightPageM.receiveShadow = true; book.add(rightPageM);
    // on the hinge the left page faces down until the cover is open, then faces up
    const leftPageM = new THREE.Mesh(pageGeo(1), leftMat);
    leftPageM.rotation.set(Math.PI / 2, 0, Math.PI); leftPageM.position.set(W / 2, -0.0016, 0); leftPageM.receiveShadow = true; hinge.add(leftPageM);

    // loose pages that riffle over: bent strips rebuilt every frame
    const SEG = 22, riff = [];
    const riffC = paper(256, Math.round(256 * H / W), 9, true), riffTex = tex(riffC, true);
    const riffMat = new THREE.MeshStandardMaterial({ map: riffTex, roughness: 0.95, side: THREE.DoubleSide });
    disposables.push(riffMat);
    for (let i = 0; i < RIFF_N; i++) {
      const g = new THREE.PlaneGeometry(W - 0.04, H - 0.04, SEG, 1); disposables.push(g);
      const m = new THREE.Mesh(g, riffMat); m.castShadow = true; m.visible = false; book.add(m);
      riff.push(m);
    }
    function bendPage(m, th) {
      // th: 0 lies on the right, PI lies on the left. The free edge lags behind the spine while it turns.
      const p = m.geometry.attributes.position, len = W - 0.04, du = len / SEG;
      const lag = Math.sin(th) * 0.9;
      let x = 0, y = T / 2 + 0.004;
      const xs = [x], ys = [y];
      for (let s = 0; s < SEG; s++) {
        const u = (s + 0.5) / SEG, a = th - lag * u * u * (th < Math.PI / 2 ? 1 : -0.6);
        x += Math.cos(a) * du; y += Math.sin(a) * du; xs.push(x); ys.push(Math.max(y, T / 2 + 0.004));
      }
      for (let i = 0; i < p.count; i++) {
        const col = i % (SEG + 1), row = Math.floor(i / (SEG + 1));
        p.setXYZ(i, xs[col], ys[col], row === 0 ? -(H - 0.04) / 2 : (H - 0.04) / 2);
      }
      p.needsUpdate = true; m.geometry.computeVertexNormals();
    }

    // the spine: a leather ribbon from the back board's edge to the front board's edge
    const SP = 18, spGeo = new THREE.BufferGeometry();
    const spPos = new Float32Array((SP + 1) * 4 * 3), spUv = new Float32Array((SP + 1) * 4 * 2), spIdx = [];
    for (let i = 0; i <= SP; i++) for (let j = 0; j < 4; j++) { spUv[(i * 4 + j) * 2] = i / SP; spUv[(i * 4 + j) * 2 + 1] = j % 2; }
    for (let i = 0; i < SP; i++) {
      const a = i * 4, b = (i + 1) * 4;
      spIdx.push(a, b, a + 1, b, b + 1, a + 1);             // outer
      spIdx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3); // inner
    }
    spGeo.setIndex(spIdx); spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute("uv", new THREE.BufferAttribute(spUv, 2));
    const spMat = new THREE.MeshStandardMaterial({ map: plain.col, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, bumpMap: plain.bump, bumpScale: 1 });
    const spine = new THREE.Mesh(spGeo, spMat); spine.castShadow = true; book.add(spine);
    disposables.push(spGeo, spMat);
    const tmp = new THREE.Vector3();
    function shapeSpine(th) {
      const ax = 0, ay = -C / 2;
      // the front board's spine edge, carried round by the hinge
      const r = T / 2 + C / 2, bx = -Math.sin(th) * r * 0 + Math.cos(th + Math.PI / 2) * r * 0, by = T / 2 + Math.cos(th) * r;
      const bxx = -Math.sin(th) * r;
      const mx = (ax + bxx) / 2, my = (ay + by) / 2, dx = bxx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1e-4;
      const nx = -dy / d, ny = dx / d;                     // points out of the book when closed
      const bulge = d * 0.55;
      const cx = mx + nx * bulge, cy = my + ny * bulge;
      const hz = H / 2 + O;
      for (let i = 0; i <= SP; i++) {
        const t = i / SP, it = 1 - t;
        const px = it * it * ax + 2 * it * t * cx + t * t * bxx, py = it * it * ay + 2 * it * t * cy + t * t * by;
        const tx = 2 * it * (cx - ax) + 2 * t * (bxx - cx), ty = 2 * it * (cy - ay) + 2 * t * (by - cy), tl = Math.hypot(tx, ty) || 1;
        const ox = -ty / tl * C / 2, oy = tx / tl * C / 2;   // half the leather's thickness, either side
        const set = (j, x, y, z) => { spPos[(i * 4 + j) * 3] = x; spPos[(i * 4 + j) * 3 + 1] = y; spPos[(i * 4 + j) * 3 + 2] = z; };
        set(0, px + ox, py + oy, -hz); set(1, px + ox, py + oy, hz); set(2, px - ox, py - oy, -hz); set(3, px - ox, py - oy, hz);
      }
      void bx; void tmp;
      spGeo.attributes.position.needsUpdate = true; spGeo.computeVertexNormals(); spGeo.computeBoundingSphere();
    }

    // the glowing nib at the tip of the ink, and a little dust in the lamp light
    const nibC = canvas(64, 64), ng = nibC.getContext("2d"), grd = ng.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,246,210,1)"); grd.addColorStop(0.3, "rgba(255,200,90,.6)"); grd.addColorStop(1, "rgba(255,170,60,0)");
    ng.fillStyle = grd; ng.fillRect(0, 0, 64, 64);
    const nibTex = tex(nibC, true);
    const nib = new THREE.Sprite(new THREE.SpriteMaterial({ map: nibTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    nib.scale.set(0.12, 0.12, 1); nib.visible = false; scene.add(nib); disposables.push(nib.material);
    const DN = small ? 60 : 140, dust = new Float32Array(DN * 3), dr2 = rnd(23);
    for (let i = 0; i < DN; i++) { dust[i * 3] = (dr2() - 0.5) * 5; dust[i * 3 + 1] = dr2() * 2.4; dust[i * 3 + 2] = (dr2() - 0.5) * 4; }
    const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: nibTex, size: 0.03, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(dustPts); disposables.push(dustGeo, dustPts.material);

    // ---------- the camera move: a closed book seen from the front, then settling over the open spread ----------
    const camA = { p: new THREE.Vector3(1.35, 2.7, 3.5), l: new THREE.Vector3(0.75, 0.05, 0.1) };
    const camB = { p: new THREE.Vector3(0.0, 3.55, 2.55), l: new THREE.Vector3(0.0, 0.0, 0.08) };
    const look = new THREE.Vector3();
    function fit() {
      const r = el.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
      renderer.setSize(w, h, false); cam.aspect = w / h;
      // keep the whole open book in view on a tall phone screen too
      cam.fov = cam.aspect < 1 ? 40 : 30;
      cam.updateProjectionMatrix();
    }
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);

    // drag to tilt; it eases back when let go
    let drag = null, tx = 0, ty = 0, vx = 0, vy = 0;
    const cv = renderer.domElement;
    cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, tx, ty }; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
    cv.addEventListener("pointermove", (e) => { if (!drag) return; tx = clamp(drag.tx + (e.clientX - drag.x) / 300, -0.6, 0.6); ty = clamp(drag.ty + (e.clientY - drag.y) / 400, -0.25, 0.3); });
    const up = () => { drag = null; cv.style.cursor = "grab"; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);

    let t0 = performance.now(), raf = 0, alive = true, lastInk = -1, lastDate = "";
    const clock = () => (typeof window.__bookT === "number" ? window.__bookT : (performance.now() - t0) / 1000);

    function pose(t) {
      const open = calm ? 1 : ease((t - OPEN0) / (OPEN1 - OPEN0));
      const th = open * Math.PI;
      hinge.rotation.z = th;
      hinge.position.y = T / 2 + Math.sin(th) * 0.02;
      leftPageM.visible = th > Math.PI * 0.5;
      shapeSpine(th);
      // pages riffle over once the cover is most of the way
      riff.forEach((m, i) => {
        const k = calm ? 1 : clamp((t - RIFF0 - i * RIFF_GAP) / RIFF_LEN, 0, 1);
        m.visible = k > 0 && k < 1;
        if (m.visible) bendPage(m, easeOut(k) * Math.PI);
      });
      // the name writes itself
      const ik = calm ? 1 : clamp((t - INK0) / (INK1 - INK0), 0, 1);
      const inkK = ik < 1 ? ik : 1;
      const qk = Math.round(inkK * 240) / 240;
      if (qk !== lastInk || lastDate !== date) {
        lastInk = qk; lastDate = date;
        const tip = paintRight(RP, handle, date, ease(qk), PW, PH);
        rightTex.needsUpdate = true; inkTex.needsUpdate = true;
        if (tip) {
          tmp.set((tip.u - 0.5) * (W - 0.03), (0.5 - tip.v) * (H - 0.03), 0.06);
          rightPageM.localToWorld(tmp); nib.position.copy(tmp); nib.visible = true;
        } else nib.visible = false;
      }
      // the ink glows warm while it is wet, then settles
      const wet = ik <= 0 ? 0 : ik < 1 ? 1 : Math.max(0.1, 1 - (t - INK1) / 1.6);
      rightMat.emissiveIntensity = (wet * 0.75) * (0.85 + 0.15 * Math.sin(t * 3));
      // camera glides from the closed book to the spread
      const ck = calm ? 1 : ease((t - 0.2) / 3.0);
      cam.position.lerpVectors(camA.p, camB.p, ck);
      look.lerpVectors(camA.l, camB.l, ck);
      // a narrow screen backs the camera off until the whole spread fits across
      const need = 1.75 / (Math.tan(cam.fov * Math.PI / 360) * cam.aspect), have = cam.position.distanceTo(look);
      if (need > have) cam.position.sub(look).multiplyScalar(need / have).add(look);
      // a slow breath once it is all done
      const idle = Math.max(0, t - INK1);
      cam.position.x += Math.sin(idle * 0.35) * 0.08 * clamp(idle, 0, 1);
      cam.position.y += Math.sin(idle * 0.27) * 0.04 * clamp(idle, 0, 1);
      cam.lookAt(look);
      candle.intensity = 1.1 + Math.sin(t * 7.1) * 0.08 + Math.sin(t * 13.3) * 0.05;
      // dust drifts slowly upward
      const dp = dustGeo.attributes.position;
      for (let i = 0; i < DN; i++) { let y = dust[i * 3 + 1] + 0.0016; if (y > 2.4) y = 0; dust[i * 3 + 1] = y; dust[i * 3] += Math.sin(t * 0.4 + i) * 0.0006; }
      dp.needsUpdate = true;
    }
    function tick() {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const t = clock();
      if (!drag) { tx *= 0.92; ty *= 0.92; }
      vx = lerp(vx, tx, 0.12); vy = lerp(vy, ty, 0.12);
      tilt.rotation.set(vy, vx, 0);
      pose(t);
      renderer.render(scene, cam);
    }
    // centre the open book on the origin: the spread runs from -W to +W
    book.position.set(0, 0, 0);

    const ready = fonts().then(() => {
      // fonts arrived: redraw everything that has words on it
      const lc = leftPage(PW, PH); leftTex.image = lc; leftTex.needsUpdate = true;
      const f2 = leather(768, true); face.col.image = f2.col; face.orm.image = f2.orm; face.bump.image = f2.bump;
      [face.col, face.orm, face.bump].forEach((t) => { t.needsUpdate = true; });
      const nb = rightPage(PW, PH); RP.base = nb.base; lastInk = -1;
      t0 = performance.now();
    });
    tick();

    return {
      ready,
      replay() { t0 = performance.now(); lastInk = -1; },
      setHandle(h) { handle = String(h || "keeper").replace(/^@/, ""); lastInk = -1; },
      // a finished frame at 1600 by 900, with the site name in the corner
      blob(width, height) {
        width = width || 1600; height = height || 900;
        const was = renderer.getPixelRatio(), r = el.getBoundingClientRect();
        renderer.setPixelRatio(1); renderer.setSize(width, height, false); cam.aspect = width / height; cam.fov = 30; cam.updateProjectionMatrix();
        const keep = window.__bookT; window.__bookT = INK1 + 2.4; pose(INK1 + 2.4); nib.visible = false; window.__bookT = keep;
        tilt.rotation.set(0, 0, 0);
        renderer.render(scene, cam);
        const out = canvas(width, height), g = out.getContext("2d");
        g.drawImage(renderer.domElement, 0, 0, width, height);
        const fs = Math.round(height * 0.028);
        g.font = `600 ${fs}px "Fredoka", "Nunito", sans-serif`; g.textAlign = "right"; g.fillStyle = "rgba(255,240,215,.85)";
        g.fillText("pdtools.xyz", width - fs * 1.4, height - fs * 1.2);
        renderer.setPixelRatio(was); renderer.setSize(r.width || width, r.height || height, false); fit();
        return new Promise((res) => { try { out.toBlob(res, "image/png"); } catch (e) { res(null); } });
      },
      destroy() {
        alive = false; cancelAnimationFrame(raf); ro.disconnect();
        disposables.forEach((d) => { try { d.dispose(); } catch (e) { /* fine */ } });
        renderer.domElement.remove();
      },
    };
  }
  window.PDBook3D = { mount };
})();
