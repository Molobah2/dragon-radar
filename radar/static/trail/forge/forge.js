/* The Keeper's forge: the first Trail reveal. The card is forged piece by piece on the anvil while the camera
   circles it: the slab drops in glowing hot and cools, the frame lands on it, every tile slams into place with
   sparks, the avatar coin drops last, then the finished card turns to face you.
   The room is one GLB made in Blender with its light baked in (lightmap.png), so it looks rich on any phone.
   ForgeReveal.start({ theme: "lava", onDone }) */
(() => {
  "use strict";
  const THREE = window.THREE, X = window.THREEX;
  const BASE = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, "")) || "./";
  const qs = new URLSearchParams(location.search);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (x) => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const fall = (x) => { x = clamp(x, 0, 1); return x * x; };   // gravity: slow at the top, fast at the bottom

  // ---------- timeline (seconds) ----------
  const T_SLAB = 1.3, T_FRAME = 2.5, T_TILE0 = 3.3, T_TILE_GAP = 0.55, DROP = 0.5;
  const TILE_ORDER = [3, 2, 4, 5, 6, 7, 0, 1];         // views, posts, replies, reposts, likes, timeline, profile, gold
  const T_AVA = T_TILE0 + TILE_ORDER.length * T_TILE_GAP + 0.35;
  const T_SWEEP = T_AVA + 0.9, T_FACE = T_SWEEP + 0.4, T_END = T_FACE + 2.0;

  // ---------- where things are (three.js units are metres; Blender Z up becomes Y up) ----------
  const CARD_C = new THREE.Vector3(0, 1.62, -0.7);
  const CW = 1.18, PX = CW / 2400;                     // the card is laid out on a 2400 by 1350 canvas
  const CH = 1350 * PX;

  function start(opts) {
    opts = opts || {};
    const theme = opts.theme || qs.get("theme") || "lava";
    const mount = opts.mount || document.getElementById("forge");
    const small = Math.min(screen.width, screen.height) < 500 || (navigator.deviceMemory && navigator.deviceMemory <= 4);
    const renderer = new THREE.WebGLRenderer({ antialias: !small, powerPreference: "high-performance", preserveDrawingBuffer: qs.has("shot") });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#07050a");
    scene.fog = new THREE.FogExp2("#120a06", 0.06);
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 60);

    // ---------- post: bloom only catches what truly glows (coals, sparks, the hot slab) ----------
    let composer = null, bloom = null;
    function setupPost() {
      composer = new X.EffectComposer(renderer);
      composer.addPass(new X.RenderPass(scene, cam));
      bloom = new X.UnrealBloomPass(new THREE.Vector2(512, 512), small ? 0.4 : 0.55, 0.5, 0.88);
      composer.addPass(bloom);
      composer.addPass(new X.OutputPass());
    }
    setupPost();
    function fit() {
      const w = mount.clientWidth || innerWidth, h = mount.clientHeight || innerHeight;
      renderer.setSize(w, h, false); composer.setSize(w, h); cam.aspect = w / h;
      cam.fov = cam.aspect < 1 ? 58 : 38; cam.updateProjectionMatrix();
    }
    addEventListener("resize", fit); fit();

    // ---------- the room ----------
    const lmTex = new THREE.TextureLoader().load(BASE + (small ? "lightmap-1k.webp" : "lightmap.webp"));
    lmTex.colorSpace = THREE.SRGBColorSpace; lmTex.flipY = false; lmTex.channel = 1;
    let K = 8;
    const ready = [];
    ready.push(fetch(BASE + "lightmap.json").then((r) => r.json()).then((j) => { K = j.K; }).catch(() => {}));
    const coalMats = [];
    const gltf = new X.GLTFLoader();
    const draco = new X.DRACOLoader(); draco.setDecoderPath(BASE + "draco/"); gltf.setDRACOLoader(draco);
    ready.push(new Promise((ok, no) => gltf.load(BASE + "forge.glb", (g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const baked = !!o.geometry.attributes.uv1;        // the room shell carries the baked light; props are lit live
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if (baked) { m.lightMap = lmTex; m.lightMapIntensity = K; }
          m.envMapIntensity = baked ? 0.05 : 0.35;
          if (/^ash/.test(m.name)) { m.color.set("#0b0806"); m.roughness = 1; }
          if (/^coal/.test(m.name)) { coalMats.push(m); m.color.set("#120604"); m.emissive.set("#ff4a0c"); m.emissiveIntensity = 1.0; }
          else if (m.emissive && m.emissive.getHex()) m.emissiveIntensity = 1.0;
        });
      });
      scene.add(g.scene); ok();
    }, undefined, no)));

    // only a few live lights: the room's light is already in the lightmap. These light the card and the sparks.
    scene.add(new THREE.HemisphereLight("#ffd9b0", "#1a0d06", 0.25));
    const fire = new THREE.PointLight("#ff7a2a", 6, 7, 1.6); fire.position.set(-2.1, 1.7, -2.0); scene.add(fire);
    const key = new THREE.SpotLight("#ffe2bc", 26, 9, 0.5, 0.7, 1.4); key.position.set(1.4, 3.6, 1.5); key.target.position.copy(CARD_C); scene.add(key, key.target);
    const rim = new THREE.PointLight("#6f8fff", 2.2, 7, 1.6); rim.position.set(-3.5, 2.6, -1.0); scene.add(rim);
    [[-0.9, 3.4, -1.0, 2.2], [1.6, 3.4, -2.3, 2.0], [2.2, 1.1, -1.6, 0.9], [0.9, 1.0, -3.1, 0.9]].forEach(([x, y, z, e]) => {
      const l = new THREE.PointLight("#ffb46a", e, 5, 1.8); l.position.set(x, y, z); scene.add(l);
    });
    const hot = new THREE.PointLight("#ff8a3a", 0, 2.4, 2); hot.position.copy(CARD_C).add(new THREE.Vector3(0, 0, 0.5)); scene.add(hot);

    // a soft warm environment for the card's gold and lacquer
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const eg = new THREE.SphereGeometry(10, 32, 16), ec = new Float32Array(eg.attributes.position.count * 3);
    for (let i = 0; i < eg.attributes.position.count; i++) {
      const y = eg.attributes.position.getY(i) / 10, x = eg.attributes.position.getX(i) / 10;
      const w = clamp(0.35 + y * 0.6 - x * 0.35, 0, 1);
      ec[i * 3] = lerp(0.05, 1.0, w); ec[i * 3 + 1] = lerp(0.03, 0.62, w); ec[i * 3 + 2] = lerp(0.02, 0.32, w);
    }
    eg.setAttribute("color", new THREE.BufferAttribute(ec, 3));
    envScene.add(new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    scene.environment = pm.fromScene(envScene, 0.04).texture;

    // ---------- the card, in pieces ----------
    const card = new THREE.Group(); card.position.copy(CARD_C); scene.add(card);
    const pieces = [];
    const texCache = {};
    function imgTex(dataUrl, srgb) {
      if (texCache[dataUrl]) return texCache[dataUrl];
      const t = new THREE.TextureLoader().load(dataUrl); t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4;
      return (texCache[dataUrl] = t);
    }
    // a rounded slab with the picture on its face only; the sides take a plain colour
    function slab(w, h, d, r, faceMat, sideCol) {
      const shape = new THREE.Shape(), x = -w / 2, y = -h / 2;
      r = Math.min(r, w / 2, h / 2);
      shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
      shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
      shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
      const bev = Math.min(d * 0.35, r * 0.5);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 10 });
      geo.translate(0, 0, -d / 2 + bev);
      // planar uvs from the front so the picture lands exactly on the face
      const p = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
      const side = new THREE.MeshStandardMaterial({ color: sideCol || "#2a1a10", roughness: 0.5, metalness: 0.2 });
      // ExtrudeGeometry groups: 0 = the caps (front and back), 1 = the sides
      const m = new THREE.Mesh(geo, [faceMat, side]); m.castShadow = true;
      return m;
    }
    function rectToLocal(rect, z) {
      const [x, y, w, h] = rect;
      return { x: (x + w / 2 - 1200) * PX, y: (675 - (y + h / 2)) * PX, w: w * PX, h: h * PX, z };
    }
    async function buildCard() {
      const j = await fetch(BASE + "../themes/" + theme + ".json").then((r) => r.json());
      const A = j.assets, F = j.scene.front, cfg = j.cfg || {};
      Object.keys(A).forEach((n) => { if (!/^(data|blob):/.test(A[n])) A[n] = "data:image/jpeg;base64," + A[n]; });
      // the Keeper's own name and numbers are painted onto the tiles (the Trail's KTL painter)
      if (window.KTL) { try { await window.KTL.paint(j); } catch (e) { console.warn("paint", e); } }
      const src = (n) => A[n];
      const hex = (n, d) => (typeof n === "number" ? "#" + n.toString(16).padStart(6, "0") : d);
      // 1. the base slab
      const baseMat = new THREE.MeshStandardMaterial({ map: imgTex(src("front-base.jpg")), roughness: 0.55, metalness: 0.05, emissive: new THREE.Color("#ff5a10"), emissiveIntensity: 0 });
      const base = slab(CW, CH, 0.03, 64 * PX, baseMat, hex(cfg.body, "#3a1a0c"));
      pieces.push({ kind: "slab", mesh: base, home: new THREE.Vector3(0, 0, 0), t: T_SLAB, from: new THREE.Vector3(0, 1.6, 0.25), spin: 0.25, mat: baseMat, hotFor: 2.2, snd: "lv_anvil" });
      // 2. the frame
      const fr = rectToLocal(F.frame.rect, 0);
      const frameMat = new THREE.MeshPhysicalMaterial({ map: imgTex(src("front-frame.jpg")), roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, emissive: new THREE.Color("#ff6a20"), emissiveIntensity: 0 });
      const frame = slab(fr.w, fr.h, 0.008, F.frame.r * PX, frameMat, hex(cfg.frameSide, "#2c1a0c"));
      pieces.push({ kind: "frame", mesh: frame, home: new THREE.Vector3(fr.x, fr.y, 0.019), t: T_FRAME, from: new THREE.Vector3(fr.x, fr.y + 1.2, 0.5), spin: -0.35, mat: frameMat, hotFor: 1.4, snd: "lv_hit" });
      // 3. the tiles
      TILE_ORDER.forEach((ti, n) => {
        const T = F.tiles[ti]; if (!T) return;
        const r = rectToLocal(T.rect, 0);
        const mat = new THREE.MeshPhysicalMaterial({ map: imgTex(src(T.tex)), roughness: T.kind === "gold" ? 0.3 : 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, emissive: new THREE.Color("#ff6a1a"), emissiveIntensity: 0 });
        if (T.metal && A[T.metal]) { mat.metalnessMap = imgTex(src(T.metal), false); mat.metalness = 1; }
        const m = slab(r.w, r.h, 0.016, T.r * PX, mat, T.side);
        const side = (n % 2 ? 1 : -1);
        pieces.push({ kind: "tile", mesh: m, home: new THREE.Vector3(r.x, r.y, 0.032), t: T_TILE0 + n * T_TILE_GAP,
          from: new THREE.Vector3(r.x + side * 0.5, r.y + 1.0, 0.7), spin: side * 0.6, mat, hotFor: 0.6, snd: n % 2 ? "clink" : "lv_hit" });
      });
      // 4. the avatar coin
      if (F.ava) {
        const r = rectToLocal(F.ava.rect, 0);
        const am = new THREE.MeshPhysicalMaterial({ map: imgTex(src(F.ava.tex)), roughness: 0.3, metalness: 0, clearcoat: 1, emissive: new THREE.Color("#ffd080"), emissiveIntensity: 0 });
        if (F.ava.metal && A[F.ava.metal]) { am.metalnessMap = imgTex(src(F.ava.metal), false); am.metalness = 1; }
        const geo = new THREE.CylinderGeometry(r.w / 2, r.w / 2, 0.012, 48); geo.rotateX(Math.PI / 2);
        const p = geo.attributes.position, uv = geo.attributes.uv;
        for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / r.w + 0.5, p.getY(i) / r.w + 0.5);
        const coin = new THREE.Mesh(geo, am);
        pieces.push({ kind: "ava", mesh: coin, home: new THREE.Vector3(r.x, r.y, 0.047), t: T_AVA, from: new THREE.Vector3(r.x, r.y + 0.9, 0.4), spin: 0, flip: true, mat: am, hotFor: 0.8, snd: "ring" });
      }
      pieces.forEach((pc) => { pc.mesh.visible = false; card.add(pc.mesh); });
    }
    ready.push(buildCard());

    // ---------- sparks and embers ----------
    const SPK = small ? 260 : 600;
    const spPos = new Float32Array(SPK * 3), spVel = new Float32Array(SPK * 3), spLife = new Float32Array(SPK), spCol = new Float32Array(SPK * 3);
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute("color", new THREE.BufferAttribute(spCol, 3));
    const dot = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,220,160,.8)"); r.addColorStop(1, "rgba(255,140,40,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.035, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sparks.frustumCulled = false; scene.add(sparks);
    let spNext = 0;
    function burst(at, n, power, up) {
      for (let k = 0; k < n; k++) {
        const i = spNext; spNext = (spNext + 1) % SPK;
        spPos[i * 3] = at.x; spPos[i * 3 + 1] = at.y; spPos[i * 3 + 2] = at.z;
        const a = Math.random() * Math.PI * 2, s = power * (0.4 + Math.random());
        spVel[i * 3] = Math.cos(a) * s; spVel[i * 3 + 1] = (up || 0.6) * s + Math.random() * s * 0.6; spVel[i * 3 + 2] = Math.sin(a) * s * 0.6 + s * 0.4;
        spLife[i] = 0.5 + Math.random() * 0.9;
      }
    }
    // embers drifting up out of the forge the whole time
    function embers(dt) {
      if (Math.random() < dt * (small ? 14 : 30)) {
        const i = spNext; spNext = (spNext + 1) % SPK;
        spPos[i * 3] = -2.1 + (Math.random() - 0.5) * 0.9; spPos[i * 3 + 1] = 1.0; spPos[i * 3 + 2] = -2.45 + (Math.random() - 0.5) * 0.8;
        spVel[i * 3] = (Math.random() - 0.5) * 0.15; spVel[i * 3 + 1] = 0.4 + Math.random() * 0.5; spVel[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
        spLife[i] = 1.5 + Math.random() * 1.5;
      }
    }
    function stepSparks(dt) {
      for (let i = 0; i < SPK; i++) {
        if (spLife[i] <= 0) { spCol[i * 3] = spCol[i * 3 + 1] = spCol[i * 3 + 2] = 0; continue; }
        spLife[i] -= dt;
        spVel[i * 3 + 1] -= (spPos[i * 3 + 1] > 1.05 && spPos[i * 3] < -1.5 ? -0.05 : 2.4) * dt;   // embers float, sparks fall
        spPos[i * 3] += spVel[i * 3] * dt; spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt; spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt;
        if (spPos[i * 3 + 1] < 0.01) { spPos[i * 3 + 1] = 0.01; spVel[i * 3 + 1] *= -0.3; spVel[i * 3] *= 0.5; spVel[i * 3 + 2] *= 0.5; }
        const l = clamp(spLife[i], 0, 1);
        spCol[i * 3] = 1.6 * l; spCol[i * 3 + 1] = 0.75 * l * l + 0.1 * l; spCol[i * 3 + 2] = 0.25 * l * l * l;
      }
      spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true;
    }

    // ---------- sound: real recordings from the Trail's sound pack ----------
    let ac = null, sfx = {}, muted = qs.has("mute");
    const sfxReady = fetch(BASE + "../sfx.json").then((r) => r.json()).then((d) => { sfx = d; }).catch(() => {});
    const bufs = {};
    async function play(name, vol) {
      if (muted || !ac || !sfx[name]) return;
      try {
        if (!bufs[name]) bufs[name] = await ac.decodeAudioData(await (await fetch(sfx[name])).arrayBuffer());
        const s = ac.createBufferSource(), g = ac.createGain(); g.gain.value = vol == null ? 0.8 : vol;
        s.buffer = bufs[name]; s.connect(g).connect(ac.destination); s.start();
      } catch (e) { /* fine */ }
    }
    function unlock() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* none */ } } if (ac && ac.state === "suspended") ac.resume(); }

    // ---------- the run ----------
    let t0 = 0, running = false, done = false, shake = 0, last = performance.now();
    const fired = new Set();
    const tmp = new THREE.Vector3();
    const clock = () => (qs.has("t") ? +qs.get("t") : (performance.now() - t0) / 1000);
    function once(key, fn) { if (!fired.has(key)) { fired.add(key); fn(); } }

    function pose(t, dt) {
      // camera: circles from the side to the front while the card is built, then settles
      const ok = ease(t / T_FACE);
      const fitK = cam.aspect < 1 ? 1.3 : 1;
      const ang = lerp(-1.25, 0, ok), rad = lerp(3.1, 2.15, ease(t / T_END)) * fitK, hy = lerp(2.25, 1.68, ok);
      cam.position.set(CARD_C.x + Math.sin(ang) * rad, hy, CARD_C.z + Math.cos(ang) * rad);
      tmp.copy(CARD_C); tmp.y += lerp(-0.3, -0.13, ok);
      if (shake > 0) { cam.position.x += (Math.random() - 0.5) * shake * 0.03; cam.position.y += (Math.random() - 0.5) * shake * 0.03; shake = Math.max(0, shake - dt * 4); }
      cam.lookAt(tmp);
      // the forge breathes, and flares when the work begins
      const flare = t > 0.6 && t < 2.2 ? Math.sin((t - 0.6) / 1.6 * Math.PI) : 0;
      fire.intensity = 6 + flare * 10 + Math.sin(t * 9) * 0.6 + Math.sin(t * 23) * 0.4;
      coalMats.forEach((m) => { m.emissiveIntensity = 0.8 + flare * 1.2 + Math.sin(t * 3 + 1) * 0.1; });
      once("flare", () => { if (t > 0.6) play("firewhoosh", 0.55); });
      // pieces fall, land with weight, and cool
      let heat = 0;
      pieces.forEach((pc, i) => {
        const k = (t - pc.t) / DROP;
        pc.mesh.visible = k > 0;
        if (k <= 0) return;
        const f = fall(k);
        pc.mesh.position.lerpVectors(pc.from, pc.home, f);
        pc.mesh.rotation.z = pc.spin * (1 - f);
        pc.mesh.rotation.x = (pc.flip ? Math.PI * 2 : 0.4) * (1 - f);
        if (k >= 1) {
          // a little squash and settle after the hit
          const s = t - pc.t - DROP, b = Math.exp(-s * 9) * Math.sin(s * 40) * 0.006;
          pc.mesh.position.z = pc.home.z + b;
          once("land" + i, () => {
            tmp.copy(pc.home); card.localToWorld(tmp);
            burst(tmp, pc.kind === "slab" ? 110 : pc.kind === "frame" ? 60 : 18, pc.kind === "slab" ? 2.2 : 1.5, 0.7);
            shake = pc.kind === "slab" ? 1 : pc.kind === "frame" ? 0.6 : 0.3;
            play(pc.snd, pc.kind === "slab" ? 0.9 : 0.6);
            if (pc.kind === "slab") play("impact", 0.5);
          });
        }
        // glowing hot when it arrives, cooling to its own colours
        const h = clamp(1 - (t - pc.t - DROP * 0.6) / pc.hotFor, 0, 1);
        pc.mat.emissiveIntensity = h * h * (pc.kind === "slab" ? 0.9 : pc.kind === "frame" ? 0.4 : 0.22);
        heat = Math.max(heat, h);
      });
      hot.intensity = heat * 2;
      // the finish: a light sweeps the card, it lifts a touch and the forge answers
      const sw = clamp((t - T_SWEEP) / 0.9, 0, 1);
      key.intensity = 26 + Math.sin(sw * Math.PI) * 40;
      card.position.y = CARD_C.y + easeOut((t - T_SWEEP) / 1.2) * 0.04 + (t > T_END ? Math.sin((t - T_END) * 1.3) * 0.008 : 0);
      card.rotation.y = t > T_END ? Math.sin((t - T_END) * 0.6) * 0.04 : 0;
      once("sweep", () => { if (t > T_SWEEP) { play("fin", 0.7); for (let e = 0; e < 4; e++) { tmp.set((e % 2 ? 1 : -1) * CW / 2, (e < 2 ? 1 : -1) * CH / 2, 0.05); card.localToWorld(tmp); burst(tmp, 10, 0.8, 1.0); } } });
      if (t > T_END && !done) { done = true; opts.onDone && opts.onDone(); }
      // bloom fades back after the build so the card reads clean
      if (bloom) bloom.strength = (small ? 0.4 : 0.55) + heat * 0.15;
    }
    function frame() {
      if (!running) return;
      requestAnimationFrame(frame);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = clock();
      embers(dt); stepSparks(dt);
      pose(t, dt);
      composer.render();
      if (qs.has("shot") && ++shotFrames >= 3) { running = false; document.documentElement.dataset.shot = "1"; }
    }
    let shotFrames = 0;
    const go = Promise.all(ready).then(() => sfxReady).then(() => {
      // warm the GPU before the show so nothing hitches on the first drop
      pieces.forEach((pc) => { pc.mesh.visible = true; });
      renderer.compile(scene, cam);
      pieces.forEach((pc) => { pc.mesh.visible = false; });
      t0 = performance.now(); running = true; last = performance.now(); requestAnimationFrame(frame);
      if (calm) t0 -= T_END * 1000;
    });
    return {
      ready: go,
      replay() { fired.clear(); done = false; t0 = performance.now(); unlock(); },
      unlock,
      mute(v) { muted = v; },
    };
  }
  window.ForgeReveal = { start };
})();
