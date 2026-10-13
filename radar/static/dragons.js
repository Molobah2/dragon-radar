/* Collectible dragons (v2). Finishing the daily goal (20 posts from fellow Keepers) hatches one egg a day.
   35 to collect on a fixed pace (about half in 30 goal days, all in 90); rares need a goal streak of 3, legends 7. Everything is kept in this browser
   (localStorage "pd:dex") and travels with the My progress backup code. */
(() => {
  "use strict";
  const D = window.PD_DEX;
  const $ = (id) => document.getElementById(id);
  const hatchEl = $("hatch"), dexEl = $("dex");
  if (!D || !hatchEl || !dexEl) return;
  const BASE = hatchEl.dataset.base || "https://res.cloudinary.com/gosbi0oh";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayGap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const GOAL = (() => { try { return JSON.parse($("radar-data").textContent).goal || 20; } catch (e) { return 20; } })();
  const TIERS = ["common", "rare", "legend"], TK = { common: "c", rare: "r", legend: "l" };
  const RARITY = { common: "Common", rare: "Rare holo", legend: "Golden legend", secret: "Secret relic" };

  // every collectible: 15 commons, 15 rare holo versions of the same species, 5 golden legends = 35
  const ENTRIES = [
    ...D.dragons.map((d) => ({ key: d.id + "-c", sp: d, tier: "common", pose: d.pose.c })),
    ...D.dragons.map((d) => ({ key: d.id + "-r", sp: d, tier: "rare", pose: d.pose.r })),
    ...D.legends.map((d) => ({ key: d.id + "-l", sp: d, tier: "legend", pose: d.pose })),
  ];
  // three secret relics, outside the 35. How to find them is never shown anywhere on the site.
  const SECRETS = (D.secrets || []).map((d) => ({ key: d.id + "-s", sp: d, tier: "secret", pose: d.pose }));
  const byKey = Object.fromEntries([...ENTRIES, ...SECRETS].map((e) => [e.key, e]));
  const TOTAL = ENTRIES.length;

  // The pace: one egg a day, and a fixed number of completed goal days brings each new dragon.
  // A Keeper who finishes the goal every day has about half the shelf after 30 days and all of it after 90.
  // Rares wait for a 3 day goal streak and legends for a 7 day one, so steady Keepers pull ahead.
  const SCHEDULE = {
    common: [1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 24, 27, 33],
    rare: [10, 20, 29, 36, 40, 44, 48, 52, 56, 64, 68, 72, 76, 80, 85],
    legend: [30, 45, 60, 75, 90],
  };
  const NEED = { common: 0, rare: 3, legend: 7 };

  // ---------- the collection ----------
  function load() {
    const d = store.get("pd:dex", null);
    const ok = d && typeof d === "object" && d.have && typeof d.have === "object";
    const out = ok ? { have: d.have, last: d.last || null, log: Array.isArray(d.log) ? d.log : [], n: d.n | 0, g: d.g || null }
      : { have: {}, last: null, log: [], n: 0, g: null };
    if (!out.n) out.n = new Set(out.log.map((l) => l.day)).size;   // older saves: count the days already hatched
    out.s = d && d.s && typeof d.s === "object" ? d.s : {};
    // a quiet tally of every post this device has opened on the feed, all time
    const fans = store.get("pd:authors", {}) || {};
    const past = Object.values(fans).reduce((a, v) => a + (v | 0), 0);
    out.e = Math.max(d && d.e | 0 || 0, past);
    return out;
  }
  let dex = load();
  const save = () => store.set("pd:dex", dex);
  const sealed = (e) => !!dex.s[e.sp.id];
  // the secret marks, kept unreadable on purpose
  const MARK = [3974678, 11828366, 24034322].map((v) => ((v ^ 0x2A5F3) - 104729) / 7919);
  function sealDue() { return SECRETS.find((e, i) => !sealed(e) && dex.e >= MARK[i]) || null; }
  const owned = (e) => ((dex.have[e.sp.id] || {})[TK[e.tier]] || 0) > 0;
  const found = () => ENTRIES.filter(owned).length;
  const foundIn = (tier) => ENTRIES.filter((e) => e.tier === tier && owned(e)).length;

  function goalDone() { const g = store.get("pd:goal", null); return !!g && g.day === today() && (g.n || 0) >= GOAL; }
  // the goal streak: days in a row with the daily goal finished
  function goalStreak() { const g = dex.g; return g && g.last && dayGap(g.last, today()) <= 1 ? g.count || 0 : 0; }
  function markGoalDay() {
    if (!goalDone()) return;
    const g = dex.g || { last: null, count: 0, best: 0 };
    if (g.last === today()) return;
    g.count = g.last && dayGap(g.last, today()) === 1 ? (g.count || 0) + 1 : 1;
    g.best = Math.max(g.best || 0, g.count); g.last = today();
    dex.g = g; save();
  }
  const canHatch = () => goalDone() && dex.last !== today();
  const due = (tier, n) => SCHEDULE[tier].filter((d) => d <= n).length - foundIn(tier);
  const rand = (list) => list[Math.floor(Math.random() * list.length)];

  function roll() {
    const n = dex.n + 1, gs = goalStreak();
    for (const tier of ["legend", "rare", "common"]) {
      if (due(tier, n) > 0 && gs >= NEED[tier]) {
        const missing = ENTRIES.filter((e) => e.tier === tier && !owned(e));
        if (missing.length) return { entry: rand(missing), fresh: true };
      }
    }
    // no new one today: a copy of one you have (rares only while your streak holds)
    const mine = ENTRIES.filter((e) => owned(e) && e.tier !== "legend" && (e.tier === "common" || gs >= NEED.rare));
    const commons = mine.filter((e) => e.tier === "common"), rares = mine.filter((e) => e.tier === "rare");
    const pool = rares.length && Math.random() < 0.2 ? rares : commons.length ? commons : ENTRIES.filter((e) => e.tier === "common");
    return { entry: rand(pool), fresh: false };
  }
  function keep(entry) {
    if (entry.tier === "secret") { dex.s[entry.sp.id] = today(); dex.log.push({ k: entry.key, day: today() }); dex.log = dex.log.slice(-120); save(); return; }
    const h = dex.have[entry.sp.id] || {}, k = TK[entry.tier];
    h[k] = (h[k] || 0) + 1;
    dex.have[entry.sp.id] = h;
    dex.last = today(); dex.n = (dex.n || 0) + 1;
    dex.log.push({ k: entry.key, day: today() });
    dex.log = dex.log.slice(-120);
    save();
  }
  // what to look forward to, for the shelf
  function nextNews() {
    const n = dex.n, gs = goalStreak();
    const waiting = ["legend", "rare"].find((t) => due(t, n) > 0 && gs < NEED[t]);
    if (waiting) return `A ${waiting === "legend" ? "golden legend" : "rare holo dragon"} is waiting for you. It hatches once your goal streak reaches ${NEED[waiting]} days.`;
    if (TIERS.some((t) => due(t, n + 1) > 0 && gs + 1 >= NEED[t] && ENTRIES.some((e) => e.tier === t && !owned(e)))) return "Your next egg brings a new dragon.";
    const all = [...SCHEDULE.common, ...SCHEDULE.rare, ...SCHEDULE.legend].filter((d) => d > n).sort((a, b) => a - b);
    if (!all.length) return found() >= TOTAL ? "You found every dragon. A true Keeper legend." : "";
    const k = all[0] - n;
    return k <= 1 ? "Your next egg brings a new dragon." : "More dragons are on the way. Keep your streak going.";
  }

  // ---------- sticker images: cut out of the art sheet on this device ----------
  const imgCache = new Map();
  // each dragon is its own square render on flat grey; it is cut out here and trimmed to the sticker
  function rawUrl(entry, h) {
    if (entry.tier === "secret") return `${BASE}/image/upload/c_scale,w_${Math.round(h * 1.25)}/f_png/${(D.secretArt || {})[entry.key] || "v1"}/dragon-radar/secret/${entry.key}`;
    if (flat(entry)) return `${BASE}/image/upload/c_scale,w_${Math.round(h * 1.25)}/f_png/${D.art2d[entry.key]}/dragon-radar/dex2d/${entry.key}`;
    return `${BASE}/image/upload/c_scale,w_${Math.round(h * 1.25)}/f_png/${D.art[entry.key] || "v1"}/dragon-radar/dex3/${entry.key}`;
  }
  // the golden legends are hand drawn 2D art on a clear background: they only need the white sticker edge
  const flat = (entry) => !!(D.art2d && D.art2d[entry.key]);
  function edge(im) {
    const W = im.naturalWidth, H = im.naturalHeight, b = Math.max(4, Math.round(W * 0.014)), pad = b + 2;
    const sil = document.createElement("canvas"); sil.width = W; sil.height = H;
    const sx = sil.getContext("2d"); sx.drawImage(im, 0, 0); sx.globalCompositeOperation = "source-in"; sx.fillStyle = "#fff"; sx.fillRect(0, 0, W, H);
    const c = document.createElement("canvas"); c.width = W + pad * 2; c.height = H + pad * 2;
    const x = c.getContext("2d");
    for (let a = 0; a < 24; a++) { const t = (a / 24) * Math.PI * 2; x.drawImage(sil, pad + Math.cos(t) * b, pad + Math.sin(t) * b); }
    x.drawImage(sil, pad, pad); x.drawImage(im, pad, pad);
    // trim to the sticker
    const d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let yy = 0; yy < c.height; yy += 2) for (let xx = 0; xx < c.width; xx += 2) if (d[(yy * c.width + xx) * 4 + 3] > 20) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
    if (x1 <= x0) return c;
    const o = document.createElement("canvas"); o.width = x1 - x0 + 4; o.height = y1 - y0 + 4;
    o.getContext("2d").drawImage(c, x0 - 2, y0 - 2, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }
  const loadImg = (src) => new Promise((res) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  // the sheets sit on flat grey and every sticker has a white border, so the grey is lifted off from the edges in
  function cutOut(im) {
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
    let g;
    try { g = x.getImageData(0, 0, W, H); } catch (e) { return c; }
    const d = g.data, N = W * H;
    const s = [];
    for (let X = 0; X < W; X += 3) s.push(X * 4, ((H - 1) * W + X) * 4);
    for (let Y = 0; Y < H; Y += 3) s.push(Y * W * 4, (Y * W + W - 1) * 4);
    const med = (o) => { const v = s.map((i) => d[i + o]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const bg = [med(0), med(1), med(2)], bgl = (bg[0] + bg[1] + bg[2]) / 3;
    const isBg = (i) => {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3, dl = l - bgl;
      const chroma = Math.abs(d[i] - bg[0] - dl) + Math.abs(d[i + 1] - bg[1] - dl) + Math.abs(d[i + 2] - bg[2] - dl);
      return chroma < 14 && dl < 12 && dl > -70;
    };
    const seen = new Uint8Array(N), q = [];
    const push = (p) => { if (!seen[p] && isBg(p * 4)) { seen[p] = 1; q.push(p); } };
    for (let X = 0; X < W; X++) { push(X); push((H - 1) * W + X); }
    for (let Y = 0; Y < H; Y++) { push(Y * W); push(Y * W + W - 1); }
    while (q.length) { const p = q.pop(), X = p % W; if (X > 0) push(p - 1); if (X < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < N - W) push(p + W); }
    // grey pockets the sticker wraps around (say between a wing and the tail) are background too.
    // Only big, almost perfectly flat ones with the light sticker border round their edge, so grey or silver art is never touched.
    // "flat" means one even tone (the upscaler can shift the pocket's grey a little from the outside grey)
    const chroma = (i) => { const dl = (d[i] + d[i + 1] + d[i + 2]) / 3 - bgl; return Math.abs(d[i] - bg[0] - dl) + Math.abs(d[i + 1] - bg[1] - dl) + Math.abs(d[i + 2] - bg[2] - dl); };
    const tried = new Uint8Array(N), minHole = N * 0.0005;
    const near = (r) => { const X = r % W; return [X > 0 ? r - 1 : -1, X < W - 1 ? r + 1 : -1, r >= W ? r - W : -1, r < N - W ? r + W : -1]; };
    for (let p0 = 0; p0 < N; p0++) {
      if (seen[p0] || tried[p0] || !isBg(p0 * 4)) continue;
      const part = [p0], st = [p0]; tried[p0] = 1;
      while (st.length) {
        const r = st.pop();
        for (const n of near(r)) if (n >= 0 && !seen[n] && !tried[n] && isBg(n * 4)) { tried[n] = 1; st.push(n); part.push(n); }
      }
      if (part.length < minHole || bgl < 100 || bgl > 200) continue;   // only on the usual mid grey backdrop
      const tones = part.map((r) => (d[r * 4] + d[r * 4 + 1] + d[r * 4 + 2]) / 3).sort((a, b) => a - b), mid = tones[tones.length >> 1];
      let flatN = 0, edge = 0, light = 0;
      for (const r of part) {
        const i = r * 4;
        if (Math.abs((d[i] + d[i + 1] + d[i + 2]) / 3 - mid) < 4 && chroma(i) < 9) flatN++;
        for (const n of near(r)) { if (n < 0 || tried[n]) continue; edge++; if ((d[n * 4] + d[n * 4 + 1] + d[n * 4 + 2]) / 3 > 200) light++; }
      }
      if (Math.abs(mid - bgl) < 14 && flatN >= part.length * 0.85 && light >= edge * 0.35) for (const r of part) seen[r] = 1;
    }
    // a die-cut sticker is one piece: keep the biggest, drop any stray specks
    const lab = new Int32Array(N);
    let cur = 0, bestN = 0, best = 0;
    for (let p = 0; p < N; p++) {
      if (seen[p] || lab[p]) continue;
      cur++; let n = 0; const st = [p]; lab[p] = cur;
      while (st.length) {
        const r = st.pop(); n++; const X = r % W;
        if (X > 0 && !seen[r - 1] && !lab[r - 1]) { lab[r - 1] = cur; st.push(r - 1); }
        if (X < W - 1 && !seen[r + 1] && !lab[r + 1]) { lab[r + 1] = cur; st.push(r + 1); }
        if (r >= W && !seen[r - W] && !lab[r - W]) { lab[r - W] = cur; st.push(r - W); }
        if (r < N - W && !seen[r + W] && !lab[r + W]) { lab[r + W] = cur; st.push(r + W); }
      }
      if (n > bestN) { bestN = n; best = cur; }
    }
    // the sticker sits in the middle of the render: prefer the piece that fills the centre most
    const inMid = new Map();
    for (let Y = Math.floor(H * 0.3); Y < H * 0.7; Y += 2) for (let X = Math.floor(W * 0.3); X < W * 0.7; X += 2) {
      const l = lab[Y * W + X]; if (l) inMid.set(l, (inMid.get(l) || 0) + 1);
    }
    let midN = 0;
    for (const [l, n] of inMid) if (n > midN) { midN = n; best = l; }
    for (let p = 0; p < N; p++) if (seen[p] || lab[p] !== best) d[p * 4 + 3] = 0;
    for (let p = 0; p < N; p++) {   // soften the edge by one pixel
      if (!d[p * 4 + 3]) continue;
      const X = p % W; let n = 0;
      if (X > 0 && !d[(p - 1) * 4 + 3]) n++; if (X < W - 1 && !d[(p + 1) * 4 + 3]) n++;
      if (p >= W && !d[(p - W) * 4 + 3]) n++; if (p < N - W && !d[(p + W) * 4 + 3]) n++;
      if (n) d[p * 4 + 3] = 255 - n * 45;
    }
    x.putImageData(g, 0, 0);
    // trim to the sticker
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let p = 0; p < N; p++) if (d[p * 4 + 3] > 40) { const X = p % W, Y = (p / W) | 0; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    if (x1 <= x0 || y1 <= y0) return c;
    const t = document.createElement("canvas"); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
    t.getContext("2d").drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
    return t;
  }
  function sticker(entry, h = 360) {
    const key = entry.key + ":" + h;
    if (!imgCache.has(key)) imgCache.set(key, loadImg(rawUrl(entry, h)).then((im) => (im ? (flat(entry) ? edge(im) : cutOut(im)) : null)));
    return imgCache.get(key);
  }
  async function stickerUrl(entry, h, dark) {
    const c = await sticker(entry, h);
    if (!c) return "";
    if (!dark) return c.toDataURL("image/png");
    const s = document.createElement("canvas"); s.width = c.width; s.height = c.height;
    const x = s.getContext("2d"); x.drawImage(c, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = "#2a3150"; x.fillRect(0, 0, s.width, s.height);
    return s.toDataURL("image/png");
  }

  // ---------- sheets ----------
  function openSheet(el) { el.hidden = false; requestAnimationFrame(() => el.classList.add("open")); document.body.classList.add("sheet-open"); }
  function closeSheet(el) {
    el.classList.remove("open");
    if (!document.querySelector(".sheet-wrap.open")) document.body.classList.remove("sheet-open");
    setTimeout(() => { if (!el.classList.contains("open")) el.hidden = true; }, 250);
  }
  for (const el of [hatchEl, dexEl]) el.addEventListener("click", (e) => { if (e.target === el) closeSheet(el); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!hatchEl.hidden) closeSheet(hatchEl); if (!dexEl.hidden) closeSheet(dexEl); } });

  // ---------- hatching ----------
  let shown = null;   // { entry, fresh } on the hatch sheet right now
  const stage = $("hatch-stage"), egg = $("hatch-egg"), pic = $("hatch-dragon");
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
  function setStage(state, look) { stage.dataset.state = state; stage.dataset.rarity = look || ""; }
  function paintEgg(entry) {
    const [body, spot] = entry.tier === "legend" ? ["#f5c542", "#fff1b8"] : entry.sp.egg;
    egg.style.setProperty("--body", body); egg.style.setProperty("--spot", spot);
  }

  function openHatch() {
    if (!canHatch()) { openDex(); return; }
    markGoalDay();
    // decided now and saved straight away, so reloading cannot reroll it
    let pending = store.get("pd:dexEgg", null);
    if (!pending || pending.day !== today() || !byKey[pending.k]) {
      const r = roll();
      pending = { day: today(), k: r.entry.key, fresh: r.fresh };
      store.set("pd:dexEgg", pending);
    }
    shown = { entry: byKey[pending.k], fresh: !!pending.fresh };
    const t = shown.entry.tier;
    paintEgg(shown.entry);
    sticker(shown.entry, 520);   // start loading while they look at the egg
    $("hatch-title").textContent = t === "legend" ? "A golden egg!" : t === "rare" ? "A shimmering egg!" : "Your egg is ready";
    $("hatch-sub").textContent = t === "legend" ? "Something legendary is inside. Tap to hatch it."
      : `You cheered on ${GOAL} fellow Keepers today. Tap the egg to hatch it.`;
    $("hatch-name").textContent = ""; $("hatch-name").hidden = true;
    $("hatch-actions").hidden = true; pic.hidden = true; egg.hidden = false; egg.disabled = false;
    egg.setAttribute("aria-label", "Hatch the egg");
    setStage("egg", t === "legend" ? "legend-egg" : t === "rare" ? "rare-egg" : "");
    openSheet(hatchEl);
  }


  // ---------- the relic film: a short premium moment between breaking the seal and the relic itself ----------
  const FILM = D.secretFilm || {};
  const filmSrc = (id) => FILM[id] ? `${BASE}/video/upload/q_auto:good/${FILM[id]}/dragon-radar/secret/film/${id}-film.mp4` : "";
  const filmPoster = (id) => FILM[id] ? `${BASE}/video/upload/so_0,q_auto,w_720/${FILM[id]}/dragon-radar/secret/film/${id}-film.jpg` : "";
  const FILM_GLOW = { moon: [190, 215, 255], ember: [255, 150, 60], star: [200, 150, 255] };
  const filmCache = {};
  function filmEl(id) {   // made early so the film is already loading while the Keeper looks at the seal
    if (filmCache[id]) return filmCache[id];
    const src = filmSrc(id); if (!src) return null;
    const v = document.createElement("video");
    v.src = src; v.poster = filmPoster(id); v.preload = "auto"; v.playsInline = true; v.setAttribute("playsinline", "");
    v.crossOrigin = "anonymous"; v.className = "relic-film-video";
    return (filmCache[id] = v);
  }
  function relicFilm(entry) {
    const id = entry.sp.id, v = filmEl(id);
    if (!v) return Promise.resolve();
    return new Promise((done) => {
      const [r, g, b] = FILM_GLOW[id] || FILM_GLOW.moon;
      const wrap = document.createElement("div");
      wrap.className = `relic-film ${id}`; wrap.style.setProperty("--glow", `${r}, ${g}, ${b}`);
      wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", `${entry.sp.name}, a secret relic awakens`);
      const sky = document.createElement("canvas"); sky.className = "relic-film-sky"; sky.setAttribute("aria-hidden", "true");
      const frame = document.createElement("div"); frame.className = "relic-film-frame"; frame.append(v);
      const kicker = document.createElement("p"); kicker.className = "relic-film-kicker";
      kicker.textContent = `Secret relic ${SECRETS.indexOf(entry) + 1} of ${SECRETS.length}`;
      const skip = document.createElement("button"); skip.type = "button"; skip.className = "relic-film-skip"; skip.textContent = "Skip";
      wrap.append(sky, frame, kicker, skip);
      document.body.append(wrap);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      // rising sparkles drawn in code, in the relic's own colour
      let raf = 0;
      if (!reduce) {
        const x = sky.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1);
        const size = () => { sky.width = innerWidth * dpr; sky.height = innerHeight * dpr; };
        size(); addEventListener("resize", size);
        const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: .6 + Math.random() * 2.4, v: .0006 + Math.random() * .0016, p: Math.random() * 6.28 }));
        const tick = (t) => {
          x.clearRect(0, 0, sky.width, sky.height);
          for (const m of motes) {
            m.y -= m.v; if (m.y < -.02) { m.y = 1.02; m.x = Math.random(); }
            const a = .35 + .45 * Math.sin(t / 600 + m.p);
            x.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`; x.beginPath(); x.arc(m.x * sky.width, m.y * sky.height, m.s * dpr, 0, 7); x.fill();
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        wrap._stop = () => removeEventListener("resize", size);
      }
      const snd = window.pdSound, withSound = !snd || snd.isOn();
      if (snd && withSound) snd.duck(.5);
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        clearTimeout(guard); wrap.classList.remove("on");
        if (snd && withSound) snd.unduck(1.8);
        setTimeout(() => { cancelAnimationFrame(raf); wrap._stop && wrap._stop(); v.pause(); wrap.remove(); done(); }, 650);
      };
      skip.addEventListener("click", finish);
      v.addEventListener("ended", () => setTimeout(finish, 450), { once: true });
      v.addEventListener("error", finish, { once: true });
      // a slow connection never leaves anyone waiting: no picture after 6 seconds and we go straight to the relic
      let guard = setTimeout(() => { if (v.readyState < 3) finish(); }, 6000);
      v.addEventListener("playing", () => { clearTimeout(guard); guard = setTimeout(finish, 9000); }, { once: true });
      requestAnimationFrame(() => wrap.classList.add("on"));
      try { v.currentTime = 0; } catch (e) {}
      v.muted = !withSound;
      const p = v.play();
      if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(finish); });
    });
  }

  egg.addEventListener("click", async () => {
    if (!shown || egg.disabled) return;
    egg.disabled = true;
    const { entry, fresh } = shown;
    const imgP = stickerUrl(entry, 520);
    if (entry.tier === "secret") {   // a slower, grander reveal: the seal breaks, the film plays, then the relic
      stage.dataset.state = "wobble"; await wait(1200);
      stage.dataset.state = "crack"; await wait(520);
      keep(entry);
      await relicFilm(entry);
      pic.src = await imgP; pic.alt = `${entry.sp.name}, a secret relic`;
      egg.hidden = true; pic.hidden = false;
      setStage("reveal", "secret-" + entry.sp.id);
      showName(entry, "new");
      renderDex();
      return;
    }
    stage.dataset.state = "wobble"; await wait(1300);
    stage.dataset.state = "crack"; await wait(380);
    keep(entry);
    try { localStorage.removeItem("pd:dexEgg"); } catch (e) {}
    pic.src = await imgP; pic.alt = `${RARITY[entry.tier]} ${entry.sp.name} dragon`;
    egg.hidden = true; pic.hidden = false;
    setStage("reveal", entry.tier);
    showName(entry, fresh ? "new" : "copy");
    refreshGoal();
    renderDex();
  });

  function showName(entry, mode) {
    const n = $("hatch-name"), have = (dex.have[entry.sp.id] || {})[TK[entry.tier]] || 1;
    n.innerHTML = "";
    const tag = document.createElement("span"); tag.className = "hatch-tag " + entry.tier + (entry.tier === "secret" ? " " + entry.sp.id : ""); tag.textContent = RARITY[entry.tier];
    const b = document.createElement("b"); b.textContent = entry.tier === "secret" ? entry.sp.name : `${entry.sp.name} dragon`;
    const p = document.createElement("small");
    p.textContent = entry.tier === "secret" ? `${entry.pose} · ${SECRETS.indexOf(entry) + 1} of ${SECRETS.length}`
      : `${entry.pose} · ${found()} of ${TOTAL} found${mode === "copy" ? ` · you have ${have}` : ""}`;
    n.append(tag, b, p); n.hidden = false;
    const t = entry.tier;
    if (xField) { xField.hidden = false; if (xIn) xIn.value = xName() ? "@" + xName() : ""; }
    if (t === "secret") {
      $("hatch-title").textContent = mode === "view" ? "My secret relic" : "You found a secret relic";
      $("hatch-sub").textContent = mode === "view" ? entry.sp.line : `${entry.sp.line} Very few Keepers will ever see this one.`;
      $("hatch-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText(entry, mode))}`;
      $("hatch-actions").hidden = false;
      if ($("hatch-film")) $("hatch-film").hidden = !filmSrc(entry.sp.id);
      prepShare(entry);
      return;
    }
    $("hatch-title").textContent = mode === "view" ? "My dragon"
      : mode === "copy" ? "Another one joins the family"
      : t === "legend" ? "A golden legend hatched!" : t === "rare" ? "A rare holo dragon hatched!" : "A new dragon hatched!";
    $("hatch-sub").textContent = mode === "view" ? "Show it off on X." : mode === "copy"
      ? `No new dragon today, but your ${entry.sp.name} has company. ${nextNews()}` : "It is now on your shelf. Show it off on X.";
    $("hatch-post").href = `https://x.com/intent/post?text=${encodeURIComponent(postText(entry, mode))}`;
    $("hatch-actions").hidden = false;
    if ($("hatch-film")) $("hatch-film").hidden = true;
    // cards pop up for moments worth sharing (a new dragon, a rare, a legend), never for every copy, so nothing feels farmed
    const worth = mode !== "copy" || t !== "common";
    ["hatch-post", "hatch-save"].forEach((id) => { if ($(id)) $(id).hidden = !worth; });
    if (xField) xField.hidden = !worth;
    if (!worth) $("hatch-sub").textContent = `Your ${entry.sp.name} has company. ${nextNews()}`;
    if (worth) prepShare(entry); else if ($("hatch-share")) $("hatch-share").hidden = true;
  }
  if ($("hatch-film")) $("hatch-film").addEventListener("click", () => { if (shown && shown.entry.tier === "secret") relicFilm(shown.entry); });

  // look at one you already have
  async function viewOne(entry) {
    shown = { entry, fresh: false };
    egg.hidden = true; pic.hidden = true;
    setStage("reveal", entry.tier === "secret" ? "secret-" + entry.sp.id : entry.tier);
    openSheet(hatchEl);
    pic.src = await stickerUrl(entry, 520); pic.alt = `${RARITY[entry.tier]} ${entry.sp.name} dragon`; pic.hidden = false;
    showName(entry, "view");
  }

  // ---------- sharing ----------
  const postText = (entry, mode) => {
    if (entry.tier === "secret") return `${mode === "view" ? "Still can not believe I have" : "I just found"} a secret relic on pdtools \u{1F409} ${entry.sp.name}. Nobody knows how to find them. pdtools.xyz`;
    const what = entry.tier === "legend" ? `a golden legendary ${entry.sp.name} dragon` : entry.tier === "rare" ? `a rare holo ${entry.sp.name} dragon` : `a ${entry.sp.name} dragon`;
    const gs = goalStreak(), streak = gs > 1 ? ` with a ${gs} day streak` : "";
    const lead = mode === "view" ? `Look at my ${what.replace(/^an? /, "")}` : `I just hatched ${what}`;
    return `${lead} on pdtools \u{1F409} ${found()} of ${TOTAL} found${streak}. Cheer on ${GOAL} fellow Keepers a day and hatch yours at pdtools.xyz`;
  };
  async function card(entry) {
    if (entry.tier === "secret") return secretCard(entry);
    const K = window.pdCard, t = entry.tier, sp = entry.sp;
    await K.fonts();
    const { c, x } = K.canvas(2), W = K.W, H = K.H, P = K.P;
    const idx = Math.max(0, (D.dragons || []).findIndex((d) => d.id === sp.id));
    const r = seeded(idx * 7919 + (t === "rare" ? 31 : t === "legend" ? 97 : 3));
    const egg = sp.egg || ["#c98a1e", "#5a3406"];
    const mix = (hex, to, k) => { const n = parseInt(hex.slice(1), 16), m = parseInt(to.slice(1), 16);
      const ch = (s) => Math.round(((n >> s) & 255) * (1 - k) + ((m >> s) & 255) * k); return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`; };
    // a deep, rich sky in the species' own colours for every tier; the tier shows in the finish
    const top = t === "legend" ? "#4a3008" : mix(egg[0], "#14123a", 0.42);
    const bot = t === "legend" ? "#120a02" : mix(egg[1], "#05061a", 0.72);
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, top); g.addColorStop(1, bot);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const tint = t === "legend" ? "255, 214, 110" : "255, 255, 255";
    const pattern = ["rays", "bokeh", "stars", "clouds", "scales", "ribbons"][(idx + (t === "rare" ? 2 : t === "legend" ? 4 : 0)) % 6];
    x.save();
    if (pattern === "rays") { x.translate(360, 330); x.globalAlpha = 0.09; x.fillStyle = `rgb(${tint})`;
      for (let i = 0; i < 18; i++) { x.rotate(Math.PI / 9); x.beginPath(); x.moveTo(0, 0); x.lineTo(-40, -820); x.lineTo(40, -820); x.closePath(); x.fill(); } }
    if (pattern === "bokeh") for (let i = 0; i < 30; i++) { const bx = r() * W, by = r() * H, br = 18 + r() * 70; const b = x.createRadialGradient(bx, by, 0, bx, by, br);
      b.addColorStop(0, `rgba(${tint}, ${0.1 + r() * 0.16})`); b.addColorStop(1, `rgba(${tint}, 0)`); x.fillStyle = b; x.beginPath(); x.arc(bx, by, br, 0, 7); x.fill(); }
    if (pattern === "stars") for (let i = 0; i < 150; i++) { x.globalAlpha = 0.2 + r() * 0.7; x.fillStyle = `rgb(${tint})`; x.beginPath(); x.arc(r() * W, r() * H, r() * 2.1 + 0.4, 0, 7); x.fill(); }
    if (pattern === "clouds") for (let i = 0; i < 8; i++) { const cx = r() * W, cy = 80 + r() * 520, cs = 40 + r() * 60; x.fillStyle = `rgba(${tint}, .06)`;
      [[0, 0, 1], [-0.9, 0.25, 0.7], [0.9, 0.25, 0.75], [-0.4, -0.35, 0.7], [0.45, -0.3, 0.65]].forEach(([dx, dy, k]) => { x.beginPath(); x.arc(cx + dx * cs, cy + dy * cs, cs * k, 0, 7); x.fill(); }); }
    if (pattern === "scales") { x.globalAlpha = 0.07; x.strokeStyle = `rgb(${tint})`; x.lineWidth = 2;
      for (let yy = -20; yy < H + 40; yy += 34) for (let xx = (yy / 34) % 2 ? 0 : 30; xx < W + 60; xx += 60) { x.beginPath(); x.arc(xx, yy, 30, 0, Math.PI); x.stroke(); } }
    if (pattern === "ribbons") for (let k = 0; k < 5; k++) { x.globalAlpha = 0.08; x.strokeStyle = `rgb(${tint})`; x.lineWidth = 18 + k * 6; x.beginPath();
      for (let i = 0; i <= 30; i++) { const px = (i / 30) * W, py = 120 + k * 110 + Math.sin(i / 4 + k) * 40; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
    x.restore();
    if (t === "rare") { const h = x.createLinearGradient(0, 0, W, H);
      ["#ff8ad8", "#8fd3ff", "#b77bff", "#6ee7d8", "#ffd76a"].forEach((col, i) => h.addColorStop(i / 4, col));
      x.save(); x.globalAlpha = 0.14; x.fillStyle = h; x.fillRect(0, 0, W, H); x.restore(); }
    K.vignette(x, 0.4);
    K.hero(x, await sticker(entry, 1000), { glow: t === "legend" ? "255, 214, 110" : t === "rare" ? "200, 220, 255" : "255, 245, 225" });
    K.panel(x, t === "legend" ? "rgba(255, 214, 110, .75)" : "rgba(255, 255, 255, .32)");
    const X = P.x + 40, inner = P.w - 80;
    K.pill(x, RARITY[t].toUpperCase(), X, P.y + 40, t === "legend" ? { bg: "#ffd76a", ink: "#3a2606" } : t === "rare" ? { bg: "rgba(168, 220, 255, .24)" } : {});
    x.fillStyle = K.INK; x.textAlign = "left";
    K.fit(x, `${sp.name} Dragon`, X, P.y + 148, inner, 60, 40);
    x.fillStyle = K.SOFT; x.font = '700 24px "Nunito", sans-serif'; x.fillText(entry.pose || "", X, P.y + 190);
    K.divider(x, P.y + 222);
    K.label(x, "HATCHED BY", X, P.y + 268);
    const who = xName(); x.fillStyle = K.INK; K.fit(x, who ? "@" + who : "A proud Keeper", X, P.y + 318, inner, 44, 28);
    const gs = goalStreak(); if (gs > 1) K.chip(x, `${gs} day goal streak`, X, P.y + 344);
    K.bar(x, `COLLECTION  ${found()} OF ${TOTAL}`, found(), TOTAL, P.y + 434, t === "legend" ? ["#fff1b8", "#e0a21a"] : t === "rare" ? ["#a8dcff", "#d79bff"] : ["#ffe08a", "#ff9f5a"]);
    K.footer(x);
    if (t === "legend") K.foil(x);
    K.grain(x, 0.05);
    return c;
  }

  // the X name the Keeper wants on their relic card (kept on this device only)
  const cleanX = (v) => String(v || "").trim().replace(/^@+/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
  const xName = () => cleanX(store.get("pd:xname", ""));
  const xField = $("hatch-xname"), xIn = $("hatch-xname-in");
  let xTimer = null;
  if (xIn) xIn.addEventListener("input", () => {
    const v = cleanX(xIn.value);
    store.set("pd:xname", v);
    clearTimeout(xTimer);
    xTimer = setTimeout(() => { if (shown) prepShare(shown.entry); }, 500);
  });

  // ---------- secret relic cards: each one has its own world ----------
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const LOOKS = {
    moon: { bg: ["#1a2647", "#070b1a"], glow: "rgba(190, 215, 255, .55)", ink: "#f4f7ff", soft: "rgba(220, 230, 255, .78)", accent: "#cfe0ff",
      frame: ["#f4f7ff", "#9fb3d9", "#e6eeff", "#7f93bd"], kicker: "SECRET RELIC  I" },
    ember: { bg: ["#3a1406", "#090302"], glow: "rgba(255, 140, 40, .6)", ink: "#fff1e0", soft: "rgba(255, 214, 180, .8)", accent: "#ffb347",
      frame: ["#ffd27a", "#b5521c", "#ffb347", "#6e2a0c"], kicker: "SECRET RELIC  II" },
    star: { bg: ["#2a1260", "#05031a"], glow: "rgba(190, 140, 255, .6)", ink: "#fff6dc", soft: "rgba(235, 220, 255, .82)", accent: "#ffd76a",
      frame: ["#fff1b8", "#e0a21a", "#ffd76a", "#8a5a0a"], kicker: "SECRET RELIC  III" },
  };
  async function secretCard(entry) {
    const W = 1200, H = 675, id = entry.sp.id, L = LOOKS[id] || LOOKS.moon, r = seeded(id.length * 7919 + 17);
    // drawn at twice the size so the 4K art stays crisp when shared
    const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2;
    const x = c.getContext("2d"); x.scale(2, 2);
    try { await document.fonts.load('700 60px "Fredoka"'); await document.fonts.load('800 20px "Nunito"'); } catch (e) {}
    // the sky of this relic
    const g = x.createRadialGradient(340, 330, 30, 600, 340, 900); g.addColorStop(0, L.bg[0]); g.addColorStop(1, L.bg[1]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (id === "star") {   // nebula clouds
      [["rgba(140, 60, 255, .35)", 260, 220, 420], ["rgba(40, 200, 220, .22)", 880, 160, 380], ["rgba(255, 90, 180, .22)", 760, 560, 420], ["rgba(255, 210, 120, .14)", 340, 420, 300]]
        .forEach(([col, cx, cy, rad]) => { const n = x.createRadialGradient(cx, cy, 0, cx, cy, rad); n.addColorStop(0, col); n.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = n; x.fillRect(0, 0, W, H); });
    }
    // stars, embers or moon dust
    const dots = id === "ember" ? 140 : 260;
    for (let i = 0; i < dots; i++) {
      const px = r() * W, py = id === "ember" ? H - Math.pow(r(), 0.7) * H : r() * H, sz = id === "ember" ? 1 + r() * 3.2 : 0.4 + r() * 1.8;
      x.globalAlpha = 0.25 + r() * 0.75;
      x.fillStyle = id === "ember" ? (r() < 0.5 ? "#ffb347" : "#ff6a1a") : id === "star" && r() < 0.15 ? "#ffd76a" : "#ffffff";
      if (id === "ember") { x.shadowColor = "#ff7a1a"; x.shadowBlur = 8; }
      x.beginPath(); x.arc(px, py, sz, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
    }
    x.globalAlpha = 1;
    if (id === "moon") {   // moonlight: a soft silver glow and a thin halo ring (the relic brings its own crescent)
      const mg = x.createRadialGradient(340, 330, 40, 340, 330, 360); mg.addColorStop(0, "rgba(220, 232, 255, .35)"); mg.addColorStop(0.55, "rgba(160, 185, 240, .12)"); mg.addColorStop(1, "rgba(7, 11, 26, 0)");
      x.fillStyle = mg; x.fillRect(0, 0, W, H);
      x.save(); x.strokeStyle = "rgba(220, 232, 255, .35)"; x.lineWidth = 1.5; x.shadowColor = "rgba(200, 220, 255, .8)"; x.shadowBlur = 14;
      x.beginPath(); x.arc(340, 337, 300, 0, Math.PI * 2); x.stroke();
      x.globalAlpha = 0.5; x.beginPath(); x.arc(340, 337, 318, 0, Math.PI * 2); x.stroke(); x.restore();
    }
    if (id === "ember") {   // molten cracks along the floor
      x.save(); x.strokeStyle = "#ff8a2a"; x.shadowColor = "#ff6a00"; x.shadowBlur = 18; x.lineWidth = 2.4; x.globalAlpha = 0.75;
      for (let k = 0; k < 7; k++) {
        let px = r() * 620, py = H - 30 - r() * 40; x.beginPath(); x.moveTo(px, py);
        for (let j = 0; j < 6; j++) { px += (r() - 0.5) * 140; py -= r() * 12; x.lineTo(px, py); }
        x.stroke();
      }
      x.restore();
    }
    if (id === "star") {   // golden constellations and light rays
      x.save(); x.translate(340, 337); x.globalAlpha = 0.08; x.fillStyle = "#ffd76a";
      for (let i = 0; i < 18; i++) { x.rotate(Math.PI / 9); x.beginPath(); x.moveTo(0, 0); x.lineTo(-40, -800); x.lineTo(40, -800); x.closePath(); x.fill(); }
      x.restore();
      x.save(); x.strokeStyle = "rgba(255, 215, 106, .55)"; x.fillStyle = "#ffe9a8"; x.lineWidth = 1.4;
      for (let k = 0; k < 4; k++) {
        const pts = Array.from({ length: 5 }, () => [40 + r() * 580, k % 2 ? 40 + r() * 170 : 470 + r() * 170]);
        x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke();
        pts.forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 2.6, 0, Math.PI * 2); x.fill(); });
      }
      x.restore();
    }
    // the glow and the relic itself
    const halo = x.createRadialGradient(340, 337, 10, 340, 337, 330); halo.addColorStop(0, L.glow); halo.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = halo; x.fillRect(0, 0, W, H);
    const s = await sticker(entry, 1000);
    if (s) {
      const k = Math.min(560 / s.height, 540 / s.width), w = s.width * k, hh = s.height * k;
      x.save(); x.shadowColor = L.glow; x.shadowBlur = 50; x.drawImage(s, 340 - w / 2, 337 - hh / 2, w, hh); x.restore();
      x.save(); x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = 30; x.shadowOffsetY = 14; x.drawImage(s, 340 - w / 2, 337 - hh / 2, w, hh); x.restore();
    }
    // an engraved double frame with corner jewels
    const fr = x.createLinearGradient(0, 0, W, H); L.frame.forEach((col, i) => fr.addColorStop(i / (L.frame.length - 1), col));
    x.strokeStyle = fr; x.lineWidth = 6; x.strokeRect(22, 22, W - 44, H - 44);
    x.lineWidth = 1.5; x.globalAlpha = 0.7; x.strokeRect(36, 36, W - 72, H - 72); x.globalAlpha = 1;
    [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]].forEach(([a, b]) => {
      x.save(); x.translate(a, b); x.rotate(Math.PI / 4); x.fillStyle = fr; x.shadowColor = L.glow; x.shadowBlur = 16; x.fillRect(-11, -11, 22, 22); x.restore();
    });
    // a soft shade behind the words so they always read
    const shade = x.createLinearGradient(600, 0, W, 0); shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(0.25, "rgba(0,0,0,.22)"); shade.addColorStop(1, "rgba(0,0,0,.3)");
    x.fillStyle = shade; x.fillRect(40, 40, W - 80, H - 80);
    // words
    x.textAlign = "left";
    x.fillStyle = L.accent; x.font = '800 22px "Nunito", system-ui, sans-serif';
    x.fillText(L.kicker.split("").join(String.fromCharCode(8202)), 660, 196);
    const words = entry.sp.name.split(" ");
    x.fillStyle = L.ink; x.font = '700 78px "Fredoka", system-ui, sans-serif';
    x.save(); x.shadowColor = L.glow; x.shadowBlur = 24;
    x.fillText(words[0], 660, 286); if (words[1]) x.fillText(words.slice(1).join(" "), 660, 364);
    x.restore();
    x.fillStyle = L.soft; x.font = '700 25px "Nunito", system-ui, sans-serif';
    wrap(x, entry.sp.line, 660, words[1] ? 420 : 344, 470, 34);
    x.fillStyle = L.accent; x.font = '800 22px "Nunito", system-ui, sans-serif';
    const who = xName();
    if (who) {   // the Keeper who earned it, signed on the card
      x.fillStyle = L.soft; x.font = '700 20px "Nunito", system-ui, sans-serif'; x.fillText("EARNED BY".split("").join(String.fromCharCode(8202)), 660, 520);
      x.fillStyle = L.ink; x.font = '700 40px "Fredoka", system-ui, sans-serif';
      x.save(); x.shadowColor = L.glow; x.shadowBlur = 18; x.fillText("@" + who, 660, 566); x.restore();
      x.fillStyle = L.accent; x.font = '800 18px "Nunito", system-ui, sans-serif';
      x.fillText(`Relic ${SECRETS.indexOf(entry) + 1} of ${SECRETS.length}`, 660, 604);
    } else {
      x.fillText(`Relic ${SECRETS.indexOf(entry) + 1} of ${SECRETS.length}`, 660, 560);
    }
    x.textAlign = "right"; x.fillStyle = L.ink; x.font = '800 21px "Nunito", system-ui, sans-serif';
    x.fillText("pdtools.xyz", W - 60, H - 58);
    return c;
  }
  function wrap(x, text, left, top, width, line) {
    let row = "", y = top;
    for (const w of text.split(" ")) {
      const t = row ? row + " " + w : w;
      if (x.measureText(t).width > width && row) { x.fillText(row, left, y); row = w; y += line; } else row = t;
    }
    if (row) x.fillText(row, left, y);
  }
  let shareFile = null, cardBlob = null;
  const track = (kind, ref) => { try { window.pdTrack && window.pdTrack(kind, ref); } catch (e) {} };
  const cardRef = (e) => (e && e.tier === "secret" ? "relic" : (e && e.tier) || "dragon");
  async function prepShare(entry) {
    shareFile = null; cardBlob = null; $("hatch-share").hidden = true;
    const c = await card(entry);
    const blob = await new Promise((r) => { try { c.toBlob(r, "image/png"); } catch (e) { r(null); } });
    if (!blob || !shown || shown.entry !== entry) return;
    cardBlob = blob;
    shareFile = new File([blob], `pdtools-${entry.key}-dragon.png`, { type: "image/png" });
    $("hatch-share").hidden = !(navigator.canShare && navigator.canShare({ files: [shareFile] }));
  }
  $("hatch-share").addEventListener("click", async () => {
    if (!shareFile || !shown) return;
    try { await navigator.share({ files: [shareFile], text: postText(shown.entry, "view") }); track("share", cardRef(shown.entry)); } catch (e) {}
  });
  $("hatch-save").addEventListener("click", async () => {
    if (!shown) return;
    const entry = shown.entry, btn = $("hatch-save"), label = btn.textContent;
    let b = cardBlob;
    if (!b) {
      btn.textContent = "Making your picture..."; btn.disabled = true;
      const c = await card(entry);
      b = await new Promise((r) => { try { c.toBlob(r, "image/png"); } catch (e) { r(null); } });
      btn.textContent = label; btn.disabled = false;
    }
    if (!b) return;
    track("save", cardRef(entry));
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `pdtools-${entry.key}-dragon.png`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $("hatch-post").addEventListener("click", () => { if (shown) track("share", cardRef(shown.entry)); });
  $("hatch-shelf").addEventListener("click", () => { closeSheet(hatchEl); setTimeout(openDex, 260); });
  $("hatch-close").addEventListener("click", () => closeSheet(hatchEl));

  // ---------- the shelf ----------
  function renderDex() {
    const f = found(), gs = goalStreak();
    $("dex-sub").textContent = f ? `${f} of ${TOTAL} found${gs ? ` · \u{1F525} ${gs} day goal streak` : ""}`
      : `No dragons yet. Cheer on ${GOAL} fellow Keepers today and your first egg hatches.`;
    $("dex-next").textContent = f ? nextNews() : "";
    $("dex-bar").style.setProperty("--p", `${(f / TOTAL) * 100}%`);
    $("dex-hatch").hidden = !canHatch();
    const grids = { common: $("dex-grid"), rare: $("dex-rares"), legend: $("dex-legends") };
    for (const tier of TIERS) {
      const grid = grids[tier]; grid.innerHTML = "";
      $(`dex-count-${tier}`).textContent = `${foundIn(tier)} of ${ENTRIES.filter((e) => e.tier === tier).length}`;
      for (const entry of ENTRIES.filter((e) => e.tier === tier)) {
        const have = owned(entry), count = (dex.have[entry.sp.id] || {})[TK[tier]] || 0;
        const fig = document.createElement(have ? "button" : "div");
        fig.className = `dex-card ${tier} ${have ? "have" : "missing"}`;
        if (have) { fig.type = "button"; fig.addEventListener("click", () => { closeSheet(dexEl); setTimeout(() => viewOne(entry), 260); }); }
        const im = document.createElement("img"); im.alt = have ? `${entry.sp.name} dragon` : ""; im.decoding = "async";
        const cap = document.createElement("span"); cap.className = "dex-cap";
        const b = document.createElement("b"); b.textContent = have || tier !== "legend" ? entry.sp.name : "???";
        const sm = document.createElement("small"); sm.textContent = have ? entry.pose : "Not found yet";
        cap.append(b, sm); fig.append(im, cap);
        if (count > 1) { const n = document.createElement("i"); n.className = "dex-count"; n.textContent = "x" + count; fig.append(n); }
        grid.append(fig);
        stickerUrl(entry, 220, !have).then((u) => { if (u) im.src = u; });
      }
    }
    renderSecrets();
  }
  function renderSecrets() {
    const grid = $("dex-secrets"); if (!grid) return;
    grid.innerHTML = "";
    const n = SECRETS.filter(sealed).length;
    $("dex-count-secret").textContent = n ? `${n} of ${SECRETS.length}` : "???";
    SECRETS.forEach((entry) => {
      const have = sealed(entry);
      const fig = document.createElement(have ? "button" : "div");
      fig.className = `dex-card secret ${entry.sp.id} ${have ? "have" : "missing"}`;
      if (have) {
        fig.type = "button"; fig.addEventListener("click", () => { closeSheet(dexEl); setTimeout(() => viewOne(entry), 260); });
        const im = document.createElement("img"); im.alt = entry.sp.name; im.decoding = "async"; fig.append(im);
        stickerUrl(entry, 220).then((u) => { if (u) im.src = u; });
      } else {
        const seal = document.createElement("i"); seal.className = "dex-seal"; seal.setAttribute("aria-hidden", "true"); fig.append(seal);
      }
      const cap = document.createElement("span"); cap.className = "dex-cap";
      const b = document.createElement("b"); b.textContent = have ? entry.sp.name : "Sealed";
      const sm = document.createElement("small"); sm.textContent = have ? "Secret relic" : "Nobody knows";
      cap.append(b, sm); fig.append(cap); grid.append(fig);
    });
  }
  // a relic is ready: it waits for a quiet moment, then the sealed relic appears
  function offerSeal() {
    const entry = sealDue();
    if (!entry || !hatchEl.hidden || document.querySelector(".sheet-wrap.open")) return;
    shown = { entry, fresh: true };
    egg.style.removeProperty("--body"); egg.style.removeProperty("--spot");
    $("hatch-title").textContent = "Something secret stirs";
    $("hatch-sub").textContent = "A sealed relic has appeared for you. Tap it to break the seal.";
    $("hatch-name").textContent = ""; $("hatch-name").hidden = true;
    $("hatch-actions").hidden = true; pic.hidden = true; egg.hidden = false; egg.disabled = false;
    egg.setAttribute("aria-label", "Break the seal");
    setStage("egg", "seal-" + entry.sp.id);
    sticker(entry, 520); sticker(entry, 1000);
    filmEl(entry.sp.id);
    openSheet(hatchEl);
  }
  addEventListener("pd:opened", () => {
    dex.e = (dex.e | 0) + 1; save();
    if (sealDue()) setTimeout(offerSeal, 900);
  });

  function openDex() { renderDex(); openSheet(dexEl); }
  $("dex-hatch").addEventListener("click", () => { closeSheet(dexEl); setTimeout(openHatch, 260); });
  $("dex-close").addEventListener("click", () => closeSheet(dexEl));
  document.querySelectorAll("[data-dex]").forEach((b) => b.addEventListener("click", openDex));

  // ---------- the daily goal pill becomes "hatch your egg" ----------
  const goalBtn = $("goal");
  function refreshGoal() {
    if (!goalBtn) return;
    markGoalDay();
    const ready = canHatch();
    goalBtn.classList.toggle("hatch-ready", ready);
    if (ready) $("goal-text").textContent = "Hatch your egg";
    else if (goalDone()) $("goal-text").textContent = "Daily goal done";
  }
  if (goalBtn) goalBtn.addEventListener("click", (e) => { if (canHatch()) { e.stopImmediatePropagation(); openHatch(); } }, true);
  addEventListener("pd:goaldone", () => { refreshGoal(); setTimeout(() => { if (canHatch() && hatchEl.hidden) openHatch(); }, 1600); });
  addEventListener("pd:goalshow", refreshGoal);
  addEventListener("pd:dexchange", () => { dex = load(); renderDex(); refreshGoal(); });
  addEventListener("storage", (e) => { if (e.key === "pd:dex" || e.key === "pd:goal") { dex = load(); refreshGoal(); } });
  refreshGoal();

  async function todayHatch() {
    const hit = [...(dex.log || [])].reverse().find((l) => l.day === today() && byKey[l.k] && byKey[l.k].tier !== "secret");
    if (!hit) return null;
    const entry = byKey[hit.k];
    return { name: entry.sp.name, tier: entry.tier, label: RARITY[entry.tier], img: await sticker(entry, 360) };
  }
  window.pdDex = { canHatch, openHatch, openDex, todayHatch };
  // a relic earned earlier (or brought over with a backup code) shows up once the page has settled
  (function waitCalm(t) { if (document.body.classList.contains("ready")) setTimeout(offerSeal, 2500); else if (t < 60) setTimeout(() => waitCalm(t + 1), 1000); })(0);
  if (location.hash === "#dragons") { history.replaceState(null, "", location.pathname + location.search); setTimeout(openDex, 600); }
})();
